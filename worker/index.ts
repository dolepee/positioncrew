import { ZodError } from "zod";
import {
  runFixtureRequest,
  runFrozenFixture,
  runFrozenMatrix,
  runSuppliedLendingRequest,
} from "../src/api/fixture-jobs.js";
import { PositionCrewRequestSchema } from "../src/contracts/index.js";
import { PROVIDER_CATALOG } from "../src/marketplace/catalog.js";

interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
}

const SERVICES = new Set([
  "LENDING_RESCUE",
  "LP_REBALANCE",
  "YIELD_OPTIMIZATION",
  "BOUNDED_GRID",
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
    if (url.pathname.startsWith("/api/")) return api(request, url);

    return withSecurityHeaders(await env.ASSETS.fetch(request));
  },
};
