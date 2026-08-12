import { describe, expect, it } from "vitest";
import {
  CommerceStateError,
  MemoryCommerceAdapter,
} from "../src/commerce/memory-adapter.js";
import { canonicalHash } from "../src/core/canonical.js";

function envelope() {
  return {
    schemaVersion: "positioncrew.job-envelope.v1" as const,
    idempotencyKey: "test-job-idempotency-001",
    service: "LENDING_RESCUE" as const,
    requestId: "request-commerce-001",
    requestHash: canonicalHash({ fixture: 1 }),
    budget: {
      chainId: 97 as const,
      token: {
        symbol: "TEST_USDC",
        address: "0x0000000000000000000000000000000000001001",
        decimals: 6,
      },
      amount: "5",
    },
    createdAt: "2026-08-12T16:00:00.000Z",
    deadline: "2026-08-12T16:05:00.000Z",
  };
}

describe("memory commerce adapter", () => {
  it("makes job creation idempotent", async () => {
    const adapter = new MemoryCommerceAdapter();
    const first = await adapter.createJob(envelope());
    const second = await adapter.createJob(envelope());

    expect(second.jobId).toBe(first.jobId);
    expect(second.history).toHaveLength(1);
  });

  it("rejects an idempotency key reused with different terms", async () => {
    const adapter = new MemoryCommerceAdapter();
    await adapter.createJob(envelope());

    await expect(
      adapter.createJob({
        ...envelope(),
        budget: { ...envelope().budget, amount: "6" },
      }),
    ).rejects.toBeInstanceOf(CommerceStateError);
  });

  it("requires exact token and amount funding", async () => {
    const adapter = new MemoryCommerceAdapter();
    const job = await adapter.createJob(envelope());

    await expect(
      adapter.fund(job.jobId, {
        tokenAddress: envelope().budget.token.address,
        amount: "4.999999",
        transactionReference: "funding-reference-001",
        fundedAt: "2026-08-12T16:00:01.000Z",
      }),
    ).rejects.toThrow("exact token and budget");
  });

  it("fails closed for unknown jobs", async () => {
    const adapter = new MemoryCommerceAdapter();
    await expect(adapter.reconcile("job_unknown")).rejects.toThrow("Unknown job");
  });
});
