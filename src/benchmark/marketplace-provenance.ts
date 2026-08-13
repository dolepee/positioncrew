import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { z } from "zod";
import { FixtureJobResponseSchema } from "../api/fixture-response-schema.js";
import { HashSchema, TimestampSchema } from "../contracts/common.js";
import { canonicalHash } from "../core/canonical.js";
import { verifyAgentCaptureManifest } from "./capture-manifest.js";
import { loadBenchmarkAssets, type TermixBenchmarkSlug } from "./lock.js";

const BenchmarkSlugSchema = z.enum(["lending-rescue", "lp-rebalance", "bounded-grid"]);
const BenchmarkServiceSchema = z.enum(["LENDING_RESCUE", "LP_REBALANCE", "BOUNDED_GRID"]);
const BenchmarkLockSchema = z
  .object({
    schemaVersion: z.literal("positioncrew.benchmark-lock.v1"),
    taskId: z.string().min(8),
    fixtureHash: HashSchema,
    rubricHash: HashSchema,
    protocolHash: HashSchema,
  })
  .strict();

const ProtocolTaskSchema = z
  .object({
    benchmarkSlug: BenchmarkSlugSchema,
    service: BenchmarkServiceSchema,
    providerId: z.string().min(3),
    endpoint: z.string().regex(/^\/api\/providers\/(?:lending-rescue|lp-rebalance|bounded-grid)\/jobs$/),
    benchmarkLock: BenchmarkLockSchema,
    expectedOutputHash: HashSchema,
    expectedEvaluationHash: HashSchema,
  })
  .strict();

const ProtocolBodySchema = z
  .object({
    schemaVersion: z.literal("positioncrew.marketplace-invocation-protocol.v1"),
    createdAt: TimestampSchema,
    source: z
      .object({
        repository: z.literal("https://github.com/dolepee/positioncrew"),
        productionBaseUrl: z.literal("https://positioncrew.dolepee.com"),
        productionVersion: z.number().int().positive(),
        productionCommitSha: z.string().regex(/^[a-f0-9]{40}$/),
        agentCaptureManifestHash: HashSchema,
      })
      .strict(),
    execution: z
      .object({
        runsPerTask: z.literal(2),
        order: z.tuple([
          z.literal("lending-rescue"),
          z.literal("lp-rebalance"),
          z.literal("bounded-grid"),
        ]),
        parallelism: z.literal("SEQUENTIAL"),
        attemptPolicy: z.literal("ONE_ATTEMPT_PER_RUN_NO_RETRY"),
        httpMethod: z.literal("POST"),
        bodyMode: z.literal("FROZEN_FIXTURE"),
        timer: z
          .object({
            start: z.string().min(10),
            stop: z.string().min(10),
            clock: z.literal("Node.js performance.now monotonic clock"),
            unit: z.literal("MILLISECONDS"),
          })
          .strict(),
        retention: z.string().min(30),
      })
      .strict(),
    tasks: z.array(ProtocolTaskSchema).length(3),
    successCriteria: z
      .object({
        httpStatus: z.literal(200),
        evidenceMode: z.literal("FROZEN_BSC_TEST_FIXTURE"),
        commerceMode: z.literal("IN_MEMORY_CONFORMANCE"),
        receiptMode: z.literal("PUBLIC_REPRODUCIBLE"),
        jobState: z.literal("COMPLETED"),
        jobHistory: z.tuple([
          z.literal("CREATED"),
          z.literal("FUNDED"),
          z.literal("ASSIGNED"),
          z.literal("SUBMITTED"),
          z.literal("EVALUATED"),
          z.literal("COMPLETED"),
        ]),
        conformanceScore: z.literal(100),
        criticalFailureCount: z.literal(0),
        directCostUsd: z.literal("0.00"),
        walletRequired: z.literal(false),
      })
      .strict(),
    boundaries: z.array(z.string().min(30)).length(4),
  })
  .strict();

export const MarketplaceInvocationProtocolSchema = ProtocolBodySchema.extend({
  protocolHash: HashSchema,
}).strict();

const SuccessObservationSchema = z
  .object({
    evidenceMode: z.literal("FROZEN_BSC_TEST_FIXTURE"),
    commerceMode: z.literal("IN_MEMORY_CONFORMANCE"),
    receiptMode: z.literal("PUBLIC_REPRODUCIBLE"),
    receiptUrl: z.string().url(),
    jobId: z.string().min(8),
    jobState: z.literal("COMPLETED"),
    jobHistory: z.tuple([
      z.literal("CREATED"),
      z.literal("FUNDED"),
      z.literal("ASSIGNED"),
      z.literal("SUBMITTED"),
      z.literal("EVALUATED"),
      z.literal("COMPLETED"),
    ]),
    providerId: z.string().min(3),
    outputHash: HashSchema,
    evaluationHash: HashSchema,
    conformanceScore: z.literal(100),
    criticalFailureCount: z.literal(0),
    responseHash: HashSchema,
  })
  .strict();

export const MarketplaceInvocationRecordSchema = z
  .object({
    schemaVersion: z.literal("positioncrew.marketplace-invocation-record.v1"),
    sequenceNumber: z.number().int().min(1).max(6),
    benchmarkSlug: BenchmarkSlugSchema,
    service: BenchmarkServiceSchema,
    runNumber: z.number().int().min(1).max(2),
    endpointUrl: z.string().url(),
    startedAt: TimestampSchema,
    completedAt: TimestampSchema,
    elapsedMilliseconds: z.number().int().positive(),
    directCostUsd: z.literal("0.00"),
    walletRequired: z.literal(false),
    httpStatus: z.number().int().min(0).max(599),
    success: z.boolean(),
    observation: SuccessObservationSchema.nullable(),
    error: z.string().min(1).nullable(),
  })
  .strict();

const TaskSummarySchema = z
  .object({
    benchmarkSlug: BenchmarkSlugSchema,
    service: BenchmarkServiceSchema,
    attemptCount: z.literal(2),
    successCount: z.number().int().min(0).max(2),
    medianElapsedMilliseconds: z.number().nonnegative().nullable(),
    outputHashesMatch: z.boolean(),
    evaluationHashesMatch: z.boolean(),
  })
  .strict();

const EvidenceBodySchema = z
  .object({
    schemaVersion: z.literal("positioncrew.marketplace-invocation-evidence.v1"),
    protocolHash: HashSchema,
    capturedAt: TimestampSchema,
    source: z
      .object({
        productionBaseUrl: z.literal("https://positioncrew.dolepee.com"),
        productionVersion: z.number().int().positive(),
        productionCommitSha: z.string().regex(/^[a-f0-9]{40}$/),
        protocolCommitSha: z.string().regex(/^[a-f0-9]{40}$/),
        protocolUrl: z.string().url(),
      })
      .strict(),
    records: z.array(MarketplaceInvocationRecordSchema).length(6),
    summaries: z.array(TaskSummarySchema).length(3),
    aggregate: z
      .object({
        plannedAttemptCount: z.literal(6),
        recordedAttemptCount: z.literal(6),
        successCount: z.number().int().min(0).max(6),
        allAttemptsSucceeded: z.boolean(),
      })
      .strict(),
    boundaries: z.array(z.string().min(30)).length(4),
  })
  .strict();

export const MarketplaceInvocationEvidenceSchema = EvidenceBodySchema.extend({
  evidenceHash: HashSchema,
}).strict();

export type MarketplaceInvocationProtocol = z.infer<typeof MarketplaceInvocationProtocolSchema>;
export type MarketplaceInvocationEvidence = z.infer<typeof MarketplaceInvocationEvidenceSchema>;
export type MarketplaceInvocationRecord = z.infer<typeof MarketplaceInvocationRecordSchema>;

export const MARKETPLACE_PROTOCOL_PATH = "benchmarks/marketplace-invocation-protocol.v1.json";
export const MARKETPLACE_EVIDENCE_PATH = "evidence/marketplace-invocations.production.json";

function bodyWithoutHash<T extends { protocolHash: string }>(value: T): Omit<T, "protocolHash"> {
  const { protocolHash: _protocolHash, ...body } = value;
  return body;
}

function evidenceBody(value: MarketplaceInvocationEvidence): Omit<MarketplaceInvocationEvidence, "evidenceHash"> {
  const { evidenceHash: _evidenceHash, ...body } = value;
  return body;
}

export function loadMarketplaceInvocationProtocol(
  root = process.cwd(),
  relativePath = MARKETPLACE_PROTOCOL_PATH,
): MarketplaceInvocationProtocol {
  const protocol = MarketplaceInvocationProtocolSchema.parse(
    JSON.parse(readFileSync(resolve(root, relativePath), "utf8")),
  );
  if (canonicalHash(ProtocolBodySchema.parse(bodyWithoutHash(protocol))) !== protocol.protocolHash) {
    throw new Error("Marketplace invocation protocol commitment is invalid");
  }
  verifyProtocolAgainstProject(protocol, root);
  return protocol;
}

export function verifyProtocolAgainstProject(
  protocol: MarketplaceInvocationProtocol,
  root = process.cwd(),
): void {
  const captureManifest = verifyAgentCaptureManifest(root);
  if (protocol.source.agentCaptureManifestHash !== captureManifest.manifestHash) {
    throw new Error("Marketplace protocol does not bind the committed agent-capture manifest");
  }
  if (protocol.tasks.map((task) => task.benchmarkSlug).join(",") !== protocol.execution.order.join(",")) {
    throw new Error("Marketplace protocol task order is not canonical");
  }
  for (const task of protocol.tasks) {
    const assets = loadBenchmarkAssets(task.benchmarkSlug, root);
    const capture = captureManifest.benchmarks.find(
      (candidate) => candidate.benchmarkSlug === task.benchmarkSlug,
    );
    if (!capture) throw new Error(`${task.benchmarkSlug} is missing from the capture manifest`);
    if (canonicalHash(task.benchmarkLock) !== canonicalHash(assets.lock)) {
      throw new Error(`${task.benchmarkSlug} protocol lock differs from project assets`);
    }
    if (capture.providerId !== task.providerId) {
      throw new Error(`${task.benchmarkSlug} provider differs from the capture manifest`);
    }
    if (capture.candidates.some((candidate) => candidate.outputHash !== task.expectedOutputHash)) {
      throw new Error(`${task.benchmarkSlug} output differs from the committed agent candidates`);
    }
    if (capture.candidates.some((candidate) => candidate.evaluationHash !== task.expectedEvaluationHash)) {
      throw new Error(`${task.benchmarkSlug} evaluation differs from the committed agent candidates`);
    }
  }
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]!
    : Number(((sorted[middle - 1]! + sorted[middle]!) / 2).toFixed(1));
}

function summariesFor(
  protocol: MarketplaceInvocationProtocol,
  records: MarketplaceInvocationRecord[],
): z.infer<typeof TaskSummarySchema>[] {
  return protocol.tasks.map((task) => {
    const taskRecords = records.filter((record) => record.benchmarkSlug === task.benchmarkSlug);
    const successful = taskRecords.filter((record) => record.success);
    return {
      benchmarkSlug: task.benchmarkSlug,
      service: task.service,
      attemptCount: 2 as const,
      successCount: successful.length,
      medianElapsedMilliseconds: median(successful.map((record) => record.elapsedMilliseconds)),
      outputHashesMatch:
        successful.length === 2 &&
        successful.every((record) => record.observation?.outputHash === task.expectedOutputHash),
      evaluationHashesMatch:
        successful.length === 2 &&
        successful.every(
          (record) => record.observation?.evaluationHash === task.expectedEvaluationHash,
        ),
    };
  });
}

function responseObservation(
  responseBody: unknown,
  task: MarketplaceInvocationProtocol["tasks"][number],
  baseUrl: string,
): z.infer<typeof SuccessObservationSchema> {
  const response = FixtureJobResponseSchema.parse(responseBody);
  const manifest = response.result.job.deliverable;
  if (!manifest) throw new Error("Marketplace response is missing its deliverable manifest");
  const history = response.result.job.history.map((entry) => entry.state);
  const criticalFailureCount = response.result.evaluation.checks.filter(
    (check) => check.critical && !check.passed,
  ).length;
  const observation = {
    evidenceMode: response.evidenceMode,
    commerceMode: response.commerceMode,
    receiptMode: response.receipt.mode,
    receiptUrl: new URL(response.receipt.path ?? "", baseUrl).toString(),
    jobId: response.result.job.jobId,
    jobState: response.result.job.state,
    jobHistory: history,
    providerId: response.result.job.providerId ?? "",
    outputHash: manifest.deliverableHash,
    evaluationHash: response.result.evaluation.evaluationHash,
    conformanceScore: response.result.evaluation.score,
    criticalFailureCount,
    responseHash: canonicalHash(responseBody),
  };
  const parsed = SuccessObservationSchema.parse(observation);
  if (canonicalHash(response.benchmarkLock) !== canonicalHash(task.benchmarkLock)) {
    throw new Error("Marketplace response benchmark lock differs from the protocol");
  }
  if (parsed.providerId !== task.providerId) throw new Error("Marketplace response provider differs from the protocol");
  if (parsed.outputHash !== task.expectedOutputHash) throw new Error("Marketplace response output differs from the protocol");
  if (parsed.evaluationHash !== task.expectedEvaluationHash) throw new Error("Marketplace response evaluation differs from the protocol");
  return parsed;
}

export async function captureMarketplaceInvocationEvidence(options: {
  protocolCommitSha: string;
  root?: string;
  protocol?: MarketplaceInvocationProtocol;
  fetch?: typeof fetch;
  now?: () => Date;
  monotonicNow?: () => number;
}): Promise<MarketplaceInvocationEvidence> {
  const root = resolve(options.root ?? process.cwd());
  const protocol = options.protocol ?? loadMarketplaceInvocationProtocol(root);
  verifyProtocolAgainstProject(protocol, root);
  const fetcher = options.fetch ?? fetch;
  const clock = options.now ?? (() => new Date());
  const monotonic = options.monotonicNow ?? (() => performance.now());
  const records: MarketplaceInvocationRecord[] = [];
  let sequenceNumber = 0;
  for (const task of protocol.tasks) {
    const assets = loadBenchmarkAssets(task.benchmarkSlug, root);
    for (let runNumber = 1; runNumber <= protocol.execution.runsPerTask; runNumber += 1) {
      sequenceNumber += 1;
      const startedAt = clock();
      const started = monotonic();
      let httpStatus = 0;
      let observation: z.infer<typeof SuccessObservationSchema> | null = null;
      let error: string | null = null;
      try {
        const endpointUrl = new URL(task.endpoint, protocol.source.productionBaseUrl).toString();
        const response = await fetcher(endpointUrl, {
          method: "POST",
          headers: { Accept: "application/json", "Content-Type": "application/json" },
          body: JSON.stringify({ mode: protocol.execution.bodyMode, request: assets.fixture }),
        });
        httpStatus = response.status;
        const text = await response.text();
        if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 500)}`);
        const body: unknown = JSON.parse(text);
        observation = responseObservation(body, task, protocol.source.productionBaseUrl);
      } catch (caught) {
        error = caught instanceof Error ? caught.message : String(caught);
      }
      const completedAt = clock();
      const elapsedMilliseconds = Math.max(1, Math.round(monotonic() - started));
      records.push(
        MarketplaceInvocationRecordSchema.parse({
          schemaVersion: "positioncrew.marketplace-invocation-record.v1",
          sequenceNumber,
          benchmarkSlug: task.benchmarkSlug,
          service: task.service,
          runNumber,
          endpointUrl: new URL(task.endpoint, protocol.source.productionBaseUrl).toString(),
          startedAt: startedAt.toISOString(),
          completedAt: completedAt.toISOString(),
          elapsedMilliseconds,
          directCostUsd: protocol.successCriteria.directCostUsd,
          walletRequired: protocol.successCriteria.walletRequired,
          httpStatus,
          success: error === null,
          observation,
          error,
        }),
      );
    }
  }
  const summaries = summariesFor(protocol, records);
  const successCount = records.filter((record) => record.success).length;
  const body = EvidenceBodySchema.parse({
    schemaVersion: "positioncrew.marketplace-invocation-evidence.v1",
    protocolHash: protocol.protocolHash,
    capturedAt: clock().toISOString(),
    source: {
      productionBaseUrl: protocol.source.productionBaseUrl,
      productionVersion: protocol.source.productionVersion,
      productionCommitSha: protocol.source.productionCommitSha,
      protocolCommitSha: options.protocolCommitSha,
      protocolUrl: `${protocol.source.repository}/blob/${options.protocolCommitSha}/${MARKETPLACE_PROTOCOL_PATH}`,
    },
    records,
    summaries,
    aggregate: {
      plannedAttemptCount: 6,
      recordedAttemptCount: 6,
      successCount,
      allAttemptsSucceeded: successCount === 6,
    },
    boundaries: protocol.boundaries,
  });
  return MarketplaceInvocationEvidenceSchema.parse({
    ...body,
    evidenceHash: canonicalHash(body),
  });
}

export function verifyMarketplaceInvocationEvidence(
  root = process.cwd(),
  relativePath = MARKETPLACE_EVIDENCE_PATH,
): MarketplaceInvocationEvidence {
  const protocol = loadMarketplaceInvocationProtocol(root);
  const evidence: unknown = JSON.parse(readFileSync(resolve(root, relativePath), "utf8"));
  return verifyMarketplaceInvocationEvidenceObject(evidence, protocol);
}

export function verifyMarketplaceInvocationEvidenceObject(
  input: unknown,
  protocol: MarketplaceInvocationProtocol,
): MarketplaceInvocationEvidence {
  const evidence = MarketplaceInvocationEvidenceSchema.parse(input);
  if (evidence.protocolHash !== protocol.protocolHash) {
    throw new Error("Marketplace evidence does not bind the committed invocation protocol");
  }
  if (
    evidence.source.protocolUrl !==
    `${protocol.source.repository}/blob/${evidence.source.protocolCommitSha}/${MARKETPLACE_PROTOCOL_PATH}`
  ) {
    throw new Error("Marketplace evidence protocol URL does not match its source commit");
  }
  if (canonicalHash(EvidenceBodySchema.parse(evidenceBody(evidence))) !== evidence.evidenceHash) {
    throw new Error("Marketplace invocation evidence commitment is invalid");
  }
  const expectedOrder = protocol.tasks.flatMap((task) => [
    `${task.benchmarkSlug}:1`,
    `${task.benchmarkSlug}:2`,
  ]);
  if (
    evidence.records
      .map((record) => `${record.benchmarkSlug}:${record.runNumber}`)
      .join(",") !== expectedOrder.join(",")
  ) {
    throw new Error("Marketplace invocation records are missing, duplicated, retried, or reordered");
  }
  evidence.records.forEach((record, index) => {
    if (record.sequenceNumber !== index + 1) throw new Error("Marketplace invocation sequence is not contiguous");
    const task = protocol.tasks.find((candidate) => candidate.benchmarkSlug === record.benchmarkSlug)!;
    if (record.service !== task.service) throw new Error(`${record.benchmarkSlug} service differs from protocol`);
    if (record.endpointUrl !== new URL(task.endpoint, protocol.source.productionBaseUrl).toString()) {
      throw new Error(`${record.benchmarkSlug} endpoint differs from protocol`);
    }
    if (record.success) {
      if (record.httpStatus !== protocol.successCriteria.httpStatus || !record.observation || record.error) {
        throw new Error(`${record.benchmarkSlug} success record is internally inconsistent`);
      }
      if (
        record.observation.outputHash !== task.expectedOutputHash ||
        record.observation.evaluationHash !== task.expectedEvaluationHash ||
        record.observation.providerId !== task.providerId
      ) {
        throw new Error(`${record.benchmarkSlug} successful observation differs from protocol`);
      }
    } else if (record.observation !== null || record.error === null) {
      throw new Error(`${record.benchmarkSlug} failure record is internally inconsistent`);
    }
  });
  const expectedSummaries = summariesFor(protocol, evidence.records);
  if (canonicalHash(expectedSummaries) !== canonicalHash(evidence.summaries)) {
    throw new Error("Marketplace invocation summaries do not match their records");
  }
  const successCount = evidence.records.filter((record) => record.success).length;
  if (
    evidence.aggregate.successCount !== successCount ||
    evidence.aggregate.allAttemptsSucceeded !== (successCount === 6)
  ) {
    throw new Error("Marketplace invocation aggregate does not match its records");
  }
  return evidence;
}

export function writeMarketplaceInvocationEvidenceExclusive(
  evidence: MarketplaceInvocationEvidence,
  root = process.cwd(),
  relativePath = MARKETPLACE_EVIDENCE_PATH,
): string {
  const path = resolve(root, relativePath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(evidence, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
  return path;
}

export function computeMarketplaceProtocolHash(input: unknown): string {
  const value = MarketplaceInvocationProtocolSchema.omit({ protocolHash: true }).parse(input);
  return canonicalHash(value);
}

export type { TermixBenchmarkSlug };
