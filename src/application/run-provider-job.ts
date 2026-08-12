import type { CommerceAdapter, JobRecord } from "../commerce/types.js";
import {
  CapitalOpsRequestSchema,
  type CapitalOpsDeliverable,
  type CapitalOpsRequest,
} from "../contracts/index.js";
import { canonicalHash } from "../core/canonical.js";
import { evaluateProviderConformance } from "../evaluators/provider-conformance.js";
import { executeProvider, PROVIDER_IDS } from "../providers/index.js";

const TEST_SETTLEMENT_TOKEN = {
  symbol: "TEST_USDC",
  address: "0x0000000000000000000000000000000000001001",
  decimals: 6,
} as const;

export interface ProviderJobResult {
  job: JobRecord;
  request: CapitalOpsRequest;
  deliverable: CapitalOpsDeliverable;
  evaluation: ReturnType<typeof evaluateProviderConformance>;
}

export async function runProviderJob(
  adapter: CommerceAdapter,
  requestInput: CapitalOpsRequest,
  now: Date,
): Promise<ProviderJobResult> {
  const request = CapitalOpsRequestSchema.parse(requestInput);
  const requestHash = canonicalHash(request);
  const providerId = PROVIDER_IDS[request.service];
  const evaluatorId = `capitalops:evaluator:${request.service.toLowerCase()}:v1`;
  let job = await adapter.createJob({
    schemaVersion: "capitalops.job-envelope.v1",
    idempotencyKey: `${request.service.toLowerCase()}:${request.requestId}`,
    service: request.service,
    requestId: request.requestId,
    requestHash,
    budget: {
      chainId: request.chainId,
      token: TEST_SETTLEMENT_TOKEN,
      amount: "5",
    },
    createdAt: now.toISOString(),
    deadline: request.deadline,
  });
  job = await adapter.fund(job.jobId, {
    tokenAddress: TEST_SETTLEMENT_TOKEN.address,
    amount: "5",
    transactionReference: `memory-funding:${job.jobId}`,
    fundedAt: now.toISOString(),
  });
  job = await adapter.assignProvider(job.jobId, providerId);
  job = await adapter.assignEvaluator(job.jobId, evaluatorId);

  const deliverable = executeProvider(request, now);
  const deliverableHash = canonicalHash(deliverable);
  job = await adapter.submitDeliverable(job.jobId, {
    schemaVersion: "capitalops.deliverable-manifest.v1",
    requestHash,
    deliverableHash,
    mediaType: "application/json",
    uri: `https://artifacts.capitalops.invalid/${job.jobId}/${deliverableHash.slice(7)}.json`,
    createdAt: now.toISOString(),
  });
  const evaluation = evaluateProviderConformance(
    request,
    deliverable,
    evaluatorId,
    now,
  );
  job = await adapter.evaluate(job.jobId, evaluation);
  return { job, request, deliverable, evaluation };
}
