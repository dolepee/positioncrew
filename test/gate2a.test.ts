import { describe, expect, it } from "vitest";
import { runLendingRescueJob } from "../src/application/run-lending-rescue-job.js";
import { runProviderJob } from "../src/application/run-provider-job.js";
import { MemoryCommerceAdapter } from "../src/commerce/memory-adapter.js";
import {
  BoundedGridDeliverableSchema,
  BoundedGridRequestSchema,
  LpRebalanceDeliverableSchema,
  LpRebalanceRequestSchema,
  YieldOptimizationDeliverableSchema,
  YieldOptimizationRequestSchema,
} from "../src/contracts/index.js";
import { FIXTURE_NOW, lendingFixture } from "./helpers.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const base = {
  chainId: 97 as const,
  account: "0x1111111111111111111111111111111111111111",
  protocol: "Fixture Protocol",
  requestedAt: "2026-08-12T16:00:00.000Z",
  deadline: "2026-08-12T16:05:00.000Z",
  maxDataAgeSeconds: 300,
  maxActionUsd: "250",
  maxGasUsd: "1",
  maxSlippageBps: 50,
  sources: [
    {
      sourceId: "fixture-source",
      label: "Frozen fixture",
      uri: "https://fixtures.capitalops.invalid/source.json",
      observedAt: "2026-08-12T15:59:00.000Z",
    },
  ],
};
const token0 = {
  symbol: "AAA",
  address: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  decimals: 18,
};
const token1 = {
  symbol: "BBB",
  address: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  decimals: 18,
};

describe("Gate 2A", () => {
  it("runs one buyer request through a completed evaluated job", async () => {
    const adapter = new MemoryCommerceAdapter();
    const first = await runLendingRescueJob(adapter, lendingFixture(), FIXTURE_NOW);
    const replay = await runLendingRescueJob(adapter, lendingFixture(), FIXTURE_NOW);

    expect(first.job.state).toBe("COMPLETED");
    expect(first.evaluation.score).toBe(100);
    expect(replay.job.jobId).toBe(first.job.jobId);
    expect(replay.job.history.map((entry) => entry.state)).toEqual([
      "CREATED",
      "FUNDED",
      "ASSIGNED",
      "SUBMITTED",
      "EVALUATED",
      "COMPLETED",
    ]);
  });

  it("activates every main-track provider through the same completed lifecycle", async () => {
    const adapter = new MemoryCommerceAdapter();
    const files = [
      "lending-rescue/stressed-venus-position.v1.json",
      "lp-rebalance/out-of-range-v3-position.v1.json",
      "yield-optimization/venus-to-beefy.v1.json",
      "bounded-grid/bnb-usdt-grid.v1.json",
    ];
    const results = [];
    for (const file of files) {
      const path = fileURLToPath(new URL(`../fixtures/${file}`, import.meta.url));
      const request = JSON.parse(readFileSync(path, "utf8"));
      results.push(await runProviderJob(adapter, request, FIXTURE_NOW));
    }

    expect(results.map((result) => result.job.state)).toEqual([
      "COMPLETED",
      "COMPLETED",
      "COMPLETED",
      "COMPLETED",
    ]);
    expect(results.map((result) => result.evaluation.score)).toEqual([100, 100, 100, 100]);
    expect(new Set(results.map((result) => result.request.service)).size).toBe(4);
  });

  it("freezes strict request and deliverable contracts for the remaining services", () => {
    const lpRequest = LpRebalanceRequestSchema.parse({
      ...base,
      schemaVersion: "capitalops.lp-rebalance.request.v1",
      service: "LP_REBALANCE",
      requestId: "lp-rebalance-fixture-001",
      pool: "0x2222222222222222222222222222222222222222",
      token0,
      token1,
      position: {
        lowerTick: -120,
        upperTick: 120,
        liquidity: "1000",
        positionValueUsd: "10000",
        feesEarnedUsd: "4",
        token0ShareBps: 5000,
        token1ShareBps: 5000,
      },
      marketState: {
        currentTick: 20,
        token0PriceUsd: "1",
        token1PriceUsd: "600",
        volume24hUsd: "100000",
        fees24hUsd: "300",
        poolLiquidityUsd: "1000000",
        realizedVolatilityBps: 400,
        observedAt: "2026-08-12T15:59:00.000Z",
        sourceId: "fixture-source",
      },
      constraints: {
        minimumWidthTicks: 60,
        maximumWidthTicks: 600,
        tickSpacing: 60,
        edgeBufferBps: 1000,
        highVolatilityBps: 1000,
        maximumToken0ShareBps: 7000,
        maximumToken1ShareBps: 7000,
        minimumNetBenefitUsd: "1",
        estimatedGasUsd: "0.05",
        estimatedSwapCostUsd: "0.10",
        evaluationHorizonHours: 24,
      },
    });
    const lpResult = LpRebalanceDeliverableSchema.parse({
      schemaVersion: "capitalops.lp-rebalance.deliverable.v1",
      service: "LP_REBALANCE",
      requestId: lpRequest.requestId,
      generatedAt: base.requestedAt,
      expiresAt: base.deadline,
      status: "NO_ACTION",
      decision: "HOLD",
      proposedRange: null,
      estimatedRebalanceCostUsd: "0",
      expectedGrossFeesUsd: "0",
      expectedNetBenefitUsd: "0",
      breakEvenHours: null,
      inventoryExposure: { token0Bps: 5000, token1Bps: 5000 },
      summary: "Hold the current range.",
      actionSteps: [],
      invalidationConditions: ["Price leaves the current range."],
      limitations: ["Frozen fixture only."],
    });

    const yieldRequest = YieldOptimizationRequestSchema.parse({
      ...base,
      schemaVersion: "capitalops.yield-optimization.request.v1",
      service: "YIELD_OPTIMIZATION",
      requestId: "yield-optimization-fixture-001",
      capitalUsd: "1000",
      currentPositions: [],
      opportunities: [
        {
          opportunityId: "venus-usdt",
          protocol: "Venus",
          vaultOrMarket: "0x3333333333333333333333333333333333333333",
          asset: token0,
          amountUsd: "1000",
          grossApyBps: 600,
          liquidityUsd: "1000000",
          lockupSeconds: 0,
          estimatedEntryCostUsd: "1",
          estimatedExitCostUsd: "1",
          riskTier: "LOW",
          observedAt: "2026-08-12T15:59:00.000Z",
          sourceId: "fixture-source",
        },
      ],
      constraints: {
        protocolAllowlist: ["Venus"],
        maximumRiskTier: "LOW",
        maximumProtocolConcentrationBps: 10000,
        maximumLockupSeconds: 0,
        minimumLiquidityUsd: "100000",
        minimumNetBenefitUsd: "1",
        evaluationHorizonDays: 30,
      },
    });
    const yieldResult = YieldOptimizationDeliverableSchema.parse({
      schemaVersion: "capitalops.yield-optimization.deliverable.v1",
      service: "YIELD_OPTIMIZATION",
      requestId: yieldRequest.requestId,
      generatedAt: base.requestedAt,
      expiresAt: base.deadline,
      status: "NO_ACTION",
      decision: "HOLD",
      selectedOpportunityId: null,
      allocationUsd: "0",
      grossApyBps: null,
      currentWeightedApyBps: 0,
      annualYieldUpliftUsd: "0",
      netBenefitUsd: "0",
      migrationCostUsd: "0",
      breakEvenDays: null,
      summary: "No migration clears the net-benefit floor.",
      actionSteps: [],
      risks: ["Yield can change."],
      invalidationConditions: ["Opportunity data changes."],
    });

    const gridRequest = BoundedGridRequestSchema.parse({
      ...base,
      schemaVersion: "capitalops.bounded-grid.request.v1",
      service: "BOUNDED_GRID",
      requestId: "bounded-grid-fixture-001",
      venue: "0x4444444444444444444444444444444444444444",
      baseAsset: token0,
      quoteAsset: token1,
      marketState: {
        midPrice: "10",
        liquidityUsd: "500000",
        realizedVolatilityBps: 400,
        venueFeeBps: 30,
        observedAt: "2026-08-12T15:59:00.000Z",
        sourceId: "fixture-source",
      },
      constraints: {
        capitalUsd: "1000",
        lowerPrice: "9",
        upperPrice: "11",
        levelCount: 5,
        maximumInventoryUsd: "600",
        maximumLossUsd: "100",
        minimumExpectedNetProfitUsd: "5",
        minimumLiquidityUsd: "100000",
        maximumVolatilityBps: 1000,
        expectedCompletedCycles: 3,
        estimatedGasUsd: "1",
        orderExpirySeconds: 3600,
      },
    });
    const gridResult = BoundedGridDeliverableSchema.parse({
      schemaVersion: "capitalops.bounded-grid.deliverable.v1",
      service: "BOUNDED_GRID",
      requestId: gridRequest.requestId,
      generatedAt: base.requestedAt,
      expiresAt: base.deadline,
      status: "NO_ACTION",
      decision: "NO_GRID",
      orders: [],
      grossSpreadCaptureUsd: "0",
      estimatedFeesUsd: "0",
      estimatedSlippageUsd: "0",
      estimatedGasUsd: "0",
      expectedNetProfitUsd: "0",
      worstCaseLossUsd: "0",
      maximumInventoryUsd: "0",
      summary: "No grid clears policy.",
      cancellationConditions: ["Market state changes."],
      limitations: ["Frozen fixture only."],
    });

    expect([lpResult.service, yieldResult.service, gridResult.service]).toEqual([
      "LP_REBALANCE",
      "YIELD_OPTIMIZATION",
      "BOUNDED_GRID",
    ]);
  });
});
