import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { z } from "zod";
import { PositionCrewDeliverableSchema } from "../contracts/index.js";
import { HashSchema, TimestampSchema } from "../contracts/common.js";
import { canonicalHash } from "../core/canonical.js";
import {
  MANUAL_INDEPENDENCE_ATTESTATION,
  loadFounderComparisonEvidence,
} from "./evidence.js";

export const FOUNDER_REPORT_SCHEMA_VERSION =
  "positioncrew.founder-agent-advantage-report.v1" as const;
export const FOUNDER_REPORT_FILENAME = "founder-agent-advantage-report.json" as const;
export const FOUNDER_EVIDENCE_MANIFEST_FILENAME = "evidence-manifest.json" as const;
export const FOUNDER_REPORT_INDEX_FILENAME = "index.html" as const;
export const FOUNDER_COMPARISON_MODE =
  "FOUNDER_OPERATED_NON_INDEPENDENT_NON_BLIND" as const;
export const FOUNDER_QUALITY_METHOD = "CANONICAL_EXACT_OUTPUT_PARITY" as const;
export const FOUNDER_MARKETPLACE_JOURNEY =
  "FOUNDER_PUBLIC_WORKSPACE_COMPARISON" as const;

export const FOUNDER_CLAIM_BOUNDARY = [
  "This is a founder-operated, self-attested, non-independent, non-blind comparison on three frozen historical fixtures.",
  "Canonical exact-output parity proves only that the attached candidates serialize to identical committed outputs; no independent quality score is claimed.",
  "The attached public-workspace trial evidence is PARTIAL and does not prove an external buyer or a completed marketplace hire.",
  "Lending rescue and LP rebalance show locked-receipt observations; Bounded Grid has an interactive-UI versus locked-historical-result contradiction and is not classified as conclusively fresh or locked.",
  "This report does not claim a paid hire, unique server-persisted hire, settlement, demand, revenue, or external customer activity.",
  "The fixtures and outputs are historical research evidence, not live executable advice, mainnet execution, investment performance, or a recommendation to trade.",
] as const;

const BenchmarkSlugSchema = z.enum([
  "lending-rescue",
  "lp-rebalance",
  "bounded-grid",
]);
type BenchmarkSlug = z.infer<typeof BenchmarkSlugSchema>;

const TASK_DEFINITIONS: Record<
  BenchmarkSlug,
  {
    sessionId: string;
    title: string;
    category: string;
    highStakesReason: string;
    trialModeEvidence: "LOCKED_RECEIPT_OBSERVED" | "UI_MODE_CONTRADICTION";
  }
> = {
  "lending-rescue": {
    sessionId: "lending-rescue-20260812215350546-bc4a1371",
    title: "Bounded lending-position rescue",
    category: "Lending risk",
    highStakesReason: "A malformed rescue plan can worsen liquidation risk.",
    trialModeEvidence: "LOCKED_RECEIPT_OBSERVED",
  },
  "lp-rebalance": {
    sessionId: "lp-rebalance-20260812215351113-a9d92c57",
    title: "Bounded concentrated-liquidity rebalance",
    category: "Liquidity management",
    highStakesReason: "Incorrect ranges or constraints can increase capital loss.",
    trialModeEvidence: "LOCKED_RECEIPT_OBSERVED",
  },
  "bounded-grid": {
    sessionId: "bounded-grid-20260812215351671-fc8afdab",
    title: "Bounded BNB-USDT grid construction",
    category: "Trading controls",
    highStakesReason: "Unsafe grid parameters can create uncontrolled inventory exposure.",
    trialModeEvidence: "UI_MODE_CONTRADICTION",
  },
};

const TASK_ORDER: BenchmarkSlug[] = [
  "lending-rescue",
  "lp-rebalance",
  "bounded-grid",
];

const TRIAL_TASK_FILENAMES = [
  "result.dom.txt",
  "json.dom.txt",
  "receipt.dom.txt",
  "public-receipt.json",
  "public-receipt.headers",
  "result.png",
] as const;

export const FOUNDER_TRIAL_ALLOWED_FILES = [
  "SHA256SUMS",
  "session.json",
  "job-history.dom.txt",
  "job-history.png",
  ...TASK_ORDER.flatMap((slug) =>
    TRIAL_TASK_FILENAMES.map((filename) => `${slug}/${filename}`),
  ),
] as string[];

const Sha256HexSchema = z.string().regex(/^[a-f0-9]{64}$/);

const MarketplaceTrialTaskCommonShape = {
    jobId: z.string().min(8),
    clientHistoryTimeLocal: z.string().min(20),
    apiDurationMilliseconds: z.number().int().min(1),
    deliverableHash: HashSchema,
    scoreReceiptHash: HashSchema,
} as const;

const MarketplaceTrialTaskSchema = z.discriminatedUnion("benchmarkSlug", [
  z
    .object({
      benchmarkSlug: z.literal("lending-rescue"),
      evidenceMode: z.literal("LOCKED_HISTORICAL_FIXTURE_REPLAY"),
      ...MarketplaceTrialTaskCommonShape,
    })
    .strict(),
  z
    .object({
      benchmarkSlug: z.literal("lp-rebalance"),
      evidenceMode: z.literal("LOCKED_HISTORICAL_FIXTURE_REPLAY"),
      ...MarketplaceTrialTaskCommonShape,
    })
    .strict(),
  z
    .object({
      benchmarkSlug: z.literal("bounded-grid"),
      evidenceMode: z.literal("UI_MODE_CONTRADICTION"),
      interactiveSourceBlock: z.literal(117066790),
      ...MarketplaceTrialTaskCommonShape,
    })
    .strict(),
]);

export const FounderMarketplaceTrialSessionSchema = z
  .object({
    schemaVersion: z.literal("positioncrew.founder-marketplace-trial-session.v1"),
    capturedAt: TimestampSchema,
    origin: z.string().url(),
    operatorRole: z.literal("FOUNDER"),
    comparisonMode: z.literal(FOUNDER_COMPARISON_MODE),
    payment: z
      .object({
        walletUsed: z.literal(false),
        tokenTransferred: z.literal(false),
        directCostUsd: z.literal("0"),
        mode: z.literal("NO_WALLET_FREE_TRIAL"),
      })
      .strict(),
    tasks: z.array(MarketplaceTrialTaskSchema).length(3),
    claimBoundary: z.array(z.string().min(20)).min(4),
  })
  .strict();

const VerifiedFileSchema = z
  .object({
    path: z.string().min(1),
    sha256: HashSchema,
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

const PublicReceiptSchema = z
  .object({
    schemaVersion: z.literal("positioncrew.public-receipt.v1"),
    publishedAt: TimestampSchema,
    receiptHash: HashSchema,
    deliverable: PositionCrewDeliverableSchema,
    job: z
      .object({
        jobId: z.string().min(8),
        state: z.literal("COMPLETED"),
        deliverable: z
          .object({ deliverableHash: HashSchema })
          .passthrough(),
        evaluation: z
          .object({
            deliverableHash: HashSchema,
            evaluationHash: HashSchema,
            passed: z.literal(true),
          })
          .passthrough(),
      })
      .passthrough(),
    evaluation: z
      .object({
        deliverableHash: HashSchema,
        evaluationHash: HashSchema,
        passed: z.literal(true),
      })
      .passthrough(),
  })
  .passthrough();

const AttachedCandidateSchema = z
  .object({
    candidateHash: HashSchema,
    outputHash: HashSchema,
    output: PositionCrewDeliverableSchema,
    capturedAt: TimestampSchema,
    localFixtureElapsedMilliseconds: z.number().int().min(1),
    directCostUsd: z.literal("0"),
  })
  .strict();

const FounderTaskComparisonSchema = z
  .object({
    benchmarkSlug: BenchmarkSlugSchema,
    taskId: z.string().min(8),
    sessionId: z.string().min(12),
    title: z.string().min(3),
    category: z.string().min(3),
    highStakesReason: z.string().min(20),
    benchmarkLock: BenchmarkLockSchema,
    manual: z
      .object({
        operatorId: z.string().min(2),
        contactReference: z.string().min(3),
        method: z.string().min(10),
        toolExclusionAttestation: z.literal(MANUAL_INDEPENDENCE_ATTESTATION),
        candidateHash: HashSchema,
        outputHash: HashSchema,
        output: PositionCrewDeliverableSchema,
        elapsedMilliseconds: z.number().int().min(1),
        directCostUsd: z.literal("0"),
        capturedAt: TimestampSchema,
      })
      .strict(),
    agent: z
      .object({
        providerId: z.string().min(1),
        officialTimingSource: z.literal("PUBLIC_NO_WALLET_TRIAL_API_DURATION"),
        officialElapsedMilliseconds: z.number().int().min(1),
        directCostUsd: z.literal("0"),
        runs: z.array(AttachedCandidateSchema).length(2),
      })
      .strict(),
    quality: z
      .object({
        method: z.literal(FOUNDER_QUALITY_METHOD),
        exactCanonicalParity: z.literal(true),
        qualityScore: z.null(),
        verdict: z.literal("IDENTICAL_CANONICAL_OUTPUT"),
      })
      .strict(),
    recordedSpeedupMultiple: z.number().positive(),
    recordedEfficiencyAdvantageSupported: z.boolean(),
    marketplace: z
      .object({
        evidenceStatus: z.literal("PARTIAL"),
        journey: z.literal(FOUNDER_MARKETPLACE_JOURNEY),
        trialModeEvidence: z.enum([
          "LOCKED_RECEIPT_OBSERVED",
          "UI_MODE_CONTRADICTION",
        ]),
        jobId: z.string().min(8),
        clientHistoryTimeLocal: z.string().min(20),
        deliverableHash: HashSchema,
        scoreReceiptHash: HashSchema,
        hireProven: z.literal(false),
        externalBuyer: z.literal(false),
        uniqueServerHire: z.literal(false),
        paid: z.literal(false),
        freshExecutionProven: z.literal(false),
      })
      .strict(),
  })
  .strict();

export const FounderEvidenceManifestSchema = z
  .object({
    schemaVersion: z.literal("positioncrew.founder-agent-advantage-evidence-manifest.v1"),
    marketplaceTrial: z
      .object({
        sessionHash: HashSchema,
        checksumsHash: HashSchema,
        verifiedFiles: z.array(VerifiedFileSchema).min(1),
      })
      .strict(),
    candidates: z
      .array(
        z
          .object({
            benchmarkSlug: BenchmarkSlugSchema,
            sessionId: z.string().min(12),
            manualCandidateHash: HashSchema,
            agentCandidateHashes: z.array(HashSchema).length(2),
          })
          .strict(),
      )
      .length(3),
  })
  .strict();

const FounderReportBodySchema = z
  .object({
    schemaVersion: z.literal(FOUNDER_REPORT_SCHEMA_VERSION),
    title: z.literal("TermiX Agent Advantage Report: Founder-Operated Comparison"),
    generatedAt: TimestampSchema,
    comparisonMode: z.literal(FOUNDER_COMPARISON_MODE),
    qualityMethod: z.literal(FOUNDER_QUALITY_METHOD),
    qualityScore: z.null(),
    independent: z.literal(false),
    blind: z.literal(false),
    evaluator: z.null(),
    manualOperatorIndependent: z.literal(false),
    manualRunsPerTask: z.literal(1),
    agentRunsPerTask: z.literal(2),
    sameFounderAcrossTasks: z.literal(true),
    rubricCommittedBeforeCandidates: z.literal(true),
    marketplaceEvidenceStatus: z.literal("PARTIAL"),
    marketplaceTrial: z
      .object({
        session: FounderMarketplaceTrialSessionSchema,
        sessionHash: HashSchema,
        checksumsHash: HashSchema,
        verifiedFiles: z.array(VerifiedFileSchema).min(1),
      })
      .strict(),
    tasks: z.array(FounderTaskComparisonSchema).length(3),
    summary: z
      .object({
        taskCount: z.literal(3),
        exactOutputParityCount: z.number().int().min(0).max(3),
        recordedSpeedAdvantageCount: z.number().int().min(0).max(3),
        directCostUsd: z.literal("0"),
        marketplaceEvidenceStatus: z.literal("PARTIAL"),
      })
      .strict(),
    evidenceManifest: FounderEvidenceManifestSchema,
    evidenceManifestHash: HashSchema,
    claimBoundary: z.array(z.string().min(20)).length(FOUNDER_CLAIM_BOUNDARY.length),
  })
  .strict();

export const FounderAgentAdvantageReportSchema = FounderReportBodySchema.extend({
  reportHash: HashSchema,
}).strict();

export type FounderMarketplaceTrialSession = z.infer<
  typeof FounderMarketplaceTrialSessionSchema
>;
export type FounderEvidenceManifest = z.infer<typeof FounderEvidenceManifestSchema>;
export type FounderAgentAdvantageReport = z.infer<
  typeof FounderAgentAdvantageReportSchema
>;

interface VerifiedMarketplaceTrial {
  directory: string;
  session: FounderMarketplaceTrialSession;
  sessionHash: string;
  checksumsHash: string;
  verifiedFiles: Array<{ path: string; sha256: string }>;
}

export interface BuildFounderReportOptions {
  projectRoot?: string;
  marketplaceTrialDirectory?: string;
  now?: Date;
}

export interface WriteFounderReportOptions extends BuildFounderReportOptions {
  outputDirectory: string;
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

function prettyJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function fileHash(path: string): string {
  return `sha256:${createHash("sha256").update(readFileSync(path)).digest("hex")}`;
}

function contentHash(value: string): string {
  return `sha256:${createHash("sha256").update(Buffer.from(value, "utf8")).digest("hex")}`;
}

function reportBody(report: FounderAgentAdvantageReport): z.infer<typeof FounderReportBodySchema> {
  const { reportHash: _reportHash, ...body } = report;
  return body;
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function canonicalVerifiedFiles(
  files: ReadonlyArray<{ path: string; sha256: string }>,
): Array<{ path: string; sha256: string }> {
  return files
    .map((file) => ({ path: file.path, sha256: file.sha256 }))
    .sort((left, right) => left.path.localeCompare(right.path));
}

function requireExactVerifiedFiles(
  claimed: ReadonlyArray<{ path: string; sha256: string }>,
  attached: ReadonlyArray<{ path: string; sha256: string }>,
): void {
  const canonicalAttached = canonicalVerifiedFiles(attached);
  if (
    canonicalHash(claimed) !== canonicalHash(canonicalAttached) ||
    claimed.some(
      (file, index) =>
        file.path !== canonicalAttached[index]?.path ||
        file.sha256 !== canonicalAttached[index]?.sha256,
    )
  ) {
    throw new Error(
      "Founder report verified-file inventory differs from the canonical attached trial inventory",
    );
  }
}

function defaultMarketplaceTrialDirectory(projectRoot: string): string {
  return join(
    projectRoot,
    "artifacts",
    "benchmarks",
    "founder-marketplace-hires",
    "2026-08-20",
  );
}

function allowedDirectories(allowedFiles: readonly string[]): Set<string> {
  const directories = new Set<string>();
  for (const file of allowedFiles) {
    const parts = file.split("/");
    parts.pop();
    while (parts.length > 0) {
      directories.add(parts.join("/"));
      parts.pop();
    }
  }
  return directories;
}

export function assertClosedRegularFileSet(
  rootInput: string,
  allowedFilesInput: readonly string[],
): string[] {
  const root = resolve(rootInput);
  const rootStat = lstatSync(root);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw new Error(`Evidence root must be a real directory: ${root}`);
  }
  const realRoot = realpathSync(root);
  const allowedFiles = new Set(allowedFilesInput);
  const directories = allowedDirectories(allowedFilesInput);
  const discovered: string[] = [];

  const walk = (directory: string, prefix: string): void => {
    for (const name of readdirSync(directory).sort()) {
      const relativePath = prefix ? `${prefix}/${name}` : name;
      const path = join(directory, name);
      const stat = lstatSync(path);
      if (stat.isSymbolicLink()) throw new Error(`Symlink evidence is forbidden: ${relativePath}`);
      const realPath = realpathSync(path);
      if (realPath !== realRoot && !realPath.startsWith(`${realRoot}${sep}`)) {
        throw new Error(`Evidence path escapes its root: ${relativePath}`);
      }
      if (stat.isDirectory()) {
        if (!directories.has(relativePath)) {
          throw new Error(`Unlisted evidence directory: ${relativePath}`);
        }
        walk(path, relativePath);
      } else if (stat.isFile()) {
        if (!allowedFiles.has(relativePath)) {
          throw new Error(`Unlisted evidence file: ${relativePath}`);
        }
        discovered.push(relativePath);
      } else {
        throw new Error(`Evidence path is not a regular file or directory: ${relativePath}`);
      }
    }
  };

  walk(root, "");
  for (const allowedFile of allowedFiles) {
    if (!discovered.includes(allowedFile)) {
      throw new Error(`Required evidence file is missing: ${allowedFile}`);
    }
  }
  if (discovered.length !== allowedFiles.size) {
    throw new Error("Evidence file inventory is not closed");
  }
  return discovered.sort();
}

export function copyAllowlistedRegularFiles(
  sourceInput: string,
  destinationInput: string,
  allowedFiles: readonly string[],
): void {
  const source = resolve(sourceInput);
  const destination = resolve(destinationInput);
  const files = assertClosedRegularFileSet(source, allowedFiles);
  if (existsSync(destination)) throw new Error(`Copy destination already exists: ${destination}`);
  mkdirSync(destination, { recursive: true, mode: 0o755 });
  try {
    for (const relativePath of files) {
      const sourcePath = join(source, relativePath);
      const destinationPath = join(destination, relativePath);
      const stat = lstatSync(sourcePath);
      if (stat.isSymbolicLink() || !stat.isFile()) {
        throw new Error(`Copy source is not a regular file: ${relativePath}`);
      }
      mkdirSync(dirname(destinationPath), { recursive: true, mode: 0o755 });
      copyFileSync(sourcePath, destinationPath);
    }
    assertClosedRegularFileSet(destination, allowedFiles);
  } catch (error) {
    rmSync(destination, { recursive: true, force: true });
    throw error;
  }
}

export function founderReportAllowedFiles(): string[] {
  return [
    FOUNDER_REPORT_FILENAME,
    FOUNDER_EVIDENCE_MANIFEST_FILENAME,
    FOUNDER_REPORT_INDEX_FILENAME,
    ...FOUNDER_TRIAL_ALLOWED_FILES.map((file) => `marketplace-trial/${file}`),
  ];
}

function requireText(haystack: string, needle: string, description: string): void {
  if (!haystack.includes(needle)) {
    throw new Error(`Marketplace semantic evidence mismatch: ${description}`);
  }
}

function validateMarketplaceTrialSemantics(
  directory: string,
  session: FounderMarketplaceTrialSession,
): void {
  const historyDom = readFileSync(join(directory, "job-history.dom.txt"), "utf8");
  for (const task of session.tasks) {
    const taskDirectory = join(directory, task.benchmarkSlug);
    const resultDom = readFileSync(join(taskDirectory, "result.dom.txt"), "utf8");
    const jsonDom = readFileSync(join(taskDirectory, "json.dom.txt"), "utf8");
    const receiptDom = readFileSync(join(taskDirectory, "receipt.dom.txt"), "utf8");
    const headers = readFileSync(join(taskDirectory, "public-receipt.headers"), "utf8");
    const publicReceipt = PublicReceiptSchema.parse(
      readJson(join(taskDirectory, "public-receipt.json")),
    );
    const durationText = `${task.apiDurationMilliseconds} ms API`;
    const localTime = task.clientHistoryTimeLocal.slice(11, 19);
    const abbreviatedJobId = `${task.jobId.slice(0, 14)}...${task.jobId.slice(-8)}`;

    if (!/^HTTP\/(?:1\.1|2|3) 200(?:\s|$)/u.test(headers)) {
      throw new Error(`Marketplace public receipt HTTP success is missing: ${task.benchmarkSlug}`);
    }
    if (!/^content-type:\s*application\/json\b/imu.test(headers)) {
      throw new Error(`Marketplace public receipt content type is invalid: ${task.benchmarkSlug}`);
    }
    if (
      publicReceipt.job.jobId !== task.jobId ||
      publicReceipt.receiptHash !== task.scoreReceiptHash ||
      publicReceipt.job.deliverable.deliverableHash !== task.deliverableHash ||
      publicReceipt.job.evaluation.deliverableHash !== task.deliverableHash ||
      publicReceipt.job.evaluation.evaluationHash !== task.scoreReceiptHash ||
      publicReceipt.evaluation.deliverableHash !== task.deliverableHash ||
      publicReceipt.evaluation.evaluationHash !== task.scoreReceiptHash ||
      canonicalHash(publicReceipt.deliverable) !== task.deliverableHash
    ) {
      throw new Error(`Marketplace public receipt semantics differ from session: ${task.benchmarkSlug}`);
    }

    for (const [dom, label] of [
      [resultDom, "result DOM"],
      [jsonDom, "JSON DOM"],
      [receiptDom, "receipt DOM"],
    ] as const) {
      requireText(dom, durationText, `${task.benchmarkSlug} ${label} duration`);
    }
    requireText(receiptDom, task.jobId, `${task.benchmarkSlug} receipt job ID`);
    requireText(receiptDom, task.deliverableHash, `${task.benchmarkSlug} receipt deliverable hash`);
    requireText(receiptDom, task.scoreReceiptHash, `${task.benchmarkSlug} receipt score hash`);
    requireText(jsonDom, publicReceipt.deliverable.schemaVersion, `${task.benchmarkSlug} JSON schema`);
    requireText(jsonDom, publicReceipt.deliverable.requestId, `${task.benchmarkSlug} JSON request ID`);
    requireText(historyDom, localTime, `${task.benchmarkSlug} local history time`);
    requireText(historyDom, abbreviatedJobId, `${task.benchmarkSlug} local history job ID`);

    if (task.benchmarkSlug === "bounded-grid") {
      requireText(resultDom, 'button "Interactive" [pressed]', "grid interactive UI mode");
      requireText(resultDom, "Locked historical fixture", "grid locked historical result");
      const formattedSourceBlock = String(task.interactiveSourceBlock).replace(
        /\B(?=(\d{3})+(?!\d))/gu,
        ",",
      );
      requireText(resultDom, `Block ${formattedSourceBlock}`, "grid fresh block probe");
      if (!publicReceipt.deliverable.generatedAt.startsWith("2026-08-12T")) {
        throw new Error("Grid contradiction lacks the committed historical deliverable timestamp");
      }
    } else {
      requireText(resultDom, 'button "Locked receipt" [pressed]', `${task.benchmarkSlug} locked UI mode`);
      requireText(resultDom, "Locked historical fixture", `${task.benchmarkSlug} locked result mode`);
    }
  }
}

export function loadAndVerifyFounderMarketplaceTrial(
  directoryInput: string,
): VerifiedMarketplaceTrial {
  const directory = resolve(directoryInput);
  assertClosedRegularFileSet(directory, FOUNDER_TRIAL_ALLOWED_FILES);
  const checksumsPath = join(directory, "SHA256SUMS");
  const sessionPath = join(directory, "session.json");
  if (!existsSync(checksumsPath) || !existsSync(sessionPath)) {
    throw new Error("Founder comparison requires marketplace trial session.json and SHA256SUMS");
  }

  const lines = readFileSync(checksumsPath, "utf8")
    .trim()
    .split(/\r?\n/u)
    .filter(Boolean);
  const seen = new Set<string>();
  const verifiedFiles = lines.map((line) => {
    const match = /^([a-f0-9]{64})  \.\/(.+)$/u.exec(line);
    if (!match) throw new Error(`Invalid SHA256SUMS entry: ${line}`);
    const expectedHex = match[1];
    const relativePath = match[2];
    if (!expectedHex || !relativePath) {
      throw new Error(`Incomplete SHA256SUMS entry: ${line}`);
    }
    const parsedHex = Sha256HexSchema.parse(expectedHex);
    if (seen.has(relativePath)) throw new Error(`Duplicate SHA256SUMS path: ${relativePath}`);
    seen.add(relativePath);
    const absolutePath = resolve(directory, relativePath);
    if (absolutePath !== directory && !absolutePath.startsWith(`${directory}${sep}`)) {
      throw new Error(`SHA256SUMS path escapes marketplace trial directory: ${relativePath}`);
    }
    if (!existsSync(absolutePath)) throw new Error(`Missing marketplace evidence: ${relativePath}`);
    const actualHash = fileHash(absolutePath);
    const expectedHash = `sha256:${parsedHex}`;
    if (actualHash !== expectedHash) {
      throw new Error(`Marketplace evidence checksum mismatch: ${relativePath}`);
    }
    return { path: relativePath, sha256: expectedHash };
  });

  const expectedChecksummedFiles = FOUNDER_TRIAL_ALLOWED_FILES.filter(
    (path) => path !== "SHA256SUMS",
  );
  if (
    verifiedFiles.length !== expectedChecksummedFiles.length ||
    expectedChecksummedFiles.some((path) => !seen.has(path))
  ) {
    throw new Error("SHA256SUMS does not exactly cover the allowlisted marketplace evidence");
  }

  const sessionHash = fileHash(sessionPath);
  const committedSession = verifiedFiles.find((file) => file.path === "session.json");
  if (!committedSession || committedSession.sha256 !== sessionHash) {
    throw new Error("SHA256SUMS does not commit the marketplace trial session.json");
  }

  const session = FounderMarketplaceTrialSessionSchema.parse(readJson(sessionPath));
  const slugs = session.tasks.map((task) => task.benchmarkSlug);
  if (!sameStrings(slugs, TASK_ORDER)) {
    throw new Error("Marketplace trial tasks are not in the frozen benchmark order");
  }
  validateMarketplaceTrialSemantics(directory, session);

  return {
    directory,
    session,
    sessionHash,
    checksumsHash: fileHash(checksumsPath),
    verifiedFiles: canonicalVerifiedFiles(verifiedFiles),
  };
}

export function validateFounderReport(
  report: FounderAgentAdvantageReport,
  renderedHtml?: string,
): void {
  if (canonicalHash(reportBody(report)) !== report.reportHash) {
    throw new Error("Founder report hash is invalid");
  }
  if (canonicalHash(report.evidenceManifest) !== report.evidenceManifestHash) {
    throw new Error("Founder evidence manifest hash is invalid");
  }
  if (!sameStrings(report.claimBoundary, FOUNDER_CLAIM_BOUNDARY)) {
    throw new Error("Founder report claim boundary is not the required bounded disclosure");
  }
  if (!sameStrings(report.tasks.map((task) => task.benchmarkSlug), TASK_ORDER)) {
    throw new Error("Founder report tasks are not in the frozen benchmark order");
  }

  const firstTask = report.tasks[0];
  if (
    !firstTask ||
    report.tasks.some(
      (task) =>
        task.manual.operatorId !== firstTask.manual.operatorId ||
        task.manual.contactReference !== firstTask.manual.contactReference,
    )
  ) {
    throw new Error("Founder identity is inconsistent across report tasks");
  }

  for (const task of report.tasks) {
    const definition = TASK_DEFINITIONS[task.benchmarkSlug];
    const trial = report.marketplaceTrial.session.tasks.find(
      (candidate) => candidate.benchmarkSlug === task.benchmarkSlug,
    );
    if (!trial) throw new Error(`Missing marketplace trial for ${task.benchmarkSlug}`);
    if (
      task.sessionId !== definition.sessionId ||
      task.title !== definition.title ||
      task.category !== definition.category ||
      task.highStakesReason !== definition.highStakesReason
    ) {
      throw new Error(`Frozen task metadata is invalid for ${task.benchmarkSlug}`);
    }
    const hashes = [
      task.manual.outputHash,
      task.agent.runs[0]?.outputHash,
      task.agent.runs[1]?.outputHash,
      trial.deliverableHash,
    ];
    if (hashes.some((hash) => hash !== task.manual.outputHash)) {
      throw new Error(`Canonical output parity is false for ${task.benchmarkSlug}`);
    }
    if (canonicalHash(task.manual.output) !== task.manual.outputHash) {
      throw new Error(`Manual output attachment is invalid for ${task.benchmarkSlug}`);
    }
    for (const run of task.agent.runs) {
      if (canonicalHash(run.output) !== run.outputHash) {
        throw new Error(`Agent output attachment is invalid for ${task.benchmarkSlug}`);
      }
    }
    if (task.agent.officialElapsedMilliseconds !== trial.apiDurationMilliseconds) {
      throw new Error(`Official agent-arm timing is invalid for ${task.benchmarkSlug}`);
    }
    const expectedSpeedup = Number(
      (task.manual.elapsedMilliseconds / trial.apiDurationMilliseconds).toFixed(6),
    );
    const expectedEfficiency = task.manual.elapsedMilliseconds > trial.apiDurationMilliseconds;
    if (task.recordedSpeedupMultiple !== expectedSpeedup) {
      throw new Error(`Derived speedup is invalid for ${task.benchmarkSlug}`);
    }
    if (task.recordedEfficiencyAdvantageSupported !== expectedEfficiency) {
      throw new Error(`Derived efficiency result is invalid for ${task.benchmarkSlug}`);
    }
    if (
      task.marketplace.trialModeEvidence !== definition.trialModeEvidence ||
      task.marketplace.journey !== FOUNDER_MARKETPLACE_JOURNEY ||
      task.marketplace.jobId !== trial.jobId ||
      task.marketplace.clientHistoryTimeLocal !== trial.clientHistoryTimeLocal ||
      task.marketplace.deliverableHash !== trial.deliverableHash ||
      task.marketplace.scoreReceiptHash !== trial.scoreReceiptHash
    ) {
      throw new Error(`Marketplace mode evidence is invalid for ${task.benchmarkSlug}`);
    }
  }

  const exactOutputParityCount = report.tasks.filter(
    (task) => task.quality.exactCanonicalParity,
  ).length;
  const recordedSpeedAdvantageCount = report.tasks.filter(
    (task) => task.recordedEfficiencyAdvantageSupported,
  ).length;
  if (
    report.summary.taskCount !== report.tasks.length ||
    report.summary.exactOutputParityCount !== exactOutputParityCount ||
    report.summary.recordedSpeedAdvantageCount !== recordedSpeedAdvantageCount
  ) {
    throw new Error("Founder report summary contains invalid derived counts");
  }
  if (
    report.marketplaceTrial.sessionHash !== report.evidenceManifest.marketplaceTrial.sessionHash ||
    report.marketplaceTrial.checksumsHash !== report.evidenceManifest.marketplaceTrial.checksumsHash ||
    canonicalHash(report.marketplaceTrial.verifiedFiles) !==
      canonicalHash(report.evidenceManifest.marketplaceTrial.verifiedFiles)
  ) {
    throw new Error("Marketplace evidence manifest commitments are inconsistent");
  }
  const candidateCommitments = report.tasks.map((task) => ({
    benchmarkSlug: task.benchmarkSlug,
    sessionId: task.sessionId,
    manualCandidateHash: task.manual.candidateHash,
    agentCandidateHashes: task.agent.runs.map((run) => run.candidateHash),
  }));
  if (canonicalHash(candidateCommitments) !== canonicalHash(report.evidenceManifest.candidates)) {
    throw new Error("Candidate evidence manifest commitments are inconsistent");
  }
  if (renderedHtml !== undefined) {
    const expectedHtml = renderFounderReportHtml(report);
    if (
      renderedHtml !== expectedHtml ||
      contentHash(renderedHtml) !== contentHash(expectedHtml)
    ) {
      throw new Error("Founder report HTML is not the deterministic rendered artifact");
    }
  }
}

export function buildFounderAgentAdvantageReport(
  sessionDirectories: string[],
  options: BuildFounderReportOptions = {},
): FounderAgentAdvantageReport {
  if (sessionDirectories.length !== 3) {
    throw new Error("Founder report requires exactly three benchmark session directories");
  }
  const projectRoot = resolve(options.projectRoot ?? process.cwd());
  const marketplaceTrial = loadAndVerifyFounderMarketplaceTrial(
    options.marketplaceTrialDirectory ?? defaultMarketplaceTrialDirectory(projectRoot),
  );
  requireExactVerifiedFiles(
    marketplaceTrial.verifiedFiles,
    marketplaceTrial.verifiedFiles,
  );
  const loaded = sessionDirectories.map((directory) =>
    loadFounderComparisonEvidence(directory, { projectRoot }),
  );
  const bySlug = new Map(loaded.map((evidence) => [evidence.session.benchmarkSlug, evidence]));

  const tasks = TASK_ORDER.map((benchmarkSlug) => {
    const definition = TASK_DEFINITIONS[benchmarkSlug];
    const evidence = bySlug.get(benchmarkSlug);
    const trial = marketplaceTrial.session.tasks.find(
      (candidate) => candidate.benchmarkSlug === benchmarkSlug,
    );
    if (!evidence || !trial) throw new Error(`Missing founder comparison evidence: ${benchmarkSlug}`);
    if (evidence.session.sessionId !== definition.sessionId) {
      throw new Error(`Founder comparison must use the committed ${benchmarkSlug} session`);
    }
    if (evidence.manual.source.type !== "MANUAL") {
      throw new Error(`Manual source identity is invalid for ${benchmarkSlug}`);
    }
    const [firstAgent, secondAgent] = evidence.agents;
    if (firstAgent.source.type !== "AGENT" || secondAgent.source.type !== "AGENT") {
      throw new Error(`Agent source identity is invalid for ${benchmarkSlug}`);
    }
    if (firstAgent.source.providerId !== secondAgent.source.providerId) {
      throw new Error(`Agent provider identity differs across ${benchmarkSlug} repeats`);
    }
    const costs = [
      evidence.manual.directCostUsd,
      firstAgent.directCostUsd,
      secondAgent.directCostUsd,
      marketplaceTrial.session.payment.directCostUsd,
    ];
    if (costs.some((cost) => cost !== "0")) {
      throw new Error(`Founder comparison direct cost must be exactly $0 for ${benchmarkSlug}`);
    }
    const hashes = [
      evidence.manual.outputHash,
      firstAgent.outputHash,
      secondAgent.outputHash,
      trial.deliverableHash,
    ];
    if (hashes.some((hash) => hash !== evidence.manual.outputHash)) {
      throw new Error(`Marketplace/manual/agent hashes do not match for ${benchmarkSlug}`);
    }

    return {
      benchmarkSlug,
      taskId: evidence.session.taskId,
      sessionId: evidence.session.sessionId,
      title: definition.title,
      category: definition.category,
      highStakesReason: definition.highStakesReason,
      benchmarkLock: evidence.session.benchmarkLock,
      manual: {
        operatorId: evidence.manual.source.operatorId,
        contactReference: evidence.manual.source.contactReference,
        method: evidence.manual.source.method,
        toolExclusionAttestation: evidence.manual.source.independenceAttestation,
        candidateHash: evidence.manual.candidateHash,
        outputHash: evidence.manual.outputHash,
        output: evidence.manual.output,
        elapsedMilliseconds: evidence.manual.elapsedMilliseconds,
        directCostUsd: "0" as const,
        capturedAt: evidence.manual.capturedAt,
      },
      agent: {
        providerId: firstAgent.source.providerId,
        officialTimingSource: "PUBLIC_NO_WALLET_TRIAL_API_DURATION" as const,
        officialElapsedMilliseconds: trial.apiDurationMilliseconds,
        directCostUsd: "0" as const,
        runs: [firstAgent, secondAgent].map((candidate) => ({
          candidateHash: candidate.candidateHash,
          outputHash: candidate.outputHash,
          output: candidate.output,
          capturedAt: candidate.capturedAt,
          localFixtureElapsedMilliseconds: candidate.elapsedMilliseconds,
          directCostUsd: "0" as const,
        })),
      },
      quality: {
        method: FOUNDER_QUALITY_METHOD,
        exactCanonicalParity: true as const,
        qualityScore: null,
        verdict: "IDENTICAL_CANONICAL_OUTPUT" as const,
      },
      recordedSpeedupMultiple: Number(
        (evidence.manual.elapsedMilliseconds / trial.apiDurationMilliseconds).toFixed(6),
      ),
      recordedEfficiencyAdvantageSupported:
        evidence.manual.elapsedMilliseconds > trial.apiDurationMilliseconds,
      marketplace: {
        evidenceStatus: "PARTIAL" as const,
        journey: FOUNDER_MARKETPLACE_JOURNEY,
        trialModeEvidence: definition.trialModeEvidence,
        jobId: trial.jobId,
        clientHistoryTimeLocal: trial.clientHistoryTimeLocal,
        deliverableHash: trial.deliverableHash,
        scoreReceiptHash: trial.scoreReceiptHash,
        hireProven: false as const,
        externalBuyer: false as const,
        uniqueServerHire: false as const,
        paid: false as const,
        freshExecutionProven: false as const,
      },
    };
  });

  const [firstTask] = tasks;
  if (!firstTask) throw new Error("Founder comparison tasks are missing");
  if (
    tasks.some(
      (task) =>
        task.manual.operatorId !== firstTask.manual.operatorId ||
        task.manual.contactReference !== firstTask.manual.contactReference,
    )
  ) {
    throw new Error("The same disclosed founder identity must operate all manual comparisons");
  }

  const evidenceManifest = FounderEvidenceManifestSchema.parse({
    schemaVersion: "positioncrew.founder-agent-advantage-evidence-manifest.v1",
    marketplaceTrial: {
      sessionHash: marketplaceTrial.sessionHash,
      checksumsHash: marketplaceTrial.checksumsHash,
      verifiedFiles: marketplaceTrial.verifiedFiles,
    },
    candidates: tasks.map((task) => ({
      benchmarkSlug: task.benchmarkSlug,
      sessionId: task.sessionId,
      manualCandidateHash: task.manual.candidateHash,
      agentCandidateHashes: task.agent.runs.map((run) => run.candidateHash),
    })),
  });

  const body = FounderReportBodySchema.parse({
    schemaVersion: FOUNDER_REPORT_SCHEMA_VERSION,
    title: "TermiX Agent Advantage Report: Founder-Operated Comparison",
    generatedAt: (options.now ?? new Date()).toISOString(),
    comparisonMode: FOUNDER_COMPARISON_MODE,
    qualityMethod: FOUNDER_QUALITY_METHOD,
    qualityScore: null,
    independent: false,
    blind: false,
    evaluator: null,
    manualOperatorIndependent: false,
    manualRunsPerTask: 1,
    agentRunsPerTask: 2,
    sameFounderAcrossTasks: true,
    rubricCommittedBeforeCandidates: true,
    marketplaceEvidenceStatus: "PARTIAL",
    marketplaceTrial: {
      session: marketplaceTrial.session,
      sessionHash: marketplaceTrial.sessionHash,
      checksumsHash: marketplaceTrial.checksumsHash,
      verifiedFiles: marketplaceTrial.verifiedFiles,
    },
    tasks,
    summary: {
      taskCount: 3,
      exactOutputParityCount: tasks.filter((task) => task.quality.exactCanonicalParity).length,
      recordedSpeedAdvantageCount: tasks.filter(
        (task) => task.recordedEfficiencyAdvantageSupported,
      ).length,
      directCostUsd: "0",
      marketplaceEvidenceStatus: "PARTIAL",
    },
    evidenceManifest,
    evidenceManifestHash: canonicalHash(evidenceManifest),
    claimBoundary: [...FOUNDER_CLAIM_BOUNDARY],
  });
  const report = FounderAgentAdvantageReportSchema.parse({
    ...body,
    reportHash: canonicalHash(body),
  });
  validateFounderReport(report, renderFounderReportHtml(report));
  return report;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function renderFounderReportHtml(report: FounderAgentAdvantageReport): string {
  const taskMarkup = report.tasks
    .map(
      (task) => `<article>
        <h2>${escapeHtml(task.title)}</h2>
        <p><strong>Exact output parity:</strong> yes. <strong>Quality score:</strong> not assigned.</p>
        <p><strong>Recorded time:</strong> founder ${task.manual.elapsedMilliseconds} ms; public trial ${task.agent.officialElapsedMilliseconds} ms.</p>
        <p><strong>Marketplace evidence:</strong> PARTIAL (${task.marketplace.trialModeEvidence}). No external, paid, or unique server hire is claimed.</p>
        <details><summary>Attached manual output</summary><pre>${escapeHtml(JSON.stringify(task.manual.output, null, 2))}</pre></details>
        ${task.agent.runs
          .map(
            (run, index) => `<details><summary>Attached agent output ${index + 1}</summary><pre>${escapeHtml(JSON.stringify(run.output, null, 2))}</pre></details>`,
          )
          .join("\n")}
      </article>`,
    )
    .join("\n");
  const boundary = report.claimBoundary.map((item) => `<li>${escapeHtml(item)}</li>`).join("\n");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="positioncrew-report-hash" content="${report.reportHash}">
  <title>${escapeHtml(report.title)}</title>
  <style>body{max-width:980px;margin:0 auto;padding:40px 22px;background:#f4f0e8;color:#17211b;font:16px/1.55 Georgia,serif}h1,h2{font-family:ui-monospace,monospace}article{margin:26px 0;padding:22px;background:#fff;border:1px solid #c8c0af}pre{overflow:auto;padding:14px;background:#17211b;color:#f4f0e8}code{overflow-wrap:anywhere}.boundary{border-left:5px solid #a33;padding-left:18px}a{color:#075d52}</style>
</head>
<body>
  <header><p>TermiX evidence</p><h1>${escapeHtml(report.title)}</h1><p>Founder-operated, non-independent, non-blind. Quality method: canonical exact-output parity; quality score: null.</p><p><a href="./${FOUNDER_REPORT_FILENAME}">Machine-readable report</a> · <a href="./${FOUNDER_EVIDENCE_MANIFEST_FILENAME}">Evidence manifest</a></p></header>
  ${taskMarkup}
  <section class="boundary"><h2>Claim boundary</h2><ul>${boundary}</ul></section>
  <footer><p>Report hash: <code>${report.reportHash}</code></p></footer>
</body>
</html>\n`;
}

export function writeFounderAgentAdvantageReport(
  sessionDirectories: string[],
  options: WriteFounderReportOptions,
): { directory: string; report: FounderAgentAdvantageReport } {
  const outputDirectory = resolve(options.outputDirectory);
  if (existsSync(outputDirectory)) {
    throw new Error(`Founder report destination already exists: ${outputDirectory}`);
  }
  const projectRoot = resolve(options.projectRoot ?? process.cwd());
  const marketplaceTrialDirectory = resolve(
    options.marketplaceTrialDirectory ?? defaultMarketplaceTrialDirectory(projectRoot),
  );
  const report = buildFounderAgentAdvantageReport(sessionDirectories, {
    ...options,
    projectRoot,
    marketplaceTrialDirectory,
  });

  mkdirSync(outputDirectory, { recursive: true, mode: 0o755 });
  try {
    writeFileSync(join(outputDirectory, FOUNDER_REPORT_FILENAME), prettyJson(report), {
      encoding: "utf8",
      flag: "wx",
      mode: 0o644,
    });
    writeFileSync(
      join(outputDirectory, FOUNDER_EVIDENCE_MANIFEST_FILENAME),
      prettyJson(report.evidenceManifest),
      { encoding: "utf8", flag: "wx", mode: 0o644 },
    );
    writeFileSync(
      join(outputDirectory, FOUNDER_REPORT_INDEX_FILENAME),
      renderFounderReportHtml(report),
      {
      encoding: "utf8",
      flag: "wx",
      mode: 0o644,
      },
    );
    copyAllowlistedRegularFiles(
      marketplaceTrialDirectory,
      join(outputDirectory, "marketplace-trial"),
      FOUNDER_TRIAL_ALLOWED_FILES,
    );
    verifyFounderAgentAdvantageReport(outputDirectory);
    return { directory: outputDirectory, report };
  } catch (error) {
    rmSync(outputDirectory, { recursive: true, force: true });
    throw error;
  }
}

export function verifyFounderAgentAdvantageReport(
  directoryInput: string,
): FounderAgentAdvantageReport {
  const directory = resolve(directoryInput);
  assertClosedRegularFileSet(directory, founderReportAllowedFiles());
  const report = FounderAgentAdvantageReportSchema.parse(
    readJson(join(directory, FOUNDER_REPORT_FILENAME)),
  );
  const html = readFileSync(join(directory, FOUNDER_REPORT_INDEX_FILENAME), "utf8");
  validateFounderReport(report, html);
  const manifest = FounderEvidenceManifestSchema.parse(
    readJson(join(directory, FOUNDER_EVIDENCE_MANIFEST_FILENAME)),
  );
  if (canonicalHash(manifest) !== report.evidenceManifestHash) {
    throw new Error("Published founder evidence manifest differs from the report commitment");
  }
  const attachedTrial = loadAndVerifyFounderMarketplaceTrial(join(directory, "marketplace-trial"));
  if (
    attachedTrial.sessionHash !== report.marketplaceTrial.sessionHash ||
    attachedTrial.checksumsHash !== report.marketplaceTrial.checksumsHash ||
    canonicalHash(attachedTrial.session) !== canonicalHash(report.marketplaceTrial.session)
  ) {
    throw new Error("Attached marketplace trial differs from the report commitment");
  }
  requireExactVerifiedFiles(report.marketplaceTrial.verifiedFiles, attachedTrial.verifiedFiles);
  const expectedHtml = renderFounderReportHtml(report);
  if (
    fileHash(join(directory, FOUNDER_REPORT_INDEX_FILENAME)) !== contentHash(expectedHtml) ||
    html !== expectedHtml
  ) {
    throw new Error("Founder report page bytes or hash differ from deterministic rendering");
  }
  return report;
}

export function founderReportRelativePath(projectRoot: string, path: string): string {
  const root = resolve(projectRoot);
  const absolute = resolve(path);
  const value = relative(root, absolute);
  if (value.startsWith("..") || value === "") return absolute;
  return value;
}
