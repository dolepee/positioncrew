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

export const PROVIDER_IDS: Record<PositionCrewRequest["service"], string> = {
  LENDING_RESCUE: "positioncrew:provider:lending-rescue:v1",
  LP_REBALANCE: "positioncrew:provider:lp-rebalance:v1",
  YIELD_OPTIMIZATION: "positioncrew:provider:yield-optimization:v1",
  BOUNDED_GRID: "positioncrew:provider:bounded-grid:v1",
};

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
