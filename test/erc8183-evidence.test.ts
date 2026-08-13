import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { keccak256, stringToHex } from "viem";
import {
  buildErc8183TestnetDeliverable,
  ERC8183_TESTNET_JOBS,
} from "../src/commerce/erc8183-evidence.js";

const MANIFEST_PATH = new URL("../evidence/erc8183-job-489.deliverable.json", import.meta.url);
const LEDGER_PATH = new URL("../evidence/erc8183-jobs.testnet.json", import.meta.url);

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;

  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`);
  return `{${entries.join(",")}}`;
}

describe("ERC-8183 public evidence", () => {
  it("binds job 489 to a stable, honestly bounded delivery", async () => {
    const manifest = JSON.parse(await readFile(MANIFEST_PATH, "utf8")) as {
      version: number;
      job_id: number;
      chain_id: number;
      contracts: Record<string, string>;
      response: { content: string; content_type: string };
      metadata: Record<string, unknown>;
    };
    const delivery = JSON.parse(manifest.response.content) as {
      sourceMode: string;
      status: string;
      decision: string;
      claimBoundary: string[];
    };

    expect(manifest.version).toBe(1);
    expect(manifest.job_id).toBe(489);
    expect(manifest.chain_id).toBe(97);
    expect(manifest.contracts.policy).toBe(
      "0xd6a4217588F6B1F5657a92A3e94E6422aD771cEA",
    );
    expect(manifest.response.content_type).toBe("application/json");
    expect(delivery.sourceMode).toBe("FROZEN_BSC_TEST_FIXTURE");
    expect(delivery.status).toBe("ACTIONABLE");
    expect(delivery.decision).toBe("REPAY_DEBT");
    expect(delivery.claimBoundary).toContain(
      "The 100/100 score is deterministic conformance, not an agent-advantage claim.",
    );

    expect(keccak256(stringToHex(canonicalJson(manifest)))).toBe(
      "0x954821354fa5e5e501e785d40a1c1772c9a4d35de900f84d31952bead8372880",
    );
  });

  it("builds immutable category-bound manifests for every funded job", async () => {
    const hashes = new Set<string>();

    for (const job of ERC8183_TESTNET_JOBS) {
      const manifest = await buildErc8183TestnetDeliverable(job.jobId);
      expect(manifest).not.toBeNull();
      if (!manifest) continue;

      const delivery = JSON.parse(manifest.response.content) as {
        service: string;
        advantageStatus: string;
        commerceProof: { jobId: number; paymentMode: string };
        claimBoundary: string[];
      };
      expect(manifest.job_id).toBe(job.jobId);
      expect(delivery.service).toBe(job.service);
      expect(delivery.commerceProof.jobId).toBe(job.jobId);
      expect(delivery.commerceProof.paymentMode).toBe(
        "OPERATOR_CONTROLLED_TESTNET_ESCROW",
      );
      expect(delivery.advantageStatus).toBe("PENDING_INDEPENDENT_BLIND_EVALUATION");
      expect(delivery.claimBoundary.at(-1)).toContain("not external demand");
      hashes.add(keccak256(stringToHex(canonicalJson(manifest))));
    }

    expect(hashes.size).toBe(ERC8183_TESTNET_JOBS.length);
    expect(await buildErc8183TestnetDeliverable(999_999)).toBeNull();
  });

  it("keeps the public ledger internally consistent without inflating external demand", async () => {
    const ledger = JSON.parse(await readFile(LEDGER_PATH, "utf8")) as {
      summary: {
        completedLifecycles: number;
        fundedCompletedJobs: number;
        mandatoryCategoriesCovered: number;
        totalEscrowBaseUnits: string;
        externalBuyerJobs: number;
        externalRevenue: string;
      };
      jobs: Array<{
        jobId: number;
        service: string;
        runType: string;
        budgetBaseUnits: string;
        status: string;
        manifestUrl: string;
        manifestHash: string;
        transactions: { settle: string };
      }>;
    };

    expect(ledger.jobs).toHaveLength(ledger.summary.completedLifecycles);
    expect(ledger.jobs.filter((job) => BigInt(job.budgetBaseUnits) > 0n)).toHaveLength(
      ledger.summary.fundedCompletedJobs,
    );
    expect(
      new Set(
        ledger.jobs
          .filter((job) => job.runType === "FUNDED_CATEGORY_RECEIPT")
          .map((job) => job.service),
      ).size,
    ).toBe(ledger.summary.mandatoryCategoriesCovered);
    expect(
      ledger.jobs.reduce((total, job) => total + BigInt(job.budgetBaseUnits), 0n),
    ).toBe(BigInt(ledger.summary.totalEscrowBaseUnits));
    expect(ledger.jobs.every((job) => job.status === "COMPLETED")).toBe(true);
    expect(ledger.jobs.every((job) => job.manifestUrl.startsWith("https://positioncrew.dolepee.com/"))).toBe(true);
    expect(ledger.jobs.every((job) => /^0x[0-9a-f]{64}$/.test(job.manifestHash))).toBe(true);
    expect(ledger.jobs.every((job) => /^0x[0-9a-f]{64}$/.test(job.transactions.settle))).toBe(true);
    expect(ledger.summary.externalBuyerJobs).toBe(0);
    expect(ledger.summary.externalRevenue).toBe("0");
  });
});
