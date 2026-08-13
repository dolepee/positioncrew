import { ZodError } from "zod";
import agentCaptureManifest from "../benchmarks/agent-capture-commitments-2026-08-12.json" with { type: "json" };
import erc8183Job489Deliverable from "../evidence/erc8183-job-489.deliverable.json" with { type: "json" };
import erc8183TestnetLedger from "../evidence/erc8183-jobs.testnet.json" with { type: "json" };
import {
  runBenchmarkRepeatability,
  runFixtureRequest,
  runFrozenFixture,
  runFrozenMatrix,
  runSuppliedLendingRequest,
  runTermixBenchmarkRepeatability,
} from "../src/api/fixture-jobs.js";
import type { TermixBenchmarkService } from "../src/benchmark/lock.js";
import { buildErc8183TestnetDeliverable } from "../src/commerce/erc8183-evidence.js";
import { PositionCrewRequestSchema } from "../src/contracts/index.js";
import { PROVIDER_CATALOG } from "../src/marketplace/catalog.js";
import {
  buildMarketplaceManifest,
  buildOpenApiDocument,
  buildProviderManifest,
  getProviderBySlug,
  getSchemaDocument,
} from "../src/marketplace/discovery.js";
import { getSystemTelemetry, inspectVenusAccount } from "../src/telemetry/bsc.js";

interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
}

const SERVICES = new Set([
  "LENDING_RESCUE",
  "LP_REBALANCE",
  "YIELD_OPTIMIZATION",
  "BOUNDED_GRID",
]);

type ServiceId = "LENDING_RESCUE" | "LP_REBALANCE" | "YIELD_OPTIMIZATION" | "BOUNDED_GRID";

const PROVIDER_SLUGS = new Map<string, ServiceId>(
  PROVIDER_CATALOG.map((provider) => [provider.slug, provider.service]),
);

const BENCHMARK_SLUGS = new Map<string, TermixBenchmarkService>([
  ["lending-rescue", "LENDING_RESCUE"],
  ["lp-rebalance", "LP_REBALANCE"],
  ["bounded-grid", "BOUNDED_GRID"],
]);

const API_HEADERS = {
  "Access-Control-Allow-Headers": "Accept, Content-Type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Origin": "*",
  "Content-Type": "application/json; charset=utf-8",
  "X-Content-Type-Options": "nosniff",
};

function json(body: unknown, status = 200, cacheControl = "no-store"): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...API_HEADERS, "Cache-Control": cacheControl },
  });
}

function apiError(status: number, error: string, details: unknown): Response {
  return json({ schemaVersion: "positioncrew.api-error.v1", error, details }, status);
}

async function jobs(request: Request, url: URL): Promise<Response> {
  if (request.method === "GET") {
    const service = url.searchParams.get("service");
    if (!service || !SERVICES.has(service)) {
      return apiError(400, "INVALID_SERVICE", [
        "service must name one of the four PositionCrew providers",
      ]);
    }
    return json(
      await runFrozenFixture(
        service as "LENDING_RESCUE" | "LP_REBALANCE" | "YIELD_OPTIMIZATION" | "BOUNDED_GRID",
      ),
    );
  }

  if (request.method === "POST") {
    const body: unknown = await request.json();
    if (typeof body !== "object" || body === null || !("request" in body)) {
      return apiError(422, "INVALID_JOB_REQUEST", ["body.request is required"]);
    }
    return json(await runFixtureRequest(PositionCrewRequestSchema.parse(body.request)));
  }

  return apiError(405, "METHOD_NOT_ALLOWED", ["Use GET or POST."]);
}

async function providerJobs(request: Request, service: ServiceId): Promise<Response> {
  if (request.method === "GET") return json(await runFrozenFixture(service));
  if (request.method !== "POST") return apiError(405, "METHOD_NOT_ALLOWED", ["Use GET or POST."]);

  const body: unknown = await request.json();
  if (typeof body !== "object" || body === null || !("request" in body)) {
    return apiError(422, "INVALID_JOB_REQUEST", ["body.request is required"]);
  }
  const parsed = PositionCrewRequestSchema.parse(body.request);
  if (parsed.service !== service) {
    return apiError(409, "PROVIDER_SERVICE_MISMATCH", [
      `This provider accepts ${service} requests, not ${parsed.service}.`,
    ]);
  }
  return json(await runFixtureRequest(parsed));
}

async function providerHealth(service: ServiceId): Promise<Response> {
  const startedAt = performance.now();
  const response = await runFrozenFixture(service);
  const provider = PROVIDER_CATALOG.find((candidate) => candidate.service === service);
  return json(
    {
      schemaVersion: "positioncrew.provider-health.v1",
      checkedAt: new Date().toISOString(),
      status: response.result.evaluation.passed ? "OPERATIONAL" : "DEGRADED",
      service,
      providerId: provider?.providerId,
      endpoint: provider?.endpoint,
      latencyMs: Math.max(1, Math.round(performance.now() - startedAt)),
      conformance: {
        score: response.result.evaluation.score,
        evaluationHash: response.result.evaluation.evaluationHash,
        receiptPath: response.receipt.path,
      },
    },
    200,
    "public, max-age=0, s-maxage=30, stale-while-revalidate=60",
  );
}

async function publicReceipt(hash: string): Promise<Response> {
  const matrix = await runFrozenMatrix();
  const response = matrix.find(
    (candidate) => candidate.result.evaluation.evaluationHash.toLowerCase() === hash.toLowerCase(),
  );
  if (!response) return apiError(404, "RECEIPT_NOT_FOUND", ["No public fixture receipt matches this hash."]);
  return json(
    {
      schemaVersion: "positioncrew.public-receipt.v1",
      publishedAt: response.generatedAt,
      receiptHash: response.result.evaluation.evaluationHash,
      claimBoundary: response.claimBoundary,
      request: response.result.request,
      deliverable: response.result.deliverable,
      job: response.result.job,
      evaluation: response.result.evaluation,
    },
    200,
    "public, max-age=3600, s-maxage=86400, immutable",
  );
}

async function rescue(request: Request): Promise<Response> {
  if (request.method === "GET") return json(await runFrozenFixture("LENDING_RESCUE"));

  if (request.method === "POST") {
    const body: unknown = await request.json();
    if (
      typeof body === "object" &&
      body !== null &&
      "mode" in body &&
      body.mode === "FROZEN_FIXTURE" &&
      "request" in body
    ) {
      return json(await runFixtureRequest(body.request));
    }
    return json(await runSuppliedLendingRequest(body));
  }

  return apiError(405, "METHOD_NOT_ALLOWED", ["Use GET or POST."]);
}

async function api(request: Request, url: URL): Promise<Response> {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: API_HEADERS });

  try {
    if (url.pathname === "/.well-known/positioncrew.json") {
      if (request.method !== "GET") return apiError(405, "METHOD_NOT_ALLOWED", ["Use GET."]);
      return json(
        buildMarketplaceManifest(url.origin),
        200,
        "public, max-age=0, s-maxage=300",
      );
    }

    if (url.pathname === "/openapi.json") {
      if (request.method !== "GET") return apiError(405, "METHOD_NOT_ALLOWED", ["Use GET."]);
      return json(buildOpenApiDocument(url.origin), 200, "public, max-age=0, s-maxage=300");
    }

    if (url.pathname === "/api/providers") {
      if (request.method !== "GET") return apiError(405, "METHOD_NOT_ALLOWED", ["Use GET."]);
      return json(
        {
          schemaVersion: "positioncrew.provider-catalog-response.v1",
          generatedAt: new Date().toISOString(),
          commerceAdapter: "PENDING_SUPPORTED_AACP_GUIDE",
          providers: PROVIDER_CATALOG,
        },
        200,
        "public, max-age=0, s-maxage=300",
      );
    }

    if (url.pathname === "/api/status") {
      if (request.method !== "GET") return apiError(405, "METHOD_NOT_ALLOWED", ["Use GET."]);
      return json(
        await getSystemTelemetry(),
        200,
        "public, max-age=0, s-maxage=15, stale-while-revalidate=30",
      );
    }

    if (url.pathname === "/api/benchmarks/repeatability") {
      if (request.method !== "GET") return apiError(405, "METHOD_NOT_ALLOWED", ["Use GET."]);
      return json(await runTermixBenchmarkRepeatability());
    }

    if (url.pathname === "/api/benchmarks/captures") {
      if (request.method !== "GET") return apiError(405, "METHOD_NOT_ALLOWED", ["Use GET."]);
      return json(agentCaptureManifest, 200, "public, max-age=0, s-maxage=300");
    }

    if (url.pathname === "/api/commerce/erc8183/jobs/489/deliverable") {
      if (request.method !== "GET") return apiError(405, "METHOD_NOT_ALLOWED", ["Use GET."]);
      return json(
        erc8183Job489Deliverable,
        200,
        "public, max-age=3600, s-maxage=86400, immutable",
      );
    }

    if (url.pathname === "/api/commerce/erc8183") {
      if (request.method !== "GET") return apiError(405, "METHOD_NOT_ALLOWED", ["Use GET."]);
      return json(
        erc8183TestnetLedger,
        200,
        "public, max-age=3600, s-maxage=86400, immutable",
      );
    }

    const erc8183DeliverableRoute = url.pathname.match(
      /^\/api\/commerce\/erc8183\/jobs\/(\d+)\/deliverable$/,
    );
    if (erc8183DeliverableRoute) {
      if (request.method !== "GET") return apiError(405, "METHOD_NOT_ALLOWED", ["Use GET."]);
      const deliverable = await buildErc8183TestnetDeliverable(
        Number.parseInt(erc8183DeliverableRoute[1]!, 10),
      );
      if (!deliverable) {
        return apiError(404, "ERC8183_DELIVERABLE_NOT_FOUND", ["Unknown testnet job ID."]);
      }
      return json(deliverable, 200, "public, max-age=3600, s-maxage=86400, immutable");
    }

    const benchmarkRoute = url.pathname.match(
      /^\/api\/benchmarks\/([^/]+)\/repeatability$/,
    );
    if (benchmarkRoute) {
      if (request.method !== "GET") return apiError(405, "METHOD_NOT_ALLOWED", ["Use GET."]);
      const service = BENCHMARK_SLUGS.get(benchmarkRoute[1]!);
      if (!service) return apiError(404, "BENCHMARK_NOT_FOUND", ["Unknown benchmark slug."]);
      return json(await runBenchmarkRepeatability(service));
    }

    const providerRoute = url.pathname.match(
      /^\/api\/providers\/([^/]+)\/(health|jobs)$/,
    );
    if (providerRoute) {
      const service = PROVIDER_SLUGS.get(providerRoute[1]!);
      if (!service) return apiError(404, "PROVIDER_NOT_FOUND", ["Unknown provider slug."]);
      if (providerRoute[2] === "health") {
        if (request.method !== "GET") return apiError(405, "METHOD_NOT_ALLOWED", ["Use GET."]);
        return providerHealth(service);
      }
      return providerJobs(request, service);
    }

    const providerManifestRoute = url.pathname.match(/^\/api\/providers\/([^/]+)\/manifest$/);
    if (providerManifestRoute) {
      if (request.method !== "GET") return apiError(405, "METHOD_NOT_ALLOWED", ["Use GET."]);
      const provider = getProviderBySlug(providerManifestRoute[1]!);
      if (!provider) return apiError(404, "PROVIDER_NOT_FOUND", ["Unknown provider slug."]);
      return json(
        buildProviderManifest(provider, url.origin),
        200,
        "public, max-age=0, s-maxage=300",
      );
    }

    const schemaRoute = url.pathname.match(/^\/api\/schemas\/([^/]+)$/);
    if (schemaRoute) {
      if (request.method !== "GET") return apiError(405, "METHOD_NOT_ALLOWED", ["Use GET."]);
      const schema = getSchemaDocument(decodeURIComponent(schemaRoute[1]!));
      if (!schema) return apiError(404, "SCHEMA_NOT_FOUND", ["Unknown schema identifier."]);
      return json(schema, 200, "public, max-age=3600, s-maxage=86400, immutable");
    }

    const receiptRoute = url.pathname.match(/^\/api\/receipts\/(sha256:[0-9a-fA-F]{64})$/);
    if (receiptRoute) {
      if (request.method !== "GET") return apiError(405, "METHOD_NOT_ALLOWED", ["Use GET."]);
      return publicReceipt(receiptRoute[1]!);
    }

    const venusAccountRoute = url.pathname.match(/^\/api\/wallets\/(0x[0-9a-fA-F]{40})\/venus$/);
    if (venusAccountRoute) {
      if (request.method !== "GET") return apiError(405, "METHOD_NOT_ALLOWED", ["Use GET."]);
      return json(
        await inspectVenusAccount(venusAccountRoute[1]!),
        200,
        "public, max-age=0, s-maxage=10, stale-while-revalidate=20",
      );
    }

    if (url.pathname === "/api/matrix") {
      if (request.method !== "GET") return apiError(405, "METHOD_NOT_ALLOWED", ["Use GET."]);
      return json(
        {
          schemaVersion: "positioncrew.provider-matrix-response.v1",
          results: await runFrozenMatrix(),
        },
        200,
        "public, max-age=0, s-maxage=300",
      );
    }

    if (url.pathname === "/api/jobs") return jobs(request, url);
    if (url.pathname === "/api/rescue") return rescue(request);
    return apiError(404, "NOT_FOUND", ["Unknown PositionCrew API route."]);
  } catch (error) {
    if (error instanceof ZodError) {
      return apiError(
        422,
        "INVALID_JOB_REQUEST",
        error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
      );
    }
    return apiError(500, "REQUEST_FAILED", [
      error instanceof Error ? error.message : "Unknown error",
    ]);
  }
}

function withSecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("X-Content-Type-Options", "nosniff");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (
      url.pathname.startsWith("/api/") ||
      url.pathname === "/openapi.json" ||
      url.pathname === "/.well-known/positioncrew.json"
    ) {
      return api(request, url);
    }

    return withSecurityHeaders(await env.ASSETS.fetch(request));
  },
};
