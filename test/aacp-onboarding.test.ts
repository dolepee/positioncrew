import { describe, expect, it } from "vitest";
import {
  AacpAgentPreparePayloadSchema,
  buildAacpOnboardingManifest,
  inspectAacpOnboardingWallet,
} from "../src/commerce/aacp-onboarding.js";
import {
  AACP_BSC_API,
  AACP_PROVIDER_BLUEPRINTS,
} from "../src/commerce/aacp-production.js";

const OWNER = "0x4444444444444444444444444444444444444444";

const ADDRESSES = {
  identity: "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432",
  reputation: "0xFf3f7038c4919A420B30D7B3533cb386D5898189",
  usdc: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
  usdt: "0x55d398326f99059fF775485246999027B3197955",
  usdcEscrow: "0x6A52ba4C84b348FaEAe13dDC7A97b4F6af23913C",
  usdtEscrow: "0xCE02f987D8b8AF694E13C8a843Db9c77caBF544c",
  usdcStaking: "0x0Bd066f5113e6B8336b06F8Aa3EF90D37F7e65FC",
  usdtStaking: "0x1DcafFB7275fa2650d480a4F939A0C0D5874750B",
  usdcCampaign: "0x5BaE7834B32a4b357F65dd20248068993466D294",
  usdtCampaign: "0x16261F2BCbE8Ee47065C5ecB4be32c1571289809",
};

function descriptor(name: string, address: string) {
  return { name, address, abi: "[]", configured: true };
}

function config() {
  const usdc = {
    symbol: "USDC",
    decimals: 18,
    address: ADDRESSES.usdc,
    default: true,
    protocolFeeBps: 200,
    providerLockBps: 0,
    contracts: {
      escrow: ADDRESSES.usdcEscrow,
      staking: ADDRESSES.usdcStaking,
      campaignVault: ADDRESSES.usdcCampaign,
    },
  };
  const usdt = {
    symbol: "USDT",
    decimals: 18,
    address: ADDRESSES.usdt,
    default: false,
    protocolFeeBps: 200,
    providerLockBps: 0,
    contracts: {
      escrow: ADDRESSES.usdtEscrow,
      staking: ADDRESSES.usdtStaking,
      campaignVault: ADDRESSES.usdtCampaign,
    },
  };
  return {
    environment: "production",
    chainId: 56,
    network: "bnb-chain",
    networkLabel: "BNB Chain",
    explorerBaseUrl: "https://bscscan.com",
    protocolFeeBps: 200,
    campaignProtocolFeeBps: 200,
    settlementCurrency: {
      symbol: usdc.symbol,
      decimals: usdc.decimals,
      address: usdc.address,
    },
    settlementCurrencies: [usdc, usdt],
    settlementChains: [{ id: 56, name: "BNB Chain", default: true, explorerBaseUrl: "https://bscscan.com" }],
    contracts: {
      identityRegistry: descriptor("IdentityRegistry", ADDRESSES.identity),
      agentNft: descriptor("AgentNFT", ADDRESSES.identity),
      escrow: descriptor("TermixEscrow", ADDRESSES.usdcEscrow),
      staking: descriptor("TermixStaking", ADDRESSES.usdcStaking),
      reputation: descriptor("TermixReputation", ADDRESSES.reputation),
      usdc: descriptor("USDC", ADDRESSES.usdc),
      campaignVault: descriptor("CampaignVault", ADDRESSES.usdcCampaign),
    },
  };
}

function mockedFetch(chainId = "0x38") {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url === `${AACP_BSC_API}/api/v1/config/contracts`) {
      return new Response(JSON.stringify(config()), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    const requests = JSON.parse(String(init?.body)) as Array<{ id: number; method: string }>;
    const quantities = [
      chainId,
      `0x${(223n * 10n ** 14n).toString(16)}`,
      "0x0",
      `0x${(10n * 10n ** 18n).toString(16)}`,
    ];
    return new Response(JSON.stringify(requests.map((request, index) => ({
      jsonrpc: "2.0",
      id: request.id,
      result: quantities[index],
    }))), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
}

describe("TermiX onboarding preflight", () => {
  it("builds four strict, distinct agent and listing payloads without adjudication roles", () => {
    const manifest = buildAacpOnboardingManifest(
      OWNER,
      new Date("2026-08-13T08:00:00.000Z"),
    );

    expect(manifest.entries).toHaveLength(4);
    expect(new Set(manifest.entries.map((entry) => entry.agent.name)).size).toBe(4);
    expect(manifest.entries.map((entry) => entry.agent.name)).toEqual(
      AACP_PROVIDER_BLUEPRINTS.map((provider) => provider.mintName),
    );
    expect(manifest.entries.every((entry) => !entry.agent.name.includes(".agent"))).toBe(true);
    expect(new Set(manifest.entries.map((entry) => entry.listing.skillTag)).size).toBe(4);
    expect(manifest.entries.every((entry) => entry.listing.basePrice === "5")).toBe(true);
    expect(manifest.entries.every((entry) => entry.listing.currency === "USDT")).toBe(true);
    expect(manifest.entries.every((entry) => !("roles" in entry.agent))).toBe(true);
    expect(manifest.walletSignedAgentMints).toBe(4);
    expect(manifest.offchainListingPublishes).toBe(4);
  });

  it("rejects canonical handles and malformed names in mint prepare payloads", () => {
    expect(() => AacpAgentPreparePayloadSchema.parse({
      name: "positioncrew-lending-rescue.agent",
      displayName: "PositionCrew Lending Rescue",
      category: "Market & Protocol Research",
      description: "Computes a bounded lending rescue from pinned market evidence.",
      tags: ["Venus"],
    })).toThrow("base names without @ or .agent");

    expect(() => AacpAgentPreparePayloadSchema.parse({
      name: "@positioncrew-lending-rescue",
      displayName: "PositionCrew Lending Rescue",
      category: "Market & Protocol Research",
      description: "Computes a bounded lending rescue from pinned market evidence.",
      tags: ["Venus"],
    })).toThrow("base names without @ or .agent");
  });

  it("reads gas and settlement balances without signing or writing", async () => {
    const readiness = await inspectAacpOnboardingWallet(OWNER, {
      fetchImpl: mockedFetch(),
      now: new Date("2026-08-13T08:00:00.000Z"),
    });

    expect(readiness.chainId).toBe(56);
    expect(readiness.nativeGas).toMatchObject({ display: "0.0223", present: true });
    expect(readiness.currencies.find((currency) => currency.symbol === "USDC")).toMatchObject({
      display: "0",
      canFundOneFlagshipOrder: null,
    });
    expect(readiness.currencies.find((currency) => currency.symbol === "USDT")).toMatchObject({
      display: "10",
      oneFlagshipOrderAmount: "5",
      canFundOneFlagshipOrder: true,
    });
  });

  it("rejects a balance RPC connected to the wrong chain", async () => {
    await expect(inspectAacpOnboardingWallet(OWNER, {
      fetchImpl: mockedFetch("0x61"),
    })).rejects.toThrow("chain mismatch");
  });
});
