import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runLendingRescueJob } from "../application/run-lending-rescue-job.js";
import { MemoryCommerceAdapter } from "../commerce/memory-adapter.js";
import { LendingRescueRequestSchema } from "../contracts/lending-rescue.js";

const fixturePath = fileURLToPath(
  new URL("../../fixtures/lending-rescue/stressed-venus-position.v1.json", import.meta.url),
);
const artifactPath = fileURLToPath(
  new URL("../../artifacts/gate2a/lending-rescue-result.json", import.meta.url),
);
const fixture = LendingRescueRequestSchema.parse(
  JSON.parse(await readFile(fixturePath, "utf8")),
);
const now = new Date("2026-08-12T16:00:30.000Z");
const result = await runLendingRescueJob(new MemoryCommerceAdapter(), fixture, now);

await mkdir(dirname(artifactPath), { recursive: true });
await writeFile(artifactPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");

const recommendation = result.deliverable.recommendation;
console.log(`Job: ${result.job.jobId} (${result.job.state})`);
console.log(`Result: ${result.deliverable.summary}`);
console.log(
  recommendation
    ? `Action: ${recommendation.kind} ${recommendation.amount} ${recommendation.asset.symbol} (${recommendation.amountBaseUnits} base units)`
    : "Action: none",
);
console.log(`Evaluation: ${result.evaluation.score}/100 ${result.evaluation.passed ? "PASS" : "FAIL"}`);
console.log(`Artifact: ${artifactPath}`);
