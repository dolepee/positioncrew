import { cp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "esbuild";

const root = process.cwd();
const distRoot = resolve(root, "dist");
const clientRoot = resolve(distRoot, "client");
const serverRoot = resolve(distRoot, "server");
const drizzleRoot = resolve(root, "drizzle");
const drizzleMetaRoot = resolve(drizzleRoot, "meta");
const expectedMigration = "0000_fresh_benchmark_hires.sql";

const drizzleEntries = await readdir(drizzleRoot, { withFileTypes: true });
const drizzleInventory = drizzleEntries.map((entry) => entry.name).sort();
if (
  JSON.stringify(drizzleInventory) !== JSON.stringify([expectedMigration, "meta"]) ||
  !drizzleEntries.find((entry) => entry.name === expectedMigration)?.isFile() ||
  !drizzleEntries.find((entry) => entry.name === "meta")?.isDirectory()
) {
  throw new Error("Expected exactly one generated fresh-marketplace migration and its Drizzle metadata");
}
const drizzleMetaEntries = await readdir(drizzleMetaRoot, { withFileTypes: true });
const drizzleMetaInventory = drizzleMetaEntries.map((entry) => entry.name).sort();
if (
  JSON.stringify(drizzleMetaInventory) !==
    JSON.stringify(["0000_snapshot.json", "_journal.json"]) ||
  !drizzleMetaEntries.find((entry) => entry.name === "_journal.json")?.isFile() ||
  !drizzleMetaEntries.find((entry) => entry.name === "0000_snapshot.json")?.isFile()
) {
  throw new Error("Expected exactly the generated Drizzle journal and initial snapshot");
}

await rm(distRoot, { recursive: true, force: true });
await mkdir(clientRoot, { recursive: true });
await mkdir(serverRoot, { recursive: true });
await mkdir(resolve(distRoot, ".openai"), { recursive: true });

await cp(resolve(root, "dist-web"), clientRoot, { recursive: true });
await cp(
  resolve(root, ".openai", "hosting.json"),
  resolve(distRoot, ".openai", "hosting.json"),
);
await cp(
  drizzleRoot,
  resolve(distRoot, ".openai", "drizzle"),
  { recursive: true },
);

await build({
  entryPoints: [resolve(root, "worker", "index.ts")],
  outfile: resolve(serverRoot, "index.js"),
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  conditions: ["workerd", "browser", "import", "default"],
  external: ["node:buffer", "node:crypto"],
  logLevel: "info",
});

await writeFile(
  resolve(serverRoot, "wrangler.json"),
  `${JSON.stringify(
    {
      name: "positioncrew-marketplace",
      main: "index.js",
      compatibility_date: "2026-08-12",
      compatibility_flags: ["nodejs_compat"],
      no_bundle: true,
      assets: {
        directory: "../client",
        binding: "ASSETS",
        run_worker_first: true,
        not_found_handling: "single-page-application",
      },
      observability: { enabled: true },
    },
    null,
    2,
  )}\n`,
);
