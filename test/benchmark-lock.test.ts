import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { BenchmarkRubricSchema } from "../src/benchmark/contracts.js";
import {
  verifyLendingBenchmarkLock,
  verifyTermixBenchmarkLocks,
} from "../src/benchmark/lock.js";

describe("lending Agent Advantage benchmark lock", () => {
  it("binds the fixture, rubric, and blind protocol before outputs exist", () => {
    const records = verifyTermixBenchmarkLocks();

    expect(records.map((record) => record.slug)).toEqual([
      "lending-rescue",
      "lp-rebalance",
      "bounded-grid",
    ]);
    expect(records.map((record) => record.service)).toEqual([
      "LENDING_RESCUE",
      "LP_REBALANCE",
      "BOUNDED_GRID",
    ]);
    for (const { lock } of records) {
      expect(lock.fixtureHash).toMatch(/^sha256:[a-f0-9]{64}$/);
      expect(lock.rubricHash).toMatch(/^sha256:[a-f0-9]{64}$/);
      expect(lock.protocolHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    }
    expect(verifyLendingBenchmarkLock().taskId).toBe("venus-stressed-position-20260812-001");
  });

  it("pre-registers three 100-point rubrics with critical safety criteria", () => {
    const rubricPaths = [
      "benchmarks/lending-rescue/rubric.v1.json",
      "benchmarks/lp-rebalance/rubric.v1.json",
      "benchmarks/bounded-grid/rubric.v1.json",
    ];
    const rubrics = rubricPaths.map((path) =>
      BenchmarkRubricSchema.parse(JSON.parse(readFileSync(resolve(path), "utf8"))),
    );

    expect(rubrics.every((rubric) => rubric.criteria.reduce((sum, item) => sum + item.maximumScore, 0) === 100)).toBe(true);
    expect(rubrics[0]!.criteria.filter((item) => item.critical).map((item) => item.id)).toEqual([
      "evidence-integrity",
      "primary-rescue",
      "constraint-adherence",
    ]);
    expect(rubrics[1]!.criteria.filter((item) => item.critical).map((item) => item.id)).toEqual([
      "evidence-integrity",
      "replacement-range",
      "economics",
      "inventory-constraints",
    ]);
    expect(rubrics[2]!.criteria.filter((item) => item.critical).map((item) => item.id)).toEqual([
      "evidence-integrity",
      "grid-levels",
      "risk-bounds",
    ]);
  });
});
