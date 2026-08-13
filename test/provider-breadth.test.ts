import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  BoundedGridRequestSchema,
  LpRebalanceRequestSchema,
  YieldOptimizationRequestSchema,
} from "../src/contracts/index.js";
import { createBoundedGridDeliverable } from "../src/providers/bounded-grid.js";
import { createLpRebalanceDeliverable } from "../src/providers/lp-rebalance.js";
import { createYieldOptimizationDeliverable } from "../src/providers/yield-optimization.js";
import { evaluateProviderConformance } from "../src/evaluators/provider-conformance.js";
import { FIXTURE_NOW } from "./helpers.js";

function fixture(relativePath: string): unknown {
  const path = fileURLToPath(new URL(`../fixtures/${relativePath}`, import.meta.url));
  return JSON.parse(readFileSync(path, "utf8"));
}

describe("main-track provider breadth", () => {
  it("shifts an out-of-range V3 position only when fees clear costs", () => {
    const request = LpRebalanceRequestSchema.parse(
      fixture("lp-rebalance/out-of-range-v3-position.v1.json"),
    );
    const result = createLpRebalanceDeliverable(request, FIXTURE_NOW);

    expect(result.status).toBe("ACTIONABLE");
    expect(result.decision).toBe("SHIFT");
    expect(result.proposedRange).toEqual({ lowerTick: 0, upperTick: 240 });
    expect(Number(result.expectedNetBenefitUsd)).toBeGreaterThan(5);
    expect(Number(result.breakEvenHours)).toBeGreaterThan(0);
  });

  it("holds an LP when execution cost erases the benefit", () => {
    const request = LpRebalanceRequestSchema.parse(
      fixture("lp-rebalance/out-of-range-v3-position.v1.json"),
    );
    request.constraints.estimatedSwapCostUsd = "50";
    const result = createLpRebalanceDeliverable(request, FIXTURE_NOW);

    expect(result.status).toBe("NO_ACTION");
    expect(result.decision).toBe("HOLD");
  });

  it("treats the V3 upper tick as outside the half-open liquidity range", () => {
    const request = LpRebalanceRequestSchema.parse(
      fixture("lp-rebalance/out-of-range-v3-position.v1.json"),
    );
    request.marketState.currentTick = request.position.upperTick;
    const result = createLpRebalanceDeliverable(request, FIXTURE_NOW);

    expect(result.status).toBe("ACTIONABLE");
    expect(result.decision).toBe("SHIFT");
  });

  it("selects a bounded yield migration after costs and risk filters", () => {
    const request = YieldOptimizationRequestSchema.parse(
      fixture("yield-optimization/venus-to-beefy.v1.json"),
    );
    const result = createYieldOptimizationDeliverable(request, FIXTURE_NOW);

    expect(result.status).toBe("ACTIONABLE");
    expect(result.decision).toBe("MIGRATE");
    expect(result.selectedOpportunityId).toBe("beefy-usdt-vault");
    expect(result.currentWeightedApyBps).toBe(400);
    expect(result.grossApyBps).toBe(900);
    expect(Number(result.netBenefitUsd)).toBeGreaterThan(5);
  });

  it("holds yield when the route cannot recover its costs", () => {
    const request = YieldOptimizationRequestSchema.parse(
      fixture("yield-optimization/venus-to-beefy.v1.json"),
    );
    request.opportunities[0]!.estimatedEntryCostUsd = "20";
    const result = createYieldOptimizationDeliverable(request, FIXTURE_NOW);

    expect(result.status).toBe("NO_ACTION");
    expect(result.decision).toBe("HOLD");
  });

  it("builds a bounded two-sided grid after all costs", () => {
    const request = BoundedGridRequestSchema.parse(
      fixture("bounded-grid/bnb-usdt-grid.v1.json"),
    );
    const result = createBoundedGridDeliverable(request, FIXTURE_NOW);

    expect(result.status).toBe("ACTIONABLE");
    expect(result.decision).toBe("BUILD_GRID");
    expect(result.orders).toHaveLength(4);
    expect(new Set(result.orders.map((order) => order.side))).toEqual(
      new Set(["BUY", "SELL"]),
    );
    expect(Number(result.expectedNetProfitUsd)).toBeGreaterThan(100);
    expect(Number(result.worstCaseLossUsd)).toBeLessThanOrEqual(150);
  });

  it("rejects a grid when volatility exceeds policy", () => {
    const request = BoundedGridRequestSchema.parse(
      fixture("bounded-grid/bnb-usdt-grid.v1.json"),
    );
    request.marketState.realizedVolatilityBps = 1_001;
    const result = createBoundedGridDeliverable(request, FIXTURE_NOW);

    expect(result.status).toBe("NO_ACTION");
    expect(result.decision).toBe("NO_GRID");
    expect(result.orders).toEqual([]);
  });

  it("fails a schema-valid deliverable that no longer matches the frozen request", () => {
    const request = LpRebalanceRequestSchema.parse(
      fixture("lp-rebalance/out-of-range-v3-position.v1.json"),
    );
    const deliverable = createLpRebalanceDeliverable(request, FIXTURE_NOW);
    const tampered = { ...deliverable, summary: "A different result." };
    const evaluation = evaluateProviderConformance(
      request,
      tampered,
      "positioncrew:evaluator:lp_rebalance:v1",
      FIXTURE_NOW,
    );

    expect(evaluation.passed).toBe(false);
    expect(evaluation.score).toBe(40);
    expect(
      evaluation.checks.find((check) => check.id === "deterministic-output")?.passed,
    ).toBe(false);
  });
});
