import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  captureAgentBenchmarkRuns,
  captureManualBenchmarkRun,
  finalizeBlindBenchmark,
  prepareBenchmarkSession,
  revealBenchmarkResult,
  validateBlindScorecard,
} from "../src/benchmark/evidence.js";

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
      independenceAttestation:
        "I did not produce either candidate and could not see source identity, timing, or cost while scoring.",
    },
    scoredAt: "2026-08-13T01:00:00.000Z",
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
    attestation:
      "I scored both candidates only against the attached frozen rubric and confirm this scorecard is complete.",
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
      method: "Calculated every grid level, cost, and risk bound manually from the frozen fixture.",
      independenceAttestation:
        "I used no PositionCrew output, AI assistant, prior candidate output, or evaluator rubric during this test fixture run.",
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
    expect(result.advantageSupported).toBe(true);
  });

  it("rejects a changed packet and out-of-range evaluator scores", async () => {
    const prepared = prepareBenchmarkSession("lp-rebalance", {
      artifactRoot: tempArtifacts(),
      sessionId: "lp-rebalance-test-session",
    });
    const agents = await captureAgentBenchmarkRuns(prepared.directory);
    captureManualBenchmarkRun(prepared.directory, agents[0]!.output, {
      operatorId: "Manual Test Operator",
      method: "Calculated ticks, inventory, costs, and break-even manually from the frozen fixture.",
      independenceAttestation:
        "I used no PositionCrew output, AI assistant, prior candidate output, or evaluator rubric during this test fixture run.",
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
});
