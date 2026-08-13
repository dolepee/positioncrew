import type { PositionCrewRequest } from "../contracts/index.js";
import { PROVIDER_IDS } from "../providers/ids.js";

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
  price: { amount: "5"; token: "TEST_USDC"; chainId: 97 };
  identity: {
    protocol: "ERC-8004";
    network: "BSC_TESTNET";
    chainId: 97;
    registry: string;
    agentId: number;
    owner: string;
    registrationTransaction: string;
    explorerUrl: string;
  };
  availability: "FIXTURE_API_REACHABLE";
  verification: "DETERMINISTIC_CONFORMANCE";
  settlement: "IN_MEMORY_CONFORMANCE";
}

const IDENTITY_REGISTRY = "0x8004A818BFB912233c491871b3d84c89A494BD9e";
const IDENTITY_OWNER = "0x50da554F1bF6A86469DB201C56bfe967d2E7c43d";

function identity(agentId: number, registrationTransaction: string): ProviderListing["identity"] {
  return {
    protocol: "ERC-8004",
    network: "BSC_TESTNET",
    chainId: 97,
    registry: IDENTITY_REGISTRY,
    agentId,
    owner: IDENTITY_OWNER,
    registrationTransaction,
    explorerUrl: `https://testnet.bscscan.com/tx/${registrationTransaction}`,
  };
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
    price: { amount: "5", token: "TEST_USDC", chainId: 97 },
    identity: identity(1810, "0x828b810e1dc5f3e30859afbeb5a74deb728ed60c5d7cce09e9b44ed4be07aaaf"),
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
    price: { amount: "5", token: "TEST_USDC", chainId: 97 },
    identity: identity(1811, "0x7e94ae42091364cd110db183bb32055db3238008e8804dffc426dae76e393168"),
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
    price: { amount: "5", token: "TEST_USDC", chainId: 97 },
    identity: identity(1812, "0xfeb0d02eaa3a57c237d22a4d574497493e28e96b19dbbb363a127d23206a29da"),
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
    price: { amount: "5", token: "TEST_USDC", chainId: 97 },
    identity: identity(1813, "0x8466e273149a1178e15db544964de83767450450ec334abb61e9cd24df95bbb4"),
    availability: "FIXTURE_API_REACHABLE",
    verification: "DETERMINISTIC_CONFORMANCE",
    settlement: "IN_MEMORY_CONFORMANCE",
  },
] as const;
