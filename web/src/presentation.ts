import type { ProviderDeliverable, ServiceId } from "./types";

export function shortHash(value: string | undefined, lead = 12): string {
  if (!value) return "Pending";
  return `${value.slice(0, lead)}...${value.slice(-8)}`;
}

export function formatTimestamp(value: string): string {
  return new Intl.DateTimeFormat("en", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: "UTC",
  }).format(new Date(value));
}

export function serviceLabel(service: ServiceId): string {
  return {
    LENDING_RESCUE: "Lending rescue",
    LP_REBALANCE: "LP rebalance",
    YIELD_OPTIMIZATION: "Yield optimisation",
    BOUNDED_GRID: "Bounded grid",
  }[service];
}

export function statusTone(status: string): "good" | "warn" | "neutral" {
  if (status === "ACTIONABLE" || status === "COMPLETED") return "good";
  if (status.startsWith("REFUSED") || status === "REJECTED") return "warn";
  return "neutral";
}

export function resultHeadline(deliverable: ProviderDeliverable): string {
  if (deliverable.service === "LENDING_RESCUE") {
    const action = deliverable.recommendation;
    return action
      ? `${action.kind === "REPAY_DEBT" ? "Repay" : "Add"} ${action.amount} ${action.asset.symbol}`
      : deliverable.decision.replaceAll("_", " ");
  }
  if (deliverable.service === "LP_REBALANCE") {
    const range = deliverable.proposedRange;
    return range
      ? `${deliverable.decision} range to ${range.lowerTick}...${range.upperTick}`
      : deliverable.decision;
  }
  if (deliverable.service === "YIELD_OPTIMIZATION") {
    return deliverable.selectedOpportunityId
      ? `${deliverable.decision} to ${deliverable.selectedOpportunityId}`
      : deliverable.decision;
  }
  return deliverable.orders?.length
    ? `Build ${deliverable.orders.length} bounded orders`
    : deliverable.decision.replaceAll("_", " ");
}

export function metricsFor(deliverable: ProviderDeliverable) {
  if (deliverable.service === "LENDING_RESCUE") {
    return [
      { label: "Current health", value: deliverable.position?.currentHealthFactor ?? "-" },
      { label: "Stress health", value: deliverable.position?.stressedHealthFactor ?? "-", tone: "warn" },
      { label: "Projected health", value: deliverable.recommendation?.projectedHealthFactor ?? "-", tone: "good" },
      { label: "Action value", value: `$${deliverable.recommendation?.amountUsd ?? "0"}` },
    ];
  }
  if (deliverable.service === "LP_REBALANCE") {
    return [
      { label: "New range", value: deliverable.proposedRange ? `${deliverable.proposedRange.lowerTick}...${deliverable.proposedRange.upperTick}` : "Hold" },
      { label: "Net benefit", value: `$${deliverable.expectedNetBenefitUsd ?? "0"}`, tone: "good" },
      { label: "Rebalance cost", value: `$${deliverable.estimatedRebalanceCostUsd ?? "0"}` },
      { label: "Break-even", value: `${deliverable.breakEvenHours ?? "-"}h` },
    ];
  }
  if (deliverable.service === "YIELD_OPTIMIZATION") {
    return [
      { label: "Allocation", value: `$${deliverable.allocationUsd ?? "0"}` },
      { label: "Current APY", value: `${((deliverable.currentWeightedApyBps ?? 0) / 100).toFixed(2)}%` },
      { label: "Selected APY", value: `${((deliverable.grossApyBps ?? 0) / 100).toFixed(2)}%`, tone: "good" },
      { label: "90d net benefit", value: `$${deliverable.netBenefitUsd ?? "0"}`, tone: "good" },
    ];
  }
  return [
    { label: "Orders", value: String(deliverable.orders?.length ?? 0) },
    { label: "Expected net", value: `$${deliverable.expectedNetProfitUsd ?? "0"}`, tone: "good" },
    { label: "Worst-case loss", value: `$${deliverable.worstCaseLossUsd ?? "0"}`, tone: "warn" },
    { label: "Inventory cap", value: `$${deliverable.maximumInventoryUsd ?? "0"}` },
  ];
}

export function actionDetails(deliverable: ProviderDeliverable): Array<{ label: string; value: string }> {
  if (deliverable.service === "LENDING_RESCUE" && deliverable.recommendation) {
    return [
      { label: "Exact base units", value: deliverable.recommendation.amountBaseUnits },
      { label: "Estimated gas", value: `$${deliverable.recommendation.estimatedGasUsd}` },
      { label: "Slippage ceiling", value: `${deliverable.recommendation.maxSlippageBps} bps` },
      { label: "Execute before", value: formatTimestamp(deliverable.recommendation.executeBefore) + " UTC" },
    ];
  }
  if (deliverable.service === "LP_REBALANCE") {
    return [
      { label: "Decision", value: deliverable.decision },
      { label: "Inventory after", value: `${(deliverable.inventoryExposure?.token0Bps ?? 0) / 100}% / ${(deliverable.inventoryExposure?.token1Bps ?? 0) / 100}%` },
      { label: "Estimated cost", value: `$${deliverable.estimatedRebalanceCostUsd ?? "0"}` },
      { label: "Expires", value: formatTimestamp(deliverable.expiresAt) + " UTC" },
    ];
  }
  if (deliverable.service === "YIELD_OPTIMIZATION") {
    return [
      { label: "Destination", value: deliverable.selectedOpportunityId ?? "No migration" },
      { label: "Migration cost", value: `$${deliverable.migrationCostUsd ?? "0"}` },
      { label: "Break-even", value: `${deliverable.breakEvenDays ?? "-"} days` },
      { label: "Expires", value: formatTimestamp(deliverable.expiresAt) + " UTC" },
    ];
  }
  return [
    { label: "Decision", value: deliverable.decision.replaceAll("_", " ") },
    { label: "Order count", value: String(deliverable.orders?.length ?? 0) },
    { label: "Maximum loss", value: `$${deliverable.worstCaseLossUsd ?? "0"}` },
    { label: "Expires", value: formatTimestamp(deliverable.expiresAt) + " UTC" },
  ];
}

export function conditionsFor(deliverable: ProviderDeliverable): string[] {
  if (deliverable.service === "LENDING_RESCUE") {
    return [
      ...(deliverable.recommendation?.preconditions ?? []),
      ...(deliverable.invalidationConditions ?? []),
    ].slice(0, 5);
  }
  if (deliverable.service === "BOUNDED_GRID") {
    return deliverable.cancellationConditions?.slice(0, 5) ?? [];
  }
  return deliverable.invalidationConditions?.slice(0, 5) ?? [];
}
