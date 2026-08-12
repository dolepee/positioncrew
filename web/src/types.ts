export type ServiceId =
  | "LENDING_RESCUE"
  | "LP_REBALANCE"
  | "YIELD_OPTIMIZATION"
  | "BOUNDED_GRID";

export interface AssetIdentity {
  symbol: string;
  address: string;
  decimals: number;
}

export interface LendingAction {
  kind: "REPAY_DEBT" | "ADD_COLLATERAL";
  amount: string;
  amountBaseUnits: string;
  amountUsd: string;
  asset: AssetIdentity;
  projectedHealthFactor: string;
  estimatedGasUsd: string;
  executeBefore: string;
  maxSlippageBps: number;
  preconditions: string[];
}

export interface ProviderDeliverable {
  service: ServiceId;
  status: string;
  decision: string;
  summary: string;
  expiresAt: string;
  invalidationConditions?: string[];
  limitations?: string[];
  recommendation?: LendingAction | null;
  alternatives?: LendingAction[];
  position?: {
    collateralValueUsd: string;
    debtValueUsd: string;
    currentHealthFactor: string | null;
    stressedHealthFactor: string | null;
    targetHealthFactor: string;
  };
  proposedRange?: { lowerTick: number; upperTick: number } | null;
  expectedNetBenefitUsd?: string;
  estimatedRebalanceCostUsd?: string;
  breakEvenHours?: string | null;
  inventoryExposure?: { token0Bps: number; token1Bps: number };
  actionSteps?: string[];
  selectedOpportunityId?: string | null;
  allocationUsd?: string;
  grossApyBps?: number | null;
  currentWeightedApyBps?: number;
  netBenefitUsd?: string;
  migrationCostUsd?: string;
  breakEvenDays?: string | null;
  risks?: string[];
  orders?: Array<{
    side: "BUY" | "SELL";
    price: string;
    baseAmount: string;
    maximumQuoteAmount: string;
  }>;
  expectedNetProfitUsd?: string;
  worstCaseLossUsd?: string;
  maximumInventoryUsd?: string;
  cancellationConditions?: string[];
}

export interface JobHistoryEntry {
  state: string;
  at: string;
  reference: string;
}

export interface FixtureJobResponse {
  schemaVersion: "positioncrew.fixture-job-response.v1";
  evidenceMode: "FROZEN_BSC_TEST_FIXTURE" | "CALLER_SUPPLIED_OBSERVATIONS";
  commerceMode: "IN_MEMORY_CONFORMANCE";
  advantageStatus: "PENDING_INDEPENDENT_BLIND_EVALUATION";
  generatedAt: string;
  claimBoundary: string[];
  benchmarkLock: {
    fixtureHash: string;
    rubricHash: string;
    protocolHash: string;
  } | null;
  receipt: {
    mode: "PUBLIC_REPRODUCIBLE" | "SESSION_EMBEDDED";
    path: string | null;
    evaluationHash: string;
  };
  result: {
    job: {
      jobId: string;
      state: string;
      envelopeHash: string;
      providerId: string;
      evaluatorId: string;
      history: JobHistoryEntry[];
      deliverable: { deliverableHash: string };
    };
    request: {
      service: ServiceId;
      account: string;
      chainId: 56 | 97;
      maxActionUsd: string;
      maxGasUsd: string;
      maxSlippageBps: number;
      maxDataAgeSeconds: number;
      [key: string]: unknown;
    };
    deliverable: ProviderDeliverable;
    evaluation: {
      score: number;
      passed: boolean;
      evaluationHash: string;
      checks: Array<{ id: string; passed: boolean; critical: boolean }>;
    };
  };
}

export interface MatrixResponse {
  schemaVersion: "positioncrew.provider-matrix-response.v1";
  results: FixtureJobResponse[];
}

export interface ProviderListing {
  providerId: string;
  name: string;
  service: ServiceId;
  category: string;
  summary: string;
  method: "POST";
  endpoint: string;
  healthEndpoint: string;
  requestSchema: string;
  deliverableSchema: string;
  price: { amount: "5"; token: "TEST_USDC"; chainId: 56 };
  availability: "FIXTURE_API_REACHABLE";
  verification: "DETERMINISTIC_CONFORMANCE";
  settlement: "IN_MEMORY_CONFORMANCE";
}

export interface ProviderCatalogResponse {
  schemaVersion: "positioncrew.provider-catalog-response.v1";
  generatedAt: string;
  commerceAdapter: "PENDING_SUPPORTED_AACP_GUIDE";
  providers: ProviderListing[];
}

export interface SessionJob {
  response: FixtureJobResponse;
  responseTimeMs: number;
  ranAt: string;
}

export interface ChainProbe {
  chainId: 56 | 97;
  name: string;
  blockNumber: string;
  blockTimestamp: string;
  blockAgeSeconds: number;
  gasPriceGwei: string;
  rpcLatencyMs: number;
  rpcUrl: string;
  explorerUrl: string;
}

export interface SystemTelemetry {
  schemaVersion: "positioncrew.system-telemetry.v1";
  generatedAt: string;
  mainnet: ChainProbe;
  testnet: ChainProbe;
  market: {
    pair: "WBNB/USDT";
    venue: "PancakeSwap V3";
    poolAddress: string;
    feeTier: 100;
    spotPriceUsd: string;
    tick: number;
    liquidityRaw: string;
    observedAt: string;
    explorerUrl: string;
  };
  venus: {
    market: "vUSDT";
    address: string;
    supplyAprPct: string;
    borrowAprPct: string;
    availableLiquidityUsd: string;
    totalBorrowsUsd: string;
    observedAt: string;
    explorerUrl: string;
  };
  aacp: {
    chainId: 97;
    state: "CONTRACTS_VERIFIED_BACKEND_GATED";
    deployedCount: number;
    contractCount: number;
    contracts: Array<{
      name: string;
      address: string;
      deployed: boolean;
      explorerUrl: string;
    }>;
    docsUrl: string;
    boundary: string;
  };
}

export interface VenusAccountProbe {
  schemaVersion: "positioncrew.venus-account-probe.v1";
  generatedAt: string;
  chainId: 56;
  account: string;
  state: "NO_POSITION" | "LIQUID" | "SHORTFALL";
  nativeBalanceBnb: string;
  usdtBalance: string;
  liquidityUsd: string;
  shortfallUsd: string;
  enteredMarkets: string[];
  source: {
    comptroller: string;
    blockNumber: string;
    explorerUrl: string;
  };
  boundary: string;
}

export interface LendingRepeatabilityResponse {
  schemaVersion: "positioncrew.lending-repeatability.v1";
  generatedAt: string;
  taskId: string;
  status: "AGENT_RUNS_CAPTURED_MANUAL_PENDING";
  benchmarkLock: {
    fixtureHash: string;
    rubricHash: string;
    protocolHash: string;
  };
  runs: Array<{
    runId: string;
    elapsedMilliseconds: number;
    directCostUsd: "0.00";
    qualityScore: number;
    criticalFailureCount: number;
    outputHash: string;
  }>;
  medianElapsedMilliseconds: number;
  pending: ["MANUAL_BASELINE", "INDEPENDENT_BLIND_SCORECARD"];
  boundary: string;
}
