import { z } from "zod";
import {
  BoundedGridDeliverableSchema,
  BoundedGridRequestSchema,
  LendingRescueDeliverableSchema,
  LendingRescueRequestSchema,
  LpRebalanceDeliverableSchema,
  LpRebalanceRequestSchema,
  YieldOptimizationDeliverableSchema,
  YieldOptimizationRequestSchema,
  type PositionCrewRequest,
} from "../contracts/index.js";
import { PROVIDER_CATALOG, type ProviderListing } from "./catalog.js";

type ServiceId = PositionCrewRequest["service"];

const SCHEMA_REGISTRY = new Map<string, z.ZodType>([
  ["positioncrew.lending-rescue.request.v1", LendingRescueRequestSchema],
  ["positioncrew.lending-rescue.deliverable.v1", LendingRescueDeliverableSchema],
  ["positioncrew.lp-rebalance.request.v1", LpRebalanceRequestSchema],
  ["positioncrew.lp-rebalance.deliverable.v1", LpRebalanceDeliverableSchema],
  ["positioncrew.yield-optimization.request.v1", YieldOptimizationRequestSchema],
  ["positioncrew.yield-optimization.deliverable.v1", YieldOptimizationDeliverableSchema],
  ["positioncrew.bounded-grid.request.v1", BoundedGridRequestSchema],
  ["positioncrew.bounded-grid.deliverable.v1", BoundedGridDeliverableSchema],
]);

function absolute(origin: string, path: string): string {
  return new URL(path, `${origin}/`).toString();
}

function componentName(schemaId: string): string {
  return schemaId
    .split(/[.-]/)
    .filter((part) => part !== "positioncrew" && part !== "v1")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

function schemaUrl(origin: string, schemaId: string): string {
  return absolute(origin, `/api/schemas/${schemaId}`);
}

export function getProviderBySlug(slug: string): ProviderListing | undefined {
  return PROVIDER_CATALOG.find((provider) => provider.slug === slug);
}

export function getSchemaDocument(schemaId: string): Record<string, unknown> | null {
  const schema = SCHEMA_REGISTRY.get(schemaId);
  if (!schema) return null;
  return {
    ...z.toJSONSchema(schema, { target: "draft-2020-12" }),
    $id: schemaId,
    title: schemaId,
  };
}

export function buildProviderManifest(
  provider: ProviderListing,
  origin: string,
  generatedAt = new Date(),
): Record<string, unknown> {
  return {
    schemaVersion: "positioncrew.provider-manifest.v1",
    generatedAt: generatedAt.toISOString(),
    provider: {
      providerId: provider.providerId,
      operator: "PositionCrew",
      relationship: "FIRST_PARTY",
      name: provider.name,
      service: provider.service,
      category: provider.category,
      summary: provider.summary,
    },
    identity: provider.identity,
    transport: {
      protocol: "HTTPS_JSON",
      job: {
        method: provider.method,
        url: absolute(origin, provider.endpoint),
        contentType: "application/json",
        bodyEnvelope: { request: `<${provider.requestSchema}>` },
      },
      health: {
        method: "GET",
        url: absolute(origin, provider.healthEndpoint),
      },
      schemas: {
        request: schemaUrl(origin, provider.requestSchema),
        deliverable: schemaUrl(origin, provider.deliverableSchema),
      },
    },
    pricing: provider.price,
    verification: {
      mode: provider.verification,
      healthUrl: absolute(origin, provider.healthEndpoint),
      catalogUrl: absolute(origin, "/api/providers"),
    },
    commerce: {
      settlement: provider.settlement,
      adapter: "PENDING_SUPPORTED_AACP_GUIDE",
      boundary:
        "The public endpoint runs a conformance lifecycle with TEST_USDC semantics. It does not claim paid AACP or mainnet settlement.",
    },
  };
}

export function buildMarketplaceManifest(
  origin: string,
  generatedAt = new Date(),
): Record<string, unknown> {
  return {
    schemaVersion: "positioncrew.marketplace-manifest.v1",
    generatedAt: generatedAt.toISOString(),
    name: "PositionCrew",
    operator: "PositionCrew",
    chain: { name: "BNB Smart Chain", chainId: 56 },
    identityNetwork: {
      name: "BNB Smart Chain Testnet",
      chainId: 97,
      protocol: "ERC-8004",
      registry: PROVIDER_CATALOG[0]?.identity.registry,
    },
    catalogUrl: absolute(origin, "/api/providers"),
    openApiUrl: absolute(origin, "/openapi.json"),
    providers: PROVIDER_CATALOG.map((provider) => ({
      providerId: provider.providerId,
      service: provider.service,
      identity: provider.identity,
      manifestUrl: absolute(origin, provider.manifestEndpoint),
      healthUrl: absolute(origin, provider.healthEndpoint),
    })),
    claims: {
      categoryCoverage: "4_OF_4",
      providerIdentity: "ERC8004_BSC_TESTNET_VERIFIED",
      settlement: "IN_MEMORY_CONFORMANCE",
      agentAdvantage: "PENDING_INDEPENDENT_BLIND_EVALUATION",
    },
  };
}

export function buildOpenApiDocument(origin: string): Record<string, unknown> {
  const schemas = Object.fromEntries(
    [...SCHEMA_REGISTRY.entries()].map(([schemaId, schema]) => [
      componentName(schemaId),
      z.toJSONSchema(schema, { target: "draft-2020-12" }),
    ]),
  );
  const paths = Object.fromEntries(
    PROVIDER_CATALOG.map((provider) => [
      provider.endpoint,
      {
        get: {
          summary: `Run the frozen ${provider.category.toLowerCase()} conformance fixture`,
          operationId: `get${componentName(provider.requestSchema)}Fixture`,
          responses: { "200": { description: "Completed conformance lifecycle" } },
        },
        post: {
          summary: provider.summary,
          operationId: `run${componentName(provider.requestSchema)}`,
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  additionalProperties: false,
                  required: ["request"],
                  properties: {
                    request: {
                      $ref: `#/components/schemas/${componentName(provider.requestSchema)}`,
                    },
                  },
                },
              },
            },
          },
          responses: {
            "200": {
              description: `Lifecycle receipt containing a ${provider.deliverableSchema} at result.deliverable`,
            },
            "409": { description: "Provider and requested service do not match" },
            "422": { description: "Request failed schema validation" },
          },
        },
      },
    ]),
  );
  return {
    openapi: "3.1.0",
    info: {
      title: "PositionCrew Provider API",
      version: "1.0.0",
      description:
        "Machine-readable contracts for four bounded BSC capital providers. Current settlement is an in-memory conformance rail, not paid AACP settlement.",
    },
    servers: [{ url: origin }],
    paths,
    components: { schemas },
  };
}

export function schemaIdsForService(service: ServiceId): [string, string] {
  const provider = PROVIDER_CATALOG.find((candidate) => candidate.service === service);
  if (!provider) throw new Error(`Unknown service: ${service}`);
  return [provider.requestSchema, provider.deliverableSchema];
}
