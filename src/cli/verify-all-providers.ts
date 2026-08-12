import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runProviderJob } from "../application/run-provider-job.js";
import { MemoryCommerceAdapter } from "../commerce/memory-adapter.js";
import { CapitalOpsRequestSchema } from "../contracts/index.js";

const fixtureNames = [
  "lending-rescue/stressed-venus-position.v1.json",
  "lp-rebalance/out-of-range-v3-position.v1.json",
  "yield-optimization/venus-to-beefy.v1.json",
  "bounded-grid/bnb-usdt-grid.v1.json",
] as const;
const now = new Date("2026-08-12T16:00:30.000Z");
const adapter = new MemoryCommerceAdapter();
const results = [];

for (const fixtureName of fixtureNames) {
  const fixturePath = fileURLToPath(
    new URL(`../../fixtures/${fixtureName}`, import.meta.url),
  );
  const request = CapitalOpsRequestSchema.parse(
    JSON.parse(await readFile(fixturePath, "utf8")),
  );
  results.push(await runProviderJob(adapter, request, now));
}

const artifactPath = fileURLToPath(
  new URL("../../artifacts/main-track/provider-matrix.json", import.meta.url),
);
await mkdir(dirname(artifactPath), { recursive: true });
await writeFile(artifactPath, `${JSON.stringify(results, null, 2)}\n`, "utf8");

for (const result of results) {
  console.log(
    `${result.request.service.padEnd(20)} ${result.job.state.padEnd(10)} ${String(result.evaluation.score).padStart(3)}/100  ${result.deliverable.summary}`,
  );
}
console.log(`Artifact: ${artifactPath}`);
