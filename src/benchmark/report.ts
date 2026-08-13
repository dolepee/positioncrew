import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { z } from "zod";
import { HashSchema, TimestampSchema } from "../contracts/common.js";
import { canonicalHash } from "../core/canonical.js";
import {
  AgentAdvantageResultSchema,
  loadCompletedBenchmarkEvidence,
  type CompletedBenchmarkEvidence,
} from "./evidence.js";
import type { TermixBenchmarkSlug } from "./lock.js";

const TASK_METADATA = {
  "lending-rescue": {
    title: "Lending position rescue",
    category: "Security / DeFi",
    highStakesReason:
      "A wrong repay amount or stale recommendation can leave a borrower exposed to liquidation or waste scarce capital.",
  },
  "lp-rebalance": {
    title: "LP range rebalancing",
    category: "Liquidity management",
    highStakesReason:
      "A wrong range, inventory assumption, or cost model can crystallize losses and move liquidity into an uneconomic position.",
  },
  "bounded-grid": {
    title: "Bounded grid construction",
    category: "Trading",
    highStakesReason:
      "A malformed grid can place orders on the wrong side of market, exceed inventory limits, or expose more loss than the buyer authorized.",
  },
} as const satisfies Record<TermixBenchmarkSlug, {
  title: string;
  category: string;
  highStakesReason: string;
}>;

const EvidenceFilesSchema = z
  .object({
    "agent-output.json": HashSchema,
    "agent-repeat-output.json": HashSchema,
    "manual-output.json": HashSchema,
    "blind-evaluator-packet.json": HashSchema,
    "completed-scorecard.json": HashSchema,
    "source-mapping.opened.json": HashSchema,
    "agent-run-1.json": HashSchema,
    "agent-run-2.json": HashSchema,
    "manual-run.json": HashSchema,
    "agent-advantage-result.json": HashSchema,
  })
  .strict();

const BenchmarkLockSchema = z
  .object({
    schemaVersion: z.literal("positioncrew.benchmark-lock.v1"),
    taskId: z.string().min(8),
    fixtureHash: HashSchema,
    rubricHash: HashSchema,
    protocolHash: HashSchema,
  })
  .strict();

export const AgentAdvantageReportTaskSchema = z
  .object({
    benchmarkSlug: z.enum(["lending-rescue", "lp-rebalance", "bounded-grid"]),
    title: z.string().min(3),
    category: z.string().min(3),
    highStakesReason: z.string().min(20),
    taskId: z.string().min(8),
    benchmarkLock: BenchmarkLockSchema,
    result: AgentAdvantageResultSchema,
    speedupMultiple: z.number().finite().positive(),
    costDifferenceUsd: z.number().finite(),
    evidenceDirectory: z.string().regex(/^tasks\/(?:lending-rescue|lp-rebalance|bounded-grid)$/),
    evidenceFiles: EvidenceFilesSchema,
    evidenceManifestHash: HashSchema,
  })
  .strict();

export const AgentAdvantageReportSchema = z
  .object({
    schemaVersion: z.literal("positioncrew.agent-advantage-report.v2"),
    generatedAt: TimestampSchema,
    project: z
      .object({
        name: z.literal("PositionCrew"),
        liveUrl: z.literal("https://positioncrew.dolepee.com"),
        repositoryUrl: z.literal("https://github.com/dolepee/positioncrew"),
      })
      .strict(),
    methodology: z
      .object({
        manualRunsPerTask: z.literal(1),
        agentRunsPerTask: z.literal(2),
        blindQualityCandidatesPerTask: z.literal(2),
        sourceIdentityHiddenDuringScoring: z.literal(true),
        timeCostAndOperatorHiddenDuringScoring: z.literal(true),
        rubricCommittedBeforeCandidates: z.literal(true),
        duplicateAgentRepeatExcludedFromBlindPacket: z.literal(true),
        sameManualOperatorAcrossTasks: z.literal(true),
        sameBlindEvaluatorAcrossTasks: z.literal(true),
        manualOperatorAndEvaluatorAreDistinct: z.literal(true),
      })
      .strict(),
    participants: z
      .object({
        manualOperator: z
          .object({ displayName: z.string().min(2), contactReference: z.string().min(3) })
          .strict(),
        blindEvaluator: z
          .object({ displayName: z.string().min(2), contactReference: z.string().min(3) })
          .strict(),
      })
      .strict(),
    summary: z
      .object({
        taskCount: z.literal(3),
        supportedAdvantageCount: z.number().int().min(0).max(3),
        allTasksSupportAdvantage: z.boolean(),
        agentOutputPairsMatching: z.number().int().min(0).max(3),
        totalCriticalFailures: z.number().int().min(0),
        evidenceManifestHash: HashSchema,
      })
      .strict(),
    tasks: z.array(AgentAdvantageReportTaskSchema).length(3),
    boundaries: z.array(z.string().min(20)).min(4),
    reportHash: HashSchema,
  })
  .strict();

export type AgentAdvantageReportTask = z.infer<typeof AgentAdvantageReportTaskSchema>;
export type AgentAdvantageReport = z.infer<typeof AgentAdvantageReportSchema>;

function prettyJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, prettyJson(value), { encoding: "utf8", flag: "wx", mode: 0o600 });
}

function writeText(path: string, value: string): void {
  writeFileSync(path, value, { encoding: "utf8", flag: "wx", mode: 0o600 });
}

function usdDifference(manual: string, agent: string): number {
  return Number((Number(manual) - Number(agent)).toFixed(6));
}

function speedup(manualMilliseconds: number, agentMilliseconds: number): number {
  return Number((manualMilliseconds / agentMilliseconds).toFixed(2));
}

function taskMarkdown(task: AgentAdvantageReportTask): string {
  const status = task.result.advantageSupported ? "SUPPORTED" : "NOT SUPPORTED";
  return [
    `## ${task.title}`,
    "",
    `**Category:** ${task.category}`,
    "",
    `**Why high stakes:** ${task.highStakesReason}`,
    "",
    `**Result:** ${status} for this frozen task only.`,
    "",
    "| Measure | Agent | Manual |",
    "| --- | ---: | ---: |",
    `| Blind quality score | ${task.result.agent.score}/100 | ${task.result.manual.score}/100 |`,
    `| Elapsed time | ${task.result.agent.medianElapsedMilliseconds} ms median | ${task.result.manual.elapsedMilliseconds} ms |`,
    `| Direct cost | $${task.result.agent.medianDirectCostUsd} median | $${task.result.manual.directCostUsd} |`,
    `| Critical failures | ${task.result.agent.conformanceCriticalFailureCount + task.result.agent.blindCriticalFailureCount} | n/a |`,
    "",
    `Agent delivery was ${task.speedupMultiple}x faster by the locked timer. Cost difference (manual minus agent) was $${task.costDifferenceUsd}.`,
    "",
    `Agent provider: \`${task.result.agent.providerId}\`. Manual operator: ${task.result.manual.operatorId}. Evaluator: ${task.result.evaluator.displayName}.`,
    "",
    `Task evidence commitment: \`${task.evidenceManifestHash}\``,
    "",
    `- [Agent output](tasks/${task.benchmarkSlug}/agent-output.json)`,
    `- [Manual output](tasks/${task.benchmarkSlug}/manual-output.json)`,
    `- [Blind evaluator packet](tasks/${task.benchmarkSlug}/blind-evaluator-packet.json)`,
    `- [Completed scorecard](tasks/${task.benchmarkSlug}/completed-scorecard.json)`,
    `- [Opened source mapping](tasks/${task.benchmarkSlug}/source-mapping.opened.json)`,
    `- [Complete result](tasks/${task.benchmarkSlug}/agent-advantage-result.json)`,
    "",
  ].join("\n");
}

function reportMarkdown(report: AgentAdvantageReport): string {
  const aggregate = report.summary.allTasksSupportAdvantage
    ? "All three frozen tasks satisfy the pre-registered Agent Advantage decision rule."
    : `${report.summary.supportedAdvantageCount} of 3 frozen tasks satisfy the pre-registered Agent Advantage decision rule.`;
  return [
    "# PositionCrew Agent Advantage Report",
    "",
    aggregate,
    "",
    "PositionCrew compares one real manual run with two agent runs for lending rescue, LP rebalancing, and bounded grid construction. The first agent run is precommitted for blind quality scoring; the second establishes deterministic repeatability without appearing in the evaluator packet.",
    "",
    "## Methodology",
    "",
    "- Every fixture, 100-point rubric, timing rule, and blind protocol was committed before the comparison candidates.",
    "- The manual operator received the task and neutral output contract but not the answer-bearing rubric.",
    "- The independent evaluator saw two anonymized outputs and the frozen rubric, but no source identity, time, cost, or operator information.",
    "- A salted commitment bound the private source mapping before scoring. This bundle opens that mapping after the completed scorecard.",
    "- A positive result requires agent quality at least equal to manual quality, matching agent output hashes, zero agent critical failures, and lower median agent time.",
    `- The same manual operator completed all three tasks: ${report.participants.manualOperator.displayName} (${report.participants.manualOperator.contactReference}).`,
    `- A different independent evaluator scored all six blinded candidates: ${report.participants.blindEvaluator.displayName} (${report.participants.blindEvaluator.contactReference}).`,
    "",
    ...report.tasks.map(taskMarkdown),
    "## Claim boundaries",
    "",
    ...report.boundaries.map((boundary) => `- ${boundary}`),
    "",
    `Evidence manifest commitment: \`${report.summary.evidenceManifestHash}\``,
    "",
    `Report commitment: \`${report.reportHash}\``,
    "",
  ].join("\n");
}

function writeTaskEvidence(
  root: string,
  evidence: CompletedBenchmarkEvidence,
): {
  directory: string;
  files: z.infer<typeof EvidenceFilesSchema>;
  manifestHash: string;
} {
  const relative = join("tasks", evidence.session.benchmarkSlug);
  const directory = join(root, relative);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const values = {
    "agent-output.json": evidence.representative.output,
    "agent-repeat-output.json": evidence.excludedRepeat.output,
    "manual-output.json": evidence.manual.output,
    "blind-evaluator-packet.json": evidence.packet,
    "completed-scorecard.json": evidence.scorecard,
    "source-mapping.opened.json": evidence.mapping,
    "agent-run-1.json": evidence.representative,
    "agent-run-2.json": evidence.excludedRepeat,
    "manual-run.json": evidence.manual,
    "agent-advantage-result.json": evidence.result,
  };
  for (const [filename, value] of Object.entries(values)) {
    writeJson(join(directory, filename), value);
  }
  const files = EvidenceFilesSchema.parse(
    Object.fromEntries(
      Object.entries(values).map(([filename, value]) => [filename, canonicalHash(value)]),
    ),
  );
  return {
    directory: relative,
    files,
    manifestHash: canonicalHash({ directory: relative, files }),
  };
}

function normalizedIdentity(value: string): string {
  return value.trim().toLowerCase().replace(/\/+$/, "");
}

function requireConsistentParticipants(
  evidence: Array<Pick<CompletedBenchmarkEvidence, "result">>,
): {
  manualOperator: { displayName: string; contactReference: string };
  blindEvaluator: { displayName: string; contactReference: string };
} {
  const first = evidence[0]!;
  const manualName = normalizedIdentity(first.result.manual.operatorId);
  const manualContact = normalizedIdentity(first.result.manual.contactReference);
  const evaluatorName = normalizedIdentity(first.result.evaluator.displayName);
  const evaluatorContact = normalizedIdentity(first.result.evaluator.contactReference);
  if (
    evidence.some(
      (item) =>
        normalizedIdentity(item.result.manual.operatorId) !== manualName ||
        normalizedIdentity(item.result.manual.contactReference) !== manualContact,
    )
  ) {
    throw new Error("All three report tasks must use the same manual operator identity");
  }
  if (
    evidence.some(
      (item) =>
        normalizedIdentity(item.result.evaluator.displayName) !== evaluatorName ||
        normalizedIdentity(item.result.evaluator.contactReference) !== evaluatorContact,
    )
  ) {
    throw new Error("All three report tasks must use the same blind evaluator identity");
  }
  if (manualName === evaluatorName || manualContact === evaluatorContact) {
    throw new Error("The report's manual operator and blind evaluator must be different people");
  }
  return {
    manualOperator: {
      displayName: first.result.manual.operatorId,
      contactReference: first.result.manual.contactReference,
    },
    blindEvaluator: {
      displayName: first.result.evaluator.displayName,
      contactReference: first.result.evaluator.contactReference,
    },
  };
}

export function buildAgentAdvantageReport(
  sessionDirectories: string[],
  outputDirectoryInput: string,
  now = new Date(),
): AgentAdvantageReport {
  if (sessionDirectories.length !== 3) {
    throw new Error("The TermiX Agent Advantage report requires exactly three completed tasks");
  }
  const evidence = sessionDirectories.map(loadCompletedBenchmarkEvidence);
  const bySlug = new Map(evidence.map((item) => [item.session.benchmarkSlug, item]));
  const requiredSlugs = Object.keys(TASK_METADATA) as TermixBenchmarkSlug[];
  if (
    bySlug.size !== requiredSlugs.length ||
    requiredSlugs.some((slug) => !bySlug.has(slug))
  ) {
    throw new Error("The report requires one completed lending, LP, and grid benchmark");
  }
  const participants = requireConsistentParticipants(evidence);
  const outputDirectory = resolve(outputDirectoryInput);
  mkdirSync(outputDirectory, { recursive: true, mode: 0o700 });
  const tasks = requiredSlugs.map((slug) => {
    const item = bySlug.get(slug)!;
    const metadata = TASK_METADATA[slug];
    const evidenceBundle = writeTaskEvidence(outputDirectory, item);
    return {
      benchmarkSlug: slug,
      ...metadata,
      taskId: item.session.taskId,
      benchmarkLock: item.session.benchmarkLock,
      result: item.result,
      speedupMultiple: speedup(
        item.result.manual.elapsedMilliseconds,
        item.result.agent.medianElapsedMilliseconds,
      ),
      costDifferenceUsd: usdDifference(
        item.result.manual.directCostUsd,
        item.result.agent.medianDirectCostUsd,
      ),
      evidenceDirectory: evidenceBundle.directory,
      evidenceFiles: evidenceBundle.files,
      evidenceManifestHash: evidenceBundle.manifestHash,
    } satisfies AgentAdvantageReportTask;
  });
  const evidenceManifestHash = canonicalHash(
    tasks.map((task) => ({
      benchmarkSlug: task.benchmarkSlug,
      evidenceManifestHash: task.evidenceManifestHash,
    })),
  );
  const body = {
    schemaVersion: "positioncrew.agent-advantage-report.v2" as const,
    generatedAt: now.toISOString(),
    project: {
      name: "PositionCrew" as const,
      liveUrl: "https://positioncrew.dolepee.com" as const,
      repositoryUrl: "https://github.com/dolepee/positioncrew" as const,
    },
    methodology: {
      manualRunsPerTask: 1 as const,
      agentRunsPerTask: 2 as const,
      blindQualityCandidatesPerTask: 2 as const,
      sourceIdentityHiddenDuringScoring: true as const,
      timeCostAndOperatorHiddenDuringScoring: true as const,
      rubricCommittedBeforeCandidates: true as const,
      duplicateAgentRepeatExcludedFromBlindPacket: true as const,
      sameManualOperatorAcrossTasks: true as const,
      sameBlindEvaluatorAcrossTasks: true as const,
      manualOperatorAndEvaluatorAreDistinct: true as const,
    },
    participants,
    summary: {
      taskCount: 3 as const,
      supportedAdvantageCount: tasks.filter((task) => task.result.advantageSupported).length,
      allTasksSupportAdvantage: tasks.every((task) => task.result.advantageSupported),
      agentOutputPairsMatching: tasks.filter((task) => task.result.agent.outputHashesMatch).length,
      totalCriticalFailures: tasks.reduce(
        (total, task) =>
          total +
          task.result.agent.conformanceCriticalFailureCount +
          task.result.agent.blindCriticalFailureCount,
        0,
      ),
      evidenceManifestHash,
    },
    tasks,
    boundaries: [
      "Results apply only to the three disclosed frozen fixtures and do not establish live investment performance.",
      "Conformance and blind task quality do not prove paid AACP settlement, external-provider traction, or mainnet execution.",
      "Manual timing depends on the named operator and disclosed method; another operator may perform differently.",
      "Agent timing covers local Provider and evaluator execution against an already-loaded frozen fixture; it excludes network transit, wallet interaction, and commerce settlement latency.",
      "Agent direct cost is the measured marginal cost of the local deterministic run and excludes prior engineering and shared hosting; manual cost is the operator-disclosed direct cost for that run.",
      "Modeled economic outputs are bounded recommendations, not guaranteed fills, returns, or liquidation prevention.",
    ],
  };
  const report = AgentAdvantageReportSchema.parse({
    ...body,
    reportHash: canonicalHash(body),
  });
  writeJson(join(outputDirectory, "agent-advantage-report.json"), report);
  writeText(join(outputDirectory, "agent-advantage-report.md"), reportMarkdown(report));
  return report;
}

function reportBody(report: AgentAdvantageReport): Omit<AgentAdvantageReport, "reportHash"> {
  const { reportHash: _reportHash, ...body } = report;
  return body;
}

export function verifyAgentAdvantageReport(
  outputDirectoryInput: string,
): AgentAdvantageReport {
  const outputDirectory = resolve(outputDirectoryInput);
  const report = AgentAdvantageReportSchema.parse(
    JSON.parse(readFileSync(join(outputDirectory, "agent-advantage-report.json"), "utf8")),
  );
  if (canonicalHash(reportBody(report)) !== report.reportHash) {
    throw new Error("Agent Advantage report commitment is invalid");
  }
  const expectedSlugs = ["lending-rescue", "lp-rebalance", "bounded-grid"];
  if (report.tasks.map((task) => task.benchmarkSlug).join(",") !== expectedSlugs.join(",")) {
    throw new Error("Agent Advantage report tasks are missing, duplicated, or out of order");
  }
  for (const task of report.tasks) {
    const expectedDirectory = `tasks/${task.benchmarkSlug}`;
    if (task.evidenceDirectory !== expectedDirectory) {
      throw new Error(`${task.benchmarkSlug} evidence directory is not canonical`);
    }
    const directory = resolve(outputDirectory, task.evidenceDirectory);
    if (directory !== outputDirectory && !directory.startsWith(`${outputDirectory}${sep}`)) {
      throw new Error(`${task.benchmarkSlug} evidence directory escapes the report root`);
    }
    for (const [filename, expectedHash] of Object.entries(task.evidenceFiles)) {
      const value = JSON.parse(readFileSync(join(directory, filename), "utf8"));
      if (canonicalHash(value) !== expectedHash) {
        throw new Error(`${task.benchmarkSlug}/${filename} does not match its evidence commitment`);
      }
    }
    if (
      canonicalHash({ directory: task.evidenceDirectory, files: task.evidenceFiles }) !==
      task.evidenceManifestHash
    ) {
      throw new Error(`${task.benchmarkSlug} evidence manifest commitment is invalid`);
    }
    const attachedResult = AgentAdvantageResultSchema.parse(
      JSON.parse(readFileSync(join(directory, "agent-advantage-result.json"), "utf8")),
    );
    if (canonicalHash(attachedResult) !== canonicalHash(task.result)) {
      throw new Error(`${task.benchmarkSlug} attached result differs from the report result`);
    }
  }
  const expectedEvidenceManifestHash = canonicalHash(
    report.tasks.map((task) => ({
      benchmarkSlug: task.benchmarkSlug,
      evidenceManifestHash: task.evidenceManifestHash,
    })),
  );
  if (expectedEvidenceManifestHash !== report.summary.evidenceManifestHash) {
    throw new Error("The aggregate evidence manifest commitment is invalid");
  }
  const participants = requireConsistentParticipants(
    report.tasks.map((task) => ({ result: task.result })),
  );
  if (canonicalHash(participants) !== canonicalHash(report.participants)) {
    throw new Error("The report participant summary does not match its task evidence");
  }
  const expectedSummary = {
    taskCount: 3 as const,
    supportedAdvantageCount: report.tasks.filter((task) => task.result.advantageSupported).length,
    allTasksSupportAdvantage: report.tasks.every((task) => task.result.advantageSupported),
    agentOutputPairsMatching: report.tasks.filter((task) => task.result.agent.outputHashesMatch)
      .length,
    totalCriticalFailures: report.tasks.reduce(
      (total, task) =>
        total +
        task.result.agent.conformanceCriticalFailureCount +
        task.result.agent.blindCriticalFailureCount,
      0,
    ),
    evidenceManifestHash: expectedEvidenceManifestHash,
  };
  if (canonicalHash(expectedSummary) !== canonicalHash(report.summary)) {
    throw new Error("The report summary does not match its task evidence");
  }
  return report;
}
