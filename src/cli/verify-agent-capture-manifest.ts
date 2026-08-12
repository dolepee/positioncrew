import { verifyAgentCaptureManifest } from "../benchmark/capture-manifest.js";

const manifest = verifyAgentCaptureManifest();
console.log(
  JSON.stringify(
    {
      manifestHash: manifest.manifestHash,
      sourceCommit: manifest.source.commitSha,
      benchmarks: manifest.benchmarks.map((benchmark) => ({
        slug: benchmark.benchmarkSlug,
        sessionId: benchmark.sessionId,
        candidateCount: benchmark.candidates.length,
        outputHash: benchmark.candidates[0]!.outputHash,
      })),
    },
    null,
    2,
  ),
);
