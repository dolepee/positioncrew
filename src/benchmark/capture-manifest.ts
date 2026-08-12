import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { HashSchema, TimestampSchema } from "../contracts/common.js";
import { canonicalHash } from "../core/canonical.js";
import {
  TERMIX_BENCHMARK_DEFINITIONS,
  verifyTermixBenchmarkLocks,
} from "./lock.js";

const LockSchema = z
  .object({
    schemaVersion: z.literal("positioncrew.benchmark-lock.v1"),
    taskId: z.string().min(8),
    fixtureHash: HashSchema,
    rubricHash: HashSchema,
    protocolHash: HashSchema,
  })
  .strict();

const CaptureSchema = z
  .object({
    runNumber: z.number().int().min(1).max(2),
    candidateHash: HashSchema,
    outputHash: HashSchema,
    evaluationHash: HashSchema,
  })
  .strict();

const ManifestBodySchema = z
  .object({
    schemaVersion: z.literal("positioncrew.agent-capture-commitments.v1"),
    createdAt: TimestampSchema,
    source: z
      .object({
        repository: z.literal("https://github.com/dolepee/positioncrew"),
        commitSha: z.string().regex(/^[a-f0-9]{40}$/),
      })
      .strict(),
    benchmarks: z
      .array(
        z
          .object({
            benchmarkSlug: z.enum(["lending-rescue", "lp-rebalance", "bounded-grid"]),
            sessionId: z.string().min(12),
            providerId: z.string().min(1),
            benchmarkLock: LockSchema,
            candidates: z.array(CaptureSchema).length(2),
          })
          .strict(),
      )
      .length(3),
    boundary: z.string().min(20),
  })
  .strict();

const CaptureManifestSchema = ManifestBodySchema.extend({ manifestHash: HashSchema }).strict();

export function verifyAgentCaptureManifest(
  root = process.cwd(),
  relativePath = "benchmarks/agent-capture-commitments-2026-08-12.json",
): z.infer<typeof CaptureManifestSchema> {
  const manifest = CaptureManifestSchema.parse(
    JSON.parse(readFileSync(resolve(root, relativePath), "utf8")),
  );
  const { manifestHash, ...body } = manifest;
  if (canonicalHash(ManifestBodySchema.parse(body)) !== manifestHash) {
    throw new Error("Agent capture manifest commitment is invalid");
  }
  const expectedLocks = new Map(
    verifyTermixBenchmarkLocks(root).map((record) => [record.slug, record.lock]),
  );
  const expectedSlugs = TERMIX_BENCHMARK_DEFINITIONS.map((definition) => definition.slug);
  if (
    new Set(manifest.benchmarks.map((benchmark) => benchmark.benchmarkSlug)).size !== 3 ||
    expectedSlugs.some(
      (slug) => !manifest.benchmarks.some((benchmark) => benchmark.benchmarkSlug === slug),
    )
  ) {
    throw new Error("Agent capture manifest does not contain the three required benchmarks");
  }
  for (const benchmark of manifest.benchmarks) {
    if (canonicalHash(benchmark.benchmarkLock) !== canonicalHash(expectedLocks.get(benchmark.benchmarkSlug))) {
      throw new Error(`${benchmark.benchmarkSlug} capture lock does not match the public benchmark`);
    }
    if (benchmark.candidates.map((candidate) => candidate.runNumber).sort().join(",") !== "1,2") {
      throw new Error(`${benchmark.benchmarkSlug} does not commit runs 1 and 2 exactly once`);
    }
    if (new Set(benchmark.candidates.map((candidate) => candidate.candidateHash)).size !== 2) {
      throw new Error(`${benchmark.benchmarkSlug} candidate commitments are not distinct`);
    }
    if (new Set(benchmark.candidates.map((candidate) => candidate.outputHash)).size !== 1) {
      throw new Error(`${benchmark.benchmarkSlug} agent outputs do not reproduce`);
    }
  }
  return manifest;
}
