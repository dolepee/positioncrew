import lendingFixture from "../../fixtures/lending-rescue/stressed-venus-position.v1.json" with { type: "json" };
import lpFixture from "../../fixtures/lp-rebalance/out-of-range-v3-position.v1.json" with { type: "json" };
import yieldFixture from "../../fixtures/yield-optimization/venus-to-beefy.v1.json" with { type: "json" };
import gridFixture from "../../fixtures/bounded-grid/bnb-usdt-grid.v1.json" with { type: "json" };
import benchmarkProtocol from "../../benchmarks/lending-rescue/protocol.v1.json" with { type: "json" };
import benchmarkRubric from "../../benchmarks/lending-rescue/rubric.v1.json" with { type: "json" };
import { runProviderJob, type ProviderJobResult } from "../application/run-provider-job.js";
import type { BenchmarkLock } from "../benchmark/lock.js";
import { MemoryCommerceAdapter } from "../commerce/memory-adapter.js";
import {
  LendingRescueRequestSchema,
  PositionCrewRequestSchema,
  type PositionCrewRequest,
} from "../contracts/index.js";
import { canonicalHash } from "../core/canonical.js";

const FIXTURE_NOW = new Date("2026-08-12T16:00:30.000Z");
const FIXTURES = [lendingFixture, lpFixture, yieldFixture, gridFixture] as const;
const LENDING_BENCHMARK_LOCK: BenchmarkLock = {
  schemaVersion: "positioncrew.benchmark-lock.v1",
  taskId: benchmarkProtocol.taskId,
  fixtureHash: canonicalHash(lendingFixture),
  rubricHash: canonicalHash(benchmarkRubric),
  protocolHash: canonicalHash(benchmarkProtocol),
};

export const CLAIM_BOUNDARY = [
  "Frozen BSC test fixtures are used; no live wallet or protocol state is read.",
  "The lifecycle is an in-memory conformance rail, not an AACP or mainnet settlement.",
  "A 100/100 receipt means the output satisfied deterministic contract checks, not that agent advantage has been established.",
] as const;

export interface FixtureJobResponse {
  schemaVersion: "positioncrew.fixture-job-response.v1";
  evidenceMode: "FROZEN_BSC_TEST_FIXTURE" | "CALLER_SUPPLIED_OBSERVATIONS";
  commerceMode: "IN_MEMORY_CONFORMANCE";
  advantageStatus: "PENDING_INDEPENDENT_BLIND_EVALUATION";
  generatedAt: string;
  claimBoundary: readonly string[];
  benchmarkLock: BenchmarkLock | null;
  receipt: {
    mode: "PUBLIC_REPRODUCIBLE" | "SESSION_EMBEDDED";
    path: string | null;
    evaluationHash: string;
  };
  result: ProviderJobResult;
}

export interface LendingRepeatabilityResponse {
  schemaVersion: "positioncrew.lending-repeatability.v1";
  generatedAt: string;
  taskId: string;
  status: "AGENT_RUNS_CAPTURED_MANUAL_PENDING";
  benchmarkLock: BenchmarkLock;
  runs: Array<{
    runId: string;
    elapsedMilliseconds: number;
    directCostUsd: "0.00";
    qualityScore: number;
    criticalFailureCount: number;
    outputHash: string;
  }>;
  medianElapsedMilliseconds: number;
  pending: readonly ["MANUAL_BASELINE", "INDEPENDENT_BLIND_SCORECARD"];
  boundary: string;
}

export async function runFrozenFixture(
  service: PositionCrewRequest["service"],
): Promise<FixtureJobResponse> {
  const fixture = FIXTURES.find((candidate) => candidate.service === service);
  if (!fixture) {
    throw new Error(`No frozen fixture exists for ${service}`);
  }
  return runFixtureRequest(fixture);
}

export async function runFixtureRequest(input: unknown): Promise<FixtureJobResponse> {
  const request = PositionCrewRequestSchema.parse(input);
  const result = await runProviderJob(new MemoryCommerceAdapter(), request, FIXTURE_NOW);
  const isPublicFixture = FIXTURES.some(
    (fixture) => canonicalHash(request) === canonicalHash(PositionCrewRequestSchema.parse(fixture)),
  );
  const isLockedLendingFixture =
    request.service === "LENDING_RESCUE" &&
    canonicalHash(request) === LENDING_BENCHMARK_LOCK.fixtureHash;
  return {
    schemaVersion: "positioncrew.fixture-job-response.v1",
    evidenceMode: "FROZEN_BSC_TEST_FIXTURE",
    commerceMode: "IN_MEMORY_CONFORMANCE",
    advantageStatus: "PENDING_INDEPENDENT_BLIND_EVALUATION",
    generatedAt: FIXTURE_NOW.toISOString(),
    claimBoundary: CLAIM_BOUNDARY,
    benchmarkLock: isLockedLendingFixture ? LENDING_BENCHMARK_LOCK : null,
    receipt: {
      mode: isPublicFixture ? "PUBLIC_REPRODUCIBLE" : "SESSION_EMBEDDED",
      path: isPublicFixture
        ? `/api/receipts/${result.evaluation.evaluationHash}`
        : null,
      evaluationHash: result.evaluation.evaluationHash,
    },
    result,
  };
}

export async function runFrozenMatrix(): Promise<FixtureJobResponse[]> {
  return Promise.all(
    FIXTURES.map((fixture) =>
      runFrozenFixture(PositionCrewRequestSchema.parse(fixture).service),
    ),
  );
}

export async function runLendingRepeatability(): Promise<LendingRepeatabilityResponse> {
  const runs: LendingRepeatabilityResponse["runs"] = [];
  for (let index = 0; index < 2; index += 1) {
    const startedAt = performance.now();
    const response = await runFrozenFixture("LENDING_RESCUE");
    const manifest = response.result.job.deliverable;
    if (!manifest) throw new Error("Completed lending repeat is missing its deliverable manifest");
    const elapsedMilliseconds = Math.max(1, Math.round(performance.now() - startedAt));
    runs.push({
      runId: `positioncrew-provider-repeat-${index + 1}`,
      elapsedMilliseconds,
      directCostUsd: "0.00",
      qualityScore: response.result.evaluation.score,
      criticalFailureCount: response.result.evaluation.checks.filter(
        (check) => check.critical && !check.passed,
      ).length,
      outputHash: manifest.deliverableHash,
    });
  }
  const sortedTimes = runs.map((run) => run.elapsedMilliseconds).sort((a, b) => a - b);
  const medianElapsedMilliseconds = (sortedTimes[0]! + sortedTimes[1]!) / 2;
  return {
    schemaVersion: "positioncrew.lending-repeatability.v1",
    generatedAt: new Date().toISOString(),
    taskId: benchmarkProtocol.taskId,
    status: "AGENT_RUNS_CAPTURED_MANUAL_PENDING",
    benchmarkLock: LENDING_BENCHMARK_LOCK,
    runs,
    medianElapsedMilliseconds,
    pending: ["MANUAL_BASELINE", "INDEPENDENT_BLIND_SCORECARD"],
    boundary:
      "These runs establish deterministic provider repeatability only. Agent advantage is not claimed until the manual baseline and independent blind scorecard are complete.",
  };
}

export async function runSuppliedLendingRequest(
  input: unknown,
  now = new Date(),
): Promise<FixtureJobResponse> {
  const request = LendingRescueRequestSchema.parse(input);
  const result = await runProviderJob(new MemoryCommerceAdapter(), request, now);
  return {
    schemaVersion: "positioncrew.fixture-job-response.v1",
    evidenceMode: "CALLER_SUPPLIED_OBSERVATIONS",
    commerceMode: "IN_MEMORY_CONFORMANCE",
    advantageStatus: "PENDING_INDEPENDENT_BLIND_EVALUATION",
    generatedAt: now.toISOString(),
    claimBoundary: [
      "Caller-supplied observations are validated but are not independently fetched from BSC.",
      "The lifecycle is an in-memory conformance rail, not an AACP or mainnet settlement.",
      "The output must be revalidated against fresh protocol state before execution.",
    ],
    benchmarkLock: null,
    receipt: {
      mode: "SESSION_EMBEDDED",
      path: null,
      evaluationHash: result.evaluation.evaluationHash,
    },
    result,
  };
}
