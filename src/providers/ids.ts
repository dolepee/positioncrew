import type { PositionCrewRequest } from "../contracts/index.js";

export const PROVIDER_IDS: Record<PositionCrewRequest["service"], string> = {
  LENDING_RESCUE: "positioncrew:provider:lending-rescue:v1",
  LP_REBALANCE: "positioncrew:provider:lp-rebalance:v1",
  YIELD_OPTIMIZATION: "positioncrew:provider:yield-optimization:v1",
  BOUNDED_GRID: "positioncrew:provider:bounded-grid:v1",
};
