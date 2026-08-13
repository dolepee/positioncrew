import { describe, expect, it } from "vitest";
import epoch from "../evidence/production-monitor-epoch.json" with { type: "json" };
import {
  buildProductionTrackRecord,
  githubWorkflowRunsApiUrl,
  unavailableProductionTrackRecord,
  type ProductionMonitorEpoch,
} from "../src/operations/production-track-record.js";

const monitorEpoch = epoch as ProductionMonitorEpoch;

function run(
  id: number,
  createdAt: string,
  conclusion: string | null,
  event = "schedule",
  status = "completed",
) {
  return {
    id,
    event,
    status,
    conclusion,
    created_at: createdAt,
    updated_at: createdAt,
    head_sha: String(id).padStart(40, "0"),
    html_url: `https://github.com/dolepee/positioncrew/actions/runs/${id}`,
  };
}

describe("production track record", () => {
  it("includes every observed scheduled run after the fixed epoch", () => {
    const record = buildProductionTrackRecord(
      {
        total_count: 3,
        workflow_runs: [
          run(4, "2026-08-13T05:00:00.000Z", "failure"),
          run(3, "2026-08-13T04:30:00.000Z", null, "schedule", "in_progress"),
          run(2, "2026-08-13T04:00:00.000Z", "success"),
          run(1, "2026-08-13T03:59:59.000Z", "failure"),
          run(5, "2026-08-13T07:17:00.000Z", "success", "push"),
        ],
      },
      monitorEpoch,
      "2026-08-13T07:30:00.000Z",
    );

    expect(record.status).toBe("DEGRADED");
    expect(record.runs.map((candidate) => candidate.runId)).toEqual([4, 3, 2]);
    expect(record.summary).toMatchObject({
      totalScheduledRunsSinceEpoch: 3,
      observedRunCount: 3,
      completedRuns: 2,
      successfulRuns: 1,
      unsuccessfulRuns: 1,
      pendingRuns: 1,
      rollingPassRatePct: 50,
      rollingWindowStartedAt: "2026-08-13T04:00:00.000Z",
      rollingWindowEndedAt: "2026-08-13T05:00:00.000Z",
    });
  });

  it("reports a collecting state before the first scheduled sample", () => {
    const record = buildProductionTrackRecord(
      { total_count: 0, workflow_runs: [] },
      monitorEpoch,
      "2026-08-13T05:00:00.000Z",
    );
    expect(record.status).toBe("COLLECTING");
    expect(record.summary.rollingPassRatePct).toBeNull();
    expect(githubWorkflowRunsApiUrl(monitorEpoch)).toContain("event=schedule");
    expect(githubWorkflowRunsApiUrl(monitorEpoch)).toContain("per_page=100");
  });

  it("fails closed on a malformed source and exposes a bounded unavailable record", () => {
    expect(() => buildProductionTrackRecord({}, monitorEpoch)).toThrow(
      "GitHub workflow total count is invalid",
    );
    const record = unavailableProductionTrackRecord(monitorEpoch);
    expect(record.status).toBe("SOURCE_UNAVAILABLE");
    expect(record.source.sourceStatus).toBe("UNAVAILABLE");
    expect(record.summary.totalScheduledRunsSinceEpoch).toBeNull();
  });
});
