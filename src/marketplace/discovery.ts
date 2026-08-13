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
        bodyEnvelope: {
          mode: "CALLER_SUPPLIED_OBSERVATIONS",
          request: `<${provider.requestSchema}>`,
        },
        evidenceModes: {
          default: "CALLER_SUPPLIED_OBSERVATIONS",
          lockedReceipt: "FROZEN_FIXTURE",
        },
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
    pricing: {
      ...provider.price,
      judgeTrial: {
        amount: "0",
        token: "NONE",
        walletRequired: false,
        settlement: "NO_PAYMENT",
      },
    },
    verification: {
      mode: provider.verification,
      healthUrl: absolute(origin, provider.healthEndpoint),
      catalogUrl: absolute(origin, "/api/providers"),
    },
    commerce: {
      settlement: provider.settlement,
      adapter: "AACP_PRODUCTION_ONBOARDING_PENDING",
      readinessUrl: absolute(origin, "/api/commerce/aacp"),
      boundary:
        "The public endpoint offers a no-wallet provider trial and runs an in-memory conformance lifecycle. The listed 5 TEST_USDC price is not collected by the trial. Funded ERC-8183 testnet evidence is disclosed separately. Production AACP contracts and onboarding state are independently reported, but no paid AACP order or revenue is claimed.",
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
    operatingRecordUrl: absolute(origin, "/api/operations/production"),
    marketplaceDeliveryEvidenceUrl: absolute(origin, "/api/benchmarks/marketplace-provenance"),
    aacpReadinessUrl: absolute(origin, "/api/commerce/aacp"),
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
      aacp: "PRODUCTION_ONBOARDING_PENDING",
      judgeTrial: "NO_WALLET_PROVIDER_CALL",
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
  const providerPaths = Object.fromEntries(
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
                    mode: {
                      type: "string",
                      enum: ["CALLER_SUPPLIED_OBSERVATIONS", "FROZEN_FIXTURE"],
                      default: "CALLER_SUPPLIED_OBSERVATIONS",
                      description:
                        "Use caller-supplied observations and timestamps for an interactive scenario. FROZEN_FIXTURE reproduces the historical public receipt and is not a current execution instruction.",
                    },
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
  const paths = {
    ...providerPaths,
    "/api/status": {
      get: {
        summary: "Read current BSC, PancakeSwap, Venus, and integration-boundary telemetry",
        operationId: "getSystemTelemetry",
        responses: { "200": { description: "Current public system telemetry" } },
      },
    },
    "/api/operations/production": {
      get: {
        summary: "Read the non-cherry-picked scheduled production verification record",
        operationId: "getProductionTrackRecord",
        responses: {
          "200": {
            description:
              "Every observed scheduled verification run after the fixed epoch, or a bounded source-unavailable record",
          },
        },
      },
    },
    "/api/benchmarks/marketplace-provenance": {
      get: {
        summary: "Read the precommitted public marketplace delivery record",
        operationId: "getMarketplaceInvocationEvidence",
        responses: {
          "200": {
            description:
              "Six retained no-retry Provider invocations with end-to-end timing and exact output commitments",
          },
        },
      },
    },
    "/api/commerce/aacp": {
      get: {
        summary: "Read verified TermiX production AACP deployment and PositionCrew onboarding state",
        operationId: "getAacpProductionReadiness",
        responses: {
          "200": {
            description:
              "Fail-closed BNB Chain contract probes and public Agent.family provider/listing discovery",
          },
        },
      },
    },
    "/api/wallets/{account}/venus": {
      get: {
        summary: "Convert a block-pinned Venus Classic account into an unsigned rescue request",
        operationId: "inspectVenusAccount",
        parameters: [{
          name: "account",
          in: "path",
          required: true,
          schema: { type: "string", pattern: "^0x[a-fA-F0-9]{40}$" },
        }],
        responses: {
          "200": { description: "Venus account probe and optional rescue request" },
          "500": { description: "Pinned reads were unavailable or failed reconciliation" },
        },
      },
    },
    "/api/markets/pancake/wbnb-usdt/grid": {
      get: {
        summary: "Build an unsigned bounded-grid request from one pinned PancakeSwap block",
        operationId: "inspectPancakeGridMarket",
        responses: {
          "200": { description: "Pinned Pancake market probe and unsigned grid request" },
          "500": { description: "Pinned market reads or minimum observation history were unavailable" },
        },
      },
    },
    "/api/positions/pancake/{tokenId}": {
      get: {
        summary: "Convert a block-pinned PancakeSwap V3 position NFT into an unsigned LP request",
        operationId: "inspectPancakePosition",
        parameters: [{
          name: "tokenId",
          in: "path",
          required: true,
          schema: { type: "string", pattern: "^[1-9][0-9]{0,77}$" },
        }],
        responses: {
          "200": { description: "Pinned LP position probe and unsigned rebalance request" },
          "500": { description: "Position, pool, oracle, fee, or swap-window reads were unavailable" },
        },
      },
    },
    "/api/markets/venus/stable-yields": {
      get: {
        summary: "Build an unsigned yield-allocation request from one pinned Venus block",
        operationId: "inspectVenusStableYields",
        responses: {
          "200": { description: "Pinned Venus stablecoin base-rate probe and unsigned allocation request" },
          "500": { description: "Pinned market, oracle, token, or gas reads were unavailable" },
        },
      },
    },
  };
  return {
    openapi: "3.1.0",
    info: {
      title: "PositionCrew Provider API",
      version: "1.0.0",
      description:
        "Machine-readable contracts for four bounded BSC capital providers. The no-wallet trial remains an in-memory conformance rail; production AACP readiness is reported separately and paid settlement is not yet claimed.",
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
