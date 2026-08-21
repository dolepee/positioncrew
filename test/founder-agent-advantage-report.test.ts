import {
  afterEach,
  describe,
  expect,
  it,
} from "vitest";
import {
  createHash,
} from "node:crypto";
import {
  copyFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  type FounderAgentAdvantageReport,
  buildFounderAgentAdvantageReport,
  loadAndVerifyFounderMarketplaceHires,
  renderFounderReportHtml,
  verifyFounderAgentAdvantageReport,
} from "../src/benchmark/founder-report.js";
import { publishFounderAgentAdvantageReport } from "../src/benchmark/founder-publication.js";
import { canonicalHash } from "../src/core/canonical.js";

const projectRoot = resolve(".");
const publishedReport = join(
  projectRoot,
  "web/public/evidence/agent-advantage-founder",
);
const marketplaceTrial = join(
  publishedReport,
  "marketplace-hires",
);
const temporaryDirectories: string[] = [];

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "positioncrew-founder-report-"));
  temporaryDirectories.push(directory);
  return directory;
}

function recommitTrialSession(directory: string): void {
  const sessionPath = join(directory, "session.json");
  const replacementHash = createHash("sha256").update(readFileSync(sessionPath)).digest("hex");
  const checksumsPath = join(directory, "SHA256SUMS");
  const checksums = readFileSync(checksumsPath, "utf8").replace(
    /^[a-f0-9]{64}  session\.json$/mu,
    `${replacementHash}  session.json`,
  );
  writeFileSync(checksumsPath, checksums, "utf8");
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("founder-operated agent advantage report", () => {
  it("binds all three exact-equal candidate sets to the server-persisted D1 timing", () => {
    const report = verifyFounderAgentAdvantageReport(publishedReport);

    expect(report.comparisonMode).toBe("FOUNDER_OPERATED_NON_INDEPENDENT_NON_BLIND");
    expect(report.independent).toBe(false);
    expect(report.blind).toBe(false);
    expect(report.qualityScore).toBeNull();
    expect(report.summary).toMatchObject({
      taskCount: 3,
      exactOutputParityCount: 3,
      recordedSpeedAdvantageCount: 3,
      directCostUsd: "0",
      agentTotalElapsedMilliseconds: 1111,
      manualTotalElapsedMilliseconds: 480072,
      marketplaceEvidenceStatus: "E3_SERVER_PERSISTED",
    });
    expect(report.tasks.map((task) => task.agent.officialElapsedMilliseconds)).toEqual([
      371,
      381,
      359,
    ]);
    expect(report.tasks.map((task) => task.manual.elapsedMilliseconds)).toEqual([
      356626,
      94612,
      28834,
    ]);
    expect(report.tasks.map((task) => task.recordedSpeedupMultiple)).toEqual([
      961.256065,
      248.325459,
      80.317549,
    ]);
    expect(report.marketplaceHires.session.tasks).toMatchObject([
      { benchmarkSlug: "lending-rescue", apiDurationMilliseconds: 371 },
      { benchmarkSlug: "lp-rebalance", apiDurationMilliseconds: 381 },
      { benchmarkSlug: "bounded-grid", apiDurationMilliseconds: 359 },
    ]);
    for (const task of report.tasks) {
      expect(task.marketplace).toMatchObject({
        evidenceStatus: "E3_SERVER_PERSISTED",
        evidenceMode: "FRESH_SERVER_PERSISTED_HISTORICAL_FIXTURE_HIRE",
        serverEvidenceMode: "HISTORICAL_FIXTURE",
        hireProven: true,
        externalBuyer: false,
        uniqueServerHire: true,
        paid: false,
        freshServerPersistenceProven: true,
        freshUnderlyingAnalysisProven: false,
      });
      expect(task.quality.qualityScore).toBeNull();
      expect(task.manual.outputHash).toBe(task.agent.deliverableHash);
      expect(task.manual.outputHash).toBe(task.agent.repeatabilityCandidates[0]?.outputHash);
      expect(task.manual.outputHash).toBe(task.agent.repeatabilityCandidates[1]?.outputHash);
      expect(task.manual.outputHash).toBe(task.marketplace.deliverableHash);
    }
  });

  it("writes and verifies a self-contained immutable report", () => {
    const verified = verifyFounderAgentAdvantageReport(publishedReport);
    expect(verified.reportHash).toBe(
      "sha256:69fa9304758a2f76921e190ed28d1c6556dd98e4f0bc945cbb82d62739954853",
    );
    expect(verified.evidenceManifestHash).toBe(
      "sha256:e6e425f289a458f6735f035cff255efa886b19087b5d984d976bdfb1c1db0377",
    );
  });

  it("rejects arbitrary or modified deterministic HTML", () => {
    const root = temporaryDirectory();
    const outputDirectory = join(root, "report");
    cpSync(publishedReport, outputDirectory, { recursive: true });
    writeFileSync(join(outputDirectory, "index.html"), "<!doctype html><p>substitute</p>\n", "utf8");
    expect(() => verifyFounderAgentAdvantageReport(outputDirectory)).toThrow(
      /deterministic rendered artifact/u,
    );
  });

  it("rejects extra files in trial and built-report inventories", () => {
    const root = temporaryDirectory();
    const extraTrial = join(root, "trial");
    cpSync(marketplaceTrial, extraTrial, { recursive: true });
    writeFileSync(join(extraTrial, "uncommitted.txt"), "extra", "utf8");
    expect(() => loadAndVerifyFounderMarketplaceHires(extraTrial)).toThrow(
      /Unlisted evidence file/u,
    );

    const outputDirectory = join(root, "report");
    cpSync(publishedReport, outputDirectory, { recursive: true });
    writeFileSync(join(outputDirectory, "uncommitted.txt"), "extra", "utf8");
    expect(() => verifyFounderAgentAdvantageReport(outputDirectory)).toThrow(
      /Unlisted evidence file/u,
    );
  });

  it("rejects symlinked evidence even when it points to an allowlisted regular file", () => {
    const root = temporaryDirectory();
    const linkedTrial = join(root, "trial");
    cpSync(marketplaceTrial, linkedTrial, { recursive: true });
    const linkedPath = join(linkedTrial, "bounded-grid.receipt.json");
    rmSync(linkedPath);
    symlinkSync(join(marketplaceTrial, "bounded-grid.receipt.json"), linkedPath);
    expect(() => loadAndVerifyFounderMarketplaceHires(linkedTrial)).toThrow(
      /Symlink evidence is forbidden/u,
    );
  });

  it("rejects tampered marketplace trial evidence", () => {
    const root = temporaryDirectory();
    const tamperedTrial = join(root, "trial");
    cpSync(marketplaceTrial, tamperedTrial, { recursive: true });
    writeFileSync(
      join(tamperedTrial, "session.json"),
      `${readFileSync(join(tamperedTrial, "session.json"), "utf8")} `,
      "utf8",
    );
    expect(() => loadAndVerifyFounderMarketplaceHires(tamperedTrial)).toThrow(
      /checksum mismatch/u,
    );
  });

  it("rejects semantic session fabrication even with a regenerated session checksum", () => {
    const root = temporaryDirectory();
    const fabricatedTrial = join(root, "trial");
    cpSync(marketplaceTrial, fabricatedTrial, { recursive: true });
    const sessionPath = join(fabricatedTrial, "session.json");
    const session = JSON.parse(readFileSync(sessionPath, "utf8")) as {
      tasks: Array<{ apiDurationMilliseconds: number }>;
    };
    session.tasks[0]!.apiDurationMilliseconds += 1;
    writeFileSync(sessionPath, `${JSON.stringify(session, null, 2)}\n`, "utf8");
    recommitTrialSession(fabricatedTrial);
    expect(() => loadAndVerifyFounderMarketplaceHires(fabricatedTrial)).toThrow(
      /apiDurationMilliseconds/iu,
    );
  });

  it("rejects duplicate IDs, wrong commitments, duration, and cost after recomputing session checksum", () => {
    type MutableHireTask = {
      hireId: string;
      apiDurationMilliseconds: number;
      hashes: { request: string };
      commerce: { directCostUsd: string };
    };
    const mutations: Array<(tasks: MutableHireTask[]) => void> = [
      (tasks) => {
        tasks[1]!.hireId = tasks[0]!.hireId;
      },
      (tasks) => {
        tasks[0]!.hashes.request = "sha256:" + "0".repeat(64);
      },
      (tasks) => {
        tasks[2]!.apiDurationMilliseconds = 360;
      },
      (tasks) => {
        tasks[0]!.commerce.directCostUsd = "1.00";
      },
    ];

    for (const [index, mutate] of mutations.entries()) {
      const root = temporaryDirectory();
      const invalidTrial = join(root, `trial-${index}`);
      cpSync(marketplaceTrial, invalidTrial, { recursive: true });
      const sessionPath = join(invalidTrial, "session.json");
      const session = JSON.parse(readFileSync(sessionPath, "utf8")) as {
        tasks: MutableHireTask[];
      };
      mutate(session.tasks);
      writeFileSync(sessionPath, `${JSON.stringify(session, null, 2)}\n`, "utf8");
      recommitTrialSession(invalidTrial);
      expect(() => loadAndVerifyFounderMarketplaceHires(invalidTrial)).toThrow();
    }
  });

  it("rejects D1 output tampering even when its file checksum is recomputed", () => {
    const root = temporaryDirectory();
    const tamperedTrial = join(root, "trial");
    cpSync(marketplaceTrial, tamperedTrial, { recursive: true });
    const bodyPath = join(tamperedTrial, "lending-rescue.hire.json");
    const body = JSON.parse(readFileSync(bodyPath, "utf8")) as {
      receipt: { response: { result: { deliverable: { summary: string } } } };
    };
    body.receipt.response.result.deliverable.summary += " tampered";
    writeFileSync(bodyPath, `${JSON.stringify(body, null, 2)}\n`, "utf8");
    const replacementHash = createHash("sha256").update(readFileSync(bodyPath)).digest("hex");
    const checksumsPath = join(tamperedTrial, "SHA256SUMS");
    writeFileSync(
      checksumsPath,
      readFileSync(checksumsPath, "utf8").replace(
        /^[a-f0-9]{64}  lending-rescue\.hire\.json$/mu,
        `${replacementHash}  lending-rescue.hire.json`,
      ),
      "utf8",
    );
    expect(() => loadAndVerifyFounderMarketplaceHires(tamperedTrial)).toThrow();
  });

  it("rejects recomputed report hashes when derived fields are false", () => {
    const root = temporaryDirectory();
    const outputDirectory = join(root, "report");
    cpSync(publishedReport, outputDirectory, { recursive: true });
    const reportPath = join(outputDirectory, "founder-agent-advantage-report.json");
    const report = JSON.parse(readFileSync(reportPath, "utf8")) as FounderAgentAdvantageReport;
    report.tasks[0]!.recordedSpeedupMultiple = 1;
    const { reportHash: previousReportHash, ...body } = report;
    expect(previousReportHash).toMatch(/^sha256:/u);
    report.reportHash = canonicalHash(body);
    writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    expect(() => verifyFounderAgentAdvantageReport(outputDirectory)).toThrow(/Derived speedup/u);
  });

  it("rejects reordered verified-file claims even with recomputed commitments", () => {
    const root = temporaryDirectory();
    const outputDirectory = join(root, "report");
    cpSync(publishedReport, outputDirectory, { recursive: true });
    const reportPath = join(outputDirectory, "founder-agent-advantage-report.json");
    const manifestPath = join(outputDirectory, "evidence-manifest.json");
    const report = JSON.parse(readFileSync(reportPath, "utf8")) as FounderAgentAdvantageReport;
    const reordered = [...report.marketplaceHires.verifiedFiles].reverse();
    report.marketplaceHires.verifiedFiles = reordered;
    report.evidenceManifest.marketplaceHires.verifiedFiles = reordered;
    report.evidenceManifestHash = canonicalHash(report.evidenceManifest);
    const { reportHash: previousReportHash, ...body } = report;
    expect(previousReportHash).toMatch(/^sha256:/u);
    report.reportHash = canonicalHash(body);
    writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    writeFileSync(manifestPath, `${JSON.stringify(report.evidenceManifest, null, 2)}\n`, "utf8");
    writeFileSync(join(outputDirectory, "index.html"), renderFounderReportHtml(report), "utf8");
    expect(() => verifyFounderAgentAdvantageReport(outputDirectory)).toThrow(
      /canonical attached trial inventory/u,
    );
  });

  it("rejects sessions that cannot be validated against committed project assets", () => {
    const root = temporaryDirectory();
    expect(() =>
      buildFounderAgentAdvantageReport(["missing-1", "missing-2", "missing-3"], {
        projectRoot: root,
        marketplaceTrialDirectory: marketplaceTrial,
      }),
    ).toThrow();
  });

  it("requires the founder-specific publication guard and separate destination", () => {
    const root = temporaryDirectory();
    const publicEvidenceDirectory = join(root, "public-evidence");
    mkdirSync(publicEvidenceDirectory, { recursive: true });
    copyFileSync(
      join(projectRoot, "web/public/evidence/founder-agent-advantage-status.json"),
      join(publicEvidenceDirectory, "founder-agent-advantage-status.json"),
    );
    writeFileSync(
      join(publicEvidenceDirectory, "founder-agent-advantage-status.json"),
      JSON.stringify({
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
        boundary:
          "Founder-operated, non-independent, non-blind publication remains pending in this isolated test fixture.",
      }, null, 2) + "\n",
    );

    expect(() =>
      publishFounderAgentAdvantageReport(publishedReport, {
        confirmedFounderOperatedNonblind: false,
        projectRoot,
        publicEvidenceDirectory,
      }),
    ).toThrow(/confirm-founder-operated-nonblind/u);

    const status = publishFounderAgentAdvantageReport(publishedReport, {
      confirmedFounderOperatedNonblind: true,
      projectRoot,
      publicEvidenceDirectory,
      now: new Date("2026-08-20T16:05:00.000Z"),
    });
    expect(status).toMatchObject({
      status: "PUBLISHED",
      reportUrl: "/evidence/agent-advantage-founder/",
      exactOutputParityCount: 3,
      qualityScore: null,
      independent: false,
      blind: false,
    });
  });
});
