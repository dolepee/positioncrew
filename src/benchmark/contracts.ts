import { z } from "zod";

const CriterionSchema = z
  .object({
    id: z.string().min(1).max(80),
    label: z.string().min(1).max(160),
    maximumScore: z.number().int().min(1).max(100),
    critical: z.boolean(),
    fullCredit: z.string().min(1).max(500),
    zeroCredit: z.string().min(1).max(500),
  })
  .strict();

export const BenchmarkRubricSchema = z
  .object({
    schemaVersion: z.literal("positioncrew.benchmark-rubric.v1"),
    rubricId: z.string().min(3).max(120),
    taskId: z.string().min(8).max(120),
    title: z.string().min(3).max(160),
    maximumScore: z.literal(100),
    passScore: z.number().int().min(1).max(100),
    criteria: z.array(CriterionSchema).min(3),
  })
  .strict()
  .superRefine((value, context) => {
    const sum = value.criteria.reduce((total, criterion) => total + criterion.maximumScore, 0);
    if (sum !== value.maximumScore) {
      context.addIssue({
        code: "custom",
        path: ["criteria"],
        message: `criterion weights must sum to ${value.maximumScore}; received ${sum}`,
      });
    }
    if (new Set(value.criteria.map((criterion) => criterion.id)).size !== value.criteria.length) {
      context.addIssue({
        code: "custom",
        path: ["criteria"],
        message: "criterion IDs must be unique",
      });
    }
  });

export const BenchmarkProtocolSchema = z
  .object({
    schemaVersion: z.literal("positioncrew.benchmark-protocol.v2"),
    protocolId: z.string().min(3).max(120),
    taskId: z.string().min(8).max(120),
    fixturePath: z.string().min(1).max(240),
    rubricPath: z.string().min(1).max(240),
    runs: z.object({ manual: z.literal(1), agent: z.number().int().min(2).max(5) }).strict(),
    timing: z
      .object({ start: z.string().min(1), stop: z.string().min(1), unit: z.literal("milliseconds") })
      .strict(),
    allowedInputs: z.array(z.string().min(1)).min(1),
    prohibitedInputs: z.array(z.string().min(1)).min(1),
    blinding: z
      .object({
        candidateLabels: z.array(z.string().min(1)).length(2),
        agentRepresentativeSelection: z.string().min(1),
        randomization: z.string().min(1),
        mappingCustody: z.string().min(1),
        evaluator: z.string().min(1),
      })
      .strict(),
    reportedMetrics: z.array(z.string().min(1)).min(4),
    decisionRule: z.string().min(1),
  })
  .strict();

export type BenchmarkRubric = z.infer<typeof BenchmarkRubricSchema>;
export type BenchmarkProtocol = z.infer<typeof BenchmarkProtocolSchema>;
