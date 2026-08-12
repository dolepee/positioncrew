import { describe, expect, it } from "vitest";
import { runLendingRescueJob } from "../src/application/run-lending-rescue-job.js";
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

  it("freezes strict request and deliverable contracts for the remaining services", () => {
    const lpRequest = LpRebalanceRequestSchema.parse({
      ...base,
      schemaVersion: "capitalops.lp-rebalance.request.v1",
      service: "LP_REBALANCE",
      requestId: "lp-rebalance-fixture-001",
      pool: "0x2222222222222222222222222222222222222222",
      token0,
      token1,
      position: { lowerTick: -120, upperTick: 120, liquidity: "1000", feesEarnedUsd: "4" },
      marketState: {
        currentTick: 20,
        token0PriceUsd: "1",
        token1PriceUsd: "600",
        volume24hUsd: "100000",
        fees24hUsd: "300",
        observedAt: "2026-08-12T15:59:00.000Z",
        sourceId: "fixture-source",
      },
      constraints: {
        minimumWidthTicks: 60,
        maximumWidthTicks: 600,
        maximumToken0ShareBps: 7000,
        maximumToken1ShareBps: 7000,
        minimumNetBenefitUsd: "1",
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
          observedAt: "2026-08-12T15:59:00.000Z",
          sourceId: "fixture-source",
        },
      ],
      constraints: {
        protocolAllowlist: ["Venus"],
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
      grossApyBps: null,
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
      estimatedFeesUsd: "0",
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
