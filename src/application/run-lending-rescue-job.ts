import type { LendingRescueRequest } from "../contracts/lending-rescue.js";
import { LendingRescueRequestSchema } from "../contracts/lending-rescue.js";
import { canonicalHash } from "../core/canonical.js";
import type { CommerceAdapter, JobRecord } from "../commerce/types.js";
import { evaluateLendingRescue } from "../evaluators/lending-rescue.js";
import { createLendingRescueDeliverable } from "../providers/lending-rescue.js";

const TEST_SETTLEMENT_TOKEN = {
  symbol: "TEST_USDC",
  address: "0x0000000000000000000000000000000000001001",
  decimals: 6,
} as const;

export interface LendingRescueJobResult {
  job: JobRecord;
  request: LendingRescueRequest;
  deliverable: ReturnType<typeof createLendingRescueDeliverable>;
  evaluation: ReturnType<typeof evaluateLendingRescue>;
}

export async function runLendingRescueJob(
  adapter: CommerceAdapter,
  requestInput: LendingRescueRequest,
  now: Date,
): Promise<LendingRescueJobResult> {
  const request = LendingRescueRequestSchema.parse(requestInput);
  const requestHash = canonicalHash(request);
  const providerId = "positioncrew:provider:lending-rescue:v1";
  const evaluatorId = "positioncrew:evaluator:lending-rescue:v1";
  let job = await adapter.createJob({
    schemaVersion: "positioncrew.job-envelope.v1",
    idempotencyKey: `lending:${request.requestId}`,
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

  const deliverable = createLendingRescueDeliverable(request, now);
  const deliverableHash = canonicalHash(deliverable);
  job = await adapter.submitDeliverable(job.jobId, {
    schemaVersion: "positioncrew.deliverable-manifest.v1",
    requestHash,
    deliverableHash,
    mediaType: "application/json",
    uri: `https://artifacts.positioncrew.invalid/${job.jobId}/${deliverableHash.slice(7)}.json`,
    createdAt: now.toISOString(),
  });

  const evaluation = evaluateLendingRescue(request, deliverable, evaluatorId, now);
  job = await adapter.evaluate(job.jobId, evaluation);
  return { job, request, deliverable, evaluation };
}
