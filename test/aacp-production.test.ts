import { describe, expect, it } from "vitest";
import {
  AACP_PROVIDER_BLUEPRINTS,
  fetchAacpProductionConfig,
  getAacpProductionReadiness,
  unavailableAacpProductionReadiness,
} from "../src/commerce/aacp-production.js";

const ADDRESSES = {
  identity: "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432",
  reputation: "0xFf3f7038c4919A420B30D7B3533cb386D5898189",
  usdc: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
  usdcEscrow: "0x6A52ba4C84b348FaEAe13dDC7A97b4F6af23913C",
  usdcStaking: "0x0Bd066f5113e6B8336b06F8Aa3EF90D37F7e65FC",
  usdcCampaign: "0x5BaE7834B32a4b357F65dd20248068993466D294",
  usdt: "0x55d398326f99059fF775485246999027B3197955",
  usdtEscrow: "0xCE02f987D8b8AF694E13C8a843Db9c77caBF544c",
  usdtStaking: "0x1DcafFB7275fa2650d480a4F939A0C0D5874750B",
  usdtCampaign: "0x16261F2BCbE8Ee47065C5ecB4be32c1571289809",
} as const;

function descriptor(name: string, address: string) {
  return { name, address, abi: name, configured: true };
}

function productionConfig() {
  return {
    environment: "production",
    chainId: 56,
    network: "bnb-chain",
    networkLabel: "BNB Chain",
    explorerBaseUrl: "https://bscscan.com",
    protocolFeeBps: 200,
    campaignProtocolFeeBps: 200,
    settlementCurrency: {
      symbol: "USDC",
      decimals: 18,
      address: ADDRESSES.usdc,
    },
    settlementCurrencies: [
      {
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
      },
      {
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
      },
    ],
    settlementChains: [
      {
        id: 56,
        name: "BNB Chain",
        default: true,
        explorerBaseUrl: "https://bscscan.com",
      },
    ],
    contracts: {
      identityRegistry: descriptor("IdentityRegistry", ADDRESSES.identity),
      agentNft: descriptor("IdentityRegistry", ADDRESSES.identity),
      escrow: descriptor("TermixEscrow", ADDRESSES.usdcEscrow),
      staking: descriptor("TermixStaking", ADDRESSES.usdcStaking),
      reputation: descriptor("TermixReputation", ADDRESSES.reputation),
      usdc: descriptor("USDC", ADDRESSES.usdc),
      campaignVault: descriptor("CampaignVault", ADDRESSES.usdcCampaign),
    },
  };
}

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function mockedFetch(options: {
  missingCodeAt?: number;
  chainId?: string;
  handleAvailable?: boolean;
  searchStatus?: number;
} = {}) {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/api/v1/config/contracts")) return json(productionConfig());
    if (url.includes("/api/v1/explorer/agents")) {
      if (options.searchStatus) return json({ error: "search unavailable" }, options.searchStatus);
      return json({ items: [], page: 1, pageSize: 100, total: 0, totalPages: 0 });
    }
    if (url.includes("/api/v1/agents/name-availability")) {
      const name = new URL(url).searchParams.get("name") ?? "unknown.agent";
      return json({ available: options.handleAvailable ?? true, normalized: name });
    }
    if (init?.method === "POST") {
      const calls = JSON.parse(String(init.body)) as Array<{
        id: number;
        method: string;
      }>;
      let codeIndex = 0;
      return json(
        calls.map((call) => {
          let result = "0x60006000";
          if (call.method === "eth_chainId") result = options.chainId ?? "0x38";
          if (call.method === "eth_blockNumber") result = "0x1234";
          if (call.method === "eth_getCode") {
            if (codeIndex === options.missingCodeAt) result = "0x";
            codeIndex += 1;
          }
          return { jsonrpc: "2.0", id: call.id, result };
        }),
      );
    }
    return json({ error: "unexpected URL" }, 404);
  }) as typeof fetch;
}

describe("TermiX production AACP readiness", () => {
  it("locks four distinct production provider blueprints", () => {
    expect(AACP_PROVIDER_BLUEPRINTS.map((provider) => provider.service)).toEqual([
      "LENDING_RESCUE",
      "LP_REBALANCE",
      "YIELD_OPTIMIZATION",
      "BOUNDED_GRID",
    ]);
    expect(new Set(AACP_PROVIDER_BLUEPRINTS.map((provider) => provider.handle)).size).toBe(4);
    expect(AACP_PROVIDER_BLUEPRINTS.every((provider) => provider.listing.currency === "USDT")).toBe(true);
    expect(AACP_PROVIDER_BLUEPRINTS.every((provider) => provider.listing.publicSearch)).toBe(true);
    expect(AACP_PROVIDER_BLUEPRINTS.every((provider) => provider.listing.instantBuyable)).toBe(true);
  });

  it("validates production config, bytecode, and unclaimed provider handles", async () => {
    const readiness = await getAacpProductionReadiness({
      fetchImpl: mockedFetch(),
      now: new Date("2026-08-13T12:00:00.000Z"),
    });

    expect(readiness).toMatchObject({
      schemaVersion: "positioncrew.aacp-production-readiness.v1",
      generatedAt: "2026-08-13T12:00:00.000Z",
      state: "ONBOARDING_PENDING",
      network: { chainId: 56, blockNumber: "4660" },
      protocol: { protocolFeeBps: 200 },
      integration: {
        guide: {
          status: "CURRENT_HUMAN_GUIDE_VERIFIED",
          openApiStatus: "SAMPLE_SPEC_NOT_USED",
        },
        runtime: {
          status: "PREISSUED_TOKEN_ADAPTER_IMPLEMENTED",
          ownerSignerOnHost: false,
          autoRenewsToken: false,
          tokenLifetimeHours: 12,
        },
        orderGuard: {
          status: "STRICT_LOCAL_LIFECYCLE_IMPLEMENTED",
          chainId: 56,
          signerOnGuard: false,
          broadcastsTransactions: false,
          abiDecodedIntentBinding: true,
          minedTransactionBinding: true,
          indexerReconciliationRequired: true,
        },
      },
      marketplace: {
        requiredProviderCount: 4,
        indexedProviderCount: 0,
        publishedListingCount: 0,
        onlineProviderCount: 0,
      },
    });
    expect(readiness.protocol.deployedCount).toBe(readiness.protocol.contractCount);
    expect(readiness.protocol.currencies.map((currency) => currency.symbol)).toEqual(["USDC", "USDT"]);
    expect(readiness.marketplace.providers.every((provider) => provider.status === "HANDLE_AVAILABLE")).toBe(true);
    expect(readiness.integration.lifecycle).toContain("PENDING_OR_EXPIRED_CANCELLATION");
    expect(readiness.integration.lifecycle).toContain("BUYER_RELEASE_REDO_DISPUTE_OR_TIMEOUT");
    expect(readiness.integration.runtime.operatorRequiredConversationKinds).toContain("CHALLENGE");
    expect(readiness.boundaries.join(" ")).toContain("does not claim");
  });

  it("fails closed when the upstream config moves to another chain", async () => {
    const config = productionConfig();
    config.chainId = 97;
    const fetchImpl = (async () => json(config)) as typeof fetch;

    await expect(fetchAacpProductionConfig({ fetchImpl })).rejects.toThrow();
  });

  it("fails closed when a settlement currency omits provider lock data", async () => {
    const config = productionConfig();
    config.settlementCurrencies[0]!.providerLockBps = null as never;
    const fetchImpl = (async () => json(config)) as typeof fetch;

    await expect(fetchAacpProductionConfig({ fetchImpl })).rejects.toThrow(
      "providerLockBps must be available",
    );
  });

  it("rejects a default-currency contract alias that points elsewhere", async () => {
    const config = productionConfig();
    config.contracts.escrow.address = ADDRESSES.usdtEscrow;
    const fetchImpl = (async () => json(config)) as typeof fetch;

    await expect(fetchAacpProductionConfig({ fetchImpl })).rejects.toThrow(
      "escrow must match the default settlement currency contract",
    );
  });

  it("rejects an RPC connected to the wrong chain", async () => {
    await expect(
      getAacpProductionReadiness({ fetchImpl: mockedFetch({ chainId: "0x61" }) }),
    ).rejects.toThrow("chain mismatch");
  });

  it("reports protocol degradation when a configured contract has no bytecode", async () => {
    const readiness = await getAacpProductionReadiness({
      fetchImpl: mockedFetch({ missingCodeAt: 0 }),
    });

    expect(readiness.state).toBe("PROTOCOL_DEGRADED");
    expect(readiness.protocol.deployedCount).toBe(readiness.protocol.contractCount - 1);
  });

  it("keeps protocol verification visible during an Agent.family search outage", async () => {
    const readiness = await getAacpProductionReadiness({
      fetchImpl: mockedFetch({ handleAvailable: false, searchStatus: 500 }),
    });

    expect(readiness.state).toBe("MARKETPLACE_DISCOVERY_DEGRADED");
    expect(readiness.protocol.deployedCount).toBe(readiness.protocol.contractCount);
    expect(readiness.marketplace.providers.every((provider) => provider.status === "DISCOVERY_UNAVAILABLE")).toBe(true);
  });

  it("publishes a fail-closed record when live sources are unavailable", () => {
    const readiness = unavailableAacpProductionReadiness(
      new Date("2026-08-13T12:05:00.000Z"),
    );

    expect(readiness.state).toBe("SOURCE_UNAVAILABLE");
    expect(readiness.network).toMatchObject({ chainId: 56, blockNumber: null });
    expect(readiness.marketplace.requiredProviderCount).toBe(4);
    expect(readiness.integration.runtime.ownerSignerOnHost).toBe(false);
    expect(readiness.integration.orderGuard.guardedActions).toHaveLength(10);
    expect(readiness.marketplace.providers.every((provider) => provider.status === "UPSTREAM_UNAVAILABLE")).toBe(true);
    expect(readiness.boundaries.join(" ")).toContain("no cached deployment claim");
  });
});
