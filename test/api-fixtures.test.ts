import { describe, expect, it } from "vitest";
import { Buffer } from "node:buffer";
import lendingFixture from "../fixtures/lending-rescue/stressed-venus-position.v1.json" with { type: "json" };
import {
  runFixtureRequest,
  runFrozenFixture,
  runFrozenMatrix,
  runLendingRepeatability,
  runSuppliedLendingRequest,
} from "../src/api/fixture-jobs.js";
import { PROVIDER_CATALOG } from "../src/marketplace/catalog.js";

describe("public fixture job boundary", () => {
  it("returns an actionable rescue while declaring the non-onchain boundary", async () => {
    const response = await runFrozenFixture("LENDING_RESCUE");

    expect(response.result.job.state).toBe("COMPLETED");
    expect(response.result.deliverable.status).toBe("ACTIONABLE");
    expect(response.result.deliverable.service).toBe("LENDING_RESCUE");
    expect(response.commerceMode).toBe("IN_MEMORY_CONFORMANCE");
    expect(response.advantageStatus).toBe("PENDING_INDEPENDENT_BLIND_EVALUATION");
    expect(response.benchmarkLock?.fixtureHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(response.claimBoundary.join(" ")).toContain("not an AACP");
    expect(response.receipt.mode).toBe("PUBLIC_REPRODUCIBLE");
    expect(response.receipt.path).toBe(`/api/receipts/${response.result.evaluation.evaluationHash}`);

    const artifactManifest = response.result.job.deliverable;
    expect(artifactManifest).not.toBeNull();
    if (!artifactManifest) throw new Error("Completed job is missing its artifact manifest");
    const artifactUri = artifactManifest.uri;
    expect(artifactUri).toMatch(/^data:application\/json;base64,/);
    const artifact = JSON.parse(
      Buffer.from(artifactUri.slice(artifactUri.indexOf(",") + 1), "base64").toString("utf8"),
    );
    expect(artifact).toEqual(response.result.deliverable);
  });

  it("exposes all four required categories at equal conformance depth", async () => {
    const matrix = await runFrozenMatrix();

    expect(matrix.map((item) => item.result.request.service)).toEqual([
      "LENDING_RESCUE",
      "LP_REBALANCE",
      "YIELD_OPTIMIZATION",
      "BOUNDED_GRID",
    ]);
    expect(matrix.every((item) => item.result.evaluation.score === 100)).toBe(true);
    expect(matrix.every((item) => item.result.job.state === "COMPLETED")).toBe(true);
  });

  it("captures deterministic provider repeats without claiming agent advantage", async () => {
    const record = await runLendingRepeatability();

    expect(record.runs).toHaveLength(2);
    expect(record.runs.every((run) => run.qualityScore === 100)).toBe(true);
    expect(record.runs.every((run) => run.criticalFailureCount === 0)).toBe(true);
    expect(new Set(record.runs.map((run) => run.outputHash)).size).toBe(1);
    expect(record.pending).toEqual(["MANUAL_BASELINE", "INDEPENDENT_BLIND_SCORECARD"]);
    expect(record.boundary).toContain("Agent advantage is not claimed");
  });

  it("publishes one callable provider listing for every required category", () => {
    expect(PROVIDER_CATALOG.map((provider) => provider.service)).toEqual([
      "LENDING_RESCUE",
      "LP_REBALANCE",
      "YIELD_OPTIMIZATION",
      "BOUNDED_GRID",
    ]);
    expect(new Set(PROVIDER_CATALOG.map((provider) => provider.endpoint)).size).toBe(4);
    expect(PROVIDER_CATALOG.every((provider) => provider.endpoint.startsWith("/api/providers/") && provider.endpoint.endsWith("/jobs"))).toBe(true);
    expect(PROVIDER_CATALOG.every((provider) => provider.healthEndpoint.startsWith("/api/providers/") && provider.healthEndpoint.endsWith("/health"))).toBe(true);
    expect(PROVIDER_CATALOG.every((provider) => provider.settlement === "IN_MEMORY_CONFORMANCE")).toBe(true);
  });

  it("does not carry the locked benchmark onto a modified fixture", async () => {
    const modified = structuredClone(lendingFixture);
    modified.maxActionUsd = "100";
    const response = await runFixtureRequest(modified);

    expect(response.benchmarkLock).toBeNull();
    expect(response.receipt.mode).toBe("SESSION_EMBEDDED");
    expect(response.receipt.path).toBeNull();
    expect(response.result.deliverable.status).toBe("REFUSED_CONSTRAINTS");
  });

  it("fails closed when a supplied request is stale", async () => {
    const response = await runSuppliedLendingRequest(
      lendingFixture,
      new Date("2026-08-12T16:04:30.000Z"),
    );

    expect(response.result.deliverable.status).toBe("REFUSED_STALE_DATA");
    if (response.result.deliverable.service !== "LENDING_RESCUE") {
      throw new Error("Expected a lending rescue deliverable");
    }
    expect(response.result.deliverable.recommendation).toBeNull();
  });
});
