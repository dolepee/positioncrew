import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  captureAgentBenchmarkRuns,
  captureManualBenchmarkRun,
  EVALUATOR_INDEPENDENCE_ATTESTATION,
  finalizeBlindBenchmark,
  loadCompletedBenchmarkEvidence,
  MANUAL_INDEPENDENCE_ATTESTATION,
  prepareBenchmarkSession,
  revealBenchmarkResult,
  SCORECARD_ATTESTATION,
  validateBlindScorecard,
} from "../src/benchmark/evidence.js";
import {
  buildBlindEvaluatorHandoff,
  buildManualOperatorHandoff,
  captureManualHandoffBundle,
} from "../src/benchmark/handoff.js";
import {
  buildAgentAdvantageReport,
  verifyAgentAdvantageReport,
} from "../src/benchmark/report.js";
import {
  PENDING_AGENT_ADVANTAGE_PUBLICATION,
  stageAgentAdvantageReport,
} from "../src/benchmark/publication.js";
import { canonicalHash } from "../src/core/canonical.js";

const temporaryDirectories: string[] = [];

function tempArtifacts(): string {
  const directory = mkdtempSync(join(tmpdir(), "positioncrew-benchmark-"));
  temporaryDirectories.push(directory);
  return directory;
}

function fullScorecard(packet: ReturnType<typeof finalizeBlindBenchmark>["packet"]) {
  return {
    schemaVersion: "positioncrew.blind-scorecard.v1" as const,
    sessionId: packet.sessionId,
    taskId: packet.taskId,
    packetHash: packet.packetHash,
    mappingCommitment: packet.mappingCommitment,
    evaluator: {
      displayName: "Independent Evaluator",
      contactReference: "https://example.com/evaluator",
      relationshipDisclosure: "No financial or operating relationship with PositionCrew or the manual operator.",
      independenceAttestation: EVALUATOR_INDEPENDENCE_ATTESTATION,
    },
    scoredAt: new Date(Date.parse(packet.createdAt) + 1_000).toISOString(),
    candidates: packet.candidates.map((candidate) => ({
      label: candidate.label,
      criteria: packet.rubric.criteria.map((criterion) => ({
        criterionId: criterion.id,
        score: criterion.maximumScore,
        criticalFailure: false,
        notes: "The candidate satisfies the frozen full-credit condition using only the supplied task evidence.",
      })),
      overallNotes: "Complete, bounded, and immediately usable for the frozen task.",
    })),
    attestation: SCORECARD_ATTESTATION,
  };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("tamper-evident Agent Advantage evidence workflow", () => {
  it("keeps expected answers out of the manual packet and binds two repeatable agent runs", async () => {
    const prepared = prepareBenchmarkSession("lending-rescue", {
      artifactRoot: tempArtifacts(),
      sessionId: "lending-rescue-test-session",
      now: new Date("2026-08-12T22:00:00.000Z"),
    });
    const taskPacket = JSON.parse(readFileSync(prepared.taskPacketPath, "utf8"));

    expect(taskPacket.rubric).toBeUndefined();
    expect(JSON.stringify(taskPacket)).not.toContain("fullCredit");
    expect(taskPacket.outputContract.properties.service.const).toBe("LENDING_RESCUE");

    const agents = await captureAgentBenchmarkRuns(prepared.directory, {
      now: () => new Date("2026-08-12T22:01:00.000Z"),
    });
    expect(agents).toHaveLength(2);
    expect(new Set(agents.map((record) => record.outputHash)).size).toBe(1);
    expect(agents.every((record) => record.conformance?.criticalFailureCount === 0)).toBe(true);
  });

  it("blinds one precommitted agent output and reveals only after a valid scorecard", async () => {
    const prepared = prepareBenchmarkSession("bounded-grid", {
      artifactRoot: tempArtifacts(),
      sessionId: "bounded-grid-test-session",
      now: new Date("2026-08-12T22:00:00.000Z"),
    });
    const agents = await captureAgentBenchmarkRuns(prepared.directory, {
      now: () => new Date("2026-08-12T22:01:00.000Z"),
    });
    captureManualBenchmarkRun(prepared.directory, agents[0]!.output, {
      operatorId: "Manual Test Operator",
      contactReference: "https://example.com/manual-test-operator",
      method: "Calculated every grid level, cost, and risk bound manually from the frozen fixture.",
      independenceAttestation: MANUAL_INDEPENDENCE_ATTESTATION,
      elapsedMilliseconds: 60_000,
      directCostUsd: "0",
      capturedAt: "2026-08-12T22:03:00.000Z",
    });

    const { packet, mapping } = finalizeBlindBenchmark(prepared.directory, {
      agentFirst: true,
      now: new Date("2026-08-12T22:04:00.000Z"),
    });
    expect(packet.candidates).toHaveLength(2);
    expect(packet.candidates[0]!.label).toBe("Candidate A");
    expect(JSON.stringify(packet)).not.toContain("sourceType");
    expect(JSON.stringify(packet)).not.toContain("PositionCrew");
    expect(mapping.assignments[0]!.sourceType).toBe("AGENT");
    expect(mapping.excludedAgentRepeat.runNumber).toBe(2);

    const scorecard = fullScorecard(packet);
    const validated = validateBlindScorecard(packet, scorecard);
    expect(validated.totals.get("Candidate A")?.total).toBe(100);
    const result = revealBenchmarkResult(prepared.directory, scorecard);
    expect(result.agent.outputHashesMatch).toBe(true);
    expect(result.agent.score).toBe(100);
    expect(result.manual.score).toBe(100);
    expect(result.manual.blindCriticalFailureCount).toBe(0);
    expect(result.advantageSupported).toBe(true);
  });

  it("rejects a changed packet and out-of-range evaluator scores", async () => {
    const prepared = prepareBenchmarkSession("lp-rebalance", {
      artifactRoot: tempArtifacts(),
      sessionId: "lp-rebalance-test-session",
    });
    const agents = await captureAgentBenchmarkRuns(prepared.directory, {
      now: () => new Date("2026-08-12T22:01:00.000Z"),
    });
    captureManualBenchmarkRun(prepared.directory, agents[0]!.output, {
      operatorId: "Manual Test Operator",
      contactReference: "https://example.com/manual-test-operator",
      method: "Calculated ticks, inventory, costs, and break-even manually from the frozen fixture.",
      independenceAttestation: MANUAL_INDEPENDENCE_ATTESTATION,
      elapsedMilliseconds: 60_000,
      directCostUsd: "0",
      capturedAt: "2026-08-12T22:03:00.000Z",
    });
    const { packet } = finalizeBlindBenchmark(prepared.directory, { agentFirst: false });
    const scorecard = fullScorecard(packet);

    const tampered = structuredClone(packet);
    tampered.candidates[0]!.output.summary = "Changed after the packet commitment.";
    expect(() => validateBlindScorecard(tampered, scorecard)).toThrow(
      "Blind evaluator packet commitment is invalid",
    );

    const invalidScorecard = structuredClone(scorecard);
    invalidScorecard.candidates[0]!.criteria[0]!.score = 101;
    expect(() => validateBlindScorecard(packet, invalidScorecard)).toThrow();
  });

  it("rejects same-person evaluation and any edited completed result", async () => {
    const prepared = prepareBenchmarkSession("lending-rescue", {
      artifactRoot: tempArtifacts(),
      sessionId: "lending-rescue-integrity-test-session",
      now: new Date("2026-08-12T22:00:00.000Z"),
    });
    const agents = await captureAgentBenchmarkRuns(prepared.directory, {
      now: () => new Date("2026-08-12T22:01:00.000Z"),
    });
    captureManualBenchmarkRun(prepared.directory, agents[0]!.output, {
      operatorId: "Manual Integrity Operator",
      contactReference: "https://example.com/manual-integrity-operator",
      method: "Calculated the frozen lending task manually using a local calculator.",
      independenceAttestation: MANUAL_INDEPENDENCE_ATTESTATION,
      elapsedMilliseconds: 60_000,
      directCostUsd: "0",
      capturedAt: "2026-08-12T22:03:00.000Z",
    });
    const { packet } = finalizeBlindBenchmark(prepared.directory, {
      now: new Date("2026-08-12T22:04:00.000Z"),
      agentFirst: true,
    });
    const samePerson = fullScorecard(packet);
    samePerson.evaluator.displayName = "Manual Integrity Operator";
    samePerson.evaluator.contactReference = "https://example.com/manual-integrity-operator";
    expect(() => revealBenchmarkResult(prepared.directory, samePerson)).toThrow(
      "The blind evaluator must be a different person",
    );

    const result = revealBenchmarkResult(prepared.directory, fullScorecard(packet));
    const resultPath = join(prepared.directory, "public", "agent-advantage-result.json");
    writeFileSync(
      resultPath,
      `${JSON.stringify({ ...result, advantageSupported: !result.advantageSupported }, null, 2)}\n`,
    );
    expect(() => loadCompletedBenchmarkEvidence(prepared.directory)).toThrow(
      "Completed Agent Advantage result does not match its source evidence",
    );
  });

  it("generates offline role-separated handoff tools and validates the timed manual bundle", async () => {
    const prepared = prepareBenchmarkSession("lending-rescue", {
      artifactRoot: tempArtifacts(),
      sessionId: "lending-rescue-handoff-test-session",
      now: new Date("2026-08-12T22:00:00.000Z"),
    });
    const agents = await captureAgentBenchmarkRuns(prepared.directory, {
      now: () => new Date("2026-08-12T22:01:00.000Z"),
    });
    const manualTool = buildManualOperatorHandoff(prepared.directory);
    const manualHtml = readFileSync(manualTool.path, "utf8");

    expect(manualHtml).toContain("Offline evidence capture");
    expect(manualHtml).not.toContain("fullCredit");
    expect(manualHtml).not.toContain('"sourceType"');
    expect(manualHtml).not.toContain('"candidateHash"');

    const manualOutput = agents[0]!.output;
    const validBundle = {
      schemaVersion: "positioncrew.manual-handoff-bundle.v1",
      sessionId: prepared.session.sessionId,
      taskId: prepared.session.taskId,
      taskPacketHash: manualTool.taskPacketHash,
      startedAt: "2026-08-12T22:02:00.000Z",
      completedAt: "2026-08-12T22:03:00.000Z",
      outputHash: canonicalHash(manualOutput),
      output: manualOutput,
      metadata: {
        operatorId: "Independent Manual Operator",
        contactReference: "https://example.com/independent-manual-operator",
        method: "Calculated the frozen lending task with a calculator and recorded the complete JSON result.",
        independenceAttestation: MANUAL_INDEPENDENCE_ATTESTATION,
        elapsedMilliseconds: 60_000,
        directCostUsd: "0",
        capturedAt: "2026-08-12T22:03:00.000Z",
      },
    } as const;

    expect(() =>
      captureManualHandoffBundle(prepared.directory, {
        ...validBundle,
        metadata: {
          ...validBundle.metadata,
          capturedAt: "2026-08-12T22:02:59.000Z",
        },
      }),
    ).toThrow();

    const manual = captureManualHandoffBundle(prepared.directory, validBundle);
    expect(manual.source.type).toBe("MANUAL");

    finalizeBlindBenchmark(prepared.directory, {
      agentFirst: false,
      now: new Date("2026-08-12T22:04:00.000Z"),
    });
    const evaluatorTool = buildBlindEvaluatorHandoff(prepared.directory);
    const evaluatorHtml = readFileSync(evaluatorTool.path, "utf8");
    expect(evaluatorHtml).toContain("PositionCrew blind evaluator");
    expect(evaluatorHtml).toContain("Candidate A");
    expect(evaluatorHtml).not.toContain('"sourceType"');
    expect(evaluatorHtml).not.toContain('"elapsedMilliseconds"');
  });

  it("assembles only a complete three-category TermiX report", async () => {
    const artifactRoot = tempArtifacts();
    const directories: string[] = [];
    for (const slug of ["lending-rescue", "lp-rebalance", "bounded-grid"] as const) {
      const prepared = prepareBenchmarkSession(slug, {
        artifactRoot,
        sessionId: `${slug}-report-test-session`,
      });
      const agents = await captureAgentBenchmarkRuns(prepared.directory, {
        now: () => new Date("2026-08-12T22:01:00.000Z"),
      });
      captureManualBenchmarkRun(prepared.directory, agents[0]!.output, {
        operatorId: "Manual Report Test Operator",
        contactReference: "https://example.com/manual-report-test-operator",
        method: "Calculated the complete frozen task manually and rendered the result in the neutral output contract.",
        independenceAttestation: MANUAL_INDEPENDENCE_ATTESTATION,
        elapsedMilliseconds: 60_000,
        directCostUsd: "1",
        capturedAt: "2026-08-12T22:03:00.000Z",
      });
      const { packet } = finalizeBlindBenchmark(prepared.directory, { agentFirst: true });
      revealBenchmarkResult(prepared.directory, fullScorecard(packet));
      directories.push(prepared.directory);
    }
    const outputDirectory = join(tempArtifacts(), "report");
    const report = buildAgentAdvantageReport(
      directories,
      outputDirectory,
      new Date("2026-08-13T02:00:00.000Z"),
    );

    expect(report.summary).toMatchObject({
      taskCount: 3,
      supportedAdvantageCount: 3,
      allTasksSupportAdvantage: true,
      agentOutputPairsMatching: 3,
      totalCriticalFailures: 0,
      marketplaceDeliverySuccessCount: 6,
      marketplaceEvidenceHash: "sha256:0588d908352e3bacb799f595909e11d1becdeec7063265c7a7aa5b8e493fba84",
      marketplaceProtocolHash: "sha256:4935a4d6a32291112a1f64911765429ca90e65aa9a8a2d966634833cced597e4",
    });
    expect(report.schemaVersion).toBe("positioncrew.agent-advantage-report.v4");
    expect(report.tasks.map((task) => task.benchmarkSlug)).toEqual([
      "lending-rescue",
      "lp-rebalance",
      "bounded-grid",
    ]);
    expect(existsSync(join(outputDirectory, "agent-advantage-report.md"))).toBe(true);
    expect(existsSync(join(outputDirectory, "agent-advantage-report.html"))).toBe(true);
    expect(existsSync(join(outputDirectory, "marketplace-invocation-evidence.json"))).toBe(true);
    expect(existsSync(join(outputDirectory, "erc8183-jobs.testnet.json"))).toBe(true);
    expect(report.trackRecord).toMatchObject({
      highStakesServiceCount: 4,
      marketplace: {
        attemptedNoRetryDeliveries: 6,
        successfulNoRetryDeliveries: 6,
      },
      onchainTestnet: {
        completedLifecycles: 7,
        fundedCompletedJobs: 6,
        mandatoryCategoriesCovered: 4,
        externalBuyerJobs: 0,
        externalRevenue: "0",
      },
    });
    expect(report.tasks.every((task) => task.marketplaceDelivery.successCount === 2)).toBe(true);
    expect(existsSync(join(outputDirectory, "tasks", "bounded-grid", "manual-output.json"))).toBe(true);
    expect(readFileSync(join(outputDirectory, "agent-advantage-report.md"), "utf8")).toContain(
      "PositionCrew Agent Advantage Report",
    );
    expect(readFileSync(join(outputDirectory, "agent-advantage-report.md"), "utf8")).toContain(
      "Public marketplace delivery",
    );
    expect(verifyAgentAdvantageReport(outputDirectory).reportHash).toBe(report.reportHash);
    expect(
      JSON.parse(
        readFileSync(
          join(process.cwd(), "web", "public", "evidence", "agent-advantage-status.json"),
          "utf8",
        ),
      ),
    ).toEqual(PENDING_AGENT_ADVANTAGE_PUBLICATION);

    const publicRoot = join(tempArtifacts(), "public");
    const evidenceRoot = join(publicRoot, "evidence");
    mkdirSync(evidenceRoot, { recursive: true });
    writeFileSync(
      join(evidenceRoot, "agent-advantage-status.json"),
      `${JSON.stringify(PENDING_AGENT_ADVANTAGE_PUBLICATION, null, 2)}\n`,
    );
    writeFileSync(join(outputDirectory, "private-note.txt"), "must not be published\n");
    expect(() =>
      stageAgentAdvantageReport(outputDirectory, publicRoot, {
        confirmedIndependentHumans: false,
      }),
    ).toThrow("explicit confirmation");
    const publication = stageAgentAdvantageReport(outputDirectory, publicRoot, {
      confirmedIndependentHumans: true,
      publishedAt: new Date("2026-08-13T02:05:00.000Z"),
    });
    expect(publication).toMatchObject({
      status: "PUBLISHED",
      reportHash: report.reportHash,
      supportedAdvantageCount: 3,
      agentBlindQualityScore: 300,
    });
    expect(existsSync(join(evidenceRoot, "agent-advantage", "index.html"))).toBe(true);
    expect(
      existsSync(
        join(evidenceRoot, "agent-advantage", "marketplace-invocation-evidence.json"),
      ),
    ).toBe(true);
    expect(
      existsSync(join(evidenceRoot, "agent-advantage", "erc8183-jobs.testnet.json")),
    ).toBe(true);
    expect(existsSync(join(evidenceRoot, "agent-advantage", "private-note.txt"))).toBe(false);
    expect(
      JSON.parse(readFileSync(join(evidenceRoot, "agent-advantage-status.json"), "utf8")),
    ).toEqual(publication);
    expect(() =>
      stageAgentAdvantageReport(outputDirectory, publicRoot, {
        confirmedIndependentHumans: true,
      }),
    ).toThrow("already been staged");

    const marketplaceEvidencePath = join(
      outputDirectory,
      "marketplace-invocation-evidence.json",
    );
    const originalMarketplaceEvidence = readFileSync(marketplaceEvidencePath, "utf8");
    const changedMarketplaceEvidence = JSON.parse(originalMarketplaceEvidence);
    changedMarketplaceEvidence.records[0].elapsedMilliseconds += 1;
    writeFileSync(
      marketplaceEvidencePath,
      `${JSON.stringify(changedMarketplaceEvidence, null, 2)}\n`,
    );
    expect(() => verifyAgentAdvantageReport(outputDirectory)).toThrow(
      "Marketplace invocation evidence commitment is invalid",
    );
    writeFileSync(marketplaceEvidencePath, originalMarketplaceEvidence);

    const commerceLedgerPath = join(outputDirectory, "erc8183-jobs.testnet.json");
    const originalCommerceLedger = readFileSync(commerceLedgerPath, "utf8");
    const changedCommerceLedger = JSON.parse(originalCommerceLedger);
    changedCommerceLedger.summary.externalBuyerJobs = 1;
    writeFileSync(commerceLedgerPath, `${JSON.stringify(changedCommerceLedger, null, 2)}\n`);
    expect(() => verifyAgentAdvantageReport(outputDirectory)).toThrow();
    writeFileSync(commerceLedgerPath, originalCommerceLedger);

    const htmlPath = join(outputDirectory, "agent-advantage-report.html");
    const originalHtml = readFileSync(htmlPath, "utf8");
    writeFileSync(htmlPath, originalHtml.replace("Agent Advantage Report", "Edited Report"));
    expect(() => verifyAgentAdvantageReport(outputDirectory)).toThrow(
      "The HTML report does not match the committed report data",
    );
    writeFileSync(htmlPath, originalHtml);

    const agentOutputPath = join(
      outputDirectory,
      "tasks",
      "bounded-grid",
      "agent-output.json",
    );
    const changedOutput = JSON.parse(readFileSync(agentOutputPath, "utf8"));
    changedOutput.summary = "Edited after the report commitment.";
    writeFileSync(agentOutputPath, `${JSON.stringify(changedOutput, null, 2)}\n`);
    expect(() => verifyAgentAdvantageReport(outputDirectory)).toThrow(
      "bounded-grid/agent-output.json does not match its evidence commitment",
    );
  });
});
