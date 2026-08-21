import { describe, expect, it } from "vitest";
import {
  isVerifiedFounderAgentAdvantagePublication,
  type FounderAgentAdvantagePublicationStatus,
} from "../web/src/types.js";

const validPublication = {
  schemaVersion: "positioncrew.founder-agent-advantage-publication.v1",
  status: "PUBLISHED",
  reportUrl: "/evidence/agent-advantage-founder/",
  reportHash: `sha256:${"a".repeat(64)}`,
  evidenceManifestHash: `sha256:${"b".repeat(64)}`,
  publishedAt: "2026-08-20T16:00:00.000Z",
  taskCount: 3,
  exactOutputParityCount: 3,
  recordedSpeedAdvantageCount: 3,
  qualityMethod: "CANONICAL_EXACT_OUTPUT_PARITY",
  qualityScore: null,
  independent: false,
  blind: false,
  boundary:
    "This founder-operated comparison is non-independent and non-blind. E3_SERVER_PERSISTED records prove fresh PositionCrew server-persisted $0.00, no-wallet historical-fixture hires only. This does not establish paid commerce, an external buyer, external demand, fresh underlying analysis, or live advice.",
} as const satisfies FounderAgentAdvantagePublicationStatus;

const tamperedCases: Array<[string, Record<string, unknown>]> = [
  ["report URL", { reportUrl: "/evidence/wrong/" }],
  ["report hash", { reportHash: "sha256:bad" }],
  ["manifest hash", { evidenceManifestHash: "sha256:bad" }],
  ["publication time", { publishedAt: "not-a-time" }],
  ["task count", { taskCount: 2 }],
  ["parity count", { exactOutputParityCount: 2 }],
  ["speed count", { recordedSpeedAdvantageCount: 4 }],
  ["quality method", { qualityMethod: "BLIND_SCORE" }],
  ["quality score", { qualityScore: 300 }],
  ["independence", { independent: true }],
  ["blinding", { blind: true }],
  ["claim boundary", { boundary: "Founder comparison published." }],
];

describe("founder Agent Advantage public claim gate", () => {
  it("rejects the pending publication state", () => {
    const pending: FounderAgentAdvantagePublicationStatus = {
      schemaVersion: "positioncrew.founder-agent-advantage-publication.v1",
      status: "PENDING_FOUNDER_COMPARISON",
      reportUrl: null,
      reportHash: null,
      evidenceManifestHash: null,
      publishedAt: null,
      taskCount: 3,
      exactOutputParityCount: null,
      recordedSpeedAdvantageCount: null,
      qualityMethod: "CANONICAL_EXACT_OUTPUT_PARITY",
      qualityScore: null,
      independent: false,
      blind: false,
      boundary: "Founder comparison publication is pending.",
    };
    expect(isVerifiedFounderAgentAdvantagePublication(pending)).toBe(false);
  });

  it("accepts only the fully bounded published record", () => {
    expect(isVerifiedFounderAgentAdvantagePublication(validPublication)).toBe(true);
  });

  it.each(tamperedCases)("rejects a tampered %s", (_label, change) => {
    expect(
      isVerifiedFounderAgentAdvantagePublication({ ...validPublication, ...change }),
    ).toBe(false);
  });
});
