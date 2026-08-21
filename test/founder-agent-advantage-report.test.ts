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
  renderFounderReportHtml,
  verifyFounderAgentAdvantageReport,
  writeFounderAgentAdvantageReport,
} from "../src/benchmark/founder-report.js";
import { publishFounderAgentAdvantageReport } from "../src/benchmark/founder-publication.js";
import { canonicalHash } from "../src/core/canonical.js";

const projectRoot = resolve(".");
const sessions = [
  join(
    projectRoot,
    "artifacts/benchmarks/lending-rescue/lending-rescue-20260812215350546-bc4a1371",
  ),
  join(
    projectRoot,
    "artifacts/benchmarks/lp-rebalance/lp-rebalance-20260812215351113-a9d92c57",
  ),
  join(
    projectRoot,
    "artifacts/benchmarks/bounded-grid/bounded-grid-20260812215351671-fc8afdab",
  ),
];
const marketplaceTrial = join(
  projectRoot,
  "artifacts/benchmarks/founder-marketplace-hires/2026-08-20",
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
    /^[a-f0-9]{64}  \.\/session\.json$/mu,
    `${replacementHash}  ./session.json`,
  );
  writeFileSync(checksumsPath, checksums, "utf8");
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("founder-operated agent advantage report", () => {
  it("binds all three exact-equal candidate sets to the public trial timing", () => {
    const report = buildFounderAgentAdvantageReport(sessions, {
      projectRoot,
      marketplaceTrialDirectory: marketplaceTrial,
      now: new Date("2026-08-20T16:00:00.000Z"),
    });

    expect(report.comparisonMode).toBe("FOUNDER_OPERATED_NON_INDEPENDENT_NON_BLIND");
    expect(report.independent).toBe(false);
    expect(report.blind).toBe(false);
    expect(report.qualityScore).toBeNull();
    expect(report.summary).toMatchObject({
      taskCount: 3,
      exactOutputParityCount: 3,
      recordedSpeedAdvantageCount: 3,
      directCostUsd: "0",
      marketplaceEvidenceStatus: "PARTIAL",
    });
    expect(report.tasks.map((task) => task.agent.officialElapsedMilliseconds)).toEqual([
      1758,
      2131,
      257,
    ]);
    expect(report.tasks.map((task) => task.manual.elapsedMilliseconds)).toEqual([
      356626,
      94612,
      28834,
    ]);
    expect(report.tasks[2]?.marketplace.trialModeEvidence).toBe("UI_MODE_CONTRADICTION");
    expect(report.tasks[2]?.marketplace.journey).toBe("FOUNDER_PUBLIC_WORKSPACE_COMPARISON");
    expect(report.marketplaceTrial.session.tasks).toMatchObject([
      { benchmarkSlug: "lending-rescue", evidenceMode: "LOCKED_HISTORICAL_FIXTURE_REPLAY" },
      { benchmarkSlug: "lp-rebalance", evidenceMode: "LOCKED_HISTORICAL_FIXTURE_REPLAY" },
      {
        benchmarkSlug: "bounded-grid",
        evidenceMode: "UI_MODE_CONTRADICTION",
        interactiveSourceBlock: 117066790,
      },
    ]);
    expect("interactiveSourceBlock" in report.marketplaceTrial.session.tasks[0]!).toBe(false);
    expect("interactiveSourceBlock" in report.marketplaceTrial.session.tasks[1]!).toBe(false);
    for (const task of report.tasks) {
      expect(task.marketplace).toMatchObject({
        evidenceStatus: "PARTIAL",
        hireProven: false,
        externalBuyer: false,
        uniqueServerHire: false,
        paid: false,
        freshExecutionProven: false,
      });
      expect(task.quality.qualityScore).toBeNull();
      expect(task.manual.outputHash).toBe(task.agent.runs[0]?.outputHash);
      expect(task.manual.outputHash).toBe(task.agent.runs[1]?.outputHash);
      expect(task.manual.outputHash).toBe(task.marketplace.deliverableHash);
    }
  });

  it("writes and verifies a self-contained immutable report", () => {
    const root = temporaryDirectory();
    const outputDirectory = join(root, "report");
    const written = writeFounderAgentAdvantageReport(sessions, {
      outputDirectory,
      projectRoot,
      marketplaceTrialDirectory: marketplaceTrial,
      now: new Date("2026-08-20T16:00:00.000Z"),
    });
    const verified = verifyFounderAgentAdvantageReport(outputDirectory);
    expect(verified.reportHash).toBe(written.report.reportHash);
    expect(verified.evidenceManifestHash).toBe(written.report.evidenceManifestHash);
  });

  it("rejects arbitrary or modified deterministic HTML", () => {
    const root = temporaryDirectory();
    const outputDirectory = join(root, "report");
    writeFounderAgentAdvantageReport(sessions, {
      outputDirectory,
      projectRoot,
      marketplaceTrialDirectory: marketplaceTrial,
    });
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
    expect(() =>
      buildFounderAgentAdvantageReport(sessions, {
        projectRoot,
        marketplaceTrialDirectory: extraTrial,
      }),
    ).toThrow(/Unlisted evidence file/u);

    const outputDirectory = join(root, "report");
    writeFounderAgentAdvantageReport(sessions, {
      outputDirectory,
      projectRoot,
      marketplaceTrialDirectory: marketplaceTrial,
    });
    writeFileSync(join(outputDirectory, "uncommitted.txt"), "extra", "utf8");
    expect(() => verifyFounderAgentAdvantageReport(outputDirectory)).toThrow(
      /Unlisted evidence file/u,
    );
  });

  it("rejects symlinked evidence even when it points to an allowlisted regular file", () => {
    const root = temporaryDirectory();
    const linkedTrial = join(root, "trial");
    cpSync(marketplaceTrial, linkedTrial, { recursive: true });
    const linkedPath = join(linkedTrial, "bounded-grid/result.png");
    rmSync(linkedPath);
    symlinkSync(join(marketplaceTrial, "bounded-grid/result.png"), linkedPath);
    expect(() =>
      buildFounderAgentAdvantageReport(sessions, {
        projectRoot,
        marketplaceTrialDirectory: linkedTrial,
      }),
    ).toThrow(/Symlink evidence is forbidden/u);
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
    expect(() =>
      buildFounderAgentAdvantageReport(sessions, {
        projectRoot,
        marketplaceTrialDirectory: tamperedTrial,
      }),
    ).toThrow(/checksum mismatch/u);
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
    expect(() =>
      buildFounderAgentAdvantageReport(sessions, {
        projectRoot,
        marketplaceTrialDirectory: fabricatedTrial,
      }),
    ).toThrow(/duration/u);
  });

  it("rejects missing, wrong, and cross-task evidence mode combinations", () => {
    type MutableTrialTask = {
      benchmarkSlug: string;
      evidenceMode?: string;
      interactiveSourceBlock?: number;
    };
    const mutations: Array<(tasks: MutableTrialTask[]) => void> = [
      (tasks) => {
        delete tasks[2]!.interactiveSourceBlock;
      },
      (tasks) => {
        tasks[2]!.interactiveSourceBlock = 117066791;
      },
      (tasks) => {
        tasks[0]!.evidenceMode = "UI_MODE_CONTRADICTION";
      },
      (tasks) => {
        tasks[1]!.interactiveSourceBlock = 117066790;
      },
    ];

    for (const [index, mutate] of mutations.entries()) {
      const root = temporaryDirectory();
      const invalidTrial = join(root, `trial-${index}`);
      cpSync(marketplaceTrial, invalidTrial, { recursive: true });
      const sessionPath = join(invalidTrial, "session.json");
      const session = JSON.parse(readFileSync(sessionPath, "utf8")) as {
        tasks: MutableTrialTask[];
      };
      mutate(session.tasks);
      writeFileSync(sessionPath, `${JSON.stringify(session, null, 2)}\n`, "utf8");
      recommitTrialSession(invalidTrial);
      expect(() =>
        buildFounderAgentAdvantageReport(sessions, {
          projectRoot,
          marketplaceTrialDirectory: invalidTrial,
        }),
      ).toThrow();
    }
  });

  it("rejects recomputed report hashes when derived fields are false", () => {
    const root = temporaryDirectory();
    const outputDirectory = join(root, "report");
    writeFounderAgentAdvantageReport(sessions, {
      outputDirectory,
      projectRoot,
      marketplaceTrialDirectory: marketplaceTrial,
    });
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
    writeFounderAgentAdvantageReport(sessions, {
      outputDirectory,
      projectRoot,
      marketplaceTrialDirectory: marketplaceTrial,
    });
    const reportPath = join(outputDirectory, "founder-agent-advantage-report.json");
    const manifestPath = join(outputDirectory, "evidence-manifest.json");
    const report = JSON.parse(readFileSync(reportPath, "utf8")) as FounderAgentAdvantageReport;
    const reordered = [...report.marketplaceTrial.verifiedFiles].reverse();
    report.marketplaceTrial.verifiedFiles = reordered;
    report.evidenceManifest.marketplaceTrial.verifiedFiles = reordered;
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
      buildFounderAgentAdvantageReport(sessions, {
        projectRoot: root,
        marketplaceTrialDirectory: marketplaceTrial,
      }),
    ).toThrow();
  });

  it("requires the founder-specific publication guard and separate destination", () => {
    const root = temporaryDirectory();
    const outputDirectory = join(root, "report");
    const publicEvidenceDirectory = join(root, "public-evidence");
    writeFounderAgentAdvantageReport(sessions, {
      outputDirectory,
      projectRoot,
      marketplaceTrialDirectory: marketplaceTrial,
      now: new Date("2026-08-20T16:00:00.000Z"),
    });
    mkdirSync(publicEvidenceDirectory, { recursive: true });
    copyFileSync(
      join(projectRoot, "web/public/evidence/founder-agent-advantage-status.json"),
      join(publicEvidenceDirectory, "founder-agent-advantage-status.json"),
    );

    expect(() =>
      publishFounderAgentAdvantageReport(outputDirectory, {
        confirmedFounderOperatedNonblind: false,
        projectRoot,
        publicEvidenceDirectory,
      }),
    ).toThrow(/confirm-founder-operated-nonblind/u);

    const status = publishFounderAgentAdvantageReport(outputDirectory, {
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
