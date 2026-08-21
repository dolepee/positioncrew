import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { z } from "zod";
import { HashSchema, TimestampSchema } from "../contracts/common.js";
import {
  FOUNDER_CLAIM_BOUNDARY,
  FOUNDER_QUALITY_METHOD,
  copyAllowlistedRegularFiles,
  founderReportAllowedFiles,
  verifyFounderAgentAdvantageReport,
} from "./founder-report.js";

export const FOUNDER_PUBLICATION_SCHEMA_VERSION =
  "positioncrew.founder-agent-advantage-publication.v1" as const;
export const FOUNDER_REPORT_URL = "/evidence/agent-advantage-founder/" as const;
export const FOUNDER_PUBLICATION_STATUS_FILENAME =
  "founder-agent-advantage-status.json" as const;

export const FounderAgentAdvantagePublicationStatusSchema = z
  .object({
    schemaVersion: z.literal(FOUNDER_PUBLICATION_SCHEMA_VERSION),
    status: z.enum(["PENDING_FOUNDER_COMPARISON", "PUBLISHED"]),
    reportUrl: z.string().nullable(),
    reportHash: HashSchema.nullable(),
    evidenceManifestHash: HashSchema.nullable(),
    publishedAt: TimestampSchema.nullable(),
    taskCount: z.literal(3),
    exactOutputParityCount: z.number().int().min(0).max(3).nullable(),
    recordedSpeedAdvantageCount: z.number().int().min(0).max(3).nullable(),
    qualityMethod: z.literal(FOUNDER_QUALITY_METHOD),
    qualityScore: z.null(),
    independent: z.literal(false),
    blind: z.literal(false),
    boundary: z.string().min(20),
  })
  .strict()
  .superRefine((status, context) => {
    const publicationFields = [
      status.reportUrl,
      status.reportHash,
      status.evidenceManifestHash,
      status.publishedAt,
      status.exactOutputParityCount,
      status.recordedSpeedAdvantageCount,
    ];
    if (
      status.status === "PENDING_FOUNDER_COMPARISON" &&
      publicationFields.some((value) => value !== null)
    ) {
      context.addIssue({
        code: "custom",
        message: "Pending founder comparison status cannot contain publication evidence",
      });
    }
    if (
      status.status === "PUBLISHED" &&
      publicationFields.some((value) => value === null)
    ) {
      context.addIssue({
        code: "custom",
        message: "Published founder comparison status requires complete publication evidence",
      });
    }
    if (status.status === "PUBLISHED" && status.reportUrl !== FOUNDER_REPORT_URL) {
      context.addIssue({ code: "custom", message: "Founder report URL is not allowlisted" });
    }
  });

export type FounderAgentAdvantagePublicationStatus = z.infer<
  typeof FounderAgentAdvantagePublicationStatusSchema
>;

export interface PublishFounderReportOptions {
  confirmedFounderOperatedNonblind: boolean;
  projectRoot?: string;
  publicEvidenceDirectory?: string;
  now?: Date;
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

function prettyJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function publishFounderAgentAdvantageReport(
  reportDirectoryInput: string,
  options: PublishFounderReportOptions,
): FounderAgentAdvantagePublicationStatus {
  if (!options.confirmedFounderOperatedNonblind) {
    throw new Error(
      "Founder publication requires --confirm-founder-operated-nonblind; the independent-human flag is not accepted",
    );
  }
  const reportDirectory = resolve(reportDirectoryInput);
  const report = verifyFounderAgentAdvantageReport(reportDirectory);
  const projectRoot = resolve(options.projectRoot ?? process.cwd());
  const publicEvidenceDirectory = resolve(
    options.publicEvidenceDirectory ?? join(projectRoot, "web", "public", "evidence"),
  );
  const statusPath = join(publicEvidenceDirectory, FOUNDER_PUBLICATION_STATUS_FILENAME);
  if (!existsSync(statusPath)) {
    throw new Error("Founder publication status truth source is missing");
  }
  const publicRootStat = lstatSync(publicEvidenceDirectory);
  const statusStat = lstatSync(statusPath);
  if (
    publicRootStat.isSymbolicLink() ||
    !publicRootStat.isDirectory() ||
    statusStat.isSymbolicLink() ||
    !statusStat.isFile()
  ) {
    throw new Error("Founder publication paths must be real directories and regular files");
  }
  const realPublicRoot = realpathSync(publicEvidenceDirectory);
  if (!realpathSync(statusPath).startsWith(`${realPublicRoot}/`)) {
    throw new Error("Founder publication status escapes the public evidence directory");
  }
  const currentStatus = FounderAgentAdvantagePublicationStatusSchema.parse(readJson(statusPath));
  if (currentStatus.status !== "PENDING_FOUNDER_COMPARISON") {
    throw new Error("Founder comparison has already been published");
  }

  const destination = join(publicEvidenceDirectory, "agent-advantage-founder");
  if (existsSync(destination)) {
    throw new Error("Founder publication destination already exists");
  }
  mkdirSync(publicEvidenceDirectory, { recursive: true, mode: 0o755 });
  const nonce = `${process.pid}-${Date.now()}`;
  const stage = join(publicEvidenceDirectory, `.agent-advantage-founder-${nonce}.stage`);
  const statusStage = join(publicEvidenceDirectory, `.founder-status-${nonce}.json`);
  let destinationCommitted = false;

  const publishedStatus = FounderAgentAdvantagePublicationStatusSchema.parse({
    schemaVersion: FOUNDER_PUBLICATION_SCHEMA_VERSION,
    status: "PUBLISHED",
    reportUrl: FOUNDER_REPORT_URL,
    reportHash: report.reportHash,
    evidenceManifestHash: report.evidenceManifestHash,
    publishedAt: (options.now ?? new Date()).toISOString(),
    taskCount: 3,
    exactOutputParityCount: report.summary.exactOutputParityCount,
    recordedSpeedAdvantageCount: report.summary.recordedSpeedAdvantageCount,
    qualityMethod: FOUNDER_QUALITY_METHOD,
    qualityScore: null,
    independent: false,
    blind: false,
    boundary: FOUNDER_CLAIM_BOUNDARY.join(" "),
  });

  try {
    copyAllowlistedRegularFiles(reportDirectory, stage, founderReportAllowedFiles());
    const stagedReport = verifyFounderAgentAdvantageReport(stage);
    if (
      stagedReport.reportHash !== report.reportHash ||
      stagedReport.evidenceManifestHash !== report.evidenceManifestHash
    ) {
      throw new Error("Staged founder report does not exactly match the verified source");
    }
    writeFileSync(statusStage, prettyJson(publishedStatus), {
      encoding: "utf8",
      flag: "wx",
      mode: 0o644,
    });
    FounderAgentAdvantagePublicationStatusSchema.parse(readJson(statusStage));
    renameSync(stage, destination);
    destinationCommitted = true;
    renameSync(statusStage, statusPath);
    return publishedStatus;
  } catch (error) {
    rmSync(stage, { recursive: true, force: true });
    rmSync(statusStage, { force: true });
    if (destinationCommitted) rmSync(destination, { recursive: true, force: true });
    throw error;
  }
}
