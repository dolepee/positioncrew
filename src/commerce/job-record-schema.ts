import { z } from "zod";
import { HashSchema, TimestampSchema } from "../contracts/common.js";
import {
  DeliverableManifestSchema,
  EvaluationReceiptSchema,
  FundingReceiptSchema,
  JobEnvelopeSchema,
  JobStateSchema,
} from "./types.js";

export const JobRecordSchema = z
  .object({
    jobId: z.string().min(8),
    envelope: JobEnvelopeSchema,
    envelopeHash: HashSchema,
    state: JobStateSchema,
    providerId: z.string().nullable(),
    evaluatorId: z.string().nullable(),
    funding: FundingReceiptSchema.nullable(),
    deliverable: DeliverableManifestSchema.nullable(),
    evaluation: EvaluationReceiptSchema.nullable(),
    history: z.array(
      z
        .object({
          state: JobStateSchema,
          at: TimestampSchema,
          reference: z.string().min(1),
        })
        .strict(),
    ),
  })
  .strict();
