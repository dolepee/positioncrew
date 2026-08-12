import { describe, expect, it } from "vitest";
import lendingFixture from "../fixtures/lending-rescue/stressed-venus-position.v1.json" with { type: "json" };
import {
  runFixtureRequest,
  runFrozenFixture,
  runFrozenMatrix,
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

  it("publishes one callable provider listing for every required category", () => {
    expect(PROVIDER_CATALOG.map((provider) => provider.service)).toEqual([
      "LENDING_RESCUE",
      "LP_REBALANCE",
      "YIELD_OPTIMIZATION",
      "BOUNDED_GRID",
    ]);
    expect(PROVIDER_CATALOG.every((provider) => provider.endpoint === "/api/jobs")).toBe(true);
    expect(PROVIDER_CATALOG.every((provider) => provider.settlement === "IN_MEMORY_CONFORMANCE")).toBe(true);
  });

  it("does not carry the locked benchmark onto a modified fixture", async () => {
    const modified = structuredClone(lendingFixture);
    modified.maxActionUsd = "100";
    const response = await runFixtureRequest(modified);

    expect(response.benchmarkLock).toBeNull();
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
