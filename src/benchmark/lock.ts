import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { canonicalHash } from "../core/canonical.js";
import {
  BenchmarkProtocolSchema,
  BenchmarkRubricSchema,
  type BenchmarkProtocol,
  type BenchmarkRubric,
} from "./contracts.js";

export interface BenchmarkLock {
  schemaVersion: "positioncrew.benchmark-lock.v1";
  taskId: string;
  fixtureHash: string;
  rubricHash: string;
  protocolHash: string;
}

export const TERMIX_BENCHMARK_DEFINITIONS = [
  {
    slug: "lending-rescue",
    service: "LENDING_RESCUE",
    protocolPath: "benchmarks/lending-rescue/protocol.v2.json",
  },
  {
    slug: "lp-rebalance",
    service: "LP_REBALANCE",
    protocolPath: "benchmarks/lp-rebalance/protocol.v2.json",
  },
  {
    slug: "bounded-grid",
    service: "BOUNDED_GRID",
    protocolPath: "benchmarks/bounded-grid/protocol.v2.json",
  },
] as const;

export type TermixBenchmarkDefinition = (typeof TERMIX_BENCHMARK_DEFINITIONS)[number];
export type TermixBenchmarkSlug = TermixBenchmarkDefinition["slug"];
export type TermixBenchmarkService = TermixBenchmarkDefinition["service"];

export interface BenchmarkLockRecord {
  slug: TermixBenchmarkSlug;
  service: TermixBenchmarkService;
  lock: BenchmarkLock;
}

export interface BenchmarkAssets extends BenchmarkLockRecord {
  protocol: BenchmarkProtocol;
  rubric: BenchmarkRubric;
  fixture: unknown;
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function verifyBenchmarkLock(
  slug: TermixBenchmarkSlug,
  root = process.cwd(),
): BenchmarkLockRecord {
  const { protocol, rubric, fixture, ...record } = loadBenchmarkAssets(slug, root);
  void protocol;
  void rubric;
  void fixture;
  return record;
}

export function loadBenchmarkAssets(
  slug: TermixBenchmarkSlug,
  root = process.cwd(),
): BenchmarkAssets {
  const definition = TERMIX_BENCHMARK_DEFINITIONS.find((candidate) => candidate.slug === slug);
  if (!definition) throw new Error(`Unknown benchmark slug: ${slug}`);
  const protocol = BenchmarkProtocolSchema.parse(
    readJson(resolve(root, definition.protocolPath)),
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
  if (!("service" in fixture) || fixture.service !== definition.service) {
    throw new Error("Benchmark fixture service does not match the benchmark definition");
  }
  return {
    slug: definition.slug,
    service: definition.service,
    lock: {
      schemaVersion: "positioncrew.benchmark-lock.v1",
      taskId: protocol.taskId,
      fixtureHash: canonicalHash(fixture),
      rubricHash: canonicalHash(rubric),
      protocolHash: canonicalHash(protocol),
    },
    protocol,
    rubric,
    fixture,
  };
}

export function verifyTermixBenchmarkLocks(root = process.cwd()): BenchmarkLockRecord[] {
  return TERMIX_BENCHMARK_DEFINITIONS.map((definition) =>
    verifyBenchmarkLock(definition.slug, root),
  );
}

export function verifyLendingBenchmarkLock(root = process.cwd()): BenchmarkLock {
  return verifyBenchmarkLock("lending-rescue", root).lock;
}
