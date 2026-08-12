import {
  CapitalOpsDeliverableSchema,
  CapitalOpsRequestSchema,
  type CapitalOpsDeliverable,
  type CapitalOpsRequest,
} from "../contracts/index.js";
import { createBoundedGridDeliverable } from "./bounded-grid.js";
import { createLendingRescueDeliverable } from "./lending-rescue.js";
import { createLpRebalanceDeliverable } from "./lp-rebalance.js";
import { createYieldOptimizationDeliverable } from "./yield-optimization.js";

export const PROVIDER_IDS: Record<CapitalOpsRequest["service"], string> = {
  LENDING_RESCUE: "capitalops:provider:lending-rescue:v1",
  LP_REBALANCE: "capitalops:provider:lp-rebalance:v1",
  YIELD_OPTIMIZATION: "capitalops:provider:yield-optimization:v1",
  BOUNDED_GRID: "capitalops:provider:bounded-grid:v1",
};

export function executeProvider(
  input: CapitalOpsRequest,
  now: Date,
): CapitalOpsDeliverable {
  const request = CapitalOpsRequestSchema.parse(input);
  switch (request.service) {
    case "LENDING_RESCUE":
      return CapitalOpsDeliverableSchema.parse(
        createLendingRescueDeliverable(request, now),
      );
    case "LP_REBALANCE":
      return CapitalOpsDeliverableSchema.parse(
        createLpRebalanceDeliverable(request, now),
      );
    case "YIELD_OPTIMIZATION":
      return CapitalOpsDeliverableSchema.parse(
        createYieldOptimizationDeliverable(request, now),
      );
    case "BOUNDED_GRID":
      return CapitalOpsDeliverableSchema.parse(
        createBoundedGridDeliverable(request, now),
      );
  }
}
