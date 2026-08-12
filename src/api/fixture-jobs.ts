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
  result: ProviderJobResult;
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
    result,
  };
}
