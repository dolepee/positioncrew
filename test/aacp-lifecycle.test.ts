import { describe, expect, it } from "vitest";
import { encodeFunctionData, parseAbi } from "viem";
import {
  AacpLifecycleError,
  assertAacpOrderIntent,
  bindAacpCheckoutSession,
  createAacpCheckoutPlan,
  deriveAacpLifecycleStage,
  reconcileAacpOrder,
  recordAacpMinedTransaction,
  type AacpOrderAction,
  type AacpOrderBinding,
} from "../src/commerce/aacp-lifecycle.js";
import { MemoryCommerceAdapter } from "../src/commerce/memory-adapter.js";

const NOW = new Date("2026-08-13T12:00:00.000Z");
const USDT = "0x55d398326f99059fF775485246999027B3197955";
const ESCROW = "0xCE02f987D8b8AF694E13C8a843Db9c77caBF544c";
const STAKING = "0x1DcafFB7275fa2650d480a4F939A0C0D5874750B";
const CAMPAIGN = "0x16261F2BCbE8Ee47065C5ecB4be32c1571289809";
const CLIENT_WALLET = "0x1111111111111111111111111111111111111111";
const PROVIDER_WALLET = "0x2222222222222222222222222222222222222222";
const CLIENT_AGENT = "client-agent-1";
const PROVIDER_AGENT = "provider-agent-1";
const CLIENT_AGENT_TOKEN_ID = "101";
const PROVIDER_AGENT_TOKEN_ID = "202";
const AGREEMENT_HASH = `0x${"a".repeat(64)}` as `0x${string}`;
const ONCHAIN_ORDER_ID = `0x${"b".repeat(64)}` as `0x${string}`;
const DELIVERY_HASH = `0x${"c".repeat(64)}` as `0x${string}`;
const EVALUATOR_AGENT_TOKEN_IDS = ["301", "302", "303"] as const;

const ERC20_ABI = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
]);
const ESCROW_ABI = parseAbi([
  "function createOrder(uint256 providerAgentId, bytes32 agreementHash, uint256 budget, uint256 deadline, uint8 settlementMode, uint256 challengeWindow, uint256 clientAgentId) returns (bytes32 orderId)",
  "function cancelPending(bytes32 orderId)",
  "function acceptOrder(bytes32 orderId)",
  "function submitDelivery(bytes32 orderId, bytes32 deliveryHash)",
  "function cancelExpired(bytes32 orderId)",
  "function releaseEscrow(bytes32 orderId)",
  "function requestRedo(bytes32 orderId)",
  "function claimAfterTimeout(bytes32 orderId)",
  "function openChallenge(bytes32 orderId, uint256[3] evaluatorAgentIds)",
]);

const CONFIG = {
  chainId: 56 as const,
  settlementCurrencies: [
    {
      symbol: "USDT" as const,
      decimals: 18,
      address: USDT,
      default: false,
      protocolFeeBps: 200,
      providerLockBps: 0,
      contracts: {
        escrow: ESCROW,
        staking: STAKING,
        campaignVault: CAMPAIGN,
      },
    },
  ],
};

async function freshBinding(): Promise<AacpOrderBinding> {
  const adapter = new MemoryCommerceAdapter();
  const job = await adapter.createJob({
    schemaVersion: "positioncrew.job-envelope.v1",
    idempotencyKey: "aacp-lifecycle-test-job-1",
    service: "LENDING_RESCUE",
    requestId: "request-aacp-lifecycle-1",
    requestHash: `sha256:${"a".repeat(64)}`,
    budget: {
      chainId: 56,
      token: { symbol: "USDT", address: USDT, decimals: 18 },
      amount: "5",
    },
    createdAt: NOW.toISOString(),
    deadline: "2026-08-14T12:00:00.000Z",
  });
  const plan = createAacpCheckoutPlan(
    job,
    CONFIG,
    {
      offerId: "offer-1",
      revisionId: "revision-1",
      clientAgentId: CLIENT_AGENT,
      clientAgentTokenId: CLIENT_AGENT_TOKEN_ID,
      clientWallet: CLIENT_WALLET,
      providerAgentId: PROVIDER_AGENT,
      providerAgentTokenId: PROVIDER_AGENT_TOKEN_ID,
      providerWallet: PROVIDER_WALLET,
      agreementHash: AGREEMENT_HASH,
      settlementMode: 0,
      challengeWindowSeconds: 86_400,
    },
    NOW,
  );
  return bindAacpCheckoutSession(
    plan,
    { id: "checkout-1", amount: "5.0", currency: "USDT", status: "OPEN" },
    NOW,
  );
}

function calldata(action: AacpOrderAction): `0x${string}` {
  if (action === "approveEscrow") {
    return encodeFunctionData({
      abi: ERC20_ABI,
      functionName: "approve",
      args: [ESCROW, 5n * 10n ** 18n],
    });
  }
  if (action === "createOrder") {
    return encodeFunctionData({
      abi: ESCROW_ABI,
      functionName: "createOrder",
      args: [
        BigInt(PROVIDER_AGENT_TOKEN_ID),
        AGREEMENT_HASH,
        5n * 10n ** 18n,
        BigInt(Math.floor(Date.parse("2026-08-14T12:00:00.000Z") / 1_000)),
        0,
        86_400n,
        BigInt(CLIENT_AGENT_TOKEN_ID),
      ],
    });
  }
  if (action === "submitDelivery") {
    return encodeFunctionData({
      abi: ESCROW_ABI,
      functionName: "submitDelivery",
      args: [ONCHAIN_ORDER_ID, DELIVERY_HASH],
    });
  }
  if (action === "openChallenge") {
    return encodeFunctionData({
      abi: ESCROW_ABI,
      functionName: "openChallenge",
      args: [
        ONCHAIN_ORDER_ID,
        [
          BigInt(EVALUATOR_AGENT_TOKEN_IDS[0]),
          BigInt(EVALUATOR_AGENT_TOKEN_IDS[1]),
          BigInt(EVALUATOR_AGENT_TOKEN_IDS[2]),
        ],
      ],
    });
  }
  return encodeFunctionData({
    abi: ESCROW_ABI,
    functionName: action,
    args: [ONCHAIN_ORDER_ID],
  });
}

function intent(action: AacpOrderAction, target?: string) {
  return {
    action,
    chainId: 56,
    contract: target ?? (action === "approveEscrow" ? USDT : ESCROW),
    callData: calldata(action),
    value: "0",
    id: `intent-${action}`,
    status: "PREPARED",
    nonceKey: `nonce-${action}`,
  };
}

function mined(
  action: AacpOrderAction,
  index: number,
  from?: string,
  reviewedIntent = intent(action),
) {
  return {
    from:
      from ??
      (["acceptOrder", "submitDelivery", "claimAfterTimeout"].includes(action)
        ? PROVIDER_WALLET
        : CLIENT_WALLET),
    chainId: 56,
    action,
    to: reviewedIntent.contract,
    input: reviewedIntent.callData,
    value: reviewedIntent.value,
    txHash: `0x${index.toString(16).padStart(64, "0")}`,
    status: "success",
    blockNumber: 115_000_000 + index,
    nonce: index,
  };
}

function observation(
  status: "PENDING_ACCEPT" | "FUNDED" | "IN_PROGRESS" | "DELIVERED" | "ACCEPTED" | "IN_DISPUTE" | "SETTLED" | "CANCELLED",
  observedAt: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    schemaVersion: "positioncrew.aacp-order-observation.v1",
    orderId: "order-1",
    onChainOrderId: ONCHAIN_ORDER_ID,
    status,
    amount: "5",
    currency: "USDT",
    clientAgentId: CLIENT_AGENT,
    providerAgentId: PROVIDER_AGENT,
    acceptDeadline: "2026-08-13T13:00:00.000Z",
    deliveryDueAt: "2026-08-14T12:00:00.000Z",
    challengeWindowEndsAt: "2026-08-15T12:00:00.000Z",
    redoUsed: false,
    availableActions: { canSubmitDelivery: status === "FUNDED" || status === "IN_PROGRESS" },
    observedAt,
    sourceUrl: "https://platform-backend.prod.termix.live/api/v1/orders/order-1",
    ...overrides,
  };
}

async function pendingBinding(): Promise<AacpOrderBinding> {
  let binding = await freshBinding();
  binding = recordAacpMinedTransaction(
    binding,
    intent("createOrder"),
    mined("createOrder", 20),
    new Date("2026-08-13T12:00:10Z"),
  );
  return reconcileAacpOrder(
    binding,
    observation("PENDING_ACCEPT", "2026-08-13T12:00:20Z"),
  );
}

async function inProgressBinding(
  overrides: Record<string, unknown> = {},
): Promise<AacpOrderBinding> {
  let binding = await pendingBinding();
  binding = recordAacpMinedTransaction(
    binding,
    intent("acceptOrder"),
    mined("acceptOrder", 21),
    new Date("2026-08-13T12:00:30Z"),
  );
  return reconcileAacpOrder(
    binding,
    observation("IN_PROGRESS", "2026-08-13T12:00:40Z", overrides),
  );
}

async function deliveredBinding(
  overrides: Record<string, unknown> = {},
): Promise<AacpOrderBinding> {
  let binding = await inProgressBinding();
  binding = recordAacpMinedTransaction(
    binding,
    intent("submitDelivery"),
    mined("submitDelivery", 22),
    new Date("2026-08-13T12:00:50Z"),
    { deliveryHash: DELIVERY_HASH },
  );
  return reconcileAacpOrder(
    binding,
    observation("DELIVERED", "2026-08-13T12:01:00Z", overrides),
  );
}

describe("PositionCrew AACP order lifecycle guard", () => {
  it("builds the exact documented checkout body and normalizes equivalent amounts", async () => {
    const binding = await freshBinding();

    expect(binding.plan.request).toMatchObject({
      offerId: "offer-1",
      revisionId: "revision-1",
      desiredStake: "0",
      clientAgentId: CLIENT_AGENT,
    });
    expect(binding.plan.request.idempotencyKey).toMatch(/^positioncrew-[a-f0-9]{64}$/);
    expect(binding.plan.currency.contracts.escrow).toBe(ESCROW);
    expect(deriveAacpLifecycleStage(binding)).toBe("CHECKOUT_CREATED");
  });

  it("rejects wrong-chain and mismatched token plans", async () => {
    const adapter = new MemoryCommerceAdapter();
    const wrongChain = await adapter.createJob({
      schemaVersion: "positioncrew.job-envelope.v1",
      idempotencyKey: "aacp-wrong-chain-job",
      service: "BOUNDED_GRID",
      requestId: "request-wrong-chain",
      requestHash: `sha256:${"b".repeat(64)}`,
      budget: {
        chainId: 97,
        token: { symbol: "USDT", address: USDT, decimals: 18 },
        amount: "5",
      },
      createdAt: NOW.toISOString(),
      deadline: "2026-08-14T12:00:00.000Z",
    });
    const refs = {
      offerId: "offer-1",
      revisionId: "revision-1",
      clientAgentId: CLIENT_AGENT,
      clientAgentTokenId: CLIENT_AGENT_TOKEN_ID,
      clientWallet: CLIENT_WALLET,
      providerAgentId: PROVIDER_AGENT,
      providerAgentTokenId: PROVIDER_AGENT_TOKEN_ID,
      providerWallet: PROVIDER_WALLET,
      agreementHash: AGREEMENT_HASH,
      settlementMode: 0,
      challengeWindowSeconds: 86_400,
    };
    expect(() => createAacpCheckoutPlan(wrongChain, CONFIG, refs, NOW)).toThrow(
      "BNB Chain 56",
    );

    const wrongToken = await adapter.createJob({
      schemaVersion: "positioncrew.job-envelope.v1",
      idempotencyKey: "aacp-wrong-token-job",
      service: "BOUNDED_GRID",
      requestId: "request-wrong-token",
      requestHash: `sha256:${"c".repeat(64)}`,
      budget: {
        chainId: 56,
        token: {
          symbol: "USDT",
          address: "0x3333333333333333333333333333333333333333",
          decimals: 18,
        },
        amount: "5",
      },
      createdAt: NOW.toISOString(),
      deadline: "2026-08-14T12:00:00.000Z",
    });
    expect(() => createAacpCheckoutPlan(wrongToken, CONFIG, refs, NOW)).toThrow(
      "token identity",
    );
  });

  it("rejects a checkout whose currency or exact amount changed", async () => {
    const binding = await freshBinding();
    expect(() => bindAacpCheckoutSession(binding.plan, {
      id: "checkout-2",
      amount: "5.01",
      currency: "USDT",
      status: "OPEN",
    })).toThrow("amount does not match");
    expect(() => bindAacpCheckoutSession(binding.plan, {
      id: "checkout-3",
      amount: "5",
      currency: "USDC",
      status: "OPEN",
    })).toThrow("currency does not match");
  });

  it("pins every reviewed tx-intent to chain 56, zero BNB, and the correct contract", async () => {
    const binding = await freshBinding();
    expect(assertAacpOrderIntent(binding, intent("approveEscrow"), "approveEscrow").contract).toBe(USDT);
    expect(assertAacpOrderIntent(binding, intent("createOrder"), "createOrder").contract).toBe(ESCROW);
    expect(() => assertAacpOrderIntent(
      binding,
      { ...intent("createOrder"), contract: USDT },
      "createOrder",
    )).toThrow("unexpected contract");
    expect(() => assertAacpOrderIntent(
      binding,
      { ...intent("createOrder"), value: "1" },
      "createOrder",
    )).toThrow("must not transfer native BNB");
    expect(() => assertAacpOrderIntent(
      binding,
      {
        ...intent("approveEscrow"),
        callData: encodeFunctionData({
          abi: ERC20_ABI,
          functionName: "approve",
          args: [ESCROW, 2n ** 256n - 1n],
        }),
      },
      "approveEscrow",
    )).toThrow("exact checkout budget");
    expect(() => assertAacpOrderIntent(
      binding,
      { ...intent("createOrder"), callData: calldata("releaseEscrow") },
      "createOrder",
    )).toThrow("instead of the reviewed action");
    expect(() => assertAacpOrderIntent(
      binding,
      {
        ...intent("createOrder"),
        callData: encodeFunctionData({
          abi: ESCROW_ABI,
          functionName: "createOrder",
          args: [
            BigInt(PROVIDER_AGENT_TOKEN_ID),
            AGREEMENT_HASH,
            6n * 10n ** 18n,
            BigInt(Math.floor(Date.parse("2026-08-14T12:00:00.000Z") / 1_000)),
            0,
            86_400n,
            BigInt(CLIENT_AGENT_TOKEN_ID),
          ],
        }),
      },
      "createOrder",
    )).toThrow("exact checkout amount");
  });

  it("runs the indexed happy path without treating a mined tx as final state", async () => {
    let binding = await freshBinding();
    binding = recordAacpMinedTransaction(binding, intent("approveEscrow"), mined("approveEscrow", 1), NOW);
    expect(deriveAacpLifecycleStage(binding)).toBe("ESCROW_APPROVED");
    expect(() => recordAacpMinedTransaction(
      binding,
      intent("approveEscrow"),
      mined("approveEscrow", 12),
      new Date("2026-08-13T12:00:30Z"),
    )).toThrow("already mined");

    binding = recordAacpMinedTransaction(binding, intent("createOrder"), mined("createOrder", 2), new Date("2026-08-13T12:01:00Z"));
    expect(deriveAacpLifecycleStage(binding)).toBe("ORDER_INDEXING");
    expect(() => assertAacpOrderIntent(
      binding,
      intent("createOrder"),
      "createOrder",
      {},
      new Date("2026-08-13T12:01:30Z"),
    )).toThrow("already mined");

    binding = reconcileAacpOrder(binding, observation("PENDING_ACCEPT", "2026-08-13T12:02:00Z"));
    expect(deriveAacpLifecycleStage(binding)).toBe("PENDING_ACCEPT");

    binding = recordAacpMinedTransaction(binding, intent("acceptOrder"), mined("acceptOrder", 3), new Date("2026-08-13T12:03:00Z"));
    expect(deriveAacpLifecycleStage(binding)).toBe("PROVIDER_ACCEPT_INDEXING");

    binding = reconcileAacpOrder(binding, observation("IN_PROGRESS", "2026-08-13T12:04:00Z"));
    expect(deriveAacpLifecycleStage(binding)).toBe("IN_PROGRESS");

    binding = recordAacpMinedTransaction(
      binding,
      intent("submitDelivery"),
      mined("submitDelivery", 4),
      new Date("2026-08-13T12:05:00Z"),
      { deliveryHash: DELIVERY_HASH },
    );
    expect(deriveAacpLifecycleStage(binding)).toBe("DELIVERY_INDEXING");

    binding = reconcileAacpOrder(binding, observation("DELIVERED", "2026-08-13T12:06:00Z"));
    expect(deriveAacpLifecycleStage(binding)).toBe("DELIVERED");

    binding = recordAacpMinedTransaction(binding, intent("releaseEscrow"), mined("releaseEscrow", 5), new Date("2026-08-13T12:07:00Z"));
    expect(deriveAacpLifecycleStage(binding)).toBe("SETTLEMENT_INDEXING");

    binding = reconcileAacpOrder(binding, observation("SETTLED", "2026-08-13T12:08:00Z"));
    expect(deriveAacpLifecycleStage(binding)).toBe("SETTLED");
  });

  it("requires the correct actor wallet and records a mined transaction idempotently", async () => {
    let binding = await freshBinding();
    expect(() => recordAacpMinedTransaction(
      binding,
      intent("createOrder"),
      mined("createOrder", 6, PROVIDER_WALLET),
      NOW,
    )).toThrow("unexpected wallet");

    binding = recordAacpMinedTransaction(binding, intent("createOrder"), mined("createOrder", 6), NOW);
    const replay = recordAacpMinedTransaction(
      binding,
      intent("createOrder"),
      mined("createOrder", 6),
      new Date("2026-08-13T12:10:00Z"),
    );
    expect(replay.transactions).toHaveLength(1);
    const changedIntent = { ...intent("createOrder"), nonceKey: "nonce-createOrder-changed" };
    expect(() => recordAacpMinedTransaction(
      binding,
      changedIntent,
      mined("createOrder", 6, undefined, changedIntent),
      new Date("2026-08-13T12:10:00Z"),
    )).toThrow("different evidence");

    const unbound = await freshBinding();
    expect(() => recordAacpMinedTransaction(
      unbound,
      intent("createOrder"),
      { ...mined("createOrder", 11), input: calldata("releaseEscrow") },
      NOW,
    )).toThrow("mined calldata differs");
  });

  it("rejects order identity, amount, agent, and stale-observation drift", async () => {
    const uncreated = await freshBinding();
    expect(() => reconcileAacpOrder(
      uncreated,
      observation("PENDING_ACCEPT", "2026-08-13T12:00:20Z"),
    )).toThrow("before createOrder is mined");
    const binding = await pendingBinding();
    expect(() => reconcileAacpOrder(binding, observation("PENDING_ACCEPT", "2026-08-13T12:03:00Z", { amount: "6" }))).toThrow("amount does not match");
    expect(() => reconcileAacpOrder(binding, observation("PENDING_ACCEPT", "2026-08-13T12:03:00Z", { providerAgentId: "another-provider" }))).toThrow("agent identities");
    expect(() => reconcileAacpOrder(binding, observation("PENDING_ACCEPT", "2026-08-13T12:03:00Z", { orderId: "order-2" }))).toThrow("cannot change order identity");
    expect(() => reconcileAacpOrder(binding, observation("PENDING_ACCEPT", "2026-08-13T12:03:00Z", {
      onChainOrderId: `0x${"d".repeat(64)}`,
    }))).toThrow("cannot change on-chain order identity");
    expect(() => reconcileAacpOrder(binding, observation("PENDING_ACCEPT", "2026-08-13T12:00:10Z"))).toThrow("older");
  });

  it("will not submit a delivery before the indexer enables it or after its deadline", async () => {
    let binding = await inProgressBinding({
      availableActions: { canSubmitDelivery: false },
    });
    expect(() => recordAacpMinedTransaction(
      binding,
      intent("submitDelivery"),
      mined("submitDelivery", 7),
      new Date("2026-08-13T12:03:00Z"),
      { deliveryHash: DELIVERY_HASH },
    )).toThrow("not yet indexed as ready");

    binding = reconcileAacpOrder(binding, observation("IN_PROGRESS", "2026-08-13T12:04:00Z", {
      deliveryDueAt: "2026-08-13T12:04:30Z",
    }));
    expect(() => recordAacpMinedTransaction(
      binding,
      intent("submitDelivery"),
      mined("submitDelivery", 8),
      new Date("2026-08-13T12:05:00Z"),
      { deliveryHash: DELIVERY_HASH },
    )).toThrow("deadline has elapsed");
  });

  it("permits timeout settlement only after the indexed challenge deadline", async () => {
    let binding = await deliveredBinding({
      challengeWindowEndsAt: "2026-08-13T13:00:00Z",
    });
    expect(() => recordAacpMinedTransaction(
      binding,
      intent("claimAfterTimeout"),
      mined("claimAfterTimeout", 9),
      new Date("2026-08-13T12:59:00Z"),
    )).toThrow("has not elapsed");
    binding = recordAacpMinedTransaction(
      binding,
      intent("claimAfterTimeout"),
      mined("claimAfterTimeout", 9),
      new Date("2026-08-13T13:01:00Z"),
    );
    expect(deriveAacpLifecycleStage(binding)).toBe("SETTLEMENT_INDEXING");
  });

  it("permits a pending-order refund only after the indexed acceptance deadline", async () => {
    let binding = await pendingBinding();
    expect(() => recordAacpMinedTransaction(
      binding,
      intent("cancelPending"),
      mined("cancelPending", 23),
      new Date("2026-08-13T12:59:00Z"),
    )).toThrow("acceptance window has not elapsed");

    binding = recordAacpMinedTransaction(
      binding,
      intent("cancelPending"),
      mined("cancelPending", 23),
      new Date("2026-08-13T13:01:00Z"),
    );
    expect(deriveAacpLifecycleStage(binding)).toBe("CANCELLATION_INDEXING");

    binding = reconcileAacpOrder(
      binding,
      observation("CANCELLED", "2026-08-13T13:02:00Z"),
    );
    expect(deriveAacpLifecycleStage(binding)).toBe("CANCELLED");
  });

  it("permits an expired-delivery refund only after the indexed delivery deadline", async () => {
    let binding = await inProgressBinding({
      deliveryDueAt: "2026-08-13T13:00:00Z",
    });
    expect(() => recordAacpMinedTransaction(
      binding,
      intent("cancelExpired"),
      mined("cancelExpired", 24),
      new Date("2026-08-13T12:59:00Z"),
    )).toThrow("Delivery deadline has not elapsed");

    binding = recordAacpMinedTransaction(
      binding,
      intent("cancelExpired"),
      mined("cancelExpired", 24),
      new Date("2026-08-13T13:01:00Z"),
    );
    expect(deriveAacpLifecycleStage(binding)).toBe("CANCELLATION_INDEXING");

    binding = reconcileAacpOrder(
      binding,
      observation("CANCELLED", "2026-08-13T13:02:00Z", {
        deliveryDueAt: "2026-08-13T13:00:00Z",
      }),
    );
    expect(deriveAacpLifecycleStage(binding)).toBe("CANCELLED");
  });

  it("fails closed when a cancellation projection lacks a reviewed refund transaction", async () => {
    const pending = await pendingBinding();
    expect(() => reconcileAacpOrder(
      pending,
      observation("CANCELLED", "2026-08-13T13:02:00Z"),
    )).toThrow("no reviewed cancellation receipt");
  });

  it("tracks the documented ACCEPTED projection until settlement is indexed", async () => {
    let binding = await deliveredBinding();
    expect(() => reconcileAacpOrder(
      binding,
      observation("ACCEPTED", "2026-08-13T12:02:00Z"),
    )).toThrow("no reviewed releaseEscrow receipt");

    binding = recordAacpMinedTransaction(
      binding,
      intent("releaseEscrow"),
      mined("releaseEscrow", 25),
      new Date("2026-08-13T12:03:00Z"),
    );
    binding = reconcileAacpOrder(
      binding,
      observation("ACCEPTED", "2026-08-13T12:04:00Z"),
    );
    expect(deriveAacpLifecycleStage(binding)).toBe("SETTLEMENT_INDEXING");

    binding = reconcileAacpOrder(
      binding,
      observation("SETTLED", "2026-08-13T12:05:00Z"),
    );
    expect(deriveAacpLifecycleStage(binding)).toBe("SETTLED");
  });

  it("binds delivery submission to the reviewed artifact hash", async () => {
    const binding = await inProgressBinding();
    expect(() => recordAacpMinedTransaction(
      binding,
      intent("submitDelivery"),
      mined("submitDelivery", 13),
      new Date("2026-08-13T12:05:00Z"),
      { deliveryHash: `0x${"d".repeat(64)}` },
    )).toThrow("delivery hash does not match");
  });

  it("binds a challenge to a distinct reviewed evaluator panel", async () => {
    const delivered = await deliveredBinding();
    expect(() => recordAacpMinedTransaction(
      delivered,
      intent("openChallenge"),
      mined("openChallenge", 14),
      new Date("2026-08-13T12:03:00Z"),
      { evaluatorAgentTokenIds: ["301", "302", "304"] },
    )).toThrow("does not match the reviewed panel");

    const duplicatePanelIntent = {
      ...intent("openChallenge"),
      callData: encodeFunctionData({
        abi: ESCROW_ABI,
        functionName: "openChallenge",
        args: [ONCHAIN_ORDER_ID, [301n, 301n, 303n]],
      }),
    };
    expect(() => recordAacpMinedTransaction(
      delivered,
      duplicatePanelIntent,
      mined("openChallenge", 15, undefined, duplicatePanelIntent),
      new Date("2026-08-13T12:03:00Z"),
      { evaluatorAgentTokenIds: EVALUATOR_AGENT_TOKEN_IDS },
    )).toThrow("contains duplicates");

    const disputed = recordAacpMinedTransaction(
      delivered,
      intent("openChallenge"),
      mined("openChallenge", 16),
      new Date("2026-08-13T12:03:00Z"),
      { evaluatorAgentTokenIds: EVALUATOR_AGENT_TOKEN_IDS },
    );
    expect(deriveAacpLifecycleStage(disputed)).toBe("DISPUTE_INDEXING");
    expect(deriveAacpLifecycleStage(reconcileAacpOrder(
      disputed,
      observation("IN_DISPUTE", "2026-08-13T12:04:00Z"),
    ))).toBe("IN_DISPUTE");
  });

  it("rejects terminal projections without a reviewed settlement transaction", async () => {
    const delivered = await deliveredBinding();
    expect(() => reconcileAacpOrder(
      delivered,
      observation("SETTLED", "2026-08-13T12:04:00Z"),
    )).toThrow("no reviewed settlement receipt");
    expect(() => reconcileAacpOrder(
      delivered,
      observation("IN_DISPUTE", "2026-08-13T12:04:00Z"),
    )).toThrow("no reviewed openChallenge receipt");
  });

  it("allows one indexed redo but rejects an unexplained order regression", async () => {
    let binding = await deliveredBinding();
    expect(() => reconcileAacpOrder(binding, observation("IN_PROGRESS", "2026-08-13T12:03:00Z"))).toThrow("one-redo path");
    expect(() => reconcileAacpOrder(binding, observation("IN_PROGRESS", "2026-08-13T12:03:00Z", {
      redoUsed: true,
      availableActions: { canSubmitDelivery: true },
    }))).toThrow("no reviewed requestRedo receipt");
    binding = recordAacpMinedTransaction(
      binding,
      intent("requestRedo"),
      mined("requestRedo", 10),
      new Date("2026-08-13T12:03:00Z"),
    );
    expect(deriveAacpLifecycleStage(binding)).toBe("REDO_INDEXING");
    binding = reconcileAacpOrder(binding, observation("IN_PROGRESS", "2026-08-13T12:04:00Z", {
      redoUsed: true,
      availableActions: { canSubmitDelivery: true },
    }));
    expect(deriveAacpLifecycleStage(binding)).toBe("IN_PROGRESS_REDO");
    expect(() => reconcileAacpOrder(binding, observation("IN_PROGRESS", "2026-08-13T12:05:00Z", {
      redoUsed: false,
    }))).toThrow("cannot clear");
  });
});
