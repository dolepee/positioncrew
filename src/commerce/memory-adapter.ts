import { canonicalHash } from "../core/canonical.js";
import {
  DeliverableManifestSchema,
  EvaluationReceiptSchema,
  FundingReceiptSchema,
  JobEnvelopeSchema,
  type CommerceAdapter,
  type JobRecord,
} from "./types.js";

function copy(record: JobRecord): JobRecord {
  return structuredClone(record);
}

export class CommerceStateError extends Error {}

export class MemoryCommerceAdapter implements CommerceAdapter {
  readonly #jobs = new Map<string, JobRecord>();
  readonly #idempotency = new Map<string, string>();

  async createJob(input: unknown): Promise<JobRecord> {
    const envelope = JobEnvelopeSchema.parse(input);
    const envelopeHash = canonicalHash(envelope);
    const priorJobId = this.#idempotency.get(envelope.idempotencyKey);
    if (priorJobId) {
      const prior = this.requireJob(priorJobId);
      if (prior.envelopeHash !== envelopeHash) {
        throw new CommerceStateError(
          "Idempotency key was already used with a different job envelope",
        );
      }
      return copy(prior);
    }

    const jobId = `job_${canonicalHash({ envelopeHash }).slice(7, 31)}`;
    const record: JobRecord = {
      jobId,
      envelope,
      envelopeHash,
      state: "CREATED",
      providerId: null,
      evaluatorId: null,
      funding: null,
      deliverable: null,
      evaluation: null,
      history: [
        {
          state: "CREATED",
          at: envelope.createdAt,
          reference: envelopeHash,
        },
      ],
    };
    this.#jobs.set(jobId, record);
    this.#idempotency.set(envelope.idempotencyKey, jobId);
    return copy(record);
  }

  async fund(jobId: string, input: unknown): Promise<JobRecord> {
    const receipt = FundingReceiptSchema.parse(input);
    const job = this.requireJob(jobId);
    if (job.funding) {
      if (canonicalHash(job.funding) !== canonicalHash(receipt)) {
        throw new CommerceStateError("Job was already funded with a different receipt");
      }
      return copy(job);
    }
    this.requireState(job, ["CREATED"]);
    if (
      receipt.tokenAddress.toLowerCase() !== job.envelope.budget.token.address.toLowerCase() ||
      receipt.amount !== job.envelope.budget.amount
    ) {
      throw new CommerceStateError("Funding must match the exact token and budget amount");
    }
    job.funding = receipt;
    this.transition(job, "FUNDED", receipt.fundedAt, receipt.transactionReference);
    return copy(job);
  }

  async assignProvider(jobId: string, providerId: string): Promise<JobRecord> {
    const job = this.requireJob(jobId);
    if (job.providerId) {
      if (job.providerId !== providerId) {
        throw new CommerceStateError("Provider cannot be changed after assignment");
      }
      return copy(job);
    }
    this.requireState(job, ["FUNDED", "ASSIGNED"]);
    if (providerId.trim().length < 3) {
      throw new CommerceStateError("Provider identity is invalid");
    }
    job.providerId = providerId;
    this.markAssignedWhenReady(job);
    return copy(job);
  }

  async assignEvaluator(jobId: string, evaluatorId: string): Promise<JobRecord> {
    const job = this.requireJob(jobId);
    if (job.evaluatorId) {
      if (job.evaluatorId !== evaluatorId) {
        throw new CommerceStateError("Evaluator cannot be changed after assignment");
      }
      return copy(job);
    }
    this.requireState(job, ["FUNDED", "ASSIGNED"]);
    if (evaluatorId.trim().length < 3) {
      throw new CommerceStateError("Evaluator identity is invalid");
    }
    job.evaluatorId = evaluatorId;
    this.markAssignedWhenReady(job);
    return copy(job);
  }

  async submitDeliverable(jobId: string, input: unknown): Promise<JobRecord> {
    const manifest = DeliverableManifestSchema.parse(input);
    const job = this.requireJob(jobId);
    if (job.deliverable) {
      if (canonicalHash(job.deliverable) !== canonicalHash(manifest)) {
        throw new CommerceStateError("Deliverable cannot be replaced after submission");
      }
      return copy(job);
    }
    this.requireState(job, ["ASSIGNED"]);
    if (Date.parse(manifest.createdAt) > Date.parse(job.envelope.deadline)) {
      throw new CommerceStateError("Deliverable was submitted after the job deadline");
    }
    if (manifest.requestHash !== job.envelope.requestHash) {
      throw new CommerceStateError("Deliverable request commitment does not match the job");
    }
    job.deliverable = manifest;
    this.transition(job, "SUBMITTED", manifest.createdAt, manifest.deliverableHash);
    return copy(job);
  }

  async evaluate(jobId: string, input: unknown): Promise<JobRecord> {
    const receipt = EvaluationReceiptSchema.parse(input);
    const { evaluationHash, ...evaluationBody } = receipt;
    if (canonicalHash(evaluationBody) !== evaluationHash) {
      throw new CommerceStateError("Evaluation commitment is invalid");
    }
    const job = this.requireJob(jobId);
    if (job.evaluation) {
      if (canonicalHash(job.evaluation) !== canonicalHash(receipt)) {
        throw new CommerceStateError("Evaluation cannot be replaced after submission");
      }
      return copy(job);
    }
    this.requireState(job, ["SUBMITTED"]);
    if (!job.deliverable || receipt.deliverableHash !== job.deliverable.deliverableHash) {
      throw new CommerceStateError("Evaluation does not match the submitted deliverable");
    }
    if (
      receipt.requestHash !== job.envelope.requestHash ||
      receipt.evaluatorId !== job.evaluatorId
    ) {
      throw new CommerceStateError("Evaluation identity or request commitment mismatch");
    }
    job.evaluation = receipt;
    this.transition(job, "EVALUATED", receipt.evaluatedAt, receipt.evaluationHash);
    this.transition(
      job,
      receipt.passed ? "COMPLETED" : "REJECTED",
      receipt.evaluatedAt,
      receipt.evaluationHash,
    );
    return copy(job);
  }

  async reconcile(jobId: string): Promise<JobRecord> {
    return copy(this.requireJob(jobId));
  }

  private requireJob(jobId: string): JobRecord {
    const job = this.#jobs.get(jobId);
    if (!job) {
      throw new CommerceStateError(`Unknown job: ${jobId}`);
    }
    return job;
  }

  private requireState(job: JobRecord, allowed: JobRecord["state"][]): void {
    if (!allowed.includes(job.state)) {
      throw new CommerceStateError(
        `Job ${job.jobId} is ${job.state}; expected ${allowed.join(" or ")}`,
      );
    }
  }

  private markAssignedWhenReady(job: JobRecord): void {
    if (job.providerId && job.evaluatorId && job.state === "FUNDED") {
      this.transition(
        job,
        "ASSIGNED",
        job.funding?.fundedAt ?? job.envelope.createdAt,
        `${job.providerId}:${job.evaluatorId}`,
      );
    }
  }

  private transition(
    job: JobRecord,
    state: JobRecord["state"],
    at: string,
    reference: string,
  ): void {
    job.state = state;
    job.history.push({ state, at, reference });
  }
}
