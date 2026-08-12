import { z } from "zod";
import {
  AddressSchema,
  HashSchema,
  PositiveDecimalSchema,
  ServiceTypeSchema,
  TimestampSchema,
} from "../contracts/common.js";

export const JobStateSchema = z.enum([
  "CREATED",
  "FUNDED",
  "ASSIGNED",
  "SUBMITTED",
  "EVALUATED",
  "COMPLETED",
  "REJECTED",
  "DISPUTED",
  "REFUNDED",
  "UNKNOWN",
]);

export const JobBudgetSchema = z
  .object({
    chainId: z.union([z.literal(56), z.literal(97)]),
    token: z
      .object({
        symbol: z.string().min(1).max(16),
        address: AddressSchema,
        decimals: z.number().int().min(0).max(18),
      })
      .strict(),
    amount: PositiveDecimalSchema,
  })
  .strict();

export const JobEnvelopeSchema = z
  .object({
    schemaVersion: z.literal("capitalops.job-envelope.v1"),
    idempotencyKey: z.string().min(8).max(160),
    service: ServiceTypeSchema,
    requestId: z.string().min(8).max(120),
    requestHash: HashSchema,
    budget: JobBudgetSchema,
    createdAt: TimestampSchema,
    deadline: TimestampSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (Date.parse(value.deadline) <= Date.parse(value.createdAt)) {
      context.addIssue({
        code: "custom",
        path: ["deadline"],
        message: "deadline must be after createdAt",
      });
    }
  });

export const FundingReceiptSchema = z
  .object({
    tokenAddress: AddressSchema,
    amount: PositiveDecimalSchema,
    transactionReference: z.string().min(8).max(200),
    fundedAt: TimestampSchema,
  })
  .strict();

export const DeliverableManifestSchema = z
  .object({
    schemaVersion: z.literal("capitalops.deliverable-manifest.v1"),
    requestHash: HashSchema,
    deliverableHash: HashSchema,
    mediaType: z.literal("application/json"),
    uri: z.string().url(),
    createdAt: TimestampSchema,
  })
  .strict();

export const EvaluationCheckSchema = z
  .object({
    id: z.string().min(1).max(120),
    label: z.string().min(1).max(200),
    weight: z.number().int().min(0).max(100),
    critical: z.boolean(),
    passed: z.boolean(),
    evidence: z.string().min(1).max(500),
  })
  .strict();

export const EvaluationReceiptSchema = z
  .object({
    schemaVersion: z.literal("capitalops.evaluation.v1"),
    rubricVersion: z.string().min(1).max(120),
    requestHash: HashSchema,
    deliverableHash: HashSchema,
    evaluatorId: z.string().min(3).max(160),
    evaluatedAt: TimestampSchema,
    score: z.number().int().min(0).max(100),
    passed: z.boolean(),
    checks: z.array(EvaluationCheckSchema).min(1),
    evaluationHash: HashSchema,
  })
  .strict()
  .superRefine((value, context) => {
    const computedScore = value.checks.reduce(
      (total, check) => total + (check.passed ? check.weight : 0),
      0,
    );
    if (computedScore !== value.score) {
      context.addIssue({
        code: "custom",
        path: ["score"],
        message: `score must equal passed check weights (${computedScore})`,
      });
    }
    const criticalFailure = value.checks.some(
      (check) => check.critical && !check.passed,
    );
    if (value.passed !== (value.score >= 90 && !criticalFailure)) {
      context.addIssue({
        code: "custom",
        path: ["passed"],
        message: "passed requires score >= 90 and no critical failures",
      });
    }
  });

export interface JobHistoryEntry {
  state: z.infer<typeof JobStateSchema>;
  at: string;
  reference: string;
}

export interface JobRecord {
  jobId: string;
  envelope: z.infer<typeof JobEnvelopeSchema>;
  envelopeHash: string;
  state: z.infer<typeof JobStateSchema>;
  providerId: string | null;
  evaluatorId: string | null;
  funding: z.infer<typeof FundingReceiptSchema> | null;
  deliverable: z.infer<typeof DeliverableManifestSchema> | null;
  evaluation: z.infer<typeof EvaluationReceiptSchema> | null;
  history: JobHistoryEntry[];
}

export interface CommerceAdapter {
  createJob(envelope: z.input<typeof JobEnvelopeSchema>): Promise<JobRecord>;
  fund(jobId: string, receipt: z.input<typeof FundingReceiptSchema>): Promise<JobRecord>;
  assignProvider(jobId: string, providerId: string): Promise<JobRecord>;
  assignEvaluator(jobId: string, evaluatorId: string): Promise<JobRecord>;
  submitDeliverable(
    jobId: string,
    manifest: z.input<typeof DeliverableManifestSchema>,
  ): Promise<JobRecord>;
  evaluate(
    jobId: string,
    receipt: z.input<typeof EvaluationReceiptSchema>,
  ): Promise<JobRecord>;
  reconcile(jobId: string): Promise<JobRecord>;
}

export type JobEnvelope = z.infer<typeof JobEnvelopeSchema>;
export type FundingReceipt = z.infer<typeof FundingReceiptSchema>;
export type DeliverableManifest = z.infer<typeof DeliverableManifestSchema>;
export type EvaluationCheck = z.infer<typeof EvaluationCheckSchema>;
export type EvaluationReceipt = z.infer<typeof EvaluationReceiptSchema>;
