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
  endpoint: "/api/jobs";
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
