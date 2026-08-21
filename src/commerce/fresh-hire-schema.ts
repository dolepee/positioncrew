import { z } from "zod";

export const FRESH_MARKETPLACE_TASKS = {
  "lending-rescue": {
    providerSlug: "lending-rescue",
    service: "LENDING_RESCUE",
    requestSchema: "positioncrew.lending-rescue.request.v1",
  },
  "lp-rebalance": {
    providerSlug: "lp-rebalance",
    service: "LP_REBALANCE",
    requestSchema: "positioncrew.lp-rebalance.request.v1",
  },
  "bounded-grid": {
    providerSlug: "bounded-grid",
    service: "BOUNDED_GRID",
    requestSchema: "positioncrew.bounded-grid.request.v1",
  },
} as const;

export const FRESH_MARKETPLACE_CLAIM_BOUNDARY = [
  "This is a public-workspace run of a frozen historical benchmark fixture.",
  "The run costs $0.00, requires no wallet, and creates no payment or settlement.",
  "The server receipt proves only this PositionCrew request, provider selection, result, and timing trace.",
  "It does not establish an external buyer, paid demand, third-party protocol execution, onchain immutability, or live financial advice.",
] as const;

const IdempotencyKeySchema = z.string().uuid();
const Sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const IsoTimestampSchema = z.string().datetime({ offset: true });
const baseRequest = {
  schemaVersion: z.literal("positioncrew.fresh-marketplace-hire-request.v1"),
  idempotencyKey: IdempotencyKeySchema,
};

export const FreshMarketplaceHireRequestSchema = z.union([
  z.object({
    ...baseRequest,
    benchmarkSlug: z.literal("lending-rescue"),
    providerSlug: z.literal("lending-rescue"),
  }).strict(),
  z.object({
    ...baseRequest,
    benchmarkSlug: z.literal("lp-rebalance"),
    providerSlug: z.literal("lp-rebalance"),
  }).strict(),
  z.object({
    ...baseRequest,
    benchmarkSlug: z.literal("bounded-grid"),
    providerSlug: z.literal("bounded-grid"),
  }).strict(),
]);

export const FreshMarketplaceJobStateSchema = z.enum([
  "CREATED",
  "RUNNING",
  "COMPLETED",
  "FAILED",
]);

export const FreshMarketplaceChainSchema = z.object({
  schemaVersion: z.literal("positioncrew.fresh-marketplace-chain.v1"),
  claimBoundary: z.tuple([
    z.literal(FRESH_MARKETPLACE_CLAIM_BOUNDARY[0]),
    z.literal(FRESH_MARKETPLACE_CLAIM_BOUNDARY[1]),
    z.literal(FRESH_MARKETPLACE_CLAIM_BOUNDARY[2]),
    z.literal(FRESH_MARKETPLACE_CLAIM_BOUNDARY[3]),
  ]),
  hire: z.object({
    hireId: z.string().uuid(),
    idempotencyKey: IdempotencyKeySchema,
    providerSlug: z.enum(["lending-rescue", "lp-rebalance", "bounded-grid"]),
    providerId: z.string().min(1),
    benchmarkSlug: z.enum(["lending-rescue", "lp-rebalance", "bounded-grid"]),
    service: z.enum(["LENDING_RESCUE", "LP_REBALANCE", "BOUNDED_GRID"]),
    evidenceMode: z.literal("HISTORICAL_FIXTURE"),
    commerce: z.object({
      directCostUsd: z.literal("0.00"),
      walletRequired: z.literal(false),
      settlement: z.literal("NO_PAYMENT"),
    }).strict(),
    request: z.record(z.string(), z.unknown()),
    requestHash: Sha256Schema,
    createdAt: IsoTimestampSchema,
  }).strict(),
  job: z.object({
    jobId: z.string().uuid(),
    state: FreshMarketplaceJobStateSchema,
    status: z.enum(["HIRE_RECORDED", "RUNNING", "COMPLETED", "FAILED"]),
    createdAt: IsoTimestampSchema,
    startedAt: IsoTimestampSchema.nullable(),
    completedAt: IsoTimestampSchema.nullable(),
    apiDurationMilliseconds: z.number().int().positive().nullable(),
    error: z.object({ code: z.string().min(1), message: z.string().min(1) }).strict().nullable(),
  }).strict(),
  receipt: z.object({
    receiptId: z.string().uuid(),
    publicUrl: z.string().startsWith("/api/benchmark-receipts/"),
    responseHash: Sha256Schema,
    deliverableHash: Sha256Schema,
    evaluationHash: Sha256Schema,
    createdAt: IsoTimestampSchema,
    response: z.unknown(),
  }).strict().nullable(),
}).strict();

export type FreshMarketplaceHireRequest = z.infer<typeof FreshMarketplaceHireRequestSchema>;
export type FreshMarketplaceChain = z.infer<typeof FreshMarketplaceChainSchema>;
export type FreshMarketplaceBenchmarkSlug = keyof typeof FRESH_MARKETPLACE_TASKS;

function canonicalValue(value: unknown): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Canonical JSON rejects non-finite numbers");
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const item = (value as Record<string, unknown>)[key];
      if (item !== undefined) output[key] = canonicalValue(item);
    }
    return output;
  }
  throw new Error("Canonical JSON accepts JSON values only");
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

export async function sha256Commitment(value: unknown): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalJson(value)));
  return "sha256:" + Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function freshMarketplaceTaskForService(
  service: string,
): [FreshMarketplaceBenchmarkSlug, (typeof FRESH_MARKETPLACE_TASKS)[FreshMarketplaceBenchmarkSlug]] | null {
  const match = Object.entries(FRESH_MARKETPLACE_TASKS).find(([, task]) => task.service === service);
  return match as [FreshMarketplaceBenchmarkSlug, (typeof FRESH_MARKETPLACE_TASKS)[FreshMarketplaceBenchmarkSlug]] | null;
}
