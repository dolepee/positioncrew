import {
  YieldOptimizationDeliverableSchema,
  YieldOptimizationRequestSchema,
  type YieldOptimizationDeliverable,
  type YieldOptimizationRequest,
} from "../contracts/yield-optimization.js";
import {
  FIXED_SCALE,
  divideFixed,
  formatFixed,
  minimum,
  multiplyFixed,
  parseFixed,
  ratioFromBps,
} from "../core/fixed.js";
import { validateEvidence } from "./provider-utils.js";

const RISK_RANK = { LOW: 0, MEDIUM: 1, HIGH: 2 } as const;

function currentWeightedApy(request: YieldOptimizationRequest): number {
  let totalUsd = 0n;
  let weighted = 0n;
  for (const position of request.currentPositions) {
    const value = parseFixed(position.amountUsd);
    totalUsd += value;
    weighted += value * BigInt(position.grossApyBps);
  }
  return totalUsd === 0n ? 0 : Number(weighted / totalUsd);
}

export function createYieldOptimizationDeliverable(
  input: YieldOptimizationRequest,
  now: Date,
): YieldOptimizationDeliverable {
  const request = YieldOptimizationRequestSchema.parse(input);
  const observations = [...request.currentPositions, ...request.opportunities];
  const evidence = validateEvidence({
    sources: request.sources,
    observations,
    requestedAt: request.requestedAt,
    deadline: request.deadline,
    maxDataAgeSeconds: request.maxDataAgeSeconds,
    now,
  });
  const currentApyBps = currentWeightedApy(request);
  const base = {
    schemaVersion: "capitalops.yield-optimization.deliverable.v1" as const,
    service: "YIELD_OPTIMIZATION" as const,
    requestId: request.requestId,
    generatedAt: now.toISOString(),
    expiresAt: evidence.expiresAt,
    currentWeightedApyBps: currentApyBps,
    invalidationConditions: [
      "APY, liquidity, lockup, protocol allowlist, or route costs change.",
      `Current time passes ${evidence.expiresAt}.`,
    ],
  };
  if (evidence.status !== "OK") {
    return YieldOptimizationDeliverableSchema.parse({
      ...base,
      status: evidence.status,
      decision: "NONE",
      selectedOpportunityId: null,
      allocationUsd: "0",
      grossApyBps: null,
      annualYieldUpliftUsd: "0",
      netBenefitUsd: "0",
      migrationCostUsd: "0",
      breakEvenDays: null,
      summary: "Yield evidence is unsafe or expired; no allocation was proposed.",
      actionSteps: [],
      risks: evidence.reasons.length > 0 ? evidence.reasons : ["Refresh evidence."],
    });
  }

  const capitalUsd = parseFixed(request.capitalUsd);
  const concentrationAllocation = multiplyFixed(
    capitalUsd,
    ratioFromBps(request.constraints.maximumProtocolConcentrationBps),
  );
  const currentExitCosts = request.currentPositions.reduce(
    (total, position) => total + parseFixed(position.estimatedExitCostUsd),
    0n,
  );
  const candidates = request.opportunities
    .filter(
      (opportunity) =>
        request.constraints.protocolAllowlist.includes(opportunity.protocol) &&
        opportunity.lockupSeconds <= request.constraints.maximumLockupSeconds &&
        parseFixed(opportunity.liquidityUsd) >=
          parseFixed(request.constraints.minimumLiquidityUsd) &&
        RISK_RANK[opportunity.riskTier] <= RISK_RANK[request.constraints.maximumRiskTier] &&
        opportunity.grossApyBps > currentApyBps,
    )
    .map((opportunity) => {
      const allocationUsd = minimum(
        concentrationAllocation,
        minimum(capitalUsd, parseFixed(opportunity.amountUsd)),
      );
      const annualYieldUplift = multiplyFixed(
        allocationUsd,
        ratioFromBps(opportunity.grossApyBps - currentApyBps),
      );
      const migrationCost =
        parseFixed(opportunity.estimatedEntryCostUsd) + currentExitCosts;
      const horizonBenefit =
        (annualYieldUplift * BigInt(request.constraints.evaluationHorizonDays)) / 365n;
      const netBenefit = horizonBenefit - migrationCost;
      const dailyUplift = annualYieldUplift / 365n;
      const breakEvenDays =
        dailyUplift > 0n ? divideFixed(migrationCost, dailyUplift) : null;
      return {
        opportunity,
        allocationUsd,
        annualYieldUplift,
        migrationCost,
        netBenefit,
        breakEvenDays,
      };
    })
    .filter(
      (candidate) =>
        candidate.netBenefit >= parseFixed(request.constraints.minimumNetBenefitUsd) &&
        candidate.migrationCost <= parseFixed(request.maxActionUsd),
    )
    .sort((left, right) =>
      left.netBenefit === right.netBenefit
        ? left.opportunity.opportunityId.localeCompare(right.opportunity.opportunityId)
        : left.netBenefit > right.netBenefit
          ? -1
          : 1,
    );

  const selected = candidates[0];
  if (!selected) {
    return YieldOptimizationDeliverableSchema.parse({
      ...base,
      status: "NO_ACTION",
      decision: "HOLD",
      selectedOpportunityId: null,
      allocationUsd: "0",
      grossApyBps: null,
      annualYieldUpliftUsd: "0",
      netBenefitUsd: "0",
      migrationCostUsd: "0",
      breakEvenDays: null,
      summary: "No eligible yield move clears liquidity, risk, cost, and net-benefit limits.",
      actionSteps: [],
      risks: ["Yield can change before the next evaluation."],
    });
  }

  const decision = request.currentPositions.length === 0 ? "SUPPLY" : "MIGRATE";
  return YieldOptimizationDeliverableSchema.parse({
    ...base,
    status: "ACTIONABLE",
    decision,
    selectedOpportunityId: selected.opportunity.opportunityId,
    allocationUsd: formatFixed(selected.allocationUsd, 6),
    grossApyBps: selected.opportunity.grossApyBps,
    annualYieldUpliftUsd: formatFixed(selected.annualYieldUplift, 6),
    netBenefitUsd: formatFixed(selected.netBenefit, 6),
    migrationCostUsd: formatFixed(selected.migrationCost, 6),
    breakEvenDays:
      selected.breakEvenDays === null ? null : formatFixed(selected.breakEvenDays, 4),
    summary: `${decision} ${formatFixed(selected.allocationUsd, 2)} USD to ${selected.opportunity.opportunityId}; projected ${request.constraints.evaluationHorizonDays}-day net benefit is ${formatFixed(selected.netBenefit, 2)} USD.`,
    actionSteps: [
      ...(request.currentPositions.length > 0
        ? ["Withdraw the bounded allocation from current positions."]
        : []),
      `Supply ${formatFixed(selected.allocationUsd, 6)} USD to ${selected.opportunity.vaultOrMarket}.`,
      `Re-evaluate before ${evidence.expiresAt}.`,
    ],
    risks: [
      `${selected.opportunity.protocol} risk tier is ${selected.opportunity.riskTier}.`,
      "Quoted APY is variable and is not a guaranteed return.",
      `Liquidity snapshot is ${selected.opportunity.liquidityUsd} USD.`,
    ],
  });
}
