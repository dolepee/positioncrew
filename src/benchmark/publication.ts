import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { z } from "zod";
import { HashSchema, TimestampSchema } from "../contracts/common.js";
import { verifyAgentAdvantageReport } from "./report.js";

const PUBLICATION_BOUNDARY =
  "This independently scored report applies only to three frozen fixtures. It does not establish live investment performance, external demand, AACP settlement, or mainnet execution.";

const PendingPublicationSchema = z
  .object({
    schemaVersion: z.literal("positioncrew.agent-advantage-publication.v1"),
    status: z.literal("PENDING_INDEPENDENT_BLIND_EVALUATION"),
    reportUrl: z.null(),
    reportHash: z.null(),
    evidenceManifestHash: z.null(),
    publishedAt: z.null(),
    taskCount: z.literal(3),
    supportedAdvantageCount: z.null(),
    agentBlindQualityScore: z.null(),
    boundary: z.string().min(20),
  })
  .strict();

const PublishedPublicationSchema = z
  .object({
    schemaVersion: z.literal("positioncrew.agent-advantage-publication.v1"),
    status: z.literal("PUBLISHED"),
    reportUrl: z.literal("/evidence/agent-advantage/"),
    reportHash: HashSchema,
    evidenceManifestHash: HashSchema,
    publishedAt: TimestampSchema,
    taskCount: z.literal(3),
    supportedAdvantageCount: z.number().int().min(0).max(3),
    agentBlindQualityScore: z.number().int().min(0).max(300),
    boundary: z.string().min(20),
  })
  .strict();

export const AgentAdvantagePublicationStatusSchema = z.discriminatedUnion("status", [
  PendingPublicationSchema,
  PublishedPublicationSchema,
]);

export const PENDING_AGENT_ADVANTAGE_PUBLICATION = PendingPublicationSchema.parse({
  schemaVersion: "positioncrew.agent-advantage-publication.v1",
  status: "PENDING_INDEPENDENT_BLIND_EVALUATION",
  reportUrl: null,
  reportHash: null,
  evidenceManifestHash: null,
  publishedAt: null,
  taskCount: 3,
  supportedAdvantageCount: null,
  agentBlindQualityScore: null,
  boundary:
    "Independent manual baselines and blind scorecards have not yet been completed or published.",
});

export type AgentAdvantagePublicationStatus = z.infer<
  typeof AgentAdvantagePublicationStatusSchema
>;

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

function prettyJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function stageAgentAdvantageReport(
  reportDirectoryInput: string,
  publicRootInput: string,
  options: {
    confirmedIndependentHumans: boolean;
    publishedAt?: Date;
  },
): AgentAdvantagePublicationStatus {
  if (!options.confirmedIndependentHumans) {
    throw new Error(
      "Publication requires explicit confirmation that a real manual operator and a different independent evaluator completed the evidence",
    );
  }

  const reportDirectory = resolve(reportDirectoryInput);
  const publicRoot = resolve(publicRootInput);
  const evidenceRoot = join(publicRoot, "evidence");
  const statusPath = join(evidenceRoot, "agent-advantage-status.json");
  const destination = join(evidenceRoot, "agent-advantage");
  if (!existsSync(statusPath)) {
    throw new Error("The public Agent Advantage pending-status file is missing");
  }
  const currentStatus = AgentAdvantagePublicationStatusSchema.parse(readJson(statusPath));
  if (currentStatus.status !== "PENDING_INDEPENDENT_BLIND_EVALUATION") {
    throw new Error("The public Agent Advantage report has already been staged");
  }
  if (existsSync(destination)) {
    throw new Error("The public Agent Advantage report directory already exists");
  }

  const report = verifyAgentAdvantageReport(reportDirectory);
  const publication = PublishedPublicationSchema.parse({
    schemaVersion: "positioncrew.agent-advantage-publication.v1",
    status: "PUBLISHED",
    reportUrl: "/evidence/agent-advantage/",
    reportHash: report.reportHash,
    evidenceManifestHash: report.summary.evidenceManifestHash,
    publishedAt: (options.publishedAt ?? new Date()).toISOString(),
    taskCount: report.summary.taskCount,
    supportedAdvantageCount: report.summary.supportedAdvantageCount,
    agentBlindQualityScore: report.tasks.reduce(
      (total, task) => total + task.result.agent.score,
      0,
    ),
    boundary: PUBLICATION_BOUNDARY,
  });

  const temporaryDestination = join(
    evidenceRoot,
    `.agent-advantage-${process.pid}-${Date.now()}`,
  );
  const temporaryStatus = join(
    evidenceRoot,
    `.agent-advantage-status-${process.pid}-${Date.now()}.json`,
  );
  mkdirSync(temporaryDestination);
  let destinationMoved = false;
  try {
    for (const filename of [
      "agent-advantage-report.json",
      "agent-advantage-report.md",
      "agent-advantage-report.html",
    ]) {
      copyFileSync(join(reportDirectory, filename), join(temporaryDestination, filename));
    }
    copyFileSync(
      join(reportDirectory, "agent-advantage-report.html"),
      join(temporaryDestination, "index.html"),
    );
    for (const task of report.tasks) {
      const taskDestination = join(temporaryDestination, "tasks", task.benchmarkSlug);
      mkdirSync(taskDestination, { recursive: true });
      for (const filename of Object.keys(task.evidenceFiles)) {
        copyFileSync(
          join(reportDirectory, "tasks", task.benchmarkSlug, filename),
          join(taskDestination, filename),
        );
      }
    }
    const stagedReport = verifyAgentAdvantageReport(temporaryDestination);
    if (stagedReport.reportHash !== report.reportHash) {
      throw new Error("The staged Agent Advantage report differs from the verified source report");
    }
    writeFileSync(temporaryStatus, prettyJson(publication), {
      encoding: "utf8",
      flag: "wx",
      mode: 0o644,
    });
    renameSync(temporaryDestination, destination);
    destinationMoved = true;
    renameSync(temporaryStatus, statusPath);
  } catch (error) {
    rmSync(temporaryDestination, { recursive: true, force: true });
    if (destinationMoved) rmSync(destination, { recursive: true, force: true });
    rmSync(temporaryStatus, { force: true });
    throw error;
  }
  return publication;
}
