import { runFrozenFixture } from "../api/fixture-jobs.js";
import type { PositionCrewRequest } from "../contracts/index.js";
import { canonicalJson } from "../core/canonical.js";

const BASE_URL = "https://positioncrew.dolepee.com";

export const ERC8183_TESTNET_CONTRACTS = {
  commerce: "0xa206c0517B6371C6638CD9e4a42Cc9f02A33B0DE",
  router: "0xD7d36D66d2F1B608A0F943f722D27e3744f66F25",
  policy: "0xd6a4217588F6B1F5657a92A3e94E6422aD771cEA",
} as const;

export const ERC8183_TESTNET_JOBS = [
  { jobId: 490, slug: "lending-rescue", service: "LENDING_RESCUE", agentId: 1810 },
  { jobId: 491, slug: "lp-rebalance", service: "LP_REBALANCE", agentId: 1811 },
  { jobId: 492, slug: "yield-optimization", service: "YIELD_OPTIMIZATION", agentId: 1812 },
  { jobId: 493, slug: "bounded-grid", service: "BOUNDED_GRID", agentId: 1813 },
  { jobId: 494, slug: "yield-optimization", service: "YIELD_OPTIMIZATION", agentId: 1812 },
  { jobId: 495, slug: "bounded-grid", service: "BOUNDED_GRID", agentId: 1813 },
] as const satisfies ReadonlyArray<{
  jobId: number;
  slug: string;
  service: PositionCrewRequest["service"];
  agentId: number;
}>;

export async function buildErc8183TestnetDeliverable(jobId: number) {
  const job = ERC8183_TESTNET_JOBS.find((candidate) => candidate.jobId === jobId);
  if (!job) return null;

  const fixture = await runFrozenFixture(job.service);
  const receiptUrl = `${BASE_URL}${fixture.receipt.path}`;
  const delivery = {
    schemaVersion: "positioncrew.erc8183-delivery.v1",
    service: job.service,
    sourceMode: fixture.evidenceMode,
    advantageStatus: fixture.advantageStatus,
    request: fixture.result.request,
    deliverable: fixture.result.deliverable,
    evaluation: fixture.result.evaluation,
    commerceProof: {
      chainId: 97,
      jobId,
      paymentMode: "OPERATOR_CONTROLLED_TESTNET_ESCROW",
      paymentToken: "0xc70B8741B8B07A6d61E54fd4B20f22Fa648E5565",
      amountBaseUnits: "100000000000000000",
      providerAgentId: job.agentId,
    },
    claimBoundary: [
      ...fixture.claimBoundary,
      "This ERC-8183 job is operator-controlled BSC testnet evidence, not external demand, paid revenue, or Agent Advantage.",
    ],
    receiptUrl,
  };

  return {
    version: 1,
    job_id: jobId,
    chain_id: 97,
    contracts: ERC8183_TESTNET_CONTRACTS,
    response: {
      content: canonicalJson(delivery),
      content_type: "application/json",
    },
    metadata: {
      schemaVersion: "positioncrew.erc8183-deliverable-metadata.v1",
      service: job.service,
      providerAgentId: job.agentId,
      providerRegistry: "0x8004A818BFB912233c491871b3d84c89A494BD9e",
      providerWallet: "0x50da554F1bF6A86469DB201C56bfe967d2E7c43d",
      clientWallet: "0x939F689A1Aeef6FB2eEFe9Ba7386B6653bcbc6b3",
      operatorControlled: true,
      sourceMode: fixture.evidenceMode,
      sourceEndpoint: `${BASE_URL}/api/providers/${job.slug}/jobs`,
      receiptUrl,
      requestHash: fixture.result.evaluation.requestHash,
      deliverableHash: fixture.result.evaluation.deliverableHash,
      evaluationHash: fixture.result.evaluation.evaluationHash,
    },
  };
}
