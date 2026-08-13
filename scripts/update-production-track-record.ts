import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  appendProductionTrackRecordRun,
  type ProductionMonitorEpoch,
  type ProductionTrackRecordRun,
} from "../src/operations/production-track-record.js";

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const [inputArgument, outputArgument] = process.argv.slice(2);
if (!inputArgument || !outputArgument) {
  throw new Error("Usage: update-production-track-record <current.json> <next.json>");
}
if (requiredEnvironment("GITHUB_EVENT_NAME") !== "schedule") {
  throw new Error("Only scheduled workflow runs may update the production track record");
}

const inputPath = resolve(inputArgument);
const outputPath = resolve(outputArgument);
const generatedAt = new Date().toISOString();
const runId = Number(requiredEnvironment("GITHUB_RUN_ID"));
if (!Number.isInteger(runId) || runId <= 0) throw new Error("GITHUB_RUN_ID is invalid");
const repository = requiredEnvironment("GITHUB_REPOSITORY");
const headSha = requiredEnvironment("GITHUB_SHA");
const verifyOutcome = requiredEnvironment("VERIFY_OUTCOME");
const token = requiredEnvironment("GH_TOKEN");
const runUrl = `${process.env.GITHUB_SERVER_URL ?? "https://github.com"}/${repository}/actions/runs/${runId}`;

let createdAt = generatedAt;
try {
  const response = await fetch(`https://api.github.com/repos/${repository}/actions/runs/${runId}`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "User-Agent": "PositionCrew-Production-Record-Writer/1.0",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (response.ok) {
    const metadata = await response.json() as { created_at?: unknown };
    if (typeof metadata.created_at === "string" && Number.isFinite(Date.parse(metadata.created_at))) {
      createdAt = metadata.created_at;
    }
  }
} catch {
  // The authenticated metadata lookup improves timestamps but never gates recording an outcome.
}

const epoch = JSON.parse(
  await readFile(resolve("evidence/production-monitor-epoch.json"), "utf8"),
) as ProductionMonitorEpoch;
const current: unknown = JSON.parse(await readFile(inputPath, "utf8"));
const run: ProductionTrackRecordRun = {
  runId,
  status: "completed",
  conclusion: verifyOutcome,
  createdAt,
  completedAt: generatedAt,
  headSha,
  url: runUrl,
};
const next = appendProductionTrackRecordRun(current, epoch, run, generatedAt);
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(next, null, 2)}\n`);
console.log(
  `Recorded scheduled run ${runId}: ${verifyOutcome}; ${next.summary.successfulRuns}/${next.summary.completedRuns} successful`,
);
