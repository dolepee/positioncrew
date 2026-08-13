import { describe, expect, it, vi } from "vitest";
import {
  TermixRuntimeClient,
  assertRuntimeTokenFresh,
  buildTermixRuntimeDecision,
  createTermixRuntimeState,
  hasProcessedRuntimeMessage,
  recordTermixRuntimeDecision,
  resolveRuntimeTokenExpiry,
  runtimePollSince,
  type TermixRuntimeMessage,
} from "../src/commerce/aacp-runtime.js";
import { parseRuntimeEnvironment, runRuntimeCycle } from "../src/cli/run-termix-runtime.js";

const NOW = new Date("2026-08-13T12:00:00.000Z");

function message(
  overrides: Partial<TermixRuntimeMessage> = {},
): TermixRuntimeMessage {
  return {
    messageId: "message-1",
    conversationId: "conversation-1",
    conversationKind: "DIRECT_MESSAGE",
    orderId: null,
    prepaymentOrderId: null,
    disputeId: null,
    kind: "TEXT",
    text: "What do you need and what will I receive?",
    from: {
      accountId: "account-1",
      walletAddress: "0xbad35FA6e368e90fC4faf63507F2D0A2Fdf94BAF",
      displayName: "Buyer",
      handle: "buyer.agent",
    },
    createdAt: "2026-08-13T11:59:00.000Z",
    ...overrides,
  };
}

function jwt(exp: number): string {
  const payload = Buffer.from(JSON.stringify({ exp })).toString("base64url");
  return `header.${payload}.signature`;
}

describe("PositionCrew TermiX A2A runtime", () => {
  it("returns an immediately useful, service-specific response without fabricating execution", () => {
    const decision = buildTermixRuntimeDecision(message(), "LENDING_RESCUE");

    expect(decision.disposition).toBe("REPLY");
    if (decision.disposition !== "REPLY") throw new Error("Expected a reply");
    expect(decision.text).toContain("5 USDC");
    expect(decision.text).toContain("target health factor");
    expect(decision.text).toContain("machine-readable JSON");
    expect(decision.text).toContain("/api/providers/lending-rescue/manifest");
    expect(decision.text).toContain("only after their AACP on-chain state is verified");
    expect(decision.text).not.toMatch(/executed|completed order|earned|revenue/i);
  });

  it("never auto-replies to a dispute or value-bearing delivery thread", () => {
    expect(
      buildTermixRuntimeDecision(
        message({ conversationKind: "CHALLENGE", disputeId: "dispute-1" }),
        "LENDING_RESCUE",
      ),
    ).toEqual({ disposition: "OPERATOR_REQUIRED", reason: "DISPUTE_OR_OPERATOR_CASE" });
    expect(
      buildTermixRuntimeDecision(
        message({ conversationKind: "ORDER_DELIVERY", orderId: "order-1" }),
        "LENDING_RESCUE",
      ),
    ).toEqual({ disposition: "OPERATOR_REQUIRED", reason: "VALUE_BEARING_ORDER" });
  });

  it("ignores platform events and empty messages", () => {
    expect(
      buildTermixRuntimeDecision(message({ kind: "ORDER_EVENT" }), "BOUNDED_GRID"),
    ).toEqual({ disposition: "IGNORE", reason: "NON_TEXT_EVENT" });
    expect(
      buildTermixRuntimeDecision(message({ text: "   " }), "BOUNDED_GRID"),
    ).toEqual({ disposition: "IGNORE", reason: "EMPTY_MESSAGE" });
  });

  it("persists idempotency and an overlap cursor without losing equal-time messages", () => {
    const initial = createTermixRuntimeState("agent-1", "LP_REBALANCE", NOW);
    const decision = buildTermixRuntimeDecision(message(), "LP_REBALANCE");
    const next = recordTermixRuntimeDecision(initial, message(), decision, NOW);

    expect(hasProcessedRuntimeMessage(next, "message-1")).toBe(true);
    expect(runtimePollSince(next)).toBe("2026-08-13T11:59:59.000Z");
    expect(next.lastReplyAt).toBe(NOW.toISOString());
  });

  it("decodes token expiry and fails closed inside the refresh buffer", () => {
    const future = Math.floor(NOW.getTime() / 1_000) + 3_600;
    expect(resolveRuntimeTokenExpiry(jwt(future))?.toISOString()).toBe(
      "2026-08-13T13:00:00.000Z",
    );
    expect(
      assertRuntimeTokenFresh(jwt(future), { now: NOW }).toISOString(),
    ).toBe("2026-08-13T13:00:00.000Z");

    const nearExpiry = Math.floor(NOW.getTime() / 1_000) + 60;
    expect(() => assertRuntimeTokenFresh(jwt(nearExpiry), { now: NOW })).toThrow(
      "fail-closed refresh window",
    );
    expect(() => assertRuntimeTokenFresh("opaque-runtime-token", { now: NOW })).toThrow(
      "expiry is unknown",
    );
  });

  it("refuses a host environment containing wallet signing material", () => {
    const base = {
      TERMIX_A2A_AGENT_ID: "agent-1",
      TERMIX_A2A_RUNTIME_TOKEN: jwt(Math.floor(NOW.getTime() / 1_000) + 3_600),
      POSITIONCREW_SERVICE: "LENDING_RESCUE",
    };
    expect(() => parseRuntimeEnvironment({ ...base, WALLET_KEY: "secret" }, [])).toThrow(
      "must not receive an owner private key",
    );
    expect(() => parseRuntimeEnvironment({ ...base, PRIVATE_KEY: "secret" }, [])).toThrow(
      "must not receive an owner private key",
    );
  });

  it("uses only a bearer runtime token for inbox, signal, and reply calls", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/inbox")) return Response.json({ items: [] });
      return Response.json({ id: "reply-1" });
    });
    const fetchImpl = fetchMock as unknown as typeof fetch;
    const client = new TermixRuntimeClient(
      "runtime-token-with-no-signing-material",
      "https://platform-backend.prod.termix.live",
      fetchImpl,
    );

    await client.poll(NOW.toISOString());
    await client.signal("conversation-1");
    await client.reply("conversation-1", "Ready.", "reply-key-1");

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    for (const [, init] of fetchMock.mock.calls) {
      const headers = new Headers(init?.headers);
      expect(headers.get("Authorization")).toBe(
        "Bearer runtime-token-with-no-signing-material",
      );
      expect(JSON.stringify(init)).not.toMatch(/wallet|private|signature/i);
    }
  });

  it("deduplicates a replayed inbox item across cycles", async () => {
    const token = jwt(Math.floor(NOW.getTime() / 1_000) + 3_600);
    const config = parseRuntimeEnvironment(
      {
        TERMIX_A2A_AGENT_ID: "agent-1",
        TERMIX_A2A_RUNTIME_TOKEN: token,
        POSITIONCREW_SERVICE: "YIELD_OPTIMIZATION",
        TERMIX_A2A_STATE_PATH: "/tmp/positioncrew-runtime-test.json",
      },
      ["--once"],
    );
    const transport = {
      poll: vi.fn(async () => [message()]),
      signal: vi.fn(async () => undefined),
      reply: vi.fn(async () => undefined),
    };
    let state = createTermixRuntimeState("agent-1", "YIELD_OPTIMIZATION", NOW);
    state = await runRuntimeCycle(config, state, transport, NOW);
    state = await runRuntimeCycle(
      config,
      state,
      transport,
      new Date("2026-08-13T12:01:00.000Z"),
    );

    expect(transport.poll).toHaveBeenCalledTimes(2);
    expect(transport.reply).toHaveBeenCalledTimes(1);
    expect(state.processedMessageIds).toEqual(["message-1"]);
  });
});
