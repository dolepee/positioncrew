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
  "positioncrew.founder-agent-advantage-report.v2" as const;
export const FOUNDER_REPORT_FILENAME = "founder-agent-advantage-report.json" as const;
export const FOUNDER_EVIDENCE_MANIFEST_FILENAME = "evidence-manifest.json" as const;
export const FOUNDER_REPORT_INDEX_FILENAME = "index.html" as const;
export const FOUNDER_COMPARISON_MODE =
  "FOUNDER_OPERATED_NON_INDEPENDENT_NON_BLIND" as const;
export const FOUNDER_QUALITY_METHOD = "CANONICAL_EXACT_OUTPUT_PARITY" as const;
export const FOUNDER_MARKETPLACE_JOURNEY =
  "FOUNDER_PUBLIC_WORKSPACE_COMPARISON" as const;
export const FOUNDER_MARKETPLACE_EVIDENCE_STATUS = "E3_SERVER_PERSISTED" as const;
export const FOUNDER_MARKETPLACE_EVIDENCE_MODE =
  "FRESH_SERVER_PERSISTED_HISTORICAL_FIXTURE_HIRE" as const;
export const FOUNDER_UNIQUE_SERVER_HIRE_DEFINITION =
  "Unique PositionCrew D1 hire, job, and receipt identifiers; not independent buyers or distinct sellers." as const;

export const FOUNDER_CLAIM_BOUNDARY = [
  "This is a founder-operated, self-attested, non-independent, non-blind comparison on three frozen historical fixtures.",
  "Canonical exact-output parity proves only that the attached candidates serialize to identical committed outputs; no independent quality score is claimed.",
  "The selected agent arms are three qualified E3_SERVER_PERSISTED PositionCrew D1 records: completed $0.00, no-wallet historical-fixture hires with public receipts.",
  "E3_SERVER_PERSISTED proves fresh PositionCrew server-persisted $0.00, no-wallet historical-fixture hires only; the captured public GET observations occurred after completion and do not prove precommitment or observation of record creation.",
  "Unique server hire means only unique PositionCrew D1 hire, job, and receipt identifiers, not independent buyers or distinct sellers.",
  "This evidence does not establish paid commerce, payment, settlement, external demand, evaluator-originated hiring, revenue, or external customer activity.",
  "The fixtures and outputs are historical research evidence, not live executable advice, mainnet execution, investment performance, or a recommendation to trade.",
  "Founder wall-clock and D1 API duration measure different execution contexts and are reported only as recorded times.",
] as const;

const BenchmarkSlugSchema = z.enum([
  "lending-rescue",
  "lp-rebalance",
  "bounded-grid",
]);
type BenchmarkSlug = z.infer<typeof BenchmarkSlugSchema>;
const BenchmarkServiceSchema = z.enum([
  "LENDING_RESCUE",
  "LP_REBALANCE",
  "BOUNDED_GRID",
]);
type BenchmarkService = z.infer<typeof BenchmarkServiceSchema>;

const TASK_DEFINITIONS: Record<
  BenchmarkSlug,
  {
    sessionId: string;
    title: string;
    category: string;
    highStakesReason: string;
    trialModeEvidence: "LOCKED_RECEIPT_OBSERVED" | "UI_MODE_CONTRADICTION";
    providerSlug: BenchmarkSlug;
    providerId: string;
    service: BenchmarkService;
    apiDurationMilliseconds: 371 | 381 | 359;
    hireFilename: string;
    receiptFilename: string;
  }
> = {
  "lending-rescue": {
    sessionId: "lending-rescue-20260812215350546-bc4a1371",
    title: "Bounded lending-position rescue",
    category: "Lending risk",
    highStakesReason: "A malformed rescue plan can worsen liquidation risk.",
    trialModeEvidence: "LOCKED_RECEIPT_OBSERVED",
    providerSlug: "lending-rescue",
    providerId: "positioncrew:provider:lending-rescue:v1",
    service: "LENDING_RESCUE",
    apiDurationMilliseconds: 371,
    hireFilename: "lending-rescue.hire.json",
    receiptFilename: "lending-rescue.receipt.json",
  },
  "lp-rebalance": {
    sessionId: "lp-rebalance-20260812215351113-a9d92c57",
    title: "Bounded concentrated-liquidity rebalance",
    category: "Liquidity management",
    highStakesReason: "Incorrect ranges or constraints can increase capital loss.",
    trialModeEvidence: "LOCKED_RECEIPT_OBSERVED",
    providerSlug: "lp-rebalance",
    providerId: "positioncrew:provider:lp-rebalance:v1",
    service: "LP_REBALANCE",
    apiDurationMilliseconds: 381,
    hireFilename: "lp-rebalance.hire.json",
    receiptFilename: "lp-rebalance.receipt.json",
  },
  "bounded-grid": {
    sessionId: "bounded-grid-20260812215351671-fc8afdab",
    title: "Bounded BNB-USDT grid construction",
    category: "Trading controls",
    highStakesReason: "Unsafe grid parameters can create uncontrolled inventory exposure.",
    trialModeEvidence: "UI_MODE_CONTRADICTION",
    providerSlug: "bounded-grid",
    providerId: "positioncrew:provider:bounded-grid:v1",
    service: "BOUNDED_GRID",
    apiDurationMilliseconds: 359,
    hireFilename: "bounded-grid.hire.json",
    receiptFilename: "bounded-grid.receipt.json",
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

export const FOUNDER_HIRE_ALLOWED_FILES = [
  "SHA256SUMS",
  "bounded-grid.hire.json",
  "bounded-grid.receipt.json",
  "lending-rescue.hire.json",
  "lending-rescue.receipt.json",
  "lp-rebalance.hire.json",
  "lp-rebalance.receipt.json",
  "session.json",
] as const;

const FOUNDER_HIRE_CHECKSUMMED_FILES = FOUNDER_HIRE_ALLOWED_FILES.filter(
  (path) => path !== "SHA256SUMS",
);

const FOUNDER_SERVER_CLAIM_BOUNDARY = [
  "This is a public-workspace run of a frozen historical benchmark fixture.",
  "The run costs $0.00, requires no wallet, and creates no payment or settlement.",
  "The server receipt proves only this PositionCrew request, provider selection, result, and timing trace.",
  "It does not establish an external buyer, paid demand, third-party protocol execution, onchain immutability, or live financial advice.",
] as const;

const FOUNDER_CAPTURE_CLAIM_BOUNDARY = [
  "This bundle records post-run public observations of three distinct PositionCrew server-persisted hire, job, and receipt chains; it does not claim that this capture precommitted or observed their creation.",
  "E3_SERVER_PERSISTED is the founder-report server-persistence classification, not independent or blind completion evidence.",
  "Unique server hire means only unique PositionCrew D1 hire, job, and receipt identifiers, not independent buyers or distinct sellers.",
  "Each selected record is a $0.00, no-wallet historical-fixture run with NO_PAYMENT settlement.",
  "This evidence does not establish paid commerce, external demand, evaluator-originated hiring, third-party protocol execution, live financial advice, or onchain immutability.",
  "The founder comparison remains non-independent and non-blind.",
] as const;

const CommerceEvidenceSchema = z
  .object({
    directCostUsd: z.literal("0.00"),
    walletRequired: z.literal(false),
    settlement: z.literal("NO_PAYMENT"),
  })
  .strict();

const CaptureObservationSchema = z
  .object({
    url: z.string().url(),
    httpStatus: z.literal(200),
    requestedAt: TimestampSchema,
    receivedAt: TimestampSchema,
    file: z.string().min(1),
    bytes: z.number().int().positive(),
    sha256: HashSchema,
  })
  .strict();

const MarketplaceHireTaskCommonShape = {
  evidenceMode: z.literal(FOUNDER_MARKETPLACE_EVIDENCE_MODE),
  serverEvidenceMode: z.literal("HISTORICAL_FIXTURE"),
  hireId: z.string().uuid(),
  idempotencyKey: z.string().uuid(),
  jobId: z.string().uuid(),
  receiptId: z.string().uuid(),
  state: z.literal("COMPLETED"),
  status: z.literal("COMPLETED"),
  createdAt: TimestampSchema,
  startedAt: TimestampSchema,
  completedAt: TimestampSchema,
  receiptCreatedAt: TimestampSchema,
  commerce: CommerceEvidenceSchema,
  hashes: z
    .object({
      request: HashSchema,
      response: HashSchema,
      deliverable: HashSchema,
      evaluation: HashSchema,
    })
    .strict(),
  observations: z
    .object({
      hire: CaptureObservationSchema,
      receipt: CaptureObservationSchema,
    })
    .strict(),
  canonicalHireReceiptChainIdentity: z.literal(true),
} as const;

const MarketplaceHireTaskSchema = z.discriminatedUnion("benchmarkSlug", [
  z
    .object({
      benchmarkSlug: z.literal("lending-rescue"),
      providerSlug: z.literal("lending-rescue"),
      providerId: z.literal("positioncrew:provider:lending-rescue:v1"),
      service: z.literal("LENDING_RESCUE"),
      apiDurationMilliseconds: z.literal(371),
      ...MarketplaceHireTaskCommonShape,
    })
    .strict(),
  z
    .object({
      benchmarkSlug: z.literal("lp-rebalance"),
      providerSlug: z.literal("lp-rebalance"),
      providerId: z.literal("positioncrew:provider:lp-rebalance:v1"),
      service: z.literal("LP_REBALANCE"),
      apiDurationMilliseconds: z.literal(381),
      ...MarketplaceHireTaskCommonShape,
    })
    .strict(),
  z
    .object({
      benchmarkSlug: z.literal("bounded-grid"),
      providerSlug: z.literal("bounded-grid"),
      providerId: z.literal("positioncrew:provider:bounded-grid:v1"),
      service: z.literal("BOUNDED_GRID"),
      apiDurationMilliseconds: z.literal(359),
      ...MarketplaceHireTaskCommonShape,
    })
    .strict(),
]);

export const FounderMarketplaceHireSessionSchema = z
  .object({
    schemaVersion: z.literal("positioncrew.founder-marketplace-hire-capture.v1"),
    captureStartedAt: TimestampSchema,
    capturedAt: TimestampSchema,
    origin: z.literal("https://positioncrew.dolepee.com"),
    operatorRole: z.literal("FOUNDER"),
    journey: z.literal(FOUNDER_MARKETPLACE_JOURNEY),
    comparisonMode: z.literal(FOUNDER_COMPARISON_MODE),
    marketplaceEvidenceStatus: z.literal(FOUNDER_MARKETPLACE_EVIDENCE_STATUS),
    evidenceMode: z.literal(FOUNDER_MARKETPLACE_EVIDENCE_MODE),
    hireProven: z.literal(true),
    uniqueServerHire: z.literal(true),
    paid: z.literal(false),
    independent: z.literal(false),
    blind: z.literal(false),
    captureMethod: z
      .object({
        requestMethod: z.literal("GET"),
        authorizedRequestCount: z.literal(6),
        observedHttp200Count: z.literal(6),
        redirectsFollowed: z.literal(false),
        retriesEnabled: z.literal(false),
        observedAfterCompletion: z.literal(true),
      })
      .strict(),
    commerce: CommerceEvidenceSchema,
    inventory: z
      .object({
        closedBundleFiles: z.array(z.string().min(1)).length(8),
        checksummedJsonFiles: z.array(z.string().min(1)).length(7),
        checksumManifest: z.literal("SHA256SUMS"),
      })
      .strict(),
    serverClaimBoundary: z.array(z.string().min(20)).length(4),
    claimBoundary: z.array(z.string().min(20)).length(6),
    verification: z
      .object({
        taskCount: z.literal(3),
        globallyUniqueHireIdCount: z.literal(3),
        globallyUniqueJobIdCount: z.literal(3),
        globallyUniqueReceiptIdCount: z.literal(3),
        canonicalHireReceiptChainIdentityCount: z.literal(3),
        completedJobCount: z.literal(3),
        canonicalRequestHashMatchCount: z.literal(3),
        canonicalResponseHashMatchCount: z.literal(3),
        canonicalDeliverableHashMatchCount: z.literal(3),
        canonicalEvaluationHashMatchCount: z.literal(3),
      })
      .strict(),
    tasks: z.array(MarketplaceHireTaskSchema).length(3),
  })
  .strict();

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

const D1EvaluationSchema = z
  .object({
    deliverableHash: HashSchema,
    evaluationHash: HashSchema,
    passed: z.literal(true),
  })
  .passthrough();

const D1ProviderRequestSchema = z
  .object({
    benchmarkSlug: BenchmarkSlugSchema,
    directCostUsd: z.literal("0.00"),
    evidenceMode: z.literal("HISTORICAL_FIXTURE"),
    providerId: z.string().min(1),
    providerSlug: BenchmarkSlugSchema,
    requestSchema: z.string().min(1),
    schemaVersion: z.literal("positioncrew.fresh-marketplace-provider-request.v1"),
    walletRequired: z.literal(false),
  })
  .strict();

const D1FixtureResponseSchema = z
  .object({
    advantageStatus: z.literal("PENDING_INDEPENDENT_BLIND_EVALUATION"),
    benchmarkLock: BenchmarkLockSchema,
    claimBoundary: z.array(z.string().min(20)).min(3),
    commerceMode: z.literal("IN_MEMORY_CONFORMANCE"),
    evidenceMode: z.literal("FROZEN_BSC_TEST_FIXTURE"),
    generatedAt: TimestampSchema,
    receipt: z
      .object({
        evaluationHash: HashSchema,
        mode: z.literal("PUBLIC_REPRODUCIBLE"),
        path: z.string().min(1),
      })
      .strict(),
    result: z
      .object({
        deliverable: PositionCrewDeliverableSchema,
        evaluation: D1EvaluationSchema,
        job: z
          .object({
            jobId: z.string().min(8),
            providerId: z.string().min(1),
            state: z.literal("COMPLETED"),
            deliverable: z
              .object({
                deliverableHash: HashSchema,
              })
              .passthrough(),
            evaluation: D1EvaluationSchema,
          })
          .passthrough(),
        request: z
          .object({
            requestId: z.string().min(8),
            schemaVersion: z.string().min(1),
            service: BenchmarkServiceSchema,
          })
          .passthrough(),
      })
      .strict(),
    schemaVersion: z.literal("positioncrew.fixture-job-response.v1"),
  })
  .strict();

const D1MarketplaceChainSchema = z
  .object({
    schemaVersion: z.literal("positioncrew.fresh-marketplace-chain.v1"),
    claimBoundary: z.array(z.string().min(20)).length(4),
    hire: z
      .object({
        hireId: z.string().uuid(),
        idempotencyKey: z.string().uuid(),
        providerSlug: BenchmarkSlugSchema,
        providerId: z.string().min(1),
        benchmarkSlug: BenchmarkSlugSchema,
        service: BenchmarkServiceSchema,
        evidenceMode: z.literal("HISTORICAL_FIXTURE"),
        commerce: CommerceEvidenceSchema,
        request: D1ProviderRequestSchema,
        requestHash: HashSchema,
        createdAt: TimestampSchema,
      })
      .strict(),
    job: z
      .object({
        jobId: z.string().uuid(),
        state: z.literal("COMPLETED"),
        status: z.literal("COMPLETED"),
        createdAt: TimestampSchema,
        startedAt: TimestampSchema,
        completedAt: TimestampSchema,
        apiDurationMilliseconds: z.number().int().positive(),
        error: z.null(),
      })
      .strict(),
    receipt: z
      .object({
        receiptId: z.string().uuid(),
        publicUrl: z.string().min(1),
        responseHash: HashSchema,
        deliverableHash: HashSchema,
        evaluationHash: HashSchema,
        createdAt: TimestampSchema,
        response: D1FixtureResponseSchema,
      })
      .strict(),
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
        officialTimingSource: z.literal("POSITIONCREW_D1_HIRE_API_DURATION"),
        officialElapsedMilliseconds: z.number().int().min(1),
        directCostUsd: z.literal("0.00"),
        hireId: z.string().uuid(),
        jobId: z.string().uuid(),
        receiptId: z.string().uuid(),
        receiptUrl: z.string().url(),
        requestHash: HashSchema,
        responseHash: HashSchema,
        deliverableHash: HashSchema,
        evaluationHash: HashSchema,
        output: PositionCrewDeliverableSchema,
        repeatabilityCandidates: z.array(AttachedCandidateSchema).length(2),
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
    recordedEfficiencyAdvantageSupported: z.literal(true),
    marketplace: z
      .object({
        evidenceStatus: z.literal(FOUNDER_MARKETPLACE_EVIDENCE_STATUS),
        journey: z.literal(FOUNDER_MARKETPLACE_JOURNEY),
        evidenceMode: z.literal(FOUNDER_MARKETPLACE_EVIDENCE_MODE),
        serverEvidenceMode: z.literal("HISTORICAL_FIXTURE"),
        hireId: z.string().uuid(),
        jobId: z.string().uuid(),
        receiptId: z.string().uuid(),
        hireUrl: z.string().url(),
        receiptUrl: z.string().url(),
        state: z.literal("COMPLETED"),
        status: z.literal("COMPLETED"),
        apiDurationMilliseconds: z.number().int().positive(),
        requestHash: HashSchema,
        responseHash: HashSchema,
        deliverableHash: HashSchema,
        evaluationHash: HashSchema,
        hireProven: z.literal(true),
        externalBuyer: z.literal(false),
        uniqueServerHire: z.literal(true),
        paid: z.literal(false),
        freshServerPersistenceProven: z.literal(true),
        freshUnderlyingAnalysisProven: z.literal(false),
      })
      .strict(),
  })
  .strict();

export const FounderEvidenceManifestSchema = z
  .object({
    schemaVersion: z.literal("positioncrew.founder-agent-advantage-evidence-manifest.v2"),
    marketplaceHires: z
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
    officialAgentRunsPerTask: z.literal(1),
    repeatabilityCandidatesPerTask: z.literal(2),
    sameFounderAcrossTasks: z.literal(true),
    rubricCommittedBeforeCandidates: z.literal(true),
    journey: z.literal(FOUNDER_MARKETPLACE_JOURNEY),
    marketplaceEvidenceStatus: z.literal(FOUNDER_MARKETPLACE_EVIDENCE_STATUS),
    hireProven: z.literal(true),
    uniqueServerHire: z.literal(true),
    uniqueServerHireDefinition: z.literal(FOUNDER_UNIQUE_SERVER_HIRE_DEFINITION),
    externalBuyer: z.literal(false),
    paid: z.literal(false),
    freshServerPersistenceProven: z.literal(true),
    freshUnderlyingAnalysisProven: z.literal(false),
    marketplaceHires: z
      .object({
        session: FounderMarketplaceHireSessionSchema,
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
        agentTotalElapsedMilliseconds: z.literal(1111),
        manualTotalElapsedMilliseconds: z.literal(480072),
        marketplaceEvidenceStatus: z.literal(FOUNDER_MARKETPLACE_EVIDENCE_STATUS),
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
export type FounderMarketplaceHireSession = z.infer<
  typeof FounderMarketplaceHireSessionSchema
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

type D1MarketplaceChain = z.infer<typeof D1MarketplaceChainSchema>;

interface VerifiedMarketplaceHires {
  directory: string;
  session: FounderMarketplaceHireSession;
  sessionHash: string;
  checksumsHash: string;
  verifiedFiles: Array<{ path: string; sha256: string }>;
  chains: Map<BenchmarkSlug, D1MarketplaceChain>;
}

export interface BuildFounderReportOptions {
  projectRoot?: string;
  marketplaceTrialDirectory?: string;
  marketplaceHireDirectory?: string;
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

function defaultMarketplaceHireDirectory(projectRoot: string): string {
  return join(
    projectRoot,
    "artifacts",
    "benchmarks",
    "founder-marketplace-hires",
    "2026-08-20-fresh-e3",
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
    ...FOUNDER_HIRE_ALLOWED_FILES.map((file) => "marketplace-hires/" + file),
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

function evaluationCommitment(evaluation: z.infer<typeof D1EvaluationSchema>): string {
  const { evaluationHash: _evaluationHash, ...body } = evaluation;
  return canonicalHash(body);
}

export function loadAndVerifyFounderMarketplaceHires(
  directoryInput: string,
): VerifiedMarketplaceHires {
  const directory = resolve(directoryInput);
  assertClosedRegularFileSet(directory, FOUNDER_HIRE_ALLOWED_FILES);
  const checksumsPath = join(directory, "SHA256SUMS");
  const sessionPath = join(directory, "session.json");
  const lines = readFileSync(checksumsPath, "utf8")
    .trim()
    .split(/\r?\n/u)
    .filter(Boolean);
  if (lines.length !== FOUNDER_HIRE_CHECKSUMMED_FILES.length) {
    throw new Error("Founder D1 SHA256SUMS must contain exactly seven JSON entries");
  }

  const seen = new Set<string>();
  const verifiedFiles = lines.map((line) => {
    const match = /^([a-f0-9]{64})  ([a-z0-9.-]+\.json)$/u.exec(line);
    if (!match) throw new Error("Invalid founder D1 SHA256SUMS entry: " + line);
    const expectedHex = Sha256HexSchema.parse(match[1]);
    const relativePath = match[2]!;
    if (!FOUNDER_HIRE_CHECKSUMMED_FILES.includes(relativePath as never)) {
      throw new Error("Unlisted founder D1 checksum path: " + relativePath);
    }
    if (seen.has(relativePath)) {
      throw new Error("Duplicate founder D1 checksum path: " + relativePath);
    }
    seen.add(relativePath);
    const absolutePath = resolve(directory, relativePath);
    if (!absolutePath.startsWith(directory + sep)) {
      throw new Error("Founder D1 checksum path escapes its directory: " + relativePath);
    }
    const actualHash = fileHash(absolutePath);
    const expectedHash = "sha256:" + expectedHex;
    if (actualHash !== expectedHash) {
      throw new Error("Founder D1 evidence checksum mismatch: " + relativePath);
    }
    return { path: relativePath, sha256: expectedHash };
  });

  if (
    FOUNDER_HIRE_CHECKSUMMED_FILES.some((path) => !seen.has(path)) ||
    seen.size !== FOUNDER_HIRE_CHECKSUMMED_FILES.length
  ) {
    throw new Error("Founder D1 SHA256SUMS does not exactly cover the JSON inventory");
  }

  const session = FounderMarketplaceHireSessionSchema.parse(readJson(sessionPath));
  if (
    !sameStrings(session.inventory.closedBundleFiles, FOUNDER_HIRE_ALLOWED_FILES) ||
    !sameStrings(session.inventory.checksummedJsonFiles, FOUNDER_HIRE_CHECKSUMMED_FILES) ||
    !sameStrings(session.serverClaimBoundary, FOUNDER_SERVER_CLAIM_BOUNDARY) ||
    !sameStrings(session.claimBoundary, FOUNDER_CAPTURE_CLAIM_BOUNDARY) ||
    !sameStrings(session.tasks.map((task) => task.benchmarkSlug), TASK_ORDER)
  ) {
    throw new Error("Founder D1 session inventory, boundaries, or task order is invalid");
  }
  if (Date.parse(session.captureStartedAt) > Date.parse(session.capturedAt)) {
    throw new Error("Founder D1 capture timestamps are invalid");
  }

  for (const [label, values] of [
    ["hire", session.tasks.map((task) => task.hireId)],
    ["job", session.tasks.map((task) => task.jobId)],
    ["receipt", session.tasks.map((task) => task.receiptId)],
    ["idempotency", session.tasks.map((task) => task.idempotencyKey)],
  ] as const) {
    if (new Set(values).size !== 3) {
      throw new Error("Founder D1 " + label + " identifiers must be globally unique");
    }
  }

  const chains = new Map<BenchmarkSlug, D1MarketplaceChain>();
  for (const task of session.tasks) {
    const definition = TASK_DEFINITIONS[task.benchmarkSlug];
    const hirePath = join(directory, definition.hireFilename);
    const receiptPath = join(directory, definition.receiptFilename);
    const hireRaw = readFileSync(hirePath, "utf8");
    const receiptRaw = readFileSync(receiptPath, "utf8");
    const hireInput = JSON.parse(hireRaw) as unknown;
    const receiptInput = JSON.parse(receiptRaw) as unknown;
    if (canonicalHash(hireInput) !== canonicalHash(receiptInput)) {
      throw new Error("Founder D1 hire and receipt observations differ: " + task.benchmarkSlug);
    }
    const chain = D1MarketplaceChainSchema.parse(hireInput);
    D1MarketplaceChainSchema.parse(receiptInput);

    const expectedHireUrl =
      session.origin + "/api/benchmark-hires/" + task.hireId;
    const expectedReceiptUrl =
      session.origin + "/api/benchmark-receipts/" + task.receiptId;
    const expectedReceiptPath = "/api/benchmark-receipts/" + task.receiptId;
    if (
      task.observations.hire.file !== definition.hireFilename ||
      task.observations.receipt.file !== definition.receiptFilename ||
      task.observations.hire.url !== expectedHireUrl ||
      task.observations.receipt.url !== expectedReceiptUrl ||
      chain.receipt.publicUrl !== expectedReceiptPath
    ) {
      throw new Error("Founder D1 observation URL or file binding is invalid: " + task.benchmarkSlug);
    }
    if (
      Date.parse(task.observations.hire.requestedAt) >
        Date.parse(task.observations.hire.receivedAt) ||
      Date.parse(task.observations.receipt.requestedAt) >
        Date.parse(task.observations.receipt.receivedAt)
    ) {
      throw new Error("Founder D1 observation timestamps are invalid: " + task.benchmarkSlug);
    }
    if (
      task.observations.hire.bytes !== Buffer.byteLength(hireRaw) ||
      task.observations.receipt.bytes !== Buffer.byteLength(receiptRaw) ||
      task.observations.hire.sha256 !== fileHash(hirePath) ||
      task.observations.receipt.sha256 !== fileHash(receiptPath)
    ) {
      throw new Error("Founder D1 observation byte commitment is invalid: " + task.benchmarkSlug);
    }

    if (
      task.providerSlug !== definition.providerSlug ||
      task.providerId !== definition.providerId ||
      task.service !== definition.service ||
      task.apiDurationMilliseconds !== definition.apiDurationMilliseconds ||
      chain.hire.hireId !== task.hireId ||
      chain.hire.idempotencyKey !== task.idempotencyKey ||
      chain.hire.providerSlug !== task.providerSlug ||
      chain.hire.providerId !== task.providerId ||
      chain.hire.benchmarkSlug !== task.benchmarkSlug ||
      chain.hire.service !== task.service ||
      chain.job.jobId !== task.jobId ||
      chain.receipt.receiptId !== task.receiptId
    ) {
      throw new Error("Founder D1 chain identity or provider mapping is invalid: " + task.benchmarkSlug);
    }
    if (
      chain.hire.createdAt !== task.createdAt ||
      chain.job.createdAt !== task.createdAt ||
      chain.job.startedAt !== task.startedAt ||
      chain.job.completedAt !== task.completedAt ||
      chain.receipt.createdAt !== task.receiptCreatedAt ||
      chain.job.apiDurationMilliseconds !== task.apiDurationMilliseconds ||
      Date.parse(chain.job.completedAt) - Date.parse(chain.job.startedAt) !==
        task.apiDurationMilliseconds
    ) {
      throw new Error("Founder D1 duration or lifecycle timestamps are invalid: " + task.benchmarkSlug);
    }
    if (
      canonicalHash(chain.claimBoundary) !== canonicalHash(session.serverClaimBoundary) ||
      chain.hire.request.benchmarkSlug !== task.benchmarkSlug ||
      chain.hire.request.providerSlug !== task.providerSlug ||
      chain.hire.request.providerId !== task.providerId ||
      chain.hire.request.requestSchema !== "positioncrew." + task.benchmarkSlug + ".request.v1" ||
      canonicalHash(chain.hire.commerce) !== canonicalHash(task.commerce) ||
      canonicalHash(chain.hire.request) !== chain.hire.requestHash
    ) {
      throw new Error("Founder D1 request or commerce commitment is invalid: " + task.benchmarkSlug);
    }

    const responseInput = (
      hireInput as { receipt: { response: unknown } }
    ).receipt.response;
    const response = chain.receipt.response;
    const deliverable = response.result.deliverable;
    const evaluation = response.result.evaluation;
    const evaluationHash = evaluationCommitment(evaluation);
    if (
      contentHash(JSON.stringify(responseInput)) !== chain.receipt.responseHash ||
      canonicalHash(deliverable) !== chain.receipt.deliverableHash ||
      evaluationHash !== chain.receipt.evaluationHash ||
      response.receipt.evaluationHash !== chain.receipt.evaluationHash ||
      evaluation.evaluationHash !== chain.receipt.evaluationHash ||
      response.result.job.evaluation.evaluationHash !== chain.receipt.evaluationHash ||
      canonicalHash(response.result.job.evaluation) !== canonicalHash(evaluation) ||
      evaluation.deliverableHash !== chain.receipt.deliverableHash ||
      response.result.job.evaluation.deliverableHash !== chain.receipt.deliverableHash ||
      response.result.job.deliverable.deliverableHash !== chain.receipt.deliverableHash
    ) {
      throw new Error("Founder D1 response, deliverable, or evaluation commitment is invalid: " + task.benchmarkSlug);
    }
    if (
      task.hashes.request !== chain.hire.requestHash ||
      task.hashes.response !== chain.receipt.responseHash ||
      task.hashes.deliverable !== chain.receipt.deliverableHash ||
      task.hashes.evaluation !== chain.receipt.evaluationHash ||
      response.result.request.service !== task.service ||
      deliverable.service !== task.service ||
      response.result.job.providerId !== task.providerId ||
      deliverable.requestId !== response.result.request.requestId
    ) {
      throw new Error("Founder D1 session hashes or fixture identity are invalid: " + task.benchmarkSlug);
    }
    chains.set(task.benchmarkSlug, chain);
  }

  return {
    directory,
    session,
    sessionHash: fileHash(sessionPath),
    checksumsHash: fileHash(checksumsPath),
    verifiedFiles: canonicalVerifiedFiles(verifiedFiles),
    chains,
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
    const hire = report.marketplaceHires.session.tasks.find(
      (candidate) => candidate.benchmarkSlug === task.benchmarkSlug,
    );
    if (!hire) throw new Error("Missing marketplace hire for " + task.benchmarkSlug);
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
      task.agent.deliverableHash,
      task.agent.repeatabilityCandidates[0]?.outputHash,
      task.agent.repeatabilityCandidates[1]?.outputHash,
      hire.hashes.deliverable,
    ];
    if (hashes.some((hash) => hash !== task.manual.outputHash)) {
      throw new Error(`Canonical output parity is false for ${task.benchmarkSlug}`);
    }
    if (canonicalHash(task.manual.output) !== task.manual.outputHash) {
      throw new Error(`Manual output attachment is invalid for ${task.benchmarkSlug}`);
    }
    if (canonicalHash(task.agent.output) !== task.agent.deliverableHash) {
      throw new Error("Official D1 output attachment is invalid for " + task.benchmarkSlug);
    }
    for (const run of task.agent.repeatabilityCandidates) {
      if (canonicalHash(run.output) !== run.outputHash) {
        throw new Error(`Agent output attachment is invalid for ${task.benchmarkSlug}`);
      }
    }
    if (
      task.agent.officialElapsedMilliseconds !== hire.apiDurationMilliseconds ||
      task.marketplace.apiDurationMilliseconds !== hire.apiDurationMilliseconds ||
      hire.apiDurationMilliseconds !== definition.apiDurationMilliseconds
    ) {
      throw new Error(`Official agent-arm timing is invalid for ${task.benchmarkSlug}`);
    }
    const expectedSpeedup = Number(
      (task.manual.elapsedMilliseconds / hire.apiDurationMilliseconds).toFixed(6),
    );
    const expectedEfficiency = task.manual.elapsedMilliseconds > hire.apiDurationMilliseconds;
    if (task.recordedSpeedupMultiple !== expectedSpeedup) {
      throw new Error(`Derived speedup is invalid for ${task.benchmarkSlug}`);
    }
    if (task.recordedEfficiencyAdvantageSupported !== expectedEfficiency) {
      throw new Error(`Derived efficiency result is invalid for ${task.benchmarkSlug}`);
    }
    if (
      task.marketplace.journey !== FOUNDER_MARKETPLACE_JOURNEY ||
      task.marketplace.hireId !== hire.hireId ||
      task.marketplace.jobId !== hire.jobId ||
      task.marketplace.receiptId !== hire.receiptId ||
      task.marketplace.hireUrl !== hire.observations.hire.url ||
      task.marketplace.receiptUrl !== hire.observations.receipt.url ||
      task.marketplace.requestHash !== hire.hashes.request ||
      task.marketplace.responseHash !== hire.hashes.response ||
      task.marketplace.deliverableHash !== hire.hashes.deliverable ||
      task.marketplace.evaluationHash !== hire.hashes.evaluation ||
      task.agent.hireId !== hire.hireId ||
      task.agent.jobId !== hire.jobId ||
      task.agent.receiptId !== hire.receiptId ||
      task.agent.receiptUrl !== hire.observations.receipt.url ||
      task.agent.requestHash !== hire.hashes.request ||
      task.agent.responseHash !== hire.hashes.response ||
      task.agent.evaluationHash !== hire.hashes.evaluation
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
    report.summary.recordedSpeedAdvantageCount !== recordedSpeedAdvantageCount ||
    report.summary.exactOutputParityCount !== 3 ||
    report.summary.recordedSpeedAdvantageCount !== 3 ||
    report.summary.agentTotalElapsedMilliseconds !==
      report.tasks.reduce((total, task) => total + task.agent.officialElapsedMilliseconds, 0) ||
    report.summary.manualTotalElapsedMilliseconds !==
      report.tasks.reduce((total, task) => total + task.manual.elapsedMilliseconds, 0)
  ) {
    throw new Error("Founder report summary contains invalid derived counts");
  }
  if (
    report.marketplaceHires.sessionHash !== report.evidenceManifest.marketplaceHires.sessionHash ||
    report.marketplaceHires.checksumsHash !== report.evidenceManifest.marketplaceHires.checksumsHash ||
    canonicalHash(report.marketplaceHires.verifiedFiles) !==
      canonicalHash(report.evidenceManifest.marketplaceHires.verifiedFiles)
  ) {
    throw new Error("Marketplace evidence manifest commitments are inconsistent");
  }
  const candidateCommitments = report.tasks.map((task) => ({
    benchmarkSlug: task.benchmarkSlug,
    sessionId: task.sessionId,
    manualCandidateHash: task.manual.candidateHash,
    agentCandidateHashes: task.agent.repeatabilityCandidates.map((run) => run.candidateHash),
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
  const marketplaceHires = loadAndVerifyFounderMarketplaceHires(
    options.marketplaceHireDirectory ??
      options.marketplaceTrialDirectory ??
      defaultMarketplaceHireDirectory(projectRoot),
  );
  requireExactVerifiedFiles(
    marketplaceHires.verifiedFiles,
    marketplaceHires.verifiedFiles,
  );
  const loaded = sessionDirectories.map((directory) =>
    loadFounderComparisonEvidence(directory, { projectRoot }),
  );
  const bySlug = new Map(loaded.map((evidence) => [evidence.session.benchmarkSlug, evidence]));

  const tasks = TASK_ORDER.map((benchmarkSlug) => {
    const definition = TASK_DEFINITIONS[benchmarkSlug];
    const evidence = bySlug.get(benchmarkSlug);
    const hire = marketplaceHires.session.tasks.find(
      (candidate) => candidate.benchmarkSlug === benchmarkSlug,
    );
    const chain = marketplaceHires.chains.get(benchmarkSlug);
    if (!evidence || !hire || !chain) {
      throw new Error("Missing founder comparison evidence: " + benchmarkSlug);
    }
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
    ];
    if (costs.some((cost) => cost !== "0")) {
      throw new Error(`Founder comparison direct cost must be exactly $0 for ${benchmarkSlug}`);
    }
    const hashes = [
      evidence.manual.outputHash,
      firstAgent.outputHash,
      secondAgent.outputHash,
      chain.receipt.deliverableHash,
    ];
    if (hashes.some((hash) => hash !== evidence.manual.outputHash)) {
      throw new Error(`Marketplace/manual/agent hashes do not match for ${benchmarkSlug}`);
    }
    if (
      canonicalHash(chain.receipt.response.benchmarkLock) !==
        canonicalHash(evidence.session.benchmarkLock) ||
      chain.receipt.response.result.request.requestId !== evidence.session.taskId ||
      chain.receipt.response.result.deliverable.requestId !== evidence.session.taskId
    ) {
      throw new Error("D1 hire is not bound to the committed benchmark: " + benchmarkSlug);
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
        officialTimingSource: "POSITIONCREW_D1_HIRE_API_DURATION" as const,
        officialElapsedMilliseconds: hire.apiDurationMilliseconds,
        directCostUsd: "0.00" as const,
        hireId: hire.hireId,
        jobId: hire.jobId,
        receiptId: hire.receiptId,
        receiptUrl: hire.observations.receipt.url,
        requestHash: hire.hashes.request,
        responseHash: hire.hashes.response,
        deliverableHash: hire.hashes.deliverable,
        evaluationHash: hire.hashes.evaluation,
        output: chain.receipt.response.result.deliverable,
        repeatabilityCandidates: [firstAgent, secondAgent].map((candidate) => ({
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
        (evidence.manual.elapsedMilliseconds / hire.apiDurationMilliseconds).toFixed(6),
      ),
      recordedEfficiencyAdvantageSupported:
        true as const,
      marketplace: {
        evidenceStatus: FOUNDER_MARKETPLACE_EVIDENCE_STATUS,
        journey: FOUNDER_MARKETPLACE_JOURNEY,
        evidenceMode: FOUNDER_MARKETPLACE_EVIDENCE_MODE,
        serverEvidenceMode: "HISTORICAL_FIXTURE" as const,
        hireId: hire.hireId,
        jobId: hire.jobId,
        receiptId: hire.receiptId,
        hireUrl: hire.observations.hire.url,
        receiptUrl: hire.observations.receipt.url,
        state: "COMPLETED" as const,
        status: "COMPLETED" as const,
        apiDurationMilliseconds: hire.apiDurationMilliseconds,
        requestHash: hire.hashes.request,
        responseHash: hire.hashes.response,
        deliverableHash: hire.hashes.deliverable,
        evaluationHash: hire.hashes.evaluation,
        hireProven: true as const,
        externalBuyer: false as const,
        uniqueServerHire: true as const,
        paid: false as const,
        freshServerPersistenceProven: true as const,
        freshUnderlyingAnalysisProven: false as const,
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
    schemaVersion: "positioncrew.founder-agent-advantage-evidence-manifest.v2",
    marketplaceHires: {
      sessionHash: marketplaceHires.sessionHash,
      checksumsHash: marketplaceHires.checksumsHash,
      verifiedFiles: marketplaceHires.verifiedFiles,
    },
    candidates: tasks.map((task) => ({
      benchmarkSlug: task.benchmarkSlug,
      sessionId: task.sessionId,
      manualCandidateHash: task.manual.candidateHash,
      agentCandidateHashes: task.agent.repeatabilityCandidates.map((run) => run.candidateHash),
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
    officialAgentRunsPerTask: 1,
    repeatabilityCandidatesPerTask: 2,
    sameFounderAcrossTasks: true,
    rubricCommittedBeforeCandidates: true,
    journey: FOUNDER_MARKETPLACE_JOURNEY,
    marketplaceEvidenceStatus: FOUNDER_MARKETPLACE_EVIDENCE_STATUS,
    hireProven: true,
    uniqueServerHire: true,
    uniqueServerHireDefinition: FOUNDER_UNIQUE_SERVER_HIRE_DEFINITION,
    externalBuyer: false,
    paid: false,
    freshServerPersistenceProven: true,
    freshUnderlyingAnalysisProven: false,
    marketplaceHires: {
      session: marketplaceHires.session,
      sessionHash: marketplaceHires.sessionHash,
      checksumsHash: marketplaceHires.checksumsHash,
      verifiedFiles: marketplaceHires.verifiedFiles,
    },
    tasks,
    summary: {
      taskCount: 3,
      exactOutputParityCount: tasks.filter((task) => task.quality.exactCanonicalParity).length,
      recordedSpeedAdvantageCount: tasks.filter(
        (task) => task.recordedEfficiencyAdvantageSupported,
      ).length,
      directCostUsd: "0",
      agentTotalElapsedMilliseconds: tasks.reduce(
        (total, task) => total + task.agent.officialElapsedMilliseconds,
        0,
      ),
      manualTotalElapsedMilliseconds: tasks.reduce(
        (total, task) => total + task.manual.elapsedMilliseconds,
        0,
      ),
      marketplaceEvidenceStatus: FOUNDER_MARKETPLACE_EVIDENCE_STATUS,
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
        <p><strong>Recorded time:</strong> founder ${task.manual.elapsedMilliseconds} ms; D1 API ${task.agent.officialElapsedMilliseconds} ms. These clocks measure different execution contexts.</p>
        <p><strong>Marketplace evidence:</strong> ${task.marketplace.evidenceStatus}. A completed $0.00, no-wallet historical-fixture hire is persisted under unique PositionCrew D1 hire, job, and receipt IDs. This does not establish an external buyer or paid commerce.</p>
        <p><a href="${escapeHtml(task.marketplace.receiptUrl)}">Public D1 receipt</a></p>
        <details><summary>Attached manual output</summary><pre>${escapeHtml(JSON.stringify(task.manual.output, null, 2))}</pre></details>
        <details><summary>Official D1 agent output</summary><pre>${escapeHtml(JSON.stringify(task.agent.output, null, 2))}</pre></details>
        ${task.agent.repeatabilityCandidates
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
  const marketplaceHireDirectory = resolve(
    options.marketplaceHireDirectory ??
      options.marketplaceTrialDirectory ??
      defaultMarketplaceHireDirectory(projectRoot),
  );
  const report = buildFounderAgentAdvantageReport(sessionDirectories, {
    ...options,
    projectRoot,
    marketplaceHireDirectory,
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
      marketplaceHireDirectory,
      join(outputDirectory, "marketplace-hires"),
      FOUNDER_HIRE_ALLOWED_FILES,
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
  const attachedHires = loadAndVerifyFounderMarketplaceHires(join(directory, "marketplace-hires"));
  if (
    attachedHires.sessionHash !== report.marketplaceHires.sessionHash ||
    attachedHires.checksumsHash !== report.marketplaceHires.checksumsHash ||
    canonicalHash(attachedHires.session) !== canonicalHash(report.marketplaceHires.session)
  ) {
    throw new Error("Attached marketplace hires differ from the report commitment");
  }
  requireExactVerifiedFiles(report.marketplaceHires.verifiedFiles, attachedHires.verifiedFiles);
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
