export interface ProductionMonitorEpoch {
  schemaVersion: "positioncrew.production-monitor-epoch.v1";
  startedAt: string;
  baseUrl: string;
  workflow: {
    owner: string;
    repository: string;
    file: string;
    url: string;
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
    provider: "GITHUB_ACTIONS";
    apiUrl: string;
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

interface GitHubWorkflowRun {
  id: number;
  event: string;
  status: string;
  conclusion: string | null;
  created_at: string;
  updated_at: string;
  head_sha: string;
  html_url: string;
}

function objectValue(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("GitHub workflow response is not an object");
  }
  return value as Record<string, unknown>;
}

function stringValue(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} is missing`);
  }
  return value;
}

function nullableString(value: unknown, label: string): string | null {
  if (value === null) return null;
  return stringValue(value, label);
}

function parseRun(value: unknown): GitHubWorkflowRun {
  const run = objectValue(value);
  if (!Number.isInteger(run.id) || Number(run.id) <= 0) {
    throw new Error("GitHub workflow run ID is invalid");
  }
  return {
    id: Number(run.id),
    event: stringValue(run.event, "GitHub workflow event"),
    status: stringValue(run.status, "GitHub workflow status"),
    conclusion: nullableString(run.conclusion, "GitHub workflow conclusion"),
    created_at: stringValue(run.created_at, "GitHub workflow creation time"),
    updated_at: stringValue(run.updated_at, "GitHub workflow update time"),
    head_sha: stringValue(run.head_sha, "GitHub workflow revision"),
    html_url: stringValue(run.html_url, "GitHub workflow URL"),
  };
}

export function githubWorkflowRunsApiUrl(epoch: ProductionMonitorEpoch): string {
  const url = new URL(
    `https://api.github.com/repos/${epoch.workflow.owner}/${epoch.workflow.repository}/actions/workflows/${epoch.workflow.file}/runs`,
  );
  url.searchParams.set("event", epoch.workflow.event);
  url.searchParams.set("created", `>=${epoch.startedAt}`);
  url.searchParams.set("per_page", "100");
  return url.toString();
}

export function buildProductionTrackRecord(
  payload: unknown,
  epoch: ProductionMonitorEpoch,
  generatedAt = new Date().toISOString(),
): ProductionTrackRecord {
  const source = objectValue(payload);
  if (!Number.isInteger(source.total_count) || Number(source.total_count) < 0) {
    throw new Error("GitHub workflow total count is invalid");
  }
  if (!Array.isArray(source.workflow_runs)) {
    throw new Error("GitHub workflow runs are missing");
  }

  const epochTime = Date.parse(epoch.startedAt);
  if (!Number.isFinite(epochTime)) throw new Error("Production monitor epoch is invalid");
  const runs = source.workflow_runs
    .map(parseRun)
    .filter((run) => run.event === epoch.workflow.event && Date.parse(run.created_at) >= epochTime)
    .sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at))
    .map<ProductionTrackRecordRun>((run) => ({
      runId: run.id,
      status: run.status,
      conclusion: run.conclusion,
      createdAt: run.created_at,
      completedAt: run.status === "completed" ? run.updated_at : null,
      headSha: run.head_sha,
      url: run.html_url,
    }));

  const completed = runs.filter((run) => run.status === "completed");
  const successful = completed.filter((run) => run.conclusion === "success");
  const unsuccessful = completed.filter((run) => run.conclusion !== "success");
  const pending = runs.filter((run) => run.status !== "completed");
  const chronological = [...runs].sort(
    (left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt),
  );
  const status = completed.length === 0
    ? "COLLECTING"
    : unsuccessful.length > 0
      ? "DEGRADED"
      : "OPERATIONAL";

  return {
    schemaVersion: "positioncrew.production-track-record.v1",
    generatedAt,
    status,
    epoch,
    source: {
      provider: "GITHUB_ACTIONS",
      apiUrl: githubWorkflowRunsApiUrl(epoch),
      workflowUrl: epoch.workflow.url,
      sourceStatus: "AVAILABLE",
    },
    summary: {
      totalScheduledRunsSinceEpoch: Number(source.total_count),
      observedRunCount: runs.length,
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
    runs,
    boundary: epoch.boundary,
  };
}

export function unavailableProductionTrackRecord(
  epoch: ProductionMonitorEpoch,
  generatedAt = new Date().toISOString(),
): ProductionTrackRecord {
  return {
    schemaVersion: "positioncrew.production-track-record.v1",
    generatedAt,
    status: "SOURCE_UNAVAILABLE",
    epoch,
    source: {
      provider: "GITHUB_ACTIONS",
      apiUrl: githubWorkflowRunsApiUrl(epoch),
      workflowUrl: epoch.workflow.url,
      sourceStatus: "UNAVAILABLE",
    },
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
    runs: [],
    boundary: epoch.boundary,
  };
}
