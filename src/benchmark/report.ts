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
import {
  loadMarketplaceInvocationProtocol,
  verifyMarketplaceInvocationEvidence,
  verifyMarketplaceInvocationEvidenceObject,
  type MarketplaceInvocationEvidence,
} from "./marketplace-provenance.js";

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

const MarketplaceDeliverySchema = z
  .object({
    attemptCount: z.literal(2),
    successCount: z.literal(2),
    allAttemptsSucceeded: z.literal(true),
    medianElapsedMilliseconds: z.number().positive(),
    endpointUrl: z.string().url(),
    receiptUrls: z.tuple([z.string().url(), z.string().url()]),
    outputHashesMatch: z.literal(true),
    evaluationHashesMatch: z.literal(true),
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
    agentDeliverableSummary: z.string().min(1).max(1_000),
    manualDeliverableSummary: z.string().min(1).max(1_000),
    speedupMultiple: z.number().finite().positive(),
    marketplaceSpeedupMultiple: z.number().finite().positive(),
    marketplaceDelivery: MarketplaceDeliverySchema,
    costDifferenceUsd: z.number().finite(),
    evidenceDirectory: z.string().regex(/^tasks\/(?:lending-rescue|lp-rebalance|bounded-grid)$/),
    evidenceFiles: EvidenceFilesSchema,
    evidenceManifestHash: HashSchema,
  })
  .strict();

export const AgentAdvantageReportSchema = z
  .object({
    schemaVersion: z.literal("positioncrew.agent-advantage-report.v3"),
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
        marketplaceDeliveriesPerTask: z.literal(2),
        marketplaceAttemptPolicy: z.literal("ONE_ATTEMPT_PER_RUN_NO_RETRY"),
        marketplaceTimingSeparatedFromDecisionRule: z.literal(true),
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
        marketplaceDeliverySuccessCount: z.literal(6),
        marketplaceEvidenceHash: HashSchema,
        marketplaceProtocolHash: HashSchema,
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
    `**Agent deliverable:** ${task.agentDeliverableSummary}`,
    "",
    `**Manual deliverable:** ${task.manualDeliverableSummary}`,
    "",
    "| Measure | Agent | Manual |",
    "| --- | ---: | ---: |",
    `| Blind quality score | ${task.result.agent.score}/100 | ${task.result.manual.score}/100 |`,
    `| Locked decision-rule time | ${task.result.agent.medianElapsedMilliseconds} ms median | ${task.result.manual.elapsedMilliseconds} ms |`,
    `| Public marketplace delivery | ${task.marketplaceDelivery.medianElapsedMilliseconds} ms median | ${task.result.manual.elapsedMilliseconds} ms |`,
    `| Direct cost | $${task.result.agent.medianDirectCostUsd} median | $${task.result.manual.directCostUsd} |`,
    `| Critical failures | ${task.result.agent.conformanceCriticalFailureCount + task.result.agent.blindCriticalFailureCount} | ${task.result.manual.blindCriticalFailureCount} |`,
    "",
    `Public marketplace delivery was ${task.marketplaceSpeedupMultiple}x faster than the manual run. The pre-registered decision-rule timer measured ${task.speedupMultiple}x; it excludes network transit and remains the only timing used by the locked advantage rule. Cost difference (manual minus agent) was $${task.costDifferenceUsd}.`,
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
    `- [Marketplace delivery record](marketplace-invocation-evidence.json)`,
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
    "- A separately precommitted overlay retained two no-retry public marketplace deliveries per task. It reports end-to-end HTTP latency and exact output commitments without changing the locked decision rule.",
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
    `Marketplace delivery evidence: \`${report.summary.marketplaceEvidenceHash}\``,
    "",
    `Report commitment: \`${report.reportHash}\``,
    "",
  ].join("\n");
}

function escapeHtml(value: unknown): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatDuration(milliseconds: number): string {
  if (milliseconds >= 60_000) return `${(milliseconds / 60_000).toFixed(2)} min`;
  if (milliseconds >= 1_000) return `${(milliseconds / 1_000).toFixed(2)} sec`;
  return `${milliseconds} ms`;
}

function formatUsd(value: string | number): string {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "$-";
  return `$${amount.toFixed(6).replace(/(?:\.0+|(?<=\.[0-9]*?)0+)$/, "")}`;
}

function formatUtcTimestamp(value: string): string {
  return value.replace("T", " ").replace(/\.\d{3}Z$/, " UTC");
}

function reportTaskHtml(task: AgentAdvantageReportTask, index: number): string {
  const status = task.result.advantageSupported ? "SUPPORTED" : "NOT SUPPORTED";
  const tone = task.result.advantageSupported ? "supported" : "unsupported";
  const directory = `tasks/${encodeURIComponent(task.benchmarkSlug)}`;
  return `<section class="task" aria-labelledby="task-${index}">
    <div class="task-head">
      <div><span class="eyebrow">Task ${index} / ${escapeHtml(task.category)}</span><h2 id="task-${index}">${escapeHtml(task.title)}</h2></div>
      <span class="result ${tone}">${status}</span>
    </div>
    <p class="stakes">${escapeHtml(task.highStakesReason)}</p>
    <div class="deliverables">
      <article><span>Agent deliverable</span><p>${escapeHtml(task.agentDeliverableSummary)}</p></article>
      <article><span>Manual deliverable</span><p>${escapeHtml(task.manualDeliverableSummary)}</p></article>
    </div>
    <div class="comparison" role="table" aria-label="Agent and manual comparison">
      <div class="comparison-row header" role="row"><span role="columnheader">Measure</span><span role="columnheader">Agent</span><span role="columnheader">Manual</span></div>
      <div class="comparison-row" role="row"><span role="cell">Blind quality</span><strong role="cell">${task.result.agent.score}/100</strong><strong role="cell">${task.result.manual.score}/100</strong></div>
      <div class="comparison-row" role="row"><span role="cell">Locked decision-rule time</span><strong role="cell">${escapeHtml(formatDuration(task.result.agent.medianElapsedMilliseconds))} median</strong><strong role="cell">${escapeHtml(formatDuration(task.result.manual.elapsedMilliseconds))}</strong></div>
      <div class="comparison-row" role="row"><span role="cell">Public marketplace delivery</span><strong role="cell">${escapeHtml(formatDuration(task.marketplaceDelivery.medianElapsedMilliseconds))} median</strong><strong role="cell">${escapeHtml(formatDuration(task.result.manual.elapsedMilliseconds))}</strong></div>
      <div class="comparison-row" role="row"><span role="cell">Direct cost</span><strong role="cell">${escapeHtml(formatUsd(task.result.agent.medianDirectCostUsd))} median</strong><strong role="cell">${escapeHtml(formatUsd(task.result.manual.directCostUsd))}</strong></div>
      <div class="comparison-row" role="row"><span role="cell">Critical failures</span><strong role="cell">${task.result.agent.conformanceCriticalFailureCount + task.result.agent.blindCriticalFailureCount}</strong><strong role="cell">${task.result.manual.blindCriticalFailureCount}</strong></div>
    </div>
    <div class="task-foot">
      <p><strong>${task.marketplaceSpeedupMultiple}x</strong> faster through the public marketplace; <strong>${task.speedupMultiple}x</strong> on the locked internal timer. Manual minus agent direct cost: <strong>${escapeHtml(formatUsd(task.costDifferenceUsd))}</strong>.</p>
      <nav aria-label="${escapeHtml(task.title)} evidence">
        <a href="${directory}/agent-output.json">Agent output</a>
        <a href="${directory}/manual-output.json">Manual output</a>
        <a href="${directory}/completed-scorecard.json">Blind scorecard</a>
        <a href="${directory}/agent-advantage-result.json">Result JSON</a>
      </nav>
      <code>${escapeHtml(task.evidenceManifestHash)}</code>
    </div>
  </section>`;
}

function reportHtml(report: AgentAdvantageReport): string {
  const aggregate = report.summary.allTasksSupportAdvantage
    ? "All three frozen tasks satisfy the pre-registered decision rule."
    : `${report.summary.supportedAdvantageCount} of 3 frozen tasks satisfy the pre-registered decision rule.`;
  const agentQualityScore = report.tasks.reduce(
    (total, task) => total + task.result.agent.score,
    0,
  );
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="description" content="PositionCrew Agent Advantage Report for three high-stakes BSC capital tasks.">
  <title>PositionCrew Agent Advantage Report</title>
  <style>
    :root{color-scheme:light;--ink:#161d19;--muted:#5d6861;--line:#d8dfda;--paper:#fff;--soft:#f2f5f2;--green:#17644f;--green-soft:#e7f3ee;--yellow:#f4c542;--yellow-soft:#fff8dd;--red:#923b49;--dark:#111713}
    *{box-sizing:border-box}html{background:#e9eeea}body{margin:0;color:var(--ink);background:#e9eeea;font:14px/1.5 Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;letter-spacing:0}a{color:var(--green);font-weight:750;text-underline-offset:3px}code{overflow-wrap:anywhere;font:11px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace}.shell{width:min(1180px,calc(100% - 32px));margin:0 auto}.hero{color:#fff;background:var(--dark);border-bottom:5px solid var(--yellow)}.hero .shell{display:grid;grid-template-columns:minmax(0,1fr) minmax(320px,.45fr);gap:44px;padding:48px 0 42px}.eyebrow{display:block;color:#758279;font-size:10px;font-weight:850;text-transform:uppercase}.hero .eyebrow{color:#b9c4bd}.hero h1{margin:10px 0 12px;font-size:clamp(32px,5vw,62px);line-height:1.02;letter-spacing:0}.hero p{max-width:720px;margin:0;color:#c9d1cc;font-size:17px}.hero-meta{align-self:end;border-left:1px solid #3a453e;padding-left:24px}.hero-meta span,.hero-meta strong{display:block}.hero-meta span{color:#9eaaa3;font-size:11px;text-transform:uppercase}.hero-meta strong{margin:5px 0 18px;font-size:14px}.summary{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));border:1px solid var(--line);border-top:0;background:var(--paper)}.summary div{min-width:0;padding:20px;border-right:1px solid var(--line)}.summary div:last-child{border-right:0}.summary strong,.summary span{display:block}.summary strong{font-size:27px;line-height:1.1}.summary span{margin-top:7px;color:var(--muted);font-size:11px}.intro{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(300px,.85fr);gap:38px;padding:38px 0}.intro h2{margin:7px 0 10px;font-size:25px}.intro p{margin:0;color:var(--muted)}.people{display:grid;grid-template-columns:1fr 1fr;border:1px solid var(--line);background:var(--paper)}.people div{min-width:0;padding:16px}.people div+div{border-left:1px solid var(--line)}.people span,.people strong,.people small{display:block}.people span{color:var(--muted);font-size:10px;text-transform:uppercase}.people strong{margin-top:6px}.people small{margin-top:3px;overflow-wrap:anywhere;color:var(--muted)}.task{margin-bottom:22px;border:1px solid var(--line);background:var(--paper)}.task-head{display:flex;align-items:flex-start;justify-content:space-between;gap:20px;padding:22px 24px;border-bottom:1px solid var(--line)}.task h2{margin:5px 0 0;font-size:22px}.result{flex:0 0 auto;padding:6px 9px;border:1px solid;font-size:10px;font-weight:900}.result.supported{color:var(--green);border-color:#9fc5b5;background:var(--green-soft)}.result.unsupported{color:var(--red);border-color:#d6a8af;background:#fff1f3}.stakes{margin:0;padding:15px 24px;color:#5b4c19;background:var(--yellow-soft);border-bottom:1px solid #eadba0}.deliverables{display:grid;grid-template-columns:1fr 1fr;border-bottom:1px solid var(--line)}.deliverables article{padding:20px 24px}.deliverables article+article{border-left:1px solid var(--line)}.deliverables span{color:var(--muted);font-size:10px;font-weight:850;text-transform:uppercase}.deliverables p{margin:7px 0 0}.comparison{padding:8px 24px}.comparison-row{display:grid;grid-template-columns:minmax(150px,1fr) minmax(130px,.75fr) minmax(130px,.75fr);gap:18px;padding:11px 0;border-bottom:1px solid #e8ece9}.comparison-row:last-child{border-bottom:0}.comparison-row.header{color:var(--muted);font-size:10px;font-weight:850;text-transform:uppercase}.comparison-row strong{font-size:13px}.task-foot{display:grid;grid-template-columns:minmax(250px,1fr) minmax(310px,auto);gap:14px 24px;align-items:center;padding:17px 24px;background:var(--soft);border-top:1px solid var(--line)}.task-foot p{margin:0}.task-foot nav{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:12px}.task-foot code{grid-column:1/-1;color:var(--muted)}.boundaries{margin:36px 0 50px;padding:26px 28px;color:#d5ded8;background:var(--dark);border-left:5px solid var(--yellow)}.boundaries h2{margin:0 0 12px;color:#fff;font-size:20px}.boundaries ul{margin:0;padding-left:19px}.boundaries li+li{margin-top:8px}.commitments{display:grid;grid-template-columns:1fr 1fr;gap:1px;margin-top:22px;background:#354039;border:1px solid #354039}.commitments div{min-width:0;padding:14px;background:#1b241f}.commitments span,.commitments code{display:block}.commitments span{color:#9faca4;font-size:10px;text-transform:uppercase}.commitments code{margin-top:5px;color:#fff}.footer{padding:0 0 40px;color:var(--muted);font-size:11px}.footer a{margin-right:14px}@media(max-width:760px){.shell{width:min(100% - 18px,1180px)}.hero .shell,.intro{grid-template-columns:1fr}.hero .shell{gap:26px;padding:32px 0}.hero-meta{border-top:1px solid #3a453e;border-left:0;padding:18px 0 0}.summary{grid-template-columns:1fr 1fr}.summary div:nth-child(2){border-right:0}.summary div:nth-child(-n+2){border-bottom:1px solid var(--line)}.people,.deliverables,.commitments{grid-template-columns:1fr}.people div+div,.deliverables article+article{border-top:1px solid var(--line);border-left:0}.task-head{padding:18px}.stakes,.deliverables article,.comparison,.task-foot{padding-left:18px;padding-right:18px}.comparison-row{grid-template-columns:minmax(100px,.8fr) 1fr 1fr;gap:8px}.task-foot{grid-template-columns:1fr}.task-foot nav{justify-content:flex-start}.task-foot code{grid-column:1}.boundaries{padding:22px 18px}}
    @media print{html,body{background:#fff}.hero{-webkit-print-color-adjust:exact;print-color-adjust:exact}.task{break-inside:avoid}.shell{width:100%}.footer{display:none}}
  </style>
</head>
<body>
  <header class="hero"><div class="shell"><div><span class="eyebrow">TermiX / independently scored evidence</span><h1>Agent Advantage Report</h1><p>${escapeHtml(aggregate)}</p></div><div class="hero-meta"><span>Project</span><strong>PositionCrew</strong><span>Generated</span><strong>${escapeHtml(formatUtcTimestamp(report.generatedAt))}</strong><span>Scope</span><strong>Three frozen BSC capital tasks</strong></div></div></header>
  <main class="shell">
    <section class="summary" aria-label="Report summary"><div><strong>${report.summary.supportedAdvantageCount}/3</strong><span>tasks supporting advantage</span></div><div><strong>${report.summary.marketplaceDeliverySuccessCount}/6</strong><span>public marketplace deliveries</span></div><div><strong>${report.summary.totalCriticalFailures}</strong><span>agent critical failures</span></div><div><strong>${agentQualityScore}/300</strong><span>agent blind quality</span></div></section>
    <section class="intro"><div><span class="eyebrow">Pre-registered method</span><h2>Same tasks. Hidden sources. Different people.</h2><p>One manual operator completed each task without PositionCrew or AI. A different evaluator scored six anonymized outputs against rubrics committed before either human saw a candidate. Timing, cost, operator identity, and the source mapping remained hidden during quality scoring.</p></div><div class="people"><div><span>Manual operator</span><strong>${escapeHtml(report.participants.manualOperator.displayName)}</strong><small>${escapeHtml(report.participants.manualOperator.contactReference)}</small></div><div><span>Blind evaluator</span><strong>${escapeHtml(report.participants.blindEvaluator.displayName)}</strong><small>${escapeHtml(report.participants.blindEvaluator.contactReference)}</small></div></div></section>
    ${report.tasks.map((task, index) => reportTaskHtml(task, index + 1)).join("\n")}
    <section class="boundaries"><h2>Claim boundaries</h2><ul>${report.boundaries.map((boundary) => `<li>${escapeHtml(boundary)}</li>`).join("")}</ul><div class="commitments"><div><span>Human + blind evidence</span><code>${escapeHtml(report.summary.evidenceManifestHash)}</code></div><div><span>Marketplace delivery</span><code>${escapeHtml(report.summary.marketplaceEvidenceHash)}</code></div><div><span>Report commitment</span><code>${escapeHtml(report.reportHash)}</code></div></div></section>
  </main>
  <footer class="shell footer"><a href="agent-advantage-report.json">Machine-readable report</a><a href="agent-advantage-report.md">Markdown report</a><a href="marketplace-invocation-evidence.json">Marketplace delivery evidence</a><a href="https://positioncrew.dolepee.com">Live marketplace</a><a href="https://github.com/dolepee/positioncrew">Public repository</a></footer>
</body>
</html>\n`;
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

function marketplaceDeliveryFor(
  slug: TermixBenchmarkSlug,
  evidence: MarketplaceInvocationEvidence,
): z.infer<typeof MarketplaceDeliverySchema> {
  const summary = evidence.summaries.find((candidate) => candidate.benchmarkSlug === slug);
  const records = evidence.records.filter((candidate) => candidate.benchmarkSlug === slug);
  if (!summary || records.length !== 2 || records.some((record) => !record.success || !record.observation)) {
    throw new Error(`${slug} does not have two successful retained marketplace deliveries`);
  }
  const [first, second] = records;
  if (!first?.observation || !second?.observation) {
    throw new Error(`${slug} marketplace delivery observations are missing`);
  }
  if (first.endpointUrl !== second.endpointUrl) {
    throw new Error(`${slug} marketplace delivery endpoints differ`);
  }
  return MarketplaceDeliverySchema.parse({
    attemptCount: summary.attemptCount,
    successCount: summary.successCount,
    allAttemptsSucceeded: summary.successCount === summary.attemptCount,
    medianElapsedMilliseconds: summary.medianElapsedMilliseconds,
    endpointUrl: first.endpointUrl,
    receiptUrls: [first.observation.receiptUrl, second.observation.receiptUrl],
    outputHashesMatch: summary.outputHashesMatch,
    evaluationHashesMatch: summary.evaluationHashesMatch,
  });
}

export function buildAgentAdvantageReport(
  sessionDirectories: string[],
  outputDirectoryInput: string,
  now = new Date(),
  projectRoot = process.cwd(),
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
  const marketplaceEvidence = verifyMarketplaceInvocationEvidence(projectRoot);
  const outputDirectory = resolve(outputDirectoryInput);
  mkdirSync(outputDirectory, { recursive: true, mode: 0o700 });
  const tasks = requiredSlugs.map((slug) => {
    const item = bySlug.get(slug)!;
    const metadata = TASK_METADATA[slug];
    const evidenceBundle = writeTaskEvidence(outputDirectory, item);
    const marketplaceDelivery = marketplaceDeliveryFor(slug, marketplaceEvidence);
    return {
      benchmarkSlug: slug,
      ...metadata,
      taskId: item.session.taskId,
      benchmarkLock: item.session.benchmarkLock,
      result: item.result,
      agentDeliverableSummary: item.representative.output.summary,
      manualDeliverableSummary: item.manual.output.summary,
      speedupMultiple: speedup(
        item.result.manual.elapsedMilliseconds,
        item.result.agent.medianElapsedMilliseconds,
      ),
      marketplaceSpeedupMultiple: speedup(
        item.result.manual.elapsedMilliseconds,
        marketplaceDelivery.medianElapsedMilliseconds,
      ),
      marketplaceDelivery,
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
    schemaVersion: "positioncrew.agent-advantage-report.v3" as const,
    generatedAt: now.toISOString(),
    project: {
      name: "PositionCrew" as const,
      liveUrl: "https://positioncrew.dolepee.com" as const,
      repositoryUrl: "https://github.com/dolepee/positioncrew" as const,
    },
    methodology: {
      manualRunsPerTask: 1 as const,
      agentRunsPerTask: 2 as const,
      marketplaceDeliveriesPerTask: 2 as const,
      marketplaceAttemptPolicy: "ONE_ATTEMPT_PER_RUN_NO_RETRY" as const,
      marketplaceTimingSeparatedFromDecisionRule: true as const,
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
      marketplaceDeliverySuccessCount: marketplaceEvidence.aggregate.successCount as 6,
      marketplaceEvidenceHash: marketplaceEvidence.evidenceHash,
      marketplaceProtocolHash: marketplaceEvidence.protocolHash,
      evidenceManifestHash,
    },
    tasks,
    boundaries: [
      "Results apply only to the three disclosed frozen fixtures and do not establish live investment performance.",
      "Conformance and blind task quality do not prove paid AACP settlement, external-provider traction, or mainnet execution.",
      "Manual timing depends on the named operator and disclosed method; another operator may perform differently.",
      "The pre-registered agent decision timer covers local Provider and evaluator execution against an already-loaded frozen fixture; it excludes network transit, wallet interaction, and commerce settlement latency.",
      "A separately precommitted no-retry overlay reports end-to-end public marketplace HTTP delivery time. It is attached for delivery provenance and does not alter the locked Agent Advantage decision rule.",
      "Agent direct cost is the measured marginal cost of the local deterministic run and excludes prior engineering and shared hosting; manual cost is the operator-disclosed direct cost for that run.",
      "Modeled economic outputs are bounded recommendations, not guaranteed fills, returns, or liquidation prevention.",
    ],
  };
  const report = AgentAdvantageReportSchema.parse({
    ...body,
    reportHash: canonicalHash(body),
  });
  writeJson(join(outputDirectory, "agent-advantage-report.json"), report);
  writeJson(
    join(outputDirectory, "marketplace-invocation-evidence.json"),
    marketplaceEvidence,
  );
  writeText(join(outputDirectory, "agent-advantage-report.md"), reportMarkdown(report));
  writeText(join(outputDirectory, "agent-advantage-report.html"), reportHtml(report));
  return report;
}

function reportBody(report: AgentAdvantageReport): Omit<AgentAdvantageReport, "reportHash"> {
  const { reportHash: _reportHash, ...body } = report;
  return body;
}

export function verifyAgentAdvantageReport(
  outputDirectoryInput: string,
  projectRoot = process.cwd(),
): AgentAdvantageReport {
  const outputDirectory = resolve(outputDirectoryInput);
  const report = AgentAdvantageReportSchema.parse(
    JSON.parse(readFileSync(join(outputDirectory, "agent-advantage-report.json"), "utf8")),
  );
  if (canonicalHash(reportBody(report)) !== report.reportHash) {
    throw new Error("Agent Advantage report commitment is invalid");
  }
  const attachedMarketplaceEvidence = verifyMarketplaceInvocationEvidenceObject(
    JSON.parse(
      readFileSync(
        join(outputDirectory, "marketplace-invocation-evidence.json"),
        "utf8",
      ),
    ),
    loadMarketplaceInvocationProtocol(projectRoot),
  );
  if (
    attachedMarketplaceEvidence.evidenceHash !== report.summary.marketplaceEvidenceHash ||
    attachedMarketplaceEvidence.protocolHash !== report.summary.marketplaceProtocolHash
  ) {
    throw new Error("Attached marketplace delivery evidence differs from the report summary");
  }
  if (
    readFileSync(join(outputDirectory, "agent-advantage-report.md"), "utf8") !==
    reportMarkdown(report)
  ) {
    throw new Error("The Markdown report does not match the committed report data");
  }
  if (
    readFileSync(join(outputDirectory, "agent-advantage-report.html"), "utf8") !==
    reportHtml(report)
  ) {
    throw new Error("The HTML report does not match the committed report data");
  }
  const expectedSlugs = ["lending-rescue", "lp-rebalance", "bounded-grid"];
  if (report.tasks.map((task) => task.benchmarkSlug).join(",") !== expectedSlugs.join(",")) {
    throw new Error("Agent Advantage report tasks are missing, duplicated, or out of order");
  }
  for (const task of report.tasks) {
    const expectedMarketplaceDelivery = marketplaceDeliveryFor(
      task.benchmarkSlug,
      attachedMarketplaceEvidence,
    );
    if (canonicalHash(expectedMarketplaceDelivery) !== canonicalHash(task.marketplaceDelivery)) {
      throw new Error(`${task.benchmarkSlug} marketplace delivery differs from its attached evidence`);
    }
    if (
      task.marketplaceSpeedupMultiple !==
      speedup(
        task.result.manual.elapsedMilliseconds,
        task.marketplaceDelivery.medianElapsedMilliseconds,
      )
    ) {
      throw new Error(`${task.benchmarkSlug} marketplace speedup is inconsistent`);
    }
    if (
      task.speedupMultiple !==
      speedup(
        task.result.manual.elapsedMilliseconds,
        task.result.agent.medianElapsedMilliseconds,
      )
    ) {
      throw new Error(`${task.benchmarkSlug} locked-timer speedup is inconsistent`);
    }
    if (
      task.costDifferenceUsd !==
      usdDifference(
        task.result.manual.directCostUsd,
        task.result.agent.medianDirectCostUsd,
      )
    ) {
      throw new Error(`${task.benchmarkSlug} cost difference is inconsistent`);
    }
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
    marketplaceDeliverySuccessCount: attachedMarketplaceEvidence.aggregate.successCount as 6,
    marketplaceEvidenceHash: attachedMarketplaceEvidence.evidenceHash,
    marketplaceProtocolHash: attachedMarketplaceEvidence.protocolHash,
    evidenceManifestHash: expectedEvidenceManifestHash,
  };
  if (canonicalHash(expectedSummary) !== canonicalHash(report.summary)) {
    throw new Error("The report summary does not match its task evidence");
  }
  return report;
}
