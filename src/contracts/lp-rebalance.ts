import { z } from "zod";
import {
  AssetIdentitySchema,
  BaseRequestFields,
  PositiveDecimalSchema,
  ProviderStatusSchema,
  TimestampSchema,
  UnsignedDecimalSchema,
  validateRequestWindow,
} from "./common.js";

export const LpRebalanceRequestSchema = z
  .object({
    schemaVersion: z.literal("capitalops.lp-rebalance.request.v1"),
    service: z.literal("LP_REBALANCE"),
    ...BaseRequestFields,
    pool: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
    token0: AssetIdentitySchema,
    token1: AssetIdentitySchema,
    position: z
      .object({
        lowerTick: z.number().int(),
        upperTick: z.number().int(),
        liquidity: PositiveDecimalSchema,
        feesEarnedUsd: UnsignedDecimalSchema,
      })
      .strict(),
    marketState: z
      .object({
        currentTick: z.number().int(),
        token0PriceUsd: PositiveDecimalSchema,
        token1PriceUsd: PositiveDecimalSchema,
        volume24hUsd: UnsignedDecimalSchema,
        fees24hUsd: UnsignedDecimalSchema,
        observedAt: TimestampSchema,
        sourceId: z.string().min(1).max(120),
      })
      .strict(),
    constraints: z
      .object({
        minimumWidthTicks: z.number().int().positive(),
        maximumWidthTicks: z.number().int().positive(),
        maximumToken0ShareBps: z.number().int().min(0).max(10_000),
        maximumToken1ShareBps: z.number().int().min(0).max(10_000),
        minimumNetBenefitUsd: UnsignedDecimalSchema,
      })
      .strict(),
  })
  .strict()
  .superRefine(validateRequestWindow);

export const LpRebalanceDeliverableSchema = z
  .object({
    schemaVersion: z.literal("capitalops.lp-rebalance.deliverable.v1"),
    service: z.literal("LP_REBALANCE"),
    requestId: z.string().min(8).max(120),
    generatedAt: TimestampSchema,
    expiresAt: TimestampSchema,
    status: ProviderStatusSchema,
    decision: z.enum(["HOLD", "WIDEN", "NARROW", "SHIFT", "EXIT", "NONE"]),
    proposedRange: z
      .object({ lowerTick: z.number().int(), upperTick: z.number().int() })
      .strict()
      .nullable(),
    estimatedRebalanceCostUsd: UnsignedDecimalSchema,
    expectedNetBenefitUsd: UnsignedDecimalSchema,
    breakEvenHours: UnsignedDecimalSchema.nullable(),
    inventoryExposure: z
      .object({ token0Bps: z.number().int().min(0).max(10_000), token1Bps: z.number().int().min(0).max(10_000) })
      .strict(),
    summary: z.string().min(1).max(400),
    actionSteps: z.array(z.string().min(1).max(240)),
    invalidationConditions: z.array(z.string().min(1).max(240)).min(1),
    limitations: z.array(z.string().min(1).max(240)).min(1),
  })
  .strict();

export type LpRebalanceRequest = z.infer<typeof LpRebalanceRequestSchema>;
export type LpRebalanceDeliverable = z.infer<typeof LpRebalanceDeliverableSchema>;
