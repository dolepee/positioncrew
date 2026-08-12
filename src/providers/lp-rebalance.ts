import {
  LpRebalanceDeliverableSchema,
  LpRebalanceRequestSchema,
  type LpRebalanceDeliverable,
  type LpRebalanceRequest,
} from "../contracts/lp-rebalance.js";
import {
  FIXED_SCALE,
  divideFixed,
  formatFixed,
  multiplyFixed,
  parseFixed,
  ratioFromBps,
} from "../core/fixed.js";
import { clampNonNegative, validateEvidence } from "./provider-utils.js";

function alignDown(tick: number, spacing: number): number {
  return Math.floor(tick / spacing) * spacing;
}

function boundedWidth(request: LpRebalanceRequest, desired: number): number {
  const { minimumWidthTicks, maximumWidthTicks, tickSpacing } = request.constraints;
  const bounded = Math.max(minimumWidthTicks, Math.min(maximumWidthTicks, desired));
  return Math.max(tickSpacing * 2, Math.ceil(bounded / tickSpacing) * tickSpacing);
}

function centeredRange(
  request: LpRebalanceRequest,
  desiredWidth: number,
): { lowerTick: number; upperTick: number } {
  const width = boundedWidth(request, desiredWidth);
  const center = alignDown(request.marketState.currentTick, request.constraints.tickSpacing);
  const half = Math.ceil(width / (2 * request.constraints.tickSpacing)) * request.constraints.tickSpacing;
  return { lowerTick: center - half, upperTick: center + half };
}

function refusal(
  request: LpRebalanceRequest,
  now: Date,
  status: Exclude<LpRebalanceDeliverable["status"], "ACTIONABLE" | "NO_ACTION">,
  expiresAt: string,
  reasons: string[],
): LpRebalanceDeliverable {
  return LpRebalanceDeliverableSchema.parse({
    schemaVersion: "capitalops.lp-rebalance.deliverable.v1",
    service: "LP_REBALANCE",
    requestId: request.requestId,
    generatedAt: now.toISOString(),
    expiresAt,
    status,
    decision: "NONE",
    proposedRange: null,
    estimatedRebalanceCostUsd: "0",
    expectedGrossFeesUsd: "0",
    expectedNetBenefitUsd: "0",
    breakEvenHours: null,
    inventoryExposure: {
      token0Bps: request.position.token0ShareBps,
      token1Bps: request.position.token1ShareBps,
    },
    summary: "LP evidence or constraints are unsafe; no rebalance was proposed.",
    actionSteps: [],
    invalidationConditions: ["Refresh the pool and position snapshot before retrying."],
    limitations: reasons.length > 0 ? reasons : ["No safe action is available."],
  });
}

export function createLpRebalanceDeliverable(
  input: LpRebalanceRequest,
  now: Date,
): LpRebalanceDeliverable {
  const request = LpRebalanceRequestSchema.parse(input);
  const evidence = validateEvidence({
    sources: request.sources,
    observations: [request.marketState],
    requestedAt: request.requestedAt,
    deadline: request.deadline,
    maxDataAgeSeconds: request.maxDataAgeSeconds,
    now,
  });
  if (evidence.status !== "OK") {
    return refusal(request, now, evidence.status, evidence.expiresAt, evidence.reasons);
  }

  const width = request.position.upperTick - request.position.lowerTick;
  const currentTick = request.marketState.currentTick;
  const inRange =
    currentTick >= request.position.lowerTick && currentTick <= request.position.upperTick;
  const edgeDistance = inRange
    ? Math.min(
        currentTick - request.position.lowerTick,
        request.position.upperTick - currentTick,
      )
    : 0;
  const edgeDistanceBps = inRange ? Math.floor((edgeDistance * 10_000) / width) : 0;
  const highVolatility =
    request.marketState.realizedVolatilityBps >= request.constraints.highVolatilityBps;

  let proposedDecision: "SHIFT" | "WIDEN" | "NARROW" | null = null;
  let desiredWidth = width;
  if (!inRange || edgeDistanceBps < request.constraints.edgeBufferBps) {
    proposedDecision = "SHIFT";
  } else if (highVolatility && width < request.constraints.maximumWidthTicks) {
    proposedDecision = "WIDEN";
    desiredWidth = Math.ceil(width * 1.5);
  } else if (
    request.marketState.realizedVolatilityBps <
      Math.floor(request.constraints.highVolatilityBps / 3) &&
    width > request.constraints.minimumWidthTicks * 2
  ) {
    proposedDecision = "NARROW";
    desiredWidth = Math.floor(width * 0.75);
  }

  const positionValueUsd = parseFixed(request.position.positionValueUsd);
  const poolLiquidityUsd = parseFixed(request.marketState.poolLiquidityUsd);
  const fees24hUsd = parseFixed(request.marketState.fees24hUsd);
  const horizonRatio =
    (BigInt(request.constraints.evaluationHorizonHours) * FIXED_SCALE) / 24n;
  const poolShare = divideFixed(positionValueUsd, poolLiquidityUsd);
  const feeBase = multiplyFixed(multiplyFixed(fees24hUsd, poolShare), horizonRatio);
  const currentUptimeBps = !inRange
    ? 0
    : edgeDistanceBps < request.constraints.edgeBufferBps
      ? 3_500
      : highVolatility
        ? 5_500
        : 9_000;
  const currentGrossFees = multiplyFixed(feeBase, ratioFromBps(currentUptimeBps));

  if (proposedDecision === null) {
    return LpRebalanceDeliverableSchema.parse({
      schemaVersion: "capitalops.lp-rebalance.deliverable.v1",
      service: "LP_REBALANCE",
      requestId: request.requestId,
      generatedAt: now.toISOString(),
      expiresAt: evidence.expiresAt,
      status: "NO_ACTION",
      decision: "HOLD",
      proposedRange: null,
      estimatedRebalanceCostUsd: "0",
      expectedGrossFeesUsd: formatFixed(currentGrossFees, 6),
      expectedNetBenefitUsd: "0",
      breakEvenHours: null,
      inventoryExposure: {
        token0Bps: request.position.token0ShareBps,
        token1Bps: request.position.token1ShareBps,
      },
      summary: "The LP remains safely inside its range and no rebalance clears the policy gate.",
      actionSteps: [],
      invalidationConditions: [
        `Current tick approaches within ${request.constraints.edgeBufferBps} bps of either range edge.`,
        `Realized volatility reaches ${request.constraints.highVolatilityBps} bps.`,
      ],
      limitations: [
        "Fee estimates use the frozen pool-share and uptime model, not guaranteed future volume.",
      ],
    });
  }

  const proposedRange = centeredRange(request, desiredWidth);
  const proposedWidth = proposedRange.upperTick - proposedRange.lowerTick;
  const widthDensity = (BigInt(width) * FIXED_SCALE) / BigInt(proposedWidth);
  const proposedUptimeBps = proposedDecision === "NARROW" ? 7_500 : 9_500;
  const expectedGrossFees = multiplyFixed(
    multiplyFixed(feeBase, widthDensity),
    ratioFromBps(proposedUptimeBps),
  );
  const gasUsd = parseFixed(request.constraints.estimatedGasUsd);
  const swapCostUsd = parseFixed(request.constraints.estimatedSwapCostUsd);
  const totalCostUsd = gasUsd + swapCostUsd;
  const incrementalFees = expectedGrossFees - currentGrossFees;
  const netBenefit = clampNonNegative(incrementalFees - totalCostUsd);
  const inventorySafe =
    request.constraints.maximumToken0ShareBps >= 5_000 &&
    request.constraints.maximumToken1ShareBps >= 5_000;
  const economicsPass =
    incrementalFees > 0n &&
    netBenefit >= parseFixed(request.constraints.minimumNetBenefitUsd) &&
    gasUsd <= parseFixed(request.maxGasUsd) &&
    totalCostUsd <= parseFixed(request.maxActionUsd) &&
    inventorySafe;

  if (!economicsPass) {
    return LpRebalanceDeliverableSchema.parse({
      schemaVersion: "capitalops.lp-rebalance.deliverable.v1",
      service: "LP_REBALANCE",
      requestId: request.requestId,
      generatedAt: now.toISOString(),
      expiresAt: evidence.expiresAt,
      status: "NO_ACTION",
      decision: "HOLD",
      proposedRange: null,
      estimatedRebalanceCostUsd: "0",
      expectedGrossFeesUsd: formatFixed(currentGrossFees, 6),
      expectedNetBenefitUsd: "0",
      breakEvenHours: null,
      inventoryExposure: {
        token0Bps: request.position.token0ShareBps,
        token1Bps: request.position.token1ShareBps,
      },
      summary: "A range change was considered but rejected after costs and inventory limits.",
      actionSteps: [],
      invalidationConditions: ["Pool fees, volatility, range position, or execution costs change."],
      limitations: [
        `Projected net benefit ${formatFixed(netBenefit, 6)} USD does not clear ${request.constraints.minimumNetBenefitUsd} USD.`,
      ],
    });
  }

  const hourlyIncrementalFees =
    (incrementalFees * FIXED_SCALE) /
    (BigInt(request.constraints.evaluationHorizonHours) * FIXED_SCALE);
  const breakEvenHours = divideFixed(totalCostUsd, hourlyIncrementalFees);
  return LpRebalanceDeliverableSchema.parse({
    schemaVersion: "capitalops.lp-rebalance.deliverable.v1",
    service: "LP_REBALANCE",
    requestId: request.requestId,
    generatedAt: now.toISOString(),
    expiresAt: evidence.expiresAt,
    status: "ACTIONABLE",
    decision: proposedDecision,
    proposedRange,
    estimatedRebalanceCostUsd: formatFixed(totalCostUsd, 6),
    expectedGrossFeesUsd: formatFixed(expectedGrossFees, 6),
    expectedNetBenefitUsd: formatFixed(netBenefit, 6),
    breakEvenHours: formatFixed(breakEvenHours, 4),
    inventoryExposure: { token0Bps: 5_000, token1Bps: 5_000 },
    summary: `${proposedDecision} the LP range to ${proposedRange.lowerTick}..${proposedRange.upperTick}; projected net benefit is ${formatFixed(netBenefit, 2)} USD after costs.`,
    actionSteps: [
      "Collect fees and remove the current liquidity position.",
      `Rebalance inventory within ${request.maxSlippageBps} bps slippage.`,
      `Mint the replacement position at ticks ${proposedRange.lowerTick} and ${proposedRange.upperTick}.`,
    ],
    invalidationConditions: [
      `Current tick changes materially from ${request.marketState.currentTick}.`,
      `Gas exceeds ${request.maxGasUsd} USD or swap cost exceeds ${request.constraints.estimatedSwapCostUsd} USD.`,
      `Current time passes ${evidence.expiresAt}.`,
    ],
    limitations: [
      "Projected fees use current pool fees, pool share, range density, and a disclosed uptime factor.",
      "Exact V3 inventory composition must be recomputed immediately before execution.",
    ],
  });
}
