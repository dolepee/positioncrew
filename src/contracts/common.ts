import { z } from "zod";

export const AddressSchema = z
  .string()
  .regex(/^0x[a-fA-F0-9]{40}$/, "Expected an EVM address");

export const HashSchema = z
  .string()
  .regex(/^sha256:[a-f0-9]{64}$/, "Expected a canonical SHA-256 commitment");

export const UnsignedDecimalSchema = z
  .string()
  .regex(/^(0|[1-9]\d*)(?:\.\d{1,18})?$/, "Expected an unsigned decimal string");

export const PositiveDecimalSchema = UnsignedDecimalSchema.refine(
  (value) => /[1-9]/.test(value),
  "Expected a positive decimal string",
);

export const TimestampSchema = z.string().refine((value) => {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && /(?:Z|[+-]\d{2}:\d{2})$/.test(value);
}, "Expected an ISO-8601 timestamp with timezone");

export const ServiceTypeSchema = z.enum([
  "LENDING_RESCUE",
  "LP_REBALANCE",
  "YIELD_OPTIMIZATION",
  "BOUNDED_GRID",
]);

export const SourceObservationSchema = z
  .object({
    sourceId: z.string().min(1).max(120),
    label: z.string().min(1).max(160),
    uri: z.string().url(),
    observedAt: TimestampSchema,
  })
  .strict();

export const AssetIdentitySchema = z
  .object({
    symbol: z.string().min(1).max(16),
    address: AddressSchema,
    decimals: z.number().int().min(0).max(18),
  })
  .strict();

export const PricedBalanceSchema = AssetIdentitySchema.extend({
  amount: UnsignedDecimalSchema,
  priceUsd: PositiveDecimalSchema,
  sourceId: z.string().min(1).max(120),
  observedAt: TimestampSchema,
}).strict();

export const BaseRequestFields = {
  requestId: z.string().min(8).max(120),
  chainId: z.union([z.literal(56), z.literal(97)]),
  account: AddressSchema,
  protocol: z.string().min(1).max(80),
  requestedAt: TimestampSchema,
  deadline: TimestampSchema,
  maxDataAgeSeconds: z.number().int().min(15).max(3_600),
  maxActionUsd: PositiveDecimalSchema,
  maxGasUsd: PositiveDecimalSchema,
  maxSlippageBps: z.number().int().min(0).max(2_000),
  sources: z.array(SourceObservationSchema).min(1),
} as const;

export function validateRequestWindow(
  value: { requestedAt: string; deadline: string },
  context: z.RefinementCtx,
): void {
  if (Date.parse(value.deadline) <= Date.parse(value.requestedAt)) {
    context.addIssue({
      code: "custom",
      path: ["deadline"],
      message: "deadline must be after requestedAt",
    });
  }
}

export const ProviderStatusSchema = z.enum([
  "ACTIONABLE",
  "NO_ACTION",
  "REFUSED_STALE_DATA",
  "REFUSED_EXPIRED",
  "REFUSED_CONSTRAINTS",
  "REFUSED_INCONSISTENT_DATA",
]);
