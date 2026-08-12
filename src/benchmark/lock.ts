import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { canonicalHash } from "../core/canonical.js";
import { BenchmarkProtocolSchema, BenchmarkRubricSchema } from "./contracts.js";

export interface BenchmarkLock {
  schemaVersion: "positioncrew.benchmark-lock.v1";
  taskId: string;
  fixtureHash: string;
  rubricHash: string;
  protocolHash: string;
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function verifyLendingBenchmarkLock(root = process.cwd()): BenchmarkLock {
  const protocol = BenchmarkProtocolSchema.parse(
    readJson(resolve(root, "benchmarks/lending-rescue/protocol.v1.json")),
  );
  const rubric = BenchmarkRubricSchema.parse(readJson(resolve(root, protocol.rubricPath)));
  const fixture = readJson(resolve(root, protocol.fixturePath));
  if (rubric.taskId !== protocol.taskId) {
    throw new Error("Benchmark rubric and protocol task IDs do not match");
  }
  if (
    typeof fixture !== "object" ||
    fixture === null ||
    !("requestId" in fixture) ||
    fixture.requestId !== protocol.taskId
  ) {
    throw new Error("Benchmark fixture request ID does not match the locked protocol");
  }
  return {
    schemaVersion: "positioncrew.benchmark-lock.v1",
    taskId: protocol.taskId,
    fixtureHash: canonicalHash(fixture),
    rubricHash: canonicalHash(rubric),
    protocolHash: canonicalHash(protocol),
  };
}
