import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "esbuild";

const root = process.cwd();
const distRoot = resolve(root, "dist");
const clientRoot = resolve(distRoot, "client");
const serverRoot = resolve(distRoot, "server");

await rm(distRoot, { recursive: true, force: true });
await mkdir(clientRoot, { recursive: true });
await mkdir(serverRoot, { recursive: true });
await mkdir(resolve(distRoot, ".openai"), { recursive: true });

await cp(resolve(root, "dist-web"), clientRoot, { recursive: true });
await cp(
  resolve(root, ".openai", "hosting.json"),
  resolve(distRoot, ".openai", "hosting.json"),
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
