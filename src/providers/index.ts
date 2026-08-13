import {
  PositionCrewDeliverableSchema,
  PositionCrewRequestSchema,
  type PositionCrewDeliverable,
  type PositionCrewRequest,
} from "../contracts/index.js";
import { createBoundedGridDeliverable } from "./bounded-grid.js";
import { createLendingRescueDeliverable } from "./lending-rescue.js";
import { createLpRebalanceDeliverable } from "./lp-rebalance.js";
import { createYieldOptimizationDeliverable } from "./yield-optimization.js";
export { PROVIDER_IDS } from "./ids.js";

export function executeProvider(
  input: PositionCrewRequest,
  now: Date,
): PositionCrewDeliverable {
  const request = PositionCrewRequestSchema.parse(input);
  switch (request.service) {
    case "LENDING_RESCUE":
      return PositionCrewDeliverableSchema.parse(
        createLendingRescueDeliverable(request, now),
      );
    case "LP_REBALANCE":
      return PositionCrewDeliverableSchema.parse(
        createLpRebalanceDeliverable(request, now),
      );
    case "YIELD_OPTIMIZATION":
      return PositionCrewDeliverableSchema.parse(
        createYieldOptimizationDeliverable(request, now),
      );
    case "BOUNDED_GRID":
      return PositionCrewDeliverableSchema.parse(
        createBoundedGridDeliverable(request, now),
      );
  }
}
