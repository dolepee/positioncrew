import { randomBytes, randomInt } from "node:crypto";
import {
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { basename, join, resolve, sep } from "node:path";
import { performance } from "node:perf_hooks";
import { z } from "zod";
import { runFrozenFixture } from "../api/fixture-jobs.js";
import { BoundedGridDeliverableSchema } from "../contracts/bounded-grid.js";
import { LendingRescueDeliverableSchema } from "../contracts/lending-rescue.js";
import { LpRebalanceDeliverableSchema } from "../contracts/lp-rebalance.js";
import { PositionCrewDeliverableSchema } from "../contracts/index.js";
import {
  HashSchema,
  TimestampSchema,
  UnsignedDecimalSchema,
} from "../contracts/common.js";
import { canonicalHash } from "../core/canonical.js";
import { BenchmarkRubricSchema } from "./contracts.js";
import {
  loadBenchmarkAssets,
  type BenchmarkLock,
  type TermixBenchmarkService,
  type TermixBenchmarkSlug,
} from "./lock.js";

const BenchmarkSlugSchema = z.enum([
  "lending-rescue",
  "lp-rebalance",
  "bounded-grid",
]);
const BenchmarkServiceSchema = z.enum([
  "LENDING_RESCUE",
  "LP_REBALANCE",
  "BOUNDED_GRID",
]);

export const MANUAL_INDEPENDENCE_ATTESTATION =
  "I completed this task without PositionCrew, an AI assistant, a prior candidate output, or access to the scoring rubric.";
export const EVALUATOR_INDEPENDENCE_ATTESTATION =
  "I did not produce either candidate and could not see source identity, timing, or cost while scoring.";
export const SCORECARD_ATTESTATION =
  "I scored both candidates only against the attached frozen rubric and confirm this scorecard is complete.";

const IdentityReferenceSchema = z.string().trim().min(3).max(240);
const BenchmarkLockSchema = z
  .object({
    schemaVersion: z.literal("positioncrew.benchmark-lock.v1"),
    taskId: z.string().min(8),
    fixtureHash: HashSchema,
    rubricHash: HashSchema,
    protocolHash: HashSchema,
  })
  .strict();

export const BenchmarkSessionSchema = z
  .object({
    schemaVersion: z.literal("positioncrew.benchmark-session.v1"),
    sessionId: z.string().regex(/^[a-z0-9-]{12,160}$/),
    benchmarkSlug: BenchmarkSlugSchema,
    service: BenchmarkServiceSchema,
    taskId: z.string().min(8),
    createdAt: TimestampSchema,
    benchmarkLock: BenchmarkLockSchema,
  })
  .strict();

const CandidateSourceSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("AGENT"),
      operatorId: z.literal("PositionCrew"),
      providerId: z.string().min(1),
    })
    .strict(),
  z
    .object({
      type: z.literal("MANUAL"),
      operatorId: z.string().min(2).max(160),
      contactReference: IdentityReferenceSchema,
      method: z.string().min(10).max(1_000),
      independenceAttestation: z.literal(MANUAL_INDEPENDENCE_ATTESTATION),
    })
    .strict(),
]);

export const ManualCaptureMetadataSchema = z
  .object({
    operatorId: z.string().min(2).max(160),
    contactReference: IdentityReferenceSchema,
    method: z.string().min(10).max(1_000),
    independenceAttestation: z.literal(MANUAL_INDEPENDENCE_ATTESTATION),
    elapsedMilliseconds: z.number().int().min(1),
    directCostUsd: UnsignedDecimalSchema,
    capturedAt: TimestampSchema,
  })
  .strict();

const ConformanceSummarySchema = z
  .object({
    score: z.number().int().min(0).max(100),
    criticalFailureCount: z.number().int().min(0),
    evaluationHash: HashSchema,
  })
  .strict();

const CandidateBodySchema = z
  .object({
    schemaVersion: z.literal("positioncrew.benchmark-candidate.v1"),
    sessionId: z.string().min(12),
    benchmarkSlug: BenchmarkSlugSchema,
    service: BenchmarkServiceSchema,
    taskId: z.string().min(8),
    source: CandidateSourceSchema,
    runNumber: z.number().int().min(1).max(5),
    capturedAt: TimestampSchema,
    elapsedMilliseconds: z.number().int().min(1),
    directCostUsd: UnsignedDecimalSchema,
    benchmarkLock: BenchmarkLockSchema,
    outputHash: HashSchema,
    output: PositionCrewDeliverableSchema,
    conformance: ConformanceSummarySchema.nullable(),
  })
  .strict();

export const BenchmarkCandidateRecordSchema = CandidateBodySchema.extend({
  candidateHash: HashSchema,
}).strict();

const BlindCandidateSchema = z
  .object({
    label: z.string().min(1).max(80),
    outputHash: HashSchema,
    output: PositionCrewDeliverableSchema,
  })
  .strict();

const BlindPacketBodySchema = z
  .object({
    schemaVersion: z.literal("positioncrew.blind-evaluator-packet.v1"),
    sessionId: z.string().min(12),
    benchmarkSlug: BenchmarkSlugSchema,
    taskId: z.string().min(8),
    createdAt: TimestampSchema,
    benchmarkLock: BenchmarkLockSchema,
    mappingCommitment: HashSchema,
    rubric: BenchmarkRubricSchema,
    candidates: z.array(BlindCandidateSchema).length(2),
    evaluatorInstructions: z.array(z.string().min(1)).min(3),
    boundary: z.string().min(20),
  })
  .strict();

export const BenchmarkBlindPacketSchema = BlindPacketBodySchema.extend({
  packetHash: HashSchema,
}).strict();

const MappingAssignmentSchema = z
  .object({
    label: z.string().min(1).max(80),
    candidateHash: HashSchema,
    sourceType: z.enum(["AGENT", "MANUAL"]),
    runNumber: z.number().int().min(1).max(5),
  })
  .strict();

const PrivateMappingBodySchema = z
  .object({
    schemaVersion: z.literal("positioncrew.private-source-mapping.v1"),
    sessionId: z.string().min(12),
    salt: z.string().regex(/^[a-f0-9]{64}$/),
    assignments: z.array(MappingAssignmentSchema).length(2),
    excludedAgentRepeat: z
      .object({ candidateHash: HashSchema, runNumber: z.number().int().min(2).max(5) })
      .strict(),
  })
  .strict();

export const PrivateSourceMappingSchema = PrivateMappingBodySchema.extend({
  mappingCommitment: HashSchema,
}).strict();

const CriterionScoreSchema = z
  .object({
    criterionId: z.string().min(1).max(80),
    score: z.number().int().min(0).max(100),
    criticalFailure: z.boolean(),
    notes: z.string().min(1).max(1_000),
  })
  .strict();

const CandidateScoreSchema = z
  .object({
    label: z.string().min(1).max(80),
    criteria: z.array(CriterionScoreSchema).min(3),
    overallNotes: z.string().min(1).max(2_000),
  })
  .strict();

export const BlindScorecardSchema = z
  .object({
    schemaVersion: z.literal("positioncrew.blind-scorecard.v1"),
    sessionId: z.string().min(12),
    taskId: z.string().min(8),
    packetHash: HashSchema,
    mappingCommitment: HashSchema,
    evaluator: z
      .object({
        displayName: z.string().min(2).max(160),
        contactReference: IdentityReferenceSchema,
        relationshipDisclosure: z.string().min(10).max(1_000),
        independenceAttestation: z.literal(EVALUATOR_INDEPENDENCE_ATTESTATION),
      })
      .strict(),
    scoredAt: TimestampSchema,
    candidates: z.array(CandidateScoreSchema).length(2),
    attestation: z.literal(SCORECARD_ATTESTATION),
  })
  .strict();

export const AgentAdvantageResultSchema = z
  .object({
    schemaVersion: z.literal("positioncrew.agent-advantage-result.v2"),
    sessionId: z.string().min(12),
    benchmarkSlug: BenchmarkSlugSchema,
    taskId: z.string().min(8),
    evaluatedAt: TimestampSchema,
    scorecardHash: HashSchema,
    mappingCommitment: HashSchema,
    manual: z
      .object({
        candidateLabel: z.string().min(1).max(80),
        outputHash: HashSchema,
        operatorId: z.string().min(2).max(160),
        contactReference: IdentityReferenceSchema,
        method: z.string().min(10).max(1_000),
        independenceAttestation: z.literal(MANUAL_INDEPENDENCE_ATTESTATION),
        score: z.number().int().min(0).max(100),
        blindCriticalFailureCount: z.number().int().min(0),
        elapsedMilliseconds: z.number().int().min(1),
        directCostUsd: UnsignedDecimalSchema,
      })
      .strict(),
    agent: z
      .object({
        candidateLabel: z.string().min(1).max(80),
        outputHash: HashSchema,
        repeatOutputHash: HashSchema,
        providerId: z.string().min(1).max(240),
        score: z.number().int().min(0).max(100),
        medianElapsedMilliseconds: z.number().min(1),
        medianDirectCostUsd: UnsignedDecimalSchema,
        outputHashesMatch: z.boolean(),
        conformanceCriticalFailureCount: z.number().int().min(0),
        blindCriticalFailureCount: z.number().int().min(0),
      })
      .strict(),
    evaluator: z
      .object({
        displayName: z.string().min(2).max(160),
        contactReference: IdentityReferenceSchema,
        relationshipDisclosure: z.string().min(10).max(1_000),
        independenceAttestation: z.literal(EVALUATOR_INDEPENDENCE_ATTESTATION),
      })
      .strict(),
    advantageSupported: z.boolean(),
    decisionRule: z.string().min(20),
    boundary: z.string().min(20),
  })
  .strict();

export type BenchmarkSession = z.infer<typeof BenchmarkSessionSchema>;
export type BenchmarkCandidateRecord = z.infer<typeof BenchmarkCandidateRecordSchema>;
export type BenchmarkBlindPacket = z.infer<typeof BenchmarkBlindPacketSchema>;
export type BlindScorecard = z.infer<typeof BlindScorecardSchema>;
export type PrivateSourceMapping = z.infer<typeof PrivateSourceMappingSchema>;
export type ManualCaptureMetadata = z.infer<typeof ManualCaptureMetadataSchema>;

export interface PreparedBenchmarkSession {
  directory: string;
  session: BenchmarkSession;
  taskPacketPath: string;
  manualMetadataTemplatePath: string;
}

export type BenchmarkResult = z.infer<typeof AgentAdvantageResultSchema>;

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

function prettyJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function writeJsonExclusive(path: string, value: unknown): void {
  writeFileSync(path, prettyJson(value), { encoding: "utf8", flag: "wx", mode: 0o600 });
}

function sameCommitment(left: BenchmarkLock, right: BenchmarkLock): boolean {
  return canonicalHash(left) === canonicalHash(right);
}

function validateSessionAssets(
  session: BenchmarkSession,
  assets: ReturnType<typeof loadBenchmarkAssets>,
): void {
  if (
    session.benchmarkSlug !== assets.slug ||
    session.service !== assets.service ||
    session.taskId !== assets.lock.taskId ||
    !sameCommitment(session.benchmarkLock, assets.lock)
  ) {
    throw new Error("Benchmark session does not match the committed project assets");
  }
}

function sessionFile(directory: string): string {
  return join(directory, "session.json");
}

function loadSession(directory: string): BenchmarkSession {
  return BenchmarkSessionSchema.parse(readJson(sessionFile(directory)));
}

function candidateBody(record: BenchmarkCandidateRecord): z.infer<typeof CandidateBodySchema> {
  const { candidateHash: _candidateHash, ...body } = record;
  return body;
}

function validateCandidateRecord(
  input: unknown,
  session: BenchmarkSession,
): BenchmarkCandidateRecord {
  const record = BenchmarkCandidateRecordSchema.parse(input);
  if (record.sessionId !== session.sessionId || record.taskId !== session.taskId) {
    throw new Error("Candidate is not bound to this benchmark session");
  }
  if (record.benchmarkSlug !== session.benchmarkSlug || record.service !== session.service) {
    throw new Error("Candidate benchmark identity does not match the session");
  }
  if (!sameCommitment(record.benchmarkLock, session.benchmarkLock)) {
    throw new Error("Candidate benchmark lock does not match the session");
  }
  if (canonicalHash(record.output) !== record.outputHash) {
    throw new Error("Candidate output hash does not match its output");
  }
  if (canonicalHash(candidateBody(record)) !== record.candidateHash) {
    throw new Error("Candidate record commitment is invalid");
  }
  if (record.output.service !== session.service || record.output.requestId !== session.taskId) {
    throw new Error("Candidate output does not answer the locked task");
  }
  return record;
}

function buildCandidate(
  body: z.input<typeof CandidateBodySchema>,
): BenchmarkCandidateRecord {
  const parsedBody = CandidateBodySchema.parse(body);
  return BenchmarkCandidateRecordSchema.parse({
    ...parsedBody,
    candidateHash: canonicalHash(parsedBody),
  });
}

function candidateDirectory(directory: string): string {
  return join(directory, "private", "candidates");
}

function candidateFilename(record: BenchmarkCandidateRecord): string {
  const source = record.source.type.toLowerCase();
  const digest = record.candidateHash.slice("sha256:".length, "sha256:".length + 12);
  return `${source}-${record.runNumber}-${digest}.json`;
}

function persistCandidate(directory: string, record: BenchmarkCandidateRecord): string {
  const path = join(candidateDirectory(directory), candidateFilename(record));
  writeJsonExclusive(path, record);
  return path;
}

function loadCandidates(directory: string, session: BenchmarkSession): BenchmarkCandidateRecord[] {
  return readdirSync(candidateDirectory(directory))
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => validateCandidateRecord(readJson(join(candidateDirectory(directory), name)), session));
}

export interface FounderComparisonEvidence {
  directory: string;
  session: BenchmarkSession;
  manual: BenchmarkCandidateRecord;
  agents: [BenchmarkCandidateRecord, BenchmarkCandidateRecord];
}

export function loadFounderComparisonEvidence(
  directoryInput: string,
  options: { projectRoot?: string } = {},
): FounderComparisonEvidence {
  const directory = resolve(directoryInput);
  const directoryStat = lstatSync(directory);
  if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory()) {
    throw new Error("Founder benchmark session must be a real directory");
  }
  const realDirectory = realpathSync(directory);
  for (const path of [
    sessionFile(directory),
    ...readdirSync(candidateDirectory(directory))
      .filter((name) => name.endsWith(".json"))
      .map((name) => join(candidateDirectory(directory), name)),
  ]) {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      throw new Error(`Founder benchmark evidence must be a regular file: ${path}`);
    }
    const realPath = realpathSync(path);
    if (!realPath.startsWith(`${realDirectory}${sep}`)) {
      throw new Error(`Founder benchmark evidence escapes its session directory: ${path}`);
    }
  }
  const session = loadSession(directory);
  const projectRoot = resolve(options.projectRoot ?? process.cwd());
  const assets = loadBenchmarkAssets(session.benchmarkSlug, projectRoot);
  validateSessionAssets(session, assets);
  const candidates = loadCandidates(directory, session);
  const manuals = candidates.filter((candidate) => candidate.source.type === "MANUAL");
  const agents = candidates
    .filter((candidate) => candidate.source.type === "AGENT")
    .sort((left, right) => left.runNumber - right.runNumber);
  const [manual] = manuals;
  const [firstAgent, secondAgent] = agents;

  if (!manual || manuals.length !== 1) {
    throw new Error("Founder comparison requires exactly one immutable manual candidate");
  }
  if (!firstAgent || !secondAgent || agents.length !== 2) {
    throw new Error("Founder comparison requires exactly two immutable agent candidates");
  }
  if (manual.runNumber !== 1 || firstAgent.runNumber !== 1 || secondAgent.runNumber !== 2) {
    throw new Error("Founder comparison candidate run numbers must be manual 1 and agent 1/2");
  }

  return { directory, session, manual, agents: [firstAgent, secondAgent] };
}

function generatedSessionId(slug: TermixBenchmarkSlug, now: Date): string {
  const timestamp = now.toISOString().replace(/[-:.TZ]/g, "").toLowerCase();
  return `${slug}-${timestamp}-${randomBytes(4).toString("hex")}`;
}

function manualOutputContract(service: TermixBenchmarkService): unknown {
  switch (service) {
    case "LENDING_RESCUE":
      return z.toJSONSchema(LendingRescueDeliverableSchema);
    case "LP_REBALANCE":
      return z.toJSONSchema(LpRebalanceDeliverableSchema);
    case "BOUNDED_GRID":
      return z.toJSONSchema(BoundedGridDeliverableSchema);
  }
}

export function prepareBenchmarkSession(
  slug: TermixBenchmarkSlug,
  options: {
    projectRoot?: string;
    artifactRoot?: string;
    now?: Date;
    sessionId?: string;
  } = {},
): PreparedBenchmarkSession {
  const projectRoot = resolve(options.projectRoot ?? process.cwd());
  const artifactRoot = resolve(options.artifactRoot ?? join(projectRoot, "artifacts", "benchmarks"));
  const now = options.now ?? new Date();
  const assets = loadBenchmarkAssets(slug, projectRoot);
  const session = BenchmarkSessionSchema.parse({
    schemaVersion: "positioncrew.benchmark-session.v1",
    sessionId: options.sessionId ?? generatedSessionId(slug, now),
    benchmarkSlug: slug,
    service: assets.service,
    taskId: assets.lock.taskId,
    createdAt: now.toISOString(),
    benchmarkLock: assets.lock,
  });
  const directory = join(artifactRoot, slug, session.sessionId);
  mkdirSync(candidateDirectory(directory), { recursive: true, mode: 0o700 });
  mkdirSync(join(directory, "public"), { recursive: true, mode: 0o700 });
  writeJsonExclusive(sessionFile(directory), session);
  const taskPacketPath = join(directory, "manual-task-packet.json");
  writeJsonExclusive(taskPacketPath, {
    schemaVersion: "positioncrew.manual-task-packet.v1",
    session,
    protocol: assets.protocol,
    fixture: assets.fixture,
    outputContract: manualOutputContract(assets.service),
    instructions: [
      "Do not use PositionCrew, an AI assistant, or any prior candidate output.",
      "Start timing only when this complete packet is first shown to the operator.",
      "Use only the allowed inputs in the locked protocol and stop timing when the final JSON answer is written.",
      "Return the same service-specific PositionCrew deliverable contract so the blind candidates have the same visible structure.",
      "The scoring rubric is committed by hash but intentionally withheld until the candidate is immutable.",
      "Record the actual elapsed time, direct cost, method, and operator identity during capture.",
    ],
  });
  const manualMetadataTemplatePath = join(directory, "manual-metadata.template.json");
  writeJsonExclusive(manualMetadataTemplatePath, {
    operatorId: "REPLACE_WITH_MANUAL_OPERATOR_NAME",
    contactReference: "REPLACE_WITH_MANUAL_OPERATOR_CONTACT_OR_PUBLIC_PROFILE",
    method: "REPLACE_WITH_THE_ACTUAL_MANUAL_METHOD_AND_TOOLS_USED",
    independenceAttestation: MANUAL_INDEPENDENCE_ATTESTATION,
    elapsedMilliseconds: 0,
    directCostUsd: "0",
    capturedAt: "REPLACE_WITH_ISO_8601_TIMESTAMP_WHEN_THE_OUTPUT_BECAME_IMMUTABLE",
  });
  return { directory, session, taskPacketPath, manualMetadataTemplatePath };
}

export async function captureAgentBenchmarkRuns(
  directoryInput: string,
  options: { projectRoot?: string; directCostUsd?: string; now?: () => Date } = {},
): Promise<BenchmarkCandidateRecord[]> {
  const directory = resolve(directoryInput);
  const session = loadSession(directory);
  const projectRoot = resolve(options.projectRoot ?? process.cwd());
  const assets = loadBenchmarkAssets(session.benchmarkSlug, projectRoot);
  validateSessionAssets(session, assets);
  const existing = loadCandidates(directory, session).filter((record) => record.source.type === "AGENT");
  if (existing.length > 0) throw new Error("Agent candidates already exist for this session");

  const records: BenchmarkCandidateRecord[] = [];
  for (let runNumber = 1; runNumber <= assets.protocol.runs.agent; runNumber += 1) {
    const startedAt = performance.now();
    const response = await runFrozenFixture(session.service as TermixBenchmarkService);
    const elapsedMilliseconds = Math.max(1, Math.round(performance.now() - startedAt));
    const output = PositionCrewDeliverableSchema.parse(response.result.deliverable);
    const record = buildCandidate({
      schemaVersion: "positioncrew.benchmark-candidate.v1",
      sessionId: session.sessionId,
      benchmarkSlug: session.benchmarkSlug,
      service: session.service,
      taskId: session.taskId,
      source: {
        type: "AGENT",
        operatorId: "PositionCrew",
        providerId: response.result.job.providerId ?? `positioncrew:${session.service.toLowerCase()}:v1`,
      },
      runNumber,
      capturedAt: (options.now?.() ?? new Date()).toISOString(),
      elapsedMilliseconds,
      directCostUsd: options.directCostUsd ?? "0",
      benchmarkLock: session.benchmarkLock,
      outputHash: canonicalHash(output),
      output,
      conformance: {
        score: response.result.evaluation.score,
        criticalFailureCount: response.result.evaluation.checks.filter(
          (check) => check.critical && !check.passed,
        ).length,
        evaluationHash: response.result.evaluation.evaluationHash,
      },
    });
    persistCandidate(directory, record);
    records.push(record);
  }
  return records;
}

export function captureManualBenchmarkRun(
  directoryInput: string,
  outputInput: unknown,
  metadataInput: unknown,
): BenchmarkCandidateRecord {
  const directory = resolve(directoryInput);
  const session = loadSession(directory);
  const assets = loadBenchmarkAssets(session.benchmarkSlug);
  validateSessionAssets(session, assets);
  const records = loadCandidates(directory, session);
  const existing = records.filter((record) => record.source.type === "MANUAL");
  if (existing.length > 0) throw new Error("A manual candidate already exists for this session");
  const agents = records.filter((record) => record.source.type === "AGENT");
  if (agents.length !== assets.protocol.runs.agent) {
    throw new Error("The committed agent repeats must exist before the manual baseline starts");
  }
  const output = PositionCrewDeliverableSchema.parse(outputInput);
  const metadata = ManualCaptureMetadataSchema.parse(metadataInput);
  const latestAgentCapture = Math.max(...agents.map((record) => Date.parse(record.capturedAt)));
  if (Date.parse(metadata.capturedAt) < latestAgentCapture) {
    throw new Error("The manual baseline must be captured after the committed agent repeats");
  }
  const record = buildCandidate({
    schemaVersion: "positioncrew.benchmark-candidate.v1",
    sessionId: session.sessionId,
    benchmarkSlug: session.benchmarkSlug,
    service: session.service,
    taskId: session.taskId,
    source: {
      type: "MANUAL",
      operatorId: metadata.operatorId,
      contactReference: metadata.contactReference,
      method: metadata.method,
      independenceAttestation: metadata.independenceAttestation,
    },
    runNumber: 1,
    capturedAt: metadata.capturedAt,
    elapsedMilliseconds: metadata.elapsedMilliseconds,
    directCostUsd: metadata.directCostUsd,
    benchmarkLock: session.benchmarkLock,
    outputHash: canonicalHash(output),
    output,
    conformance: null,
  });
  validateCandidateRecord(record, session);
  persistCandidate(directory, record);
  return record;
}

function mappingBody(mapping: PrivateSourceMapping): z.infer<typeof PrivateMappingBodySchema> {
  const { mappingCommitment: _mappingCommitment, ...body } = mapping;
  return body;
}

function packetBody(packet: BenchmarkBlindPacket): z.infer<typeof BlindPacketBodySchema> {
  const { packetHash: _packetHash, ...body } = packet;
  return body;
}

function scorecardTemplate(packet: BenchmarkBlindPacket): unknown {
  return {
    schemaVersion: "positioncrew.blind-scorecard.v1",
    sessionId: packet.sessionId,
    taskId: packet.taskId,
    packetHash: packet.packetHash,
    mappingCommitment: packet.mappingCommitment,
    evaluator: {
      displayName: "REPLACE_WITH_EVALUATOR_NAME",
      contactReference: "REPLACE_WITH_CONTACT_OR_PUBLIC_PROFILE",
      relationshipDisclosure: "REPLACE_WITH_RELATIONSHIP_DISCLOSURE",
      independenceAttestation: EVALUATOR_INDEPENDENCE_ATTESTATION,
    },
    scoredAt: "REPLACE_WITH_ISO_8601_TIMESTAMP",
    candidates: packet.candidates.map((candidate) => ({
      label: candidate.label,
      criteria: packet.rubric.criteria.map((criterion) => ({
        criterionId: criterion.id,
        score: 0,
        criticalFailure: false,
        notes: `REPLACE_WITH_SCORE_0_TO_${criterion.maximumScore}_AND_NOTES`,
      })),
      overallNotes: "REPLACE_WITH_OVERALL_NOTES",
    })),
    attestation: SCORECARD_ATTESTATION,
  };
}

export function finalizeBlindBenchmark(
  directoryInput: string,
  options: { projectRoot?: string; now?: Date; agentFirst?: boolean } = {},
): { packet: BenchmarkBlindPacket; mapping: PrivateSourceMapping; packetPath: string; scorecardPath: string } {
  const directory = resolve(directoryInput);
  const session = loadSession(directory);
  const projectRoot = resolve(options.projectRoot ?? process.cwd());
  const assets = loadBenchmarkAssets(session.benchmarkSlug, projectRoot);
  validateSessionAssets(session, assets);
  const records = loadCandidates(directory, session);
  const agents = records
    .filter((record) => record.source.type === "AGENT")
    .sort((left, right) => left.runNumber - right.runNumber);
  const manuals = records.filter((record) => record.source.type === "MANUAL");
  if (agents.length !== assets.protocol.runs.agent || manuals.length !== assets.protocol.runs.manual) {
    throw new Error(
      `Blind finalization requires ${assets.protocol.runs.agent} agent runs and ${assets.protocol.runs.manual} manual run`,
    );
  }
  const representative = agents[0]!;
  const repeat = agents[1]!;
  const manual = manuals[0]!;
  const createdAt = options.now ?? new Date();
  const latestCapture = Math.max(...records.map((record) => Date.parse(record.capturedAt)));
  if (createdAt.getTime() < latestCapture) {
    throw new Error("The blind packet cannot predate an included candidate capture");
  }
  const labels = assets.protocol.blinding.candidateLabels;
  const agentFirst = options.agentFirst ?? randomInt(2) === 0;
  const ordered = agentFirst ? [representative, manual] : [manual, representative];
  const assignments = ordered.map((record, index) => ({
    label: labels[index]!,
    candidateHash: record.candidateHash,
    sourceType: record.source.type,
    runNumber: record.runNumber,
  }));
  const rawMapping = PrivateMappingBodySchema.parse({
    schemaVersion: "positioncrew.private-source-mapping.v1",
    sessionId: session.sessionId,
    salt: randomBytes(32).toString("hex"),
    assignments,
    excludedAgentRepeat: { candidateHash: repeat.candidateHash, runNumber: repeat.runNumber },
  });
  const mapping = PrivateSourceMappingSchema.parse({
    ...rawMapping,
    mappingCommitment: canonicalHash(rawMapping),
  });
  const rawPacket = BlindPacketBodySchema.parse({
    schemaVersion: "positioncrew.blind-evaluator-packet.v1",
    sessionId: session.sessionId,
    benchmarkSlug: session.benchmarkSlug,
    taskId: session.taskId,
    createdAt: createdAt.toISOString(),
    benchmarkLock: session.benchmarkLock,
    mappingCommitment: mapping.mappingCommitment,
    rubric: assets.rubric,
    candidates: ordered.map((record, index) => ({
      label: labels[index]!,
      outputHash: record.outputHash,
      output: record.output,
    })),
    evaluatorInstructions: [
      "Score each candidate only against the frozen rubric; do not attempt to identify its source.",
      "Do not view timing, cost, operator identity, private candidate files, or the source mapping before submitting the scorecard.",
      "Give every criterion an integer score within its maximum and mark criticalFailure only when the zero-credit safety condition applies.",
      "Complete the evaluator identity, disclosure, notes, timestamp, and attestation fields before returning the scorecard.",
    ],
    boundary:
      "One precommitted agent run and one manual run are shown. A second agent run is withheld solely to establish repeatability without revealing the agent candidate by duplication.",
  });
  const packet = BenchmarkBlindPacketSchema.parse({
    ...rawPacket,
    packetHash: canonicalHash(rawPacket),
  });
  const packetPath = join(directory, "public", "blind-evaluator-packet.json");
  const scorecardPath = join(directory, "public", "blind-scorecard.template.json");
  writeJsonExclusive(join(directory, "private", "source-mapping.json"), mapping);
  writeJsonExclusive(packetPath, packet);
  writeJsonExclusive(scorecardPath, scorecardTemplate(packet));
  return { packet, mapping, packetPath, scorecardPath };
}

function verifyMapping(packet: BenchmarkBlindPacket, mapping: PrivateSourceMapping): void {
  if (canonicalHash(mappingBody(mapping)) !== mapping.mappingCommitment) {
    throw new Error("Private source mapping commitment is invalid");
  }
  if (mapping.mappingCommitment !== packet.mappingCommitment) {
    throw new Error("Private source mapping does not open the packet commitment");
  }
  if (
    new Set(mapping.assignments.map((assignment) => assignment.label)).size !== 2 ||
    new Set(mapping.assignments.map((assignment) => assignment.sourceType)).size !== 2
  ) {
    throw new Error("Private source mapping must contain one distinct AGENT and MANUAL assignment");
  }
}

interface ResolvedSourceMapping {
  manualAssignment: PrivateSourceMapping["assignments"][number];
  agentAssignment: PrivateSourceMapping["assignments"][number];
  manual: BenchmarkCandidateRecord & { source: Extract<BenchmarkCandidateRecord["source"], { type: "MANUAL" }> };
  representative: BenchmarkCandidateRecord & { source: Extract<BenchmarkCandidateRecord["source"], { type: "AGENT" }> };
  excludedRepeat: BenchmarkCandidateRecord & { source: Extract<BenchmarkCandidateRecord["source"], { type: "AGENT" }> };
}

type ManualCandidateRecord = ResolvedSourceMapping["manual"];
type AgentCandidateRecord = ResolvedSourceMapping["representative"];

function resolveSourceMapping(
  packet: BenchmarkBlindPacket,
  mapping: PrivateSourceMapping,
  records: BenchmarkCandidateRecord[],
): ResolvedSourceMapping {
  const byHash = new Map(records.map((record) => [record.candidateHash, record]));
  const packetByLabel = new Map(packet.candidates.map((candidate) => [candidate.label, candidate]));
  for (const assignment of mapping.assignments) {
    const record = byHash.get(assignment.candidateHash);
    const packetCandidate = packetByLabel.get(assignment.label);
    if (!record || !packetCandidate) throw new Error("Source mapping references missing evidence");
    if (
      record.source.type !== assignment.sourceType ||
      record.runNumber !== assignment.runNumber ||
      record.outputHash !== packetCandidate.outputHash
    ) {
      throw new Error("Source mapping does not match the committed blind candidate");
    }
  }
  const manualAssignment = mapping.assignments.find(
    (assignment) => assignment.sourceType === "MANUAL",
  );
  const agentAssignment = mapping.assignments.find(
    (assignment) => assignment.sourceType === "AGENT",
  );
  if (!manualAssignment || !agentAssignment) throw new Error("Source mapping is incomplete");
  const manualRecord = byHash.get(manualAssignment.candidateHash);
  const agentRecord = byHash.get(agentAssignment.candidateHash);
  if (!manualRecord || manualRecord.source.type !== "MANUAL") {
    throw new Error("Mapped manual candidate is invalid");
  }
  if (!agentRecord || agentRecord.source.type !== "AGENT") {
    throw new Error("Mapped agent candidate is invalid");
  }
  const excludedRecord = byHash.get(mapping.excludedAgentRepeat.candidateHash);
  if (
    !excludedRecord ||
    excludedRecord.source.type !== "AGENT" ||
    excludedRecord.runNumber !== mapping.excludedAgentRepeat.runNumber ||
    mapping.assignments.some(
      (assignment) => assignment.candidateHash === mapping.excludedAgentRepeat.candidateHash,
    )
  ) {
    throw new Error("Excluded repeat does not identify a separate agent evidence record");
  }
  return {
    manualAssignment,
    agentAssignment,
    manual: manualRecord as ManualCandidateRecord,
    representative: agentRecord as AgentCandidateRecord,
    excludedRepeat: excludedRecord as AgentCandidateRecord,
  };
}

function scoreCandidate(
  score: z.infer<typeof CandidateScoreSchema>,
  rubric: z.infer<typeof BenchmarkRubricSchema>,
): { total: number; criticalFailureCount: number } {
  if (new Set(score.criteria.map((criterion) => criterion.criterionId)).size !== score.criteria.length) {
    throw new Error(`${score.label} contains duplicate criterion scores`);
  }
  const rubricIds = new Set(rubric.criteria.map((criterion) => criterion.id));
  if (
    score.criteria.length !== rubric.criteria.length ||
    score.criteria.some((criterion) => !rubricIds.has(criterion.criterionId))
  ) {
    throw new Error(`${score.label} does not score every frozen rubric criterion exactly once`);
  }
  let total = 0;
  let criticalFailureCount = 0;
  for (const criterion of rubric.criteria) {
    const result = score.criteria.find((candidate) => candidate.criterionId === criterion.id)!;
    if (result.score > criterion.maximumScore) {
      throw new Error(`${score.label} score for ${criterion.id} exceeds ${criterion.maximumScore}`);
    }
    if (result.criticalFailure && !criterion.critical) {
      throw new Error(`${score.label} marks non-critical criterion ${criterion.id} as a critical failure`);
    }
    total += result.score;
    if (result.criticalFailure) criticalFailureCount += 1;
  }
  return { total, criticalFailureCount };
}

export function validateBlindScorecard(
  packetInput: unknown,
  scorecardInput: unknown,
): { scorecard: BlindScorecard; totals: Map<string, { total: number; criticalFailureCount: number }> } {
  const packet = BenchmarkBlindPacketSchema.parse(packetInput);
  if (canonicalHash(packetBody(packet)) !== packet.packetHash) {
    throw new Error("Blind evaluator packet commitment is invalid");
  }
  const scorecard = BlindScorecardSchema.parse(scorecardInput);
  if (
    scorecard.sessionId !== packet.sessionId ||
    scorecard.taskId !== packet.taskId ||
    scorecard.packetHash !== packet.packetHash ||
    scorecard.mappingCommitment !== packet.mappingCommitment
  ) {
    throw new Error("Scorecard is not bound to this evaluator packet");
  }
  const packetLabels = new Set(packet.candidates.map((candidate) => candidate.label));
  if (
    new Set(scorecard.candidates.map((candidate) => candidate.label)).size !== 2 ||
    scorecard.candidates.some((candidate) => !packetLabels.has(candidate.label))
  ) {
    throw new Error("Scorecard candidate labels do not match the evaluator packet");
  }
  if (prettyJson(scorecard).includes("REPLACE_WITH_")) {
    throw new Error("Scorecard still contains template placeholders");
  }
  if (Date.parse(scorecard.scoredAt) < Date.parse(packet.createdAt)) {
    throw new Error("The blind scorecard cannot predate its evaluator packet");
  }
  return {
    scorecard,
    totals: new Map(
      scorecard.candidates.map((candidate) => [
        candidate.label,
        scoreCandidate(candidate, packet.rubric),
      ]),
    ),
  };
}

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle]!;
  return (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function medianDecimal(values: string[]): string {
  return median(values.map(Number)).toFixed(6).replace(/(?:\.0+|(?<=\.[0-9]*?)0+)$/, "");
}

function normalizedIdentity(value: string): string {
  return value.trim().toLowerCase().replace(/\/+$/, "");
}

function deriveBenchmarkResult(
  session: BenchmarkSession,
  decisionRule: string,
  scorecard: BlindScorecard,
  mapping: PrivateSourceMapping,
  totals: Map<string, { total: number; criticalFailureCount: number }>,
  records: BenchmarkCandidateRecord[],
  resolved: ResolvedSourceMapping,
): BenchmarkResult {
  const { manualAssignment, agentAssignment, manual, representative, excludedRepeat } = resolved;
  const agents = records.filter((record) => record.source.type === "AGENT");
  const manualScore = totals.get(manualAssignment.label);
  const agentScore = totals.get(agentAssignment.label);
  if (!manualScore || !agentScore) throw new Error("Scorecard is missing a mapped candidate");
  if (
    normalizedIdentity(manual.source.contactReference) ===
      normalizedIdentity(scorecard.evaluator.contactReference) ||
    normalizedIdentity(manual.source.operatorId) ===
      normalizedIdentity(scorecard.evaluator.displayName)
  ) {
    throw new Error("The blind evaluator must be a different person from the manual operator");
  }
  const agentHashesMatch = new Set(agents.map((record) => record.outputHash)).size === 1;
  const conformanceCriticalFailureCount = agents.reduce(
    (total, record) => total + (record.conformance?.criticalFailureCount ?? 1),
    0,
  );
  const advantageSupported =
    agentScore.total >= manualScore.total &&
    agentHashesMatch &&
    conformanceCriticalFailureCount === 0 &&
    agentScore.criticalFailureCount === 0 &&
    median(agents.map((record) => record.elapsedMilliseconds)) < manual.elapsedMilliseconds;
  return AgentAdvantageResultSchema.parse({
    schemaVersion: "positioncrew.agent-advantage-result.v2",
    sessionId: session.sessionId,
    benchmarkSlug: session.benchmarkSlug,
    taskId: session.taskId,
    evaluatedAt: scorecard.scoredAt,
    scorecardHash: canonicalHash(scorecard),
    mappingCommitment: mapping.mappingCommitment,
    manual: {
      candidateLabel: manualAssignment.label,
      outputHash: manual.outputHash,
      operatorId: manual.source.operatorId,
      contactReference: manual.source.contactReference,
      method: manual.source.method,
      independenceAttestation: manual.source.independenceAttestation,
      score: manualScore.total,
      blindCriticalFailureCount: manualScore.criticalFailureCount,
      elapsedMilliseconds: manual.elapsedMilliseconds,
      directCostUsd: manual.directCostUsd,
    },
    agent: {
      candidateLabel: agentAssignment.label,
      outputHash: representative.outputHash,
      repeatOutputHash: excludedRepeat.outputHash,
      providerId: representative.source.providerId,
      score: agentScore.total,
      medianElapsedMilliseconds: median(agents.map((record) => record.elapsedMilliseconds)),
      medianDirectCostUsd: medianDecimal(agents.map((record) => record.directCostUsd)),
      outputHashesMatch: agentHashesMatch,
      conformanceCriticalFailureCount,
      blindCriticalFailureCount: agentScore.criticalFailureCount,
    },
    evaluator: {
      displayName: scorecard.evaluator.displayName,
      contactReference: scorecard.evaluator.contactReference,
      relationshipDisclosure: scorecard.evaluator.relationshipDisclosure,
      independenceAttestation: scorecard.evaluator.independenceAttestation,
    },
    advantageSupported,
    decisionRule,
    boundary:
      "This result opens the committed source mapping only after independent blind scoring. It applies to the frozen benchmark task and does not establish live investment performance.",
  });
}

export function revealBenchmarkResult(
  directoryInput: string,
  scorecardInput: unknown,
): BenchmarkResult {
  const directory = resolve(directoryInput);
  const session = loadSession(directory);
  const assets = loadBenchmarkAssets(session.benchmarkSlug);
  validateSessionAssets(session, assets);
  const packet = BenchmarkBlindPacketSchema.parse(
    readJson(join(directory, "public", "blind-evaluator-packet.json")),
  );
  const mapping = PrivateSourceMappingSchema.parse(
    readJson(join(directory, "private", "source-mapping.json")),
  );
  verifyMapping(packet, mapping);
  const { scorecard, totals } = validateBlindScorecard(packet, scorecardInput);
  const records = loadCandidates(directory, session);
  const resolved = resolveSourceMapping(packet, mapping, records);
  const result = deriveBenchmarkResult(
    session,
    assets.protocol.decisionRule,
    scorecard,
    mapping,
    totals,
    records,
    resolved,
  );
  writeJsonExclusive(join(directory, "public", "completed-scorecard.json"), scorecard);
  writeJsonExclusive(join(directory, "public", "agent-advantage-result.json"), result);
  return result;
}

export interface CompletedBenchmarkEvidence {
  session: BenchmarkSession;
  packet: BenchmarkBlindPacket;
  mapping: PrivateSourceMapping;
  scorecard: BlindScorecard;
  result: BenchmarkResult;
  records: BenchmarkCandidateRecord[];
  manual: ResolvedSourceMapping["manual"];
  representative: ResolvedSourceMapping["representative"];
  excludedRepeat: ResolvedSourceMapping["excludedRepeat"];
}

export function loadCompletedBenchmarkEvidence(
  directoryInput: string,
): CompletedBenchmarkEvidence {
  const directory = resolve(directoryInput);
  const session = loadSession(directory);
  const assets = loadBenchmarkAssets(session.benchmarkSlug);
  validateSessionAssets(session, assets);
  const packet = BenchmarkBlindPacketSchema.parse(
    readJson(join(directory, "public", "blind-evaluator-packet.json")),
  );
  const mapping = PrivateSourceMappingSchema.parse(
    readJson(join(directory, "private", "source-mapping.json")),
  );
  verifyMapping(packet, mapping);
  const scorecardInput = readJson(join(directory, "public", "completed-scorecard.json"));
  const { scorecard, totals } = validateBlindScorecard(packet, scorecardInput);
  const result = AgentAdvantageResultSchema.parse(
    readJson(join(directory, "public", "agent-advantage-result.json")),
  );
  const records = loadCandidates(directory, session);
  const resolved = resolveSourceMapping(packet, mapping, records);
  const expectedResult = deriveBenchmarkResult(
    session,
    assets.protocol.decisionRule,
    scorecard,
    mapping,
    totals,
    records,
    resolved,
  );
  if (canonicalHash(result) !== canonicalHash(expectedResult)) {
    throw new Error("Completed Agent Advantage result does not match its source evidence");
  }
  return {
    session,
    packet,
    mapping,
    scorecard,
    result,
    records,
    manual: resolved.manual,
    representative: resolved.representative,
    excludedRepeat: resolved.excludedRepeat,
  };
}

export function readScorecard(path: string): unknown {
  return readJson(resolve(path));
}

export function sessionSummary(directoryInput: string): {
  sessionId: string;
  benchmarkSlug: TermixBenchmarkSlug;
  directory: string;
  candidateFiles: string[];
} {
  const directory = resolve(directoryInput);
  const session = loadSession(directory);
  return {
    sessionId: session.sessionId,
    benchmarkSlug: session.benchmarkSlug,
    directory,
    candidateFiles: readdirSync(candidateDirectory(directory))
      .filter((name) => name.endsWith(".json"))
      .map((name) => basename(name))
      .sort(),
  };
}
