import { resolve } from "node:path";
import {
  captureAgentBenchmarkRuns,
  captureManualBenchmarkRun,
  finalizeBlindBenchmark,
  prepareBenchmarkSession,
  readScorecard,
  revealBenchmarkResult,
  sessionSummary,
} from "../benchmark/evidence.js";
import {
  TERMIX_BENCHMARK_DEFINITIONS,
  type TermixBenchmarkSlug,
} from "../benchmark/lock.js";

function usage(): never {
  throw new Error(
    [
      "Usage:",
      "  npm run benchmark:session -- prepare <benchmark-slug>",
      "  npm run benchmark:session -- agent <session-directory>",
      "  npm run benchmark:session -- manual <session-directory> <output.json> <metadata.json>",
      "  npm run benchmark:session -- blind <session-directory>",
      "  npm run benchmark:session -- reveal <session-directory> <completed-scorecard.json>",
      "  npm run benchmark:session -- status <session-directory>",
    ].join("\n"),
  );
}

function benchmarkSlug(value: string | undefined): TermixBenchmarkSlug {
  const definition = TERMIX_BENCHMARK_DEFINITIONS.find((candidate) => candidate.slug === value);
  if (!definition) usage();
  return definition.slug;
}

function required(value: string | undefined): string {
  if (!value) usage();
  return value;
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  switch (command) {
    case "prepare": {
      const prepared = prepareBenchmarkSession(benchmarkSlug(args[0]));
      console.log(JSON.stringify(prepared, null, 2));
      return;
    }
    case "agent": {
      const directory = resolve(required(args[0]));
      const records = await captureAgentBenchmarkRuns(directory);
      console.log(
        JSON.stringify(
          {
            ...sessionSummary(directory),
            agentRuns: records.map((record) => ({
              runNumber: record.runNumber,
              elapsedMilliseconds: record.elapsedMilliseconds,
              outputHash: record.outputHash,
              conformance: record.conformance,
            })),
          },
          null,
          2,
        ),
      );
      return;
    }
    case "manual": {
      const directory = resolve(required(args[0]));
      const output = readScorecard(required(args[1]));
      const record = captureManualBenchmarkRun(directory, output, readScorecard(required(args[2])));
      console.log(
        JSON.stringify(
          {
            ...sessionSummary(directory),
            manualRun: {
              elapsedMilliseconds: record.elapsedMilliseconds,
              directCostUsd: record.directCostUsd,
              outputHash: record.outputHash,
            },
          },
          null,
          2,
        ),
      );
      return;
    }
    case "blind": {
      const directory = resolve(required(args[0]));
      const finalized = finalizeBlindBenchmark(directory);
      console.log(
        JSON.stringify(
          {
            ...sessionSummary(directory),
            packetHash: finalized.packet.packetHash,
            mappingCommitment: finalized.packet.mappingCommitment,
            evaluatorPacket: finalized.packetPath,
            scorecardTemplate: finalized.scorecardPath,
          },
          null,
          2,
        ),
      );
      return;
    }
    case "reveal": {
      const directory = resolve(required(args[0]));
      const result = revealBenchmarkResult(directory, readScorecard(required(args[1])));
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    case "status": {
      console.log(JSON.stringify(sessionSummary(resolve(required(args[0]))), null, 2));
      return;
    }
    default:
      usage();
  }
}

await main();
