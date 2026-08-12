import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { BenchmarkRubricSchema } from "../src/benchmark/contracts.js";
import { verifyLendingBenchmarkLock } from "../src/benchmark/lock.js";

describe("lending Agent Advantage benchmark lock", () => {
  it("binds the fixture, rubric, and blind protocol before outputs exist", () => {
    const lock = verifyLendingBenchmarkLock();

    expect(lock.taskId).toBe("venus-stressed-position-20260812-001");
    expect(lock.fixtureHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(lock.rubricHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(lock.protocolHash).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it("pre-registers a 100-point rubric with critical safety criteria", () => {
    const rubric = BenchmarkRubricSchema.parse(
      JSON.parse(
        readFileSync(resolve("benchmarks/lending-rescue/rubric.v1.json"), "utf8"),
      ),
    );

    expect(rubric.criteria.reduce((sum, item) => sum + item.maximumScore, 0)).toBe(100);
    expect(rubric.criteria.filter((item) => item.critical).map((item) => item.id)).toEqual([
      "evidence-integrity",
      "primary-rescue",
      "constraint-adherence",
    ]);
  });
});
