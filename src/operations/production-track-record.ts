export interface ProductionMonitorEpoch {
  schemaVersion: "positioncrew.production-monitor-epoch.v1";
  startedAt: string;
  baseUrl: string;
  workflow: {
    owner: string;
    repository: string;
    file: string;
    url: string;
    snapshotUrl: string;
    event: "schedule";
    cadenceMinutes: number;
  };
  verification: {
    expectedCheckCountAtEpoch: number;
    scope: string[];
  };
  aggregation: {
    coverage: "LATEST_100_SCHEDULED_RUNS";
    excludeEvents: string[];
  };
  boundary: string;
}

export interface ProductionTrackRecordRun {
  runId: number;
  status: string;
  conclusion: string | null;
  createdAt: string;
  completedAt: string | null;
  headSha: string;
  url: string;
}

export interface ProductionTrackRecord {
  schemaVersion: "positioncrew.production-track-record.v1";
  generatedAt: string;
  status: "COLLECTING" | "OPERATIONAL" | "DEGRADED" | "SOURCE_UNAVAILABLE";
  epoch: ProductionMonitorEpoch;
  source: {
    provider: "GITHUB_ACTIONS_SNAPSHOT";
    snapshotUrl: string;
    workflowUrl: string;
    sourceStatus: "AVAILABLE" | "UNAVAILABLE";
  };
  summary: {
    totalScheduledRunsSinceEpoch: number | null;
    observedRunCount: number;
    completedRuns: number;
    successfulRuns: number;
    unsuccessfulRuns: number;
    pendingRuns: number;
    rollingPassRatePct: number | null;
    rollingWindowStartedAt: string | null;
    rollingWindowEndedAt: string | null;
  };
  runs: ProductionTrackRecordRun[];
  boundary: string;
}

function objectValue(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} is not an object`);
  }
  return value as Record<string, unknown>;
}

function stringValue(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${label} is missing`);
  return value;
}

function isoValue(value: unknown, label: string): string {
  const candidate = stringValue(value, label);
  if (!Number.isFinite(Date.parse(candidate))) throw new Error(`${label} is invalid`);
  return candidate;
}

function nullableString(value: unknown, label: string): string | null {
  if (value === null) return null;
  return stringValue(value, label);
}

function parseRun(value: unknown): ProductionTrackRecordRun {
  const run = objectValue(value, "Production workflow run");
  if (!Number.isInteger(run.runId) || Number(run.runId) <= 0) {
    throw new Error("Production workflow run ID is invalid");
  }
  const status = stringValue(run.status, "Production workflow status");
  const completedAt = run.completedAt === null
    ? null
    : isoValue(run.completedAt, "Production workflow completion time");
  if (status === "completed" && completedAt === null) {
    throw new Error("Completed production workflow run has no completion time");
  }
  return {
    runId: Number(run.runId),
    status,
    conclusion: nullableString(run.conclusion, "Production workflow conclusion"),
    createdAt: isoValue(run.createdAt, "Production workflow creation time"),
    completedAt,
    headSha: stringValue(run.headSha, "Production workflow revision"),
    url: stringValue(run.url, "Production workflow URL"),
  };
}

function source(epoch: ProductionMonitorEpoch, sourceStatus: "AVAILABLE" | "UNAVAILABLE") {
  return {
    provider: "GITHUB_ACTIONS_SNAPSHOT" as const,
    snapshotUrl: epoch.workflow.snapshotUrl,
    workflowUrl: epoch.workflow.url,
    sourceStatus,
  };
}

function assembleProductionTrackRecord(
  epoch: ProductionMonitorEpoch,
  runs: ProductionTrackRecordRun[],
  totalScheduledRunsSinceEpoch: number,
  generatedAt: string,
): ProductionTrackRecord {
  const epochTime = Date.parse(epoch.startedAt);
  if (!Number.isFinite(epochTime)) throw new Error("Production monitor epoch is invalid");
  if (!Number.isInteger(totalScheduledRunsSinceEpoch) || totalScheduledRunsSinceEpoch < runs.length) {
    throw new Error("Production workflow total count is invalid");
  }
  const uniqueRunIds = new Set<number>();
  const normalized = runs.map(parseRun).filter((run) => {
    if (Date.parse(run.createdAt) < epochTime) {
      throw new Error(`Production workflow run ${run.runId} predates the epoch`);
    }
    if (uniqueRunIds.has(run.runId)) {
      throw new Error(`Production workflow run ${run.runId} is duplicated`);
    }
    uniqueRunIds.add(run.runId);
    return true;
  }).sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt)).slice(0, 100);
  const completed = normalized.filter((run) => run.status === "completed");
  const successful = completed.filter((run) => run.conclusion === "success");
  const unsuccessful = completed.filter((run) => run.conclusion !== "success");
  const pending = normalized.filter((run) => run.status !== "completed");
  const chronological = [...normalized].sort(
    (left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt),
  );
  const status = completed.length === 0
    ? "COLLECTING"
    : unsuccessful.length > 0
      ? "DEGRADED"
      : "OPERATIONAL";

  return {
    schemaVersion: "positioncrew.production-track-record.v1",
    generatedAt: isoValue(generatedAt, "Production track-record generation time"),
    status,
    epoch,
    source: source(epoch, "AVAILABLE"),
    summary: {
      totalScheduledRunsSinceEpoch,
      observedRunCount: normalized.length,
      completedRuns: completed.length,
      successfulRuns: successful.length,
      unsuccessfulRuns: unsuccessful.length,
      pendingRuns: pending.length,
      rollingPassRatePct: completed.length > 0
        ? Number(((successful.length / completed.length) * 100).toFixed(2))
        : null,
      rollingWindowStartedAt: chronological[0]?.createdAt ?? null,
      rollingWindowEndedAt: chronological.at(-1)?.createdAt ?? null,
    },
    runs: normalized,
    boundary: epoch.boundary,
  };
}

export function emptyProductionTrackRecord(
  epoch: ProductionMonitorEpoch,
  generatedAt = epoch.startedAt,
): ProductionTrackRecord {
  return assembleProductionTrackRecord(epoch, [], 0, generatedAt);
}

export function parseProductionTrackRecordSnapshot(
  payload: unknown,
  epoch: ProductionMonitorEpoch,
): ProductionTrackRecord {
  const record = objectValue(payload, "Production track-record snapshot");
  if (record.schemaVersion !== "positioncrew.production-track-record.v1") {
    throw new Error("Production track-record snapshot schema is invalid");
  }
  const embeddedEpoch = objectValue(record.epoch, "Production track-record epoch");
  if (
    embeddedEpoch.schemaVersion !== epoch.schemaVersion ||
    embeddedEpoch.startedAt !== epoch.startedAt
  ) {
    throw new Error("Production track-record snapshot epoch does not match the committed epoch");
  }
  const summary = objectValue(record.summary, "Production track-record summary");
  if (!Array.isArray(record.runs)) throw new Error("Production track-record runs are missing");
  if (
    !Number.isInteger(summary.totalScheduledRunsSinceEpoch) ||
    Number(summary.totalScheduledRunsSinceEpoch) < 0
  ) {
    throw new Error("Production track-record total count is invalid");
  }
  return assembleProductionTrackRecord(
    epoch,
    record.runs.map(parseRun),
    Number(summary.totalScheduledRunsSinceEpoch),
    isoValue(record.generatedAt, "Production track-record generation time"),
  );
}

export function appendProductionTrackRecordRun(
  current: unknown,
  epoch: ProductionMonitorEpoch,
  run: ProductionTrackRecordRun,
  generatedAt = new Date().toISOString(),
): ProductionTrackRecord {
  const record = parseProductionTrackRecordSnapshot(current, epoch);
  const parsedRun = parseRun(run);
  const alreadyRecorded = record.runs.some((candidate) => candidate.runId === parsedRun.runId);
  const runs = [parsedRun, ...record.runs.filter((candidate) => candidate.runId !== parsedRun.runId)];
  return assembleProductionTrackRecord(
    epoch,
    runs,
    (record.summary.totalScheduledRunsSinceEpoch ?? record.runs.length) + (alreadyRecorded ? 0 : 1),
    generatedAt,
  );
}

export function unavailableProductionTrackRecord(
  epoch: ProductionMonitorEpoch,
  generatedAt = new Date().toISOString(),
): ProductionTrackRecord {
  return {
    ...emptyProductionTrackRecord(epoch, generatedAt),
    status: "SOURCE_UNAVAILABLE",
    source: source(epoch, "UNAVAILABLE"),
    summary: {
      totalScheduledRunsSinceEpoch: null,
      observedRunCount: 0,
      completedRuns: 0,
      successfulRuns: 0,
      unsuccessfulRuns: 0,
      pendingRuns: 0,
      rollingPassRatePct: null,
      rollingWindowStartedAt: null,
      rollingWindowEndedAt: null,
    },
  };
}
