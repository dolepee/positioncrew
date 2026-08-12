import type { PositionCrewRequest } from "../contracts/index.js";
import { PROVIDER_IDS } from "../providers/index.js";

export interface ProviderListing {
  providerId: string;
  slug: string;
  name: string;
  service: PositionCrewRequest["service"];
  category: string;
  summary: string;
  method: "POST";
  endpoint: string;
  healthEndpoint: string;
  manifestEndpoint: string;
  requestSchema: string;
  deliverableSchema: string;
  price: { amount: "5"; token: "TEST_USDC"; chainId: 56 };
  availability: "FIXTURE_API_REACHABLE";
  verification: "DETERMINISTIC_CONFORMANCE";
  settlement: "IN_MEMORY_CONFORMANCE";
}

export const PROVIDER_CATALOG: readonly ProviderListing[] = [
  {
    providerId: PROVIDER_IDS.LENDING_RESCUE,
    slug: "lending-rescue",
    name: "Lending Rescue v1",
    service: "LENDING_RESCUE",
    category: "Health factor monitoring",
    summary: "Returns the smallest allowed repayment or collateral action that restores a stressed lending position.",
    method: "POST",
    endpoint: "/api/providers/lending-rescue/jobs",
    healthEndpoint: "/api/providers/lending-rescue/health",
    manifestEndpoint: "/api/providers/lending-rescue/manifest",
    requestSchema: "positioncrew.lending-rescue.request.v1",
    deliverableSchema: "positioncrew.lending-rescue.deliverable.v1",
    price: { amount: "5", token: "TEST_USDC", chainId: 56 },
    availability: "FIXTURE_API_REACHABLE",
    verification: "DETERMINISTIC_CONFORMANCE",
    settlement: "IN_MEMORY_CONFORMANCE",
  },
  {
    providerId: PROVIDER_IDS.LP_REBALANCE,
    slug: "lp-rebalance",
    name: "LP Range Operator v1",
    service: "LP_REBALANCE",
    category: "Rebalancing",
    summary: "Proposes a bounded range change only when projected fees clear swap and gas costs.",
    method: "POST",
    endpoint: "/api/providers/lp-rebalance/jobs",
    healthEndpoint: "/api/providers/lp-rebalance/health",
    manifestEndpoint: "/api/providers/lp-rebalance/manifest",
    requestSchema: "positioncrew.lp-rebalance.request.v1",
    deliverableSchema: "positioncrew.lp-rebalance.deliverable.v1",
    price: { amount: "5", token: "TEST_USDC", chainId: 56 },
    availability: "FIXTURE_API_REACHABLE",
    verification: "DETERMINISTIC_CONFORMANCE",
    settlement: "IN_MEMORY_CONFORMANCE",
  },
  {
    providerId: PROVIDER_IDS.YIELD_OPTIMIZATION,
    slug: "yield-optimization",
    name: "Yield Allocator v1",
    service: "YIELD_OPTIMIZATION",
    category: "Yield optimisation",
    summary: "Compares allowlisted venues after costs, liquidity, lockup, concentration, and risk limits.",
    method: "POST",
    endpoint: "/api/providers/yield-optimization/jobs",
    healthEndpoint: "/api/providers/yield-optimization/health",
    manifestEndpoint: "/api/providers/yield-optimization/manifest",
    requestSchema: "positioncrew.yield-optimization.request.v1",
    deliverableSchema: "positioncrew.yield-optimization.deliverable.v1",
    price: { amount: "5", token: "TEST_USDC", chainId: 56 },
    availability: "FIXTURE_API_REACHABLE",
    verification: "DETERMINISTIC_CONFORMANCE",
    settlement: "IN_MEMORY_CONFORMANCE",
  },
  {
    providerId: PROVIDER_IDS.BOUNDED_GRID,
    slug: "bounded-grid",
    name: "Bounded Grid Builder v1",
    service: "BOUNDED_GRID",
    category: "Grid trading",
    summary: "Builds or rejects a grid under explicit inventory, loss, liquidity, volatility, and expiry limits.",
    method: "POST",
    endpoint: "/api/providers/bounded-grid/jobs",
    healthEndpoint: "/api/providers/bounded-grid/health",
    manifestEndpoint: "/api/providers/bounded-grid/manifest",
    requestSchema: "positioncrew.bounded-grid.request.v1",
    deliverableSchema: "positioncrew.bounded-grid.deliverable.v1",
    price: { amount: "5", token: "TEST_USDC", chainId: 56 },
    availability: "FIXTURE_API_REACHABLE",
    verification: "DETERMINISTIC_CONFORMANCE",
    settlement: "IN_MEMORY_CONFORMANCE",
  },
] as const;
