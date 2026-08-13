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

export type JobRequestMode = "FROZEN_FIXTURE" | "CALLER_SUPPLIED_OBSERVATIONS";

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
  slug: string;
  name: string;
  service: ServiceId;
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
  position: {
    collateralValueUsd: string;
    liquidationWeightedCollateralUsd: string;
    debtValueUsd: string;
    healthFactor: string | null;
    markets: Array<{
      vToken: string;
      symbol: string;
      underlying: string;
      decimals: number;
      suppliedAmount: string;
      borrowedAmount: string;
      walletAmount: string;
      priceUsd: string;
      collateralFactorBps: number;
      liquidationThresholdBps: number;
      collateralEnabled: boolean;
    }>;
  };
  rescueRequest: FixtureJobResponse["result"]["request"] | null;
  source: {
    comptroller: string;
    blockNumber: string;
    explorerUrl: string;
  };
  boundary: string;
}

export interface PancakeGridProbe {
  schemaVersion: "positioncrew.pancake-grid-probe.v1";
  generatedAt: string;
  chainId: 56;
  state: "READY";
  market: {
    pair: "WBNB/USDT";
    poolAddress: string;
    feeTier: 100;
    spotPriceUsd: string;
    activeLiquidityUsd: string;
    reserveValueUsd: string;
    realizedVolatilityBps: number;
    volatilityWindowSeconds: number;
    volatilitySampleCount: number;
  };
  gridRequest: FixtureJobResponse["result"]["request"];
  source: {
    blockNumber: string;
    blockTimestamp: string;
    explorerUrl: string;
    poolExplorerUrl: string;
  };
  boundary: string;
}

export interface VenusYieldProbe {
  schemaVersion: "positioncrew.venus-yield-probe.v1";
  generatedAt: string;
  chainId: 56;
  state: "READY";
  markets: Array<{
    opportunityId: string;
    symbol: string;
    vToken: string;
    underlying: string;
    baseSupplyApyBps: number;
    availableLiquidityUsd: string;
  }>;
  yieldRequest: FixtureJobResponse["result"]["request"];
  source: {
    comptroller: string;
    oracle: string;
    blockNumber: string;
    blockTimestamp: string;
    measuredSecondsPerBlock: number;
    explorerUrl: string;
  };
  boundary: string;
}

export type TermixBenchmarkService = "LENDING_RESCUE" | "LP_REBALANCE" | "BOUNDED_GRID";
export type TermixBenchmarkSlug = "lending-rescue" | "lp-rebalance" | "bounded-grid";

export interface BenchmarkRepeatabilityResponse {
  schemaVersion: "positioncrew.benchmark-repeatability.v1";
  generatedAt: string;
  benchmarkSlug: TermixBenchmarkSlug;
  service: TermixBenchmarkService;
  taskId: string;
  status: "REPRODUCIBLE_AGENT_REPEATS_MANUAL_PENDING";
  benchmarkLock: {
    schemaVersion: "positioncrew.benchmark-lock.v1";
    taskId: string;
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

export interface BenchmarkRepeatabilityMatrixResponse {
  schemaVersion: "positioncrew.benchmark-repeatability-matrix.v1";
  generatedAt: string;
  records: BenchmarkRepeatabilityResponse[];
  pending: ["MANUAL_BASELINES", "INDEPENDENT_BLIND_SCORECARDS"];
  boundary: string;
}

export interface AgentCaptureManifestResponse {
  schemaVersion: "positioncrew.agent-capture-commitments.v1";
  createdAt: string;
  source: { repository: string; commitSha: string };
  benchmarks: Array<{
    benchmarkSlug: TermixBenchmarkSlug;
    sessionId: string;
    providerId: string;
    benchmarkLock: {
      schemaVersion: "positioncrew.benchmark-lock.v1";
      taskId: string;
      fixtureHash: string;
      rubricHash: string;
      protocolHash: string;
    };
    candidates: Array<{
      runNumber: number;
      candidateHash: string;
      outputHash: string;
      evaluationHash: string;
    }>;
  }>;
  boundary: string;
  manifestHash: string;
}

export interface Erc8183TestnetLedger {
  schemaVersion: "positioncrew.erc8183-testnet-ledger.v1";
  capturedAt: string;
  network: { name: string; chainId: 97; explorer: string };
  protocol: {
    name: string;
    commerce: string;
    router: string;
    policy: string;
    paymentToken: string;
    paymentTokenSymbol: "U";
    paymentTokenDecimals: 18;
    disputeWindowSeconds: 900;
    voteQuorum: 1;
    platformFeeBps: 0;
    deploymentSource: string;
    deploymentSourceCommit: string;
  };
  parties: {
    client: string;
    provider: string;
    relationship: "SAME_DISCLOSED_OPERATOR_SEPARATE_WALLETS";
  };
  summary: {
    completedLifecycles: number;
    fundedCompletedJobs: number;
    zeroPricePathProbes: number;
    mandatoryCategoriesCovered: number;
    totalEscrowBaseUnits: string;
    totalEscrowDisplay: string;
    externalBuyerJobs: 0;
    externalRevenue: "0";
  };
  claimBoundary: string[];
  jobs: Array<{
    jobId: number;
    service: ServiceId;
    providerAgentId: number;
    runType: "ZERO_PRICE_PATH_PROBE" | "FUNDED_CATEGORY_RECEIPT" | "FUNDED_REPEAT_RECEIPT";
    budgetBaseUnits: string;
    status: "COMPLETED";
    manifestUrl: string;
    manifestHash: string;
    transactions: {
      create: string;
      setBudget: string;
      register: string;
      fund: string;
      submit: string;
      settle: string;
    };
    completedAt: string;
    completionBlock: number;
  }>;
}
