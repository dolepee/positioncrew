import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";

const baseUrl = new URL(
  process.env.POSITIONCREW_BASE_URL ?? "https://positioncrew.dolepee.com",
);
const outputPath = resolve(
  process.env.POSITIONCREW_HEALTH_OUTPUT ?? "/tmp/positioncrew-production-health.json",
);
const expectedServices = new Set([
  "LENDING_RESCUE",
  "LP_REBALANCE",
  "YIELD_OPTIMIZATION",
  "BOUNDED_GRID",
]);
const checks = [];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function localUrl(input) {
  const url = new URL(input, baseUrl);
  assert(url.origin === baseUrl.origin, `Refusing cross-origin discovery URL: ${url}`);
  return url;
}

async function fetchJson(name, input) {
  const url = localUrl(input);
  const startedAt = performance.now();
  const response = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "PositionCrew-Production-Monitor/1.0" },
    signal: AbortSignal.timeout(15_000),
  });
  const latencyMs = Math.max(1, Math.round(performance.now() - startedAt));
  const body = await response.json().catch(() => null);
  checks.push({ name, url: url.toString(), status: response.status, latencyMs });
  assert(response.ok, `${name} returned HTTP ${response.status}`);
  assert(body && typeof body === "object", `${name} did not return a JSON object`);
  return body;
}

const report = {
  schemaVersion: "positioncrew.production-health-report.v1",
  checkedAt: new Date().toISOString(),
  baseUrl: baseUrl.origin,
  status: "FAILED",
  checks,
  providers: [],
  error: null,
};

try {
  const marketplace = await fetchJson(
    "marketplace-manifest",
    "/.well-known/positioncrew.json",
  );
  assert(
    marketplace.schemaVersion === "positioncrew.marketplace-manifest.v1",
    "Unexpected marketplace manifest schema",
  );
  assert(Array.isArray(marketplace.providers), "Marketplace providers are missing");
  assert(marketplace.providers.length === 4, "Marketplace must expose exactly four providers");
  assert(
    marketplace.claims?.settlement === "IN_MEMORY_CONFORMANCE",
    "Marketplace settlement boundary changed unexpectedly",
  );

  const openApi = await fetchJson("openapi", marketplace.openApiUrl);
  assert(openApi.openapi === "3.1.0", "OpenAPI version is not 3.1.0");
  assert(Object.keys(openApi.paths ?? {}).length === 4, "OpenAPI does not expose four job paths");

  for (const entry of marketplace.providers) {
    assert(expectedServices.has(entry.service), `Unexpected provider service: ${entry.service}`);
    const manifest = await fetchJson(`${entry.service}:manifest`, entry.manifestUrl);
    assert(manifest.provider?.service === entry.service, `${entry.service} manifest mismatch`);
    assert(manifest.provider?.relationship === "FIRST_PARTY", `${entry.service} ownership is unclear`);
    assert(
      manifest.commerce?.settlement === "IN_MEMORY_CONFORMANCE",
      `${entry.service} settlement boundary changed unexpectedly`,
    );

    const health = await fetchJson(`${entry.service}:health`, manifest.transport?.health?.url);
    assert(health.status === "OPERATIONAL", `${entry.service} is ${health.status}`);
    assert(health.conformance?.score === 100, `${entry.service} conformance is not 100/100`);

    const requestSchema = await fetchJson(
      `${entry.service}:request-schema`,
      manifest.transport?.schemas?.request,
    );
    const deliverableSchema = await fetchJson(
      `${entry.service}:deliverable-schema`,
      manifest.transport?.schemas?.deliverable,
    );
    assert(requestSchema.type === "object", `${entry.service} request schema is invalid`);
    assert(deliverableSchema.type === "object", `${entry.service} deliverable schema is invalid`);

    const job = await fetchJson(`${entry.service}:job`, manifest.transport?.job?.url);
    assert(job.result?.request?.service === entry.service, `${entry.service} job routed incorrectly`);
    assert(job.result?.job?.state === "COMPLETED", `${entry.service} job did not complete`);
    assert(job.result?.evaluation?.score === 100, `${entry.service} job score is not 100/100`);

    report.providers.push({
      providerId: manifest.provider.providerId,
      service: entry.service,
      health: health.status,
      conformanceScore: health.conformance.score,
      jobState: job.result.job.state,
      evaluationHash: job.result.evaluation.evaluationHash,
    });
  }

  assert(
    new Set(report.providers.map((provider) => provider.service)).size === 4,
    "Provider services are duplicated",
  );
  report.status = "OPERATIONAL";
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
} finally {
  report.completedAt = new Date().toISOString();
  report.checkCount = checks.length;
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(report, null, 2));
  console.log(`Production health report: ${outputPath}`);
}
