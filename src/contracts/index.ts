import { z } from "zod";
import { BoundedGridDeliverableSchema, BoundedGridRequestSchema } from "./bounded-grid.js";
import { LendingRescueDeliverableSchema, LendingRescueRequestSchema } from "./lending-rescue.js";
import { LpRebalanceDeliverableSchema, LpRebalanceRequestSchema } from "./lp-rebalance.js";
import {
  YieldOptimizationDeliverableSchema,
  YieldOptimizationRequestSchema,
} from "./yield-optimization.js";

export const CapitalOpsRequestSchema = z.discriminatedUnion("service", [
  LendingRescueRequestSchema,
  LpRebalanceRequestSchema,
  YieldOptimizationRequestSchema,
  BoundedGridRequestSchema,
]);

export const CapitalOpsDeliverableSchema = z.discriminatedUnion("service", [
  LendingRescueDeliverableSchema,
  LpRebalanceDeliverableSchema,
  YieldOptimizationDeliverableSchema,
  BoundedGridDeliverableSchema,
]);

export type CapitalOpsRequest = z.infer<typeof CapitalOpsRequestSchema>;
export type CapitalOpsDeliverable = z.infer<typeof CapitalOpsDeliverableSchema>;

export * from "./bounded-grid.js";
export * from "./common.js";
export * from "./lending-rescue.js";
export * from "./lp-rebalance.js";
export * from "./yield-optimization.js";
