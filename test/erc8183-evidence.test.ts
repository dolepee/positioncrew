import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { keccak256, stringToHex } from "viem";

const MANIFEST_PATH = new URL("../evidence/erc8183-job-489.deliverable.json", import.meta.url);

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
});
