import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { canonicalHash } from "../core/canonical.js";
import {
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

export interface AgentAdvantageReportTask {
  benchmarkSlug: TermixBenchmarkSlug;
  title: string;
  category: string;
  highStakesReason: string;
  taskId: string;
  benchmarkLock: CompletedBenchmarkEvidence["session"]["benchmarkLock"];
  result: CompletedBenchmarkEvidence["result"];
  speedupMultiple: number;
  costDifferenceUsd: number;
  evidenceDirectory: string;
}

export interface AgentAdvantageReport {
  schemaVersion: "positioncrew.agent-advantage-report.v1";
  generatedAt: string;
  project: {
    name: "PositionCrew";
    liveUrl: "https://positioncrew.dolepee.com";
    repositoryUrl: "https://github.com/dolepee/positioncrew";
  };
  methodology: {
    manualRunsPerTask: 1;
    agentRunsPerTask: 2;
    blindQualityCandidatesPerTask: 2;
    sourceIdentityHiddenDuringScoring: true;
    timeCostAndOperatorHiddenDuringScoring: true;
    rubricCommittedBeforeCandidates: true;
    duplicateAgentRepeatExcludedFromBlindPacket: true;
  };
  summary: {
    taskCount: 3;
    supportedAdvantageCount: number;
    allTasksSupportAdvantage: boolean;
    agentOutputPairsMatching: number;
    totalCriticalFailures: number;
  };
  tasks: AgentAdvantageReportTask[];
  boundaries: string[];
  reportHash: string;
}

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
    "",
    ...report.tasks.map(taskMarkdown),
    "## Claim boundaries",
    "",
    ...report.boundaries.map((boundary) => `- ${boundary}`),
    "",
    `Report commitment: \`${report.reportHash}\``,
    "",
  ].join("\n");
}

function writeTaskEvidence(
  root: string,
  evidence: CompletedBenchmarkEvidence,
): string {
  const relative = join("tasks", evidence.session.benchmarkSlug);
  const directory = join(root, relative);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  writeJson(join(directory, "agent-output.json"), evidence.representative.output);
  writeJson(join(directory, "agent-repeat-output.json"), evidence.excludedRepeat.output);
  writeJson(join(directory, "manual-output.json"), evidence.manual.output);
  writeJson(join(directory, "blind-evaluator-packet.json"), evidence.packet);
  writeJson(join(directory, "completed-scorecard.json"), evidence.scorecard);
  writeJson(join(directory, "source-mapping.opened.json"), evidence.mapping);
  writeJson(join(directory, "agent-run-1.json"), evidence.representative);
  writeJson(join(directory, "agent-run-2.json"), evidence.excludedRepeat);
  writeJson(join(directory, "manual-run.json"), evidence.manual);
  writeJson(join(directory, "agent-advantage-result.json"), evidence.result);
  return relative;
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
  const outputDirectory = resolve(outputDirectoryInput);
  mkdirSync(outputDirectory, { recursive: true, mode: 0o700 });
  const tasks = requiredSlugs.map((slug) => {
    const item = bySlug.get(slug)!;
    const metadata = TASK_METADATA[slug];
    const evidenceDirectory = writeTaskEvidence(outputDirectory, item);
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
      evidenceDirectory,
    } satisfies AgentAdvantageReportTask;
  });
  const body = {
    schemaVersion: "positioncrew.agent-advantage-report.v1" as const,
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
    },
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
    },
    tasks,
    boundaries: [
      "Results apply only to the three disclosed frozen fixtures and do not establish live investment performance.",
      "Conformance and blind task quality do not prove paid AACP settlement, external-provider traction, or mainnet execution.",
      "Manual timing depends on the named operator and disclosed method; another operator may perform differently.",
      "Modeled economic outputs are bounded recommendations, not guaranteed fills, returns, or liquidation prevention.",
    ],
  };
  const report: AgentAdvantageReport = {
    ...body,
    reportHash: canonicalHash(body),
  };
  writeJson(join(outputDirectory, "agent-advantage-report.json"), report);
  writeText(join(outputDirectory, "agent-advantage-report.md"), reportMarkdown(report));
  return report;
}
