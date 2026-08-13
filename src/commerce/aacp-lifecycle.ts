import { z } from "zod";
import { decodeFunctionData, parseAbi } from "viem";
import { AddressSchema, HashSchema, PositiveDecimalSchema, TimestampSchema } from "../contracts/common.js";
import { canonicalHash } from "../core/canonical.js";
import {
  AACP_ORDER_GUARD_ACTIONS,
  AacpSettlementCurrencySchema,
  type AacpProductionConfig,
} from "./aacp-production.js";
import { JobRecordSchema } from "./job-record-schema.js";
import type { JobRecord } from "./types.js";

const TransactionHashSchema = z
  .string()
  .regex(/^0x[a-fA-F0-9]{64}$/, "Expected an EVM transaction hash");

const Bytes32Schema = z
  .string()
  .regex(/^0x[a-fA-F0-9]{64}$/, "Expected a bytes32 value");

const AgentTokenIdSchema = z.string().regex(/^[1-9]\d*$/, "Expected a positive agent token ID");

const ERC20_APPROVE_ABI = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
]);

const TERMIX_ESCROW_ABI = parseAbi([
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

const ContractCallDataSchema = z
  .string()
  .regex(/^0x(?:[a-fA-F0-9]{2}){4,}$/, "Expected contract calldata with a selector");

const RawNativeValueSchema = z.string().regex(/^\d+$/, "Expected an integer base-unit value");

export const AacpOrderActionSchema = z.enum(AACP_ORDER_GUARD_ACTIONS);

export const AacpOrderStatusSchema = z.enum([
  "PENDING_ACCEPT",
  "FUNDED",
  "IN_PROGRESS",
  "DELIVERED",
  "ACCEPTED",
  "IN_DISPUTE",
  "SETTLED",
  "CANCELLED",
]);

export const AacpLifecycleStageSchema = z.enum([
  "CHECKOUT_CREATED",
  "ESCROW_APPROVED",
  "ORDER_INDEXING",
  "PENDING_ACCEPT",
  "CANCELLATION_INDEXING",
  "PROVIDER_ACCEPT_INDEXING",
  "IN_PROGRESS",
  "DELIVERY_INDEXING",
  "DELIVERED",
  "REDO_INDEXING",
  "IN_PROGRESS_REDO",
  "DISPUTE_INDEXING",
  "IN_DISPUTE",
  "SETTLEMENT_INDEXING",
  "SETTLED",
  "CANCELLED",
]);

export const AacpCheckoutRequestSchema = z
  .object({
    offerId: z.string().min(1),
    revisionId: z.string().min(1),
    idempotencyKey: z.string().min(8).max(160),
    desiredStake: z.literal("0"),
    clientAgentId: z.string().min(1),
  })
  .strict();

const AacpLifecycleConfigSchema = z
  .object({
    chainId: z.literal(56),
    settlementCurrencies: z.array(AacpSettlementCurrencySchema).min(1),
  })
  .passthrough();

export const AacpCheckoutSessionSchema = z
  .object({
    id: z.string().min(1),
    amount: PositiveDecimalSchema,
    currency: z.enum(["USDC", "USDT"]),
    status: z.string().min(1),
  })
  .passthrough();

export const AacpOrderTxIntentSchema = z
  .object({
    action: AacpOrderActionSchema,
    chainId: z.literal(56),
    contract: AddressSchema.optional(),
    to: AddressSchema.optional(),
    callData: ContractCallDataSchema.optional(),
    data: ContractCallDataSchema.optional(),
    value: RawNativeValueSchema,
    id: z.string().min(1),
    status: z.literal("PREPARED"),
    nonceKey: z.string().min(1),
  })
  .passthrough()
  .superRefine((intent, context) => {
    if (!intent.contract && !intent.to) {
      context.addIssue({
        code: "custom",
        path: ["contract"],
        message: "tx-intent must include contract or to",
      });
    }
    if (
      intent.contract &&
      intent.to &&
      intent.contract.toLowerCase() !== intent.to.toLowerCase()
    ) {
      context.addIssue({
        code: "custom",
        path: ["to"],
        message: "contract and to must identify the same target",
      });
    }
    if (!intent.callData && !intent.data) {
      context.addIssue({
        code: "custom",
        path: ["callData"],
        message: "tx-intent must include callData or data",
      });
    }
    if (intent.callData && intent.data && intent.callData !== intent.data) {
      context.addIssue({
        code: "custom",
        path: ["data"],
        message: "callData and data must be identical",
      });
    }
  });

export const AacpMinedTransactionSchema = z
  .object({
    from: AddressSchema,
    to: AddressSchema,
    input: ContractCallDataSchema,
    value: RawNativeValueSchema,
    chainId: z.literal(56),
    action: AacpOrderActionSchema,
    txHash: TransactionHashSchema,
    status: z.literal("success"),
    blockNumber: z.union([
      z.number().int().nonnegative(),
      z.string().regex(/^\d+$/),
    ]),
    nonce: z.union([
      z.number().int().nonnegative(),
      z.string().regex(/^\d+$/),
    ]),
  })
  .strict();

export const AacpOrderObservationSchema = z
  .object({
    schemaVersion: z.literal("positioncrew.aacp-order-observation.v1"),
    orderId: z.string().min(1),
    onChainOrderId: Bytes32Schema,
    status: AacpOrderStatusSchema,
    amount: PositiveDecimalSchema,
    currency: z.enum(["USDC", "USDT"]),
    clientAgentId: z.string().min(1),
    providerAgentId: z.string().min(1),
    acceptDeadline: TimestampSchema.nullable().optional(),
    deliveryDueAt: TimestampSchema.nullable(),
    challengeWindowEndsAt: TimestampSchema.nullable(),
    redoUsed: z.boolean(),
    availableActions: z
      .object({ canSubmitDelivery: z.boolean() })
      .passthrough(),
    observedAt: TimestampSchema,
    sourceUrl: z.string().url(),
  })
  .strict();

const AacpRecordedTransactionSchema = z
  .object({
    action: AacpOrderActionSchema,
    actor: AddressSchema,
    target: AddressSchema,
    intentHash: HashSchema,
    txHash: TransactionHashSchema,
    blockNumber: z.string().regex(/^\d+$/),
    nonce: z.string().regex(/^\d+$/),
    observedAt: TimestampSchema,
  })
  .strict();

export const AacpCheckoutPlanSchema = z
  .object({
    schemaVersion: z.literal("positioncrew.aacp-checkout-plan.v1"),
    jobId: z.string().min(8),
    envelopeHash: HashSchema,
    requestHash: HashSchema,
    chainId: z.literal(56),
    currency: AacpSettlementCurrencySchema,
    amount: PositiveDecimalSchema,
    clientAgentId: z.string().min(1),
    clientAgentTokenId: AgentTokenIdSchema,
    clientWallet: AddressSchema,
    providerAgentId: z.string().min(1),
    providerAgentTokenId: AgentTokenIdSchema,
    providerWallet: AddressSchema,
    agreementHash: Bytes32Schema,
    deliveryDeadline: TimestampSchema,
    settlementMode: z.number().int().min(0).max(255),
    challengeWindowSeconds: z.number().int().positive(),
    request: AacpCheckoutRequestSchema,
    createdAt: TimestampSchema,
  })
  .strict();

export const AacpOrderBindingSchema = z
  .object({
    schemaVersion: z.literal("positioncrew.aacp-order-binding.v1"),
    plan: AacpCheckoutPlanSchema,
    checkout: AacpCheckoutSessionSchema,
    order: AacpOrderObservationSchema.nullable(),
    transactions: z.array(AacpRecordedTransactionSchema).max(16),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
  })
  .strict();

export type AacpOrderAction = z.infer<typeof AacpOrderActionSchema>;
export type AacpCheckoutPlan = z.infer<typeof AacpCheckoutPlanSchema>;
export type AacpOrderBinding = z.infer<typeof AacpOrderBindingSchema>;
export type AacpOrderObservation = z.infer<typeof AacpOrderObservationSchema>;

export const AacpIntentExpectationsSchema = z
  .object({
    deliveryHash: Bytes32Schema.optional(),
    evaluatorAgentTokenIds: z
      .tuple([AgentTokenIdSchema, AgentTokenIdSchema, AgentTokenIdSchema])
      .optional(),
  })
  .strict();

export type AacpIntentExpectations = z.infer<typeof AacpIntentExpectationsSchema>;

export class AacpLifecycleError extends Error {}

function sameAddress(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function decimalToUnits(value: string, decimals: number): bigint {
  const [whole = "0", fraction = ""] = value.split(".");
  if (fraction.length > decimals) {
    throw new AacpLifecycleError(
      `Amount ${value} exceeds the configured ${decimals} decimal places`,
    );
  }
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, "0") || "0");
}

function equalAmounts(left: string, right: string, decimals: number): boolean {
  return decimalToUnits(left, decimals) === decimalToUnits(right, decimals);
}

function intentTarget(intent: z.infer<typeof AacpOrderTxIntentSchema>): string {
  return intent.contract ?? intent.to!;
}

function intentData(intent: z.infer<typeof AacpOrderTxIntentSchema>): string {
  return intent.callData ?? intent.data!;
}

function calldataArg(args: readonly unknown[], index: number, label: string): unknown {
  const value = args[index];
  if (value === undefined) {
    throw new AacpLifecycleError(`Decoded ${label} is missing`);
  }
  return value;
}

function bigintCalldataArg(args: readonly unknown[], index: number, label: string): bigint {
  const value = calldataArg(args, index, label);
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return BigInt(value);
  }
  throw new AacpLifecycleError(`Decoded ${label} is not an unsigned integer`);
}

function stringCalldataArg(args: readonly unknown[], index: number, label: string): string {
  const value = calldataArg(args, index, label);
  if (typeof value !== "string") {
    throw new AacpLifecycleError(`Decoded ${label} is not a string value`);
  }
  return value;
}

function assertSameBytes32(actual: string, expected: string, label: string): void {
  if (actual.toLowerCase() !== expected.toLowerCase()) {
    throw new AacpLifecycleError(`${label} does not match the reviewed value`);
  }
}

function assertDecodedIntent(
  binding: AacpOrderBinding,
  intent: z.infer<typeof AacpOrderTxIntentSchema>,
  expectations: AacpIntentExpectations,
): void {
  const data = intentData(intent) as `0x${string}`;
  if (intent.action === "approveEscrow") {
    let decoded: ReturnType<typeof decodeFunctionData<typeof ERC20_APPROVE_ABI>>;
    try {
      decoded = decodeFunctionData({ abi: ERC20_APPROVE_ABI, data });
    } catch {
      throw new AacpLifecycleError("approveEscrow calldata is not a valid ERC-20 approve call");
    }
    if (decoded.functionName !== "approve") {
      throw new AacpLifecycleError("approveEscrow calldata uses an unexpected function selector");
    }
    const args = (decoded.args ?? []) as readonly unknown[];
    const spender = stringCalldataArg(args, 0, "approval spender");
    if (!sameAddress(spender, binding.plan.currency.contracts.escrow)) {
      throw new AacpLifecycleError("Approval spender is not the selected TermiX escrow");
    }
    const amount = bigintCalldataArg(args, 1, "approval amount");
    const expectedAmount = decimalToUnits(binding.plan.amount, binding.plan.currency.decimals);
    if (amount !== expectedAmount) {
      throw new AacpLifecycleError("Approval amount does not match the exact checkout budget");
    }
    return;
  }

  let decoded: ReturnType<typeof decodeFunctionData<typeof TERMIX_ESCROW_ABI>>;
  try {
    decoded = decodeFunctionData({ abi: TERMIX_ESCROW_ABI, data });
  } catch {
    throw new AacpLifecycleError(`${intent.action} calldata is not a valid TermiX escrow call`);
  }
  if (decoded.functionName !== intent.action) {
    throw new AacpLifecycleError(
      `${intent.action} calldata uses ${decoded.functionName} instead of the reviewed action`,
    );
  }
  const args = (decoded.args ?? []) as readonly unknown[];
  if (intent.action === "createOrder") {
    if (
      bigintCalldataArg(args, 0, "provider agent token ID") !==
      BigInt(binding.plan.providerAgentTokenId)
    ) {
      throw new AacpLifecycleError("createOrder provider agent does not match the reviewed plan");
    }
    assertSameBytes32(
      stringCalldataArg(args, 1, "agreement hash"),
      binding.plan.agreementHash,
      "createOrder agreement hash",
    );
    if (
      bigintCalldataArg(args, 2, "budget") !==
      decimalToUnits(binding.plan.amount, binding.plan.currency.decimals)
    ) {
      throw new AacpLifecycleError("createOrder budget does not match the exact checkout amount");
    }
    const expectedDeadline = BigInt(Math.floor(Date.parse(binding.plan.deliveryDeadline) / 1_000));
    if (bigintCalldataArg(args, 3, "delivery deadline") !== expectedDeadline) {
      throw new AacpLifecycleError("createOrder deadline does not match the reviewed plan");
    }
    if (
      bigintCalldataArg(args, 4, "settlement mode") !== BigInt(binding.plan.settlementMode)
    ) {
      throw new AacpLifecycleError("createOrder settlement mode does not match the reviewed plan");
    }
    if (
      bigintCalldataArg(args, 5, "challenge window") !==
      BigInt(binding.plan.challengeWindowSeconds)
    ) {
      throw new AacpLifecycleError("createOrder challenge window does not match the reviewed plan");
    }
    if (
      bigintCalldataArg(args, 6, "client agent token ID") !==
      BigInt(binding.plan.clientAgentTokenId)
    ) {
      throw new AacpLifecycleError("createOrder client agent does not match the reviewed plan");
    }
    return;
  }

  if (!binding.order) {
    throw new AacpLifecycleError(`${intent.action} requires an indexed TermiX order`);
  }
  assertSameBytes32(
    stringCalldataArg(args, 0, "on-chain order ID"),
    binding.order.onChainOrderId,
    `${intent.action} order ID`,
  );
  if (intent.action === "submitDelivery") {
    if (!expectations.deliveryHash) {
      throw new AacpLifecycleError("submitDelivery requires the reviewed delivery hash");
    }
    assertSameBytes32(
      stringCalldataArg(args, 1, "delivery hash"),
      expectations.deliveryHash,
      "submitDelivery delivery hash",
    );
  }
  if (intent.action === "openChallenge") {
    if (!expectations.evaluatorAgentTokenIds) {
      throw new AacpLifecycleError("openChallenge requires the reviewed evaluator panel");
    }
    const panel = calldataArg(args, 1, "evaluator panel");
    if (!Array.isArray(panel) || panel.length !== 3) {
      throw new AacpLifecycleError("openChallenge evaluator panel is malformed");
    }
    const actual = panel.map((value, index) => {
      if (typeof value !== "bigint") {
        throw new AacpLifecycleError(`Decoded evaluator token ID ${index + 1} is invalid`);
      }
      return value.toString();
    });
    if (new Set(actual).size !== 3) {
      throw new AacpLifecycleError("openChallenge evaluator panel contains duplicates");
    }
    if (actual.some((value, index) => value !== expectations.evaluatorAgentTokenIds?.[index])) {
      throw new AacpLifecycleError("openChallenge evaluator panel does not match the reviewed panel");
    }
  }
}

function normalizedIntent(intent: z.infer<typeof AacpOrderTxIntentSchema>) {
  return {
    action: intent.action,
    chainId: intent.chainId,
    target: intentTarget(intent).toLowerCase(),
    callData: intentData(intent).toLowerCase(),
    value: intent.value,
    id: intent.id,
    status: intent.status,
    nonceKey: intent.nonceKey,
  };
}

function hasAction(binding: AacpOrderBinding, action: AacpOrderAction): boolean {
  return binding.transactions.some((transaction) => transaction.action === action);
}

function latestActionAfterObservation(
  binding: AacpOrderBinding,
  actions: AacpOrderAction[],
): AacpOrderAction | null {
  if (!binding.order) return null;
  const observationTime = Date.parse(binding.order.observedAt);
  const transaction = [...binding.transactions]
    .reverse()
    .find(
      (candidate) =>
        actions.includes(candidate.action) && Date.parse(candidate.observedAt) >= observationTime,
    );
  return transaction?.action ?? null;
}

export function deriveAacpLifecycleStage(
  input: AacpOrderBinding,
): z.infer<typeof AacpLifecycleStageSchema> {
  const binding = AacpOrderBindingSchema.parse(input);
  if (!binding.order) {
    if (hasAction(binding, "createOrder")) return "ORDER_INDEXING";
    if (hasAction(binding, "approveEscrow")) return "ESCROW_APPROVED";
    return "CHECKOUT_CREATED";
  }

  if (binding.order.status === "PENDING_ACCEPT") {
    if (latestActionAfterObservation(binding, ["cancelPending"])) {
      return "CANCELLATION_INDEXING";
    }
    return hasAction(binding, "acceptOrder") ? "PROVIDER_ACCEPT_INDEXING" : "PENDING_ACCEPT";
  }
  if (binding.order.status === "FUNDED" || binding.order.status === "IN_PROGRESS") {
    if (latestActionAfterObservation(binding, ["cancelExpired"])) {
      return "CANCELLATION_INDEXING";
    }
    if (binding.order.redoUsed) return "IN_PROGRESS_REDO";
    return hasAction(binding, "submitDelivery") &&
      latestActionAfterObservation(binding, ["submitDelivery"])
      ? "DELIVERY_INDEXING"
      : "IN_PROGRESS";
  }
  if (binding.order.status === "DELIVERED") {
    const pending = latestActionAfterObservation(binding, [
      "releaseEscrow",
      "claimAfterTimeout",
      "requestRedo",
      "openChallenge",
    ]);
    if (pending === "releaseEscrow" || pending === "claimAfterTimeout") {
      return "SETTLEMENT_INDEXING";
    }
    if (pending === "requestRedo") return "REDO_INDEXING";
    if (pending === "openChallenge") return "DISPUTE_INDEXING";
    return "DELIVERED";
  }
  if (binding.order.status === "ACCEPTED") return "SETTLEMENT_INDEXING";
  if (binding.order.status === "IN_DISPUTE") return "IN_DISPUTE";
  if (binding.order.status === "SETTLED") return "SETTLED";
  return "CANCELLED";
}

export function createAacpCheckoutPlan(
  rawJob: JobRecord,
  config: Pick<AacpProductionConfig, "chainId" | "settlementCurrencies">,
  refs: {
    offerId: string;
    revisionId: string;
    clientAgentId: string;
    clientAgentTokenId: string;
    clientWallet: string;
    providerAgentId: string;
    providerAgentTokenId: string;
    providerWallet: string;
    agreementHash: string;
    settlementMode: number;
    challengeWindowSeconds: number;
  },
  now = new Date(),
): AacpCheckoutPlan {
  const job = JobRecordSchema.parse(rawJob);
  const lifecycleConfig = AacpLifecycleConfigSchema.parse(config);
  if (job.envelope.budget.chainId !== 56 || lifecycleConfig.chainId !== 56) {
    throw new AacpLifecycleError("AACP checkout requires PositionCrew and TermiX on BNB Chain 56");
  }
  if (job.state !== "CREATED") {
    throw new AacpLifecycleError("AACP checkout must bind a fresh PositionCrew job");
  }
  const currency = lifecycleConfig.settlementCurrencies.find(
    (candidate) => candidate.symbol === job.envelope.budget.token.symbol,
  );
  if (!currency) throw new AacpLifecycleError("Job currency is not configured by TermiX");
  if (
    !sameAddress(currency.address, job.envelope.budget.token.address) ||
    currency.decimals !== job.envelope.budget.token.decimals
  ) {
    throw new AacpLifecycleError("Job token identity does not match the TermiX currency record");
  }
  decimalToUnits(job.envelope.budget.amount, currency.decimals);
  const parsedRefs = z
    .object({
      offerId: z.string().min(1),
      revisionId: z.string().min(1),
      clientAgentId: z.string().min(1),
      clientAgentTokenId: AgentTokenIdSchema,
      clientWallet: AddressSchema,
      providerAgentId: z.string().min(1),
      providerAgentTokenId: AgentTokenIdSchema,
      providerWallet: AddressSchema,
      agreementHash: Bytes32Schema,
      settlementMode: z.number().int().min(0).max(255),
      challengeWindowSeconds: z.number().int().positive(),
    })
    .strict()
    .parse(refs);
  const request = AacpCheckoutRequestSchema.parse({
    offerId: parsedRefs.offerId,
    revisionId: parsedRefs.revisionId,
    idempotencyKey: `positioncrew-${canonicalHash({
      jobId: job.jobId,
      envelopeHash: job.envelopeHash,
      offerId: parsedRefs.offerId,
      revisionId: parsedRefs.revisionId,
    }).slice(7)}`,
    desiredStake: "0",
    clientAgentId: parsedRefs.clientAgentId,
  });
  return AacpCheckoutPlanSchema.parse({
    schemaVersion: "positioncrew.aacp-checkout-plan.v1",
    jobId: job.jobId,
    envelopeHash: job.envelopeHash,
    requestHash: job.envelope.requestHash,
    chainId: 56,
    currency,
    amount: job.envelope.budget.amount,
    clientAgentId: parsedRefs.clientAgentId,
    clientAgentTokenId: parsedRefs.clientAgentTokenId,
    clientWallet: parsedRefs.clientWallet,
    providerAgentId: parsedRefs.providerAgentId,
    providerAgentTokenId: parsedRefs.providerAgentTokenId,
    providerWallet: parsedRefs.providerWallet,
    agreementHash: parsedRefs.agreementHash,
    deliveryDeadline: job.envelope.deadline,
    settlementMode: parsedRefs.settlementMode,
    challengeWindowSeconds: parsedRefs.challengeWindowSeconds,
    request,
    createdAt: now.toISOString(),
  });
}

export function bindAacpCheckoutSession(
  planInput: AacpCheckoutPlan,
  checkoutInput: unknown,
  now = new Date(),
): AacpOrderBinding {
  const plan = AacpCheckoutPlanSchema.parse(planInput);
  const checkout = AacpCheckoutSessionSchema.parse(checkoutInput);
  if (checkout.currency !== plan.currency.symbol) {
    throw new AacpLifecycleError("Checkout currency does not match the reviewed plan");
  }
  if (!equalAmounts(checkout.amount, plan.amount, plan.currency.decimals)) {
    throw new AacpLifecycleError("Checkout amount does not match the reviewed plan");
  }
  const timestamp = now.toISOString();
  return AacpOrderBindingSchema.parse({
    schemaVersion: "positioncrew.aacp-order-binding.v1",
    plan,
    checkout,
    order: null,
    transactions: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}

function validateAacpOrderIntent(
  bindingInput: AacpOrderBinding,
  intentInput: unknown,
  expectedAction: AacpOrderAction,
  expectationsInput: unknown = {},
): z.infer<typeof AacpOrderTxIntentSchema> {
  const binding = AacpOrderBindingSchema.parse(bindingInput);
  const intent = AacpOrderTxIntentSchema.parse(intentInput);
  const expectations = AacpIntentExpectationsSchema.parse(expectationsInput);
  if (intent.action !== expectedAction) {
    throw new AacpLifecycleError(
      `Expected ${expectedAction} tx-intent, received ${intent.action}`,
    );
  }
  if (intent.value !== "0") {
    throw new AacpLifecycleError("AACP order tx-intent must not transfer native BNB");
  }
  const expectedTarget = expectedAction === "approveEscrow"
    ? binding.plan.currency.address
    : binding.plan.currency.contracts.escrow;
  if (!sameAddress(intentTarget(intent), expectedTarget)) {
    throw new AacpLifecycleError(`${expectedAction} tx-intent targets an unexpected contract`);
  }
  assertDecodedIntent(binding, intent, expectations);
  return intent;
}

function expectedActor(binding: AacpOrderBinding, action: AacpOrderAction): string {
  return ["acceptOrder", "submitDelivery", "claimAfterTimeout"].includes(action)
    ? binding.plan.providerWallet
    : binding.plan.clientWallet;
}

function assertActionAllowed(
  binding: AacpOrderBinding,
  action: AacpOrderAction,
  observedAt: Date,
): void {
  const stage = deriveAacpLifecycleStage(binding);
  if (action === "approveEscrow") {
    if (hasAction(binding, "approveEscrow")) {
      throw new AacpLifecycleError("Escrow approval is already mined for this checkout");
    }
    if (binding.order || hasAction(binding, "createOrder")) {
      throw new AacpLifecycleError("Escrow approval cannot follow order creation");
    }
    return;
  }
  if (action === "createOrder") {
    if (binding.order) throw new AacpLifecycleError("Order creation cannot be repeated after indexing");
    if (hasAction(binding, "createOrder")) {
      throw new AacpLifecycleError("Order creation is already mined and awaiting indexer confirmation");
    }
    if (observedAt.getTime() >= Date.parse(binding.plan.deliveryDeadline)) {
      throw new AacpLifecycleError("Order delivery deadline has elapsed");
    }
    return;
  }
  if (action === "acceptOrder" && stage === "PENDING_ACCEPT") return;
  if (action === "cancelPending" && stage === "PENDING_ACCEPT") {
    const deadline = binding.order?.acceptDeadline;
    if (!deadline) {
      throw new AacpLifecycleError("Indexed order is missing its provider acceptance deadline");
    }
    if (observedAt.getTime() <= Date.parse(deadline)) {
      throw new AacpLifecycleError("Provider acceptance window has not elapsed");
    }
    return;
  }
  if (action === "submitDelivery" && ["IN_PROGRESS", "IN_PROGRESS_REDO"].includes(stage)) {
    const priorDeliveries = binding.transactions.filter(
      (transaction) => transaction.action === "submitDelivery",
    ).length;
    const allowedPriorDeliveries = binding.order?.redoUsed ? 1 : 0;
    if (priorDeliveries > allowedPriorDeliveries) {
      throw new AacpLifecycleError("Delivery submission is already mined for this delivery round");
    }
    if (binding.order?.availableActions.canSubmitDelivery !== true) {
      throw new AacpLifecycleError("Order is not yet indexed as ready for delivery");
    }
    if (!binding.order?.deliveryDueAt) {
      throw new AacpLifecycleError("Indexed order is missing its delivery deadline");
    }
    if (observedAt.getTime() > Date.parse(binding.order.deliveryDueAt)) {
      throw new AacpLifecycleError("Delivery deadline has elapsed");
    }
    return;
  }
  if (action === "cancelExpired" && ["IN_PROGRESS", "IN_PROGRESS_REDO"].includes(stage)) {
    const deadline = binding.order?.deliveryDueAt;
    if (!deadline) {
      throw new AacpLifecycleError("Indexed order is missing its delivery deadline");
    }
    if (observedAt.getTime() <= Date.parse(deadline)) {
      throw new AacpLifecycleError("Delivery deadline has not elapsed");
    }
    return;
  }
  if (action === "releaseEscrow" && stage === "DELIVERED") {
    return;
  }
  if ((action === "requestRedo" || action === "openChallenge") && stage === "DELIVERED") {
    const deadline = binding.order?.challengeWindowEndsAt;
    if (!deadline || observedAt.getTime() > Date.parse(deadline)) {
      throw new AacpLifecycleError("Delivery challenge window has elapsed");
    }
    if (action === "requestRedo" && binding.order?.redoUsed) {
      throw new AacpLifecycleError("The one allowed redo has already been used");
    }
    return;
  }
  if (action === "claimAfterTimeout" && stage === "DELIVERED") {
    const deadline = binding.order?.challengeWindowEndsAt;
    if (!deadline || observedAt.getTime() <= Date.parse(deadline)) {
      throw new AacpLifecycleError("Challenge window has not elapsed");
    }
    return;
  }
  throw new AacpLifecycleError(`${action} is not allowed while lifecycle stage is ${stage}`);
}

export function assertAacpOrderIntent(
  bindingInput: AacpOrderBinding,
  intentInput: unknown,
  expectedAction: AacpOrderAction,
  expectationsInput: unknown = {},
  now = new Date(),
): z.infer<typeof AacpOrderTxIntentSchema> {
  const binding = AacpOrderBindingSchema.parse(bindingInput);
  const intent = validateAacpOrderIntent(
    binding,
    intentInput,
    expectedAction,
    expectationsInput,
  );
  assertActionAllowed(binding, expectedAction, now);
  return intent;
}

export function recordAacpMinedTransaction(
  bindingInput: AacpOrderBinding,
  intentInput: unknown,
  minedInput: unknown,
  now = new Date(),
  expectationsInput: unknown = {},
): AacpOrderBinding {
  const binding = AacpOrderBindingSchema.parse(bindingInput);
  const intent = AacpOrderTxIntentSchema.parse(intentInput);
  const mined = AacpMinedTransactionSchema.parse(minedInput);
  const expectations = AacpIntentExpectationsSchema.parse(expectationsInput);
  validateAacpOrderIntent(binding, intent, mined.action, expectations);
  if (mined.action !== intent.action) {
    throw new AacpLifecycleError("Mined action does not match the reviewed tx-intent");
  }
  const actor = expectedActor(binding, mined.action);
  if (!sameAddress(mined.from, actor)) {
    throw new AacpLifecycleError(`${mined.action} was mined from an unexpected wallet`);
  }
  if (!sameAddress(mined.to, intentTarget(intent))) {
    throw new AacpLifecycleError(`${mined.action} mined transaction targets an unexpected contract`);
  }
  if (mined.input.toLowerCase() !== intentData(intent).toLowerCase()) {
    throw new AacpLifecycleError(`${mined.action} mined calldata differs from the reviewed intent`);
  }
  if (mined.value !== intent.value) {
    throw new AacpLifecycleError(`${mined.action} mined BNB value differs from the reviewed intent`);
  }
  const recorded = AacpRecordedTransactionSchema.parse({
    action: mined.action,
    actor: mined.from,
    target: intentTarget(intent),
    intentHash: canonicalHash(normalizedIntent(intent)),
    txHash: mined.txHash,
    blockNumber: String(mined.blockNumber),
    nonce: String(mined.nonce),
    observedAt: now.toISOString(),
  });
  const prior = binding.transactions.find(
    (transaction) => transaction.txHash.toLowerCase() === recorded.txHash.toLowerCase(),
  );
  if (prior) {
    const { observedAt: _priorObservedAt, ...priorIdentity } = prior;
    const { observedAt: _recordedObservedAt, ...recordedIdentity } = recorded;
    if (canonicalHash(priorIdentity) !== canonicalHash(recordedIdentity)) {
      throw new AacpLifecycleError("Transaction hash was already recorded with different evidence");
    }
    return binding;
  }
  assertActionAllowed(binding, mined.action, now);
  return AacpOrderBindingSchema.parse({
    ...binding,
    transactions: [...binding.transactions, recorded],
    updatedAt: now.toISOString(),
  });
}

const ALLOWED_ORDER_TRANSITIONS: Record<
  z.infer<typeof AacpOrderStatusSchema>,
  ReadonlySet<z.infer<typeof AacpOrderStatusSchema>>
> = {
  PENDING_ACCEPT: new Set(["PENDING_ACCEPT", "FUNDED", "IN_PROGRESS", "DELIVERED", "ACCEPTED", "IN_DISPUTE", "SETTLED", "CANCELLED"]),
  FUNDED: new Set(["FUNDED", "IN_PROGRESS", "DELIVERED", "ACCEPTED", "IN_DISPUTE", "SETTLED", "CANCELLED"]),
  IN_PROGRESS: new Set(["IN_PROGRESS", "DELIVERED", "ACCEPTED", "IN_DISPUTE", "SETTLED", "CANCELLED"]),
  DELIVERED: new Set(["DELIVERED", "IN_PROGRESS", "ACCEPTED", "IN_DISPUTE", "SETTLED"]),
  ACCEPTED: new Set(["ACCEPTED", "SETTLED"]),
  IN_DISPUTE: new Set(["IN_DISPUTE", "SETTLED"]),
  SETTLED: new Set(["SETTLED"]),
  CANCELLED: new Set(["CANCELLED"]),
};

function assertProjectionEvidence(
  binding: AacpOrderBinding,
  observation: AacpOrderObservation,
): void {
  if (!hasAction(binding, "createOrder")) {
    throw new AacpLifecycleError("Indexed order cannot bind before createOrder is mined");
  }
  if (
    ["FUNDED", "IN_PROGRESS", "DELIVERED", "ACCEPTED", "IN_DISPUTE", "SETTLED"].includes(
      observation.status,
    ) &&
    !hasAction(binding, "acceptOrder")
  ) {
    throw new AacpLifecycleError(`${observation.status} projection has no reviewed acceptOrder receipt`);
  }
  if (["DELIVERED", "ACCEPTED", "IN_DISPUTE", "SETTLED"].includes(observation.status)) {
    const deliveryCount = binding.transactions.filter(
      (transaction) => transaction.action === "submitDelivery",
    ).length;
    const requiredCount = observation.redoUsed ? 2 : 1;
    if (deliveryCount < requiredCount) {
      throw new AacpLifecycleError(
        `DELIVERED projection requires ${requiredCount} reviewed delivery receipt${requiredCount === 1 ? "" : "s"}`,
      );
    }
  }
  if (observation.status === "IN_DISPUTE" && !hasAction(binding, "openChallenge")) {
    throw new AacpLifecycleError("IN_DISPUTE projection has no reviewed openChallenge receipt");
  }
  if (observation.redoUsed && !hasAction(binding, "requestRedo")) {
    throw new AacpLifecycleError("Redo projection has no reviewed requestRedo receipt");
  }
  if (observation.status === "ACCEPTED" && !hasAction(binding, "releaseEscrow")) {
    throw new AacpLifecycleError("ACCEPTED projection has no reviewed releaseEscrow receipt");
  }
  if (
    observation.status === "CANCELLED" &&
    !hasAction(binding, "cancelPending") &&
    !hasAction(binding, "cancelExpired")
  ) {
    throw new AacpLifecycleError("CANCELLED projection has no reviewed cancellation receipt");
  }
  if (
    observation.status === "SETTLED" &&
    binding.order?.status !== "IN_DISPUTE" &&
    !hasAction(binding, "releaseEscrow") &&
    !hasAction(binding, "claimAfterTimeout")
  ) {
    throw new AacpLifecycleError("SETTLED projection has no reviewed settlement receipt");
  }
}

export function reconcileAacpOrder(
  bindingInput: AacpOrderBinding,
  observationInput: unknown,
): AacpOrderBinding {
  const binding = AacpOrderBindingSchema.parse(bindingInput);
  const observation = AacpOrderObservationSchema.parse(observationInput);
  assertProjectionEvidence(binding, observation);
  if (observation.currency !== binding.plan.currency.symbol) {
    throw new AacpLifecycleError("Indexed order currency does not match the checkout plan");
  }
  if (!equalAmounts(observation.amount, binding.plan.amount, binding.plan.currency.decimals)) {
    throw new AacpLifecycleError("Indexed order amount does not match the checkout plan");
  }
  if (
    observation.clientAgentId !== binding.plan.clientAgentId ||
    observation.providerAgentId !== binding.plan.providerAgentId
  ) {
    throw new AacpLifecycleError("Indexed order agent identities do not match the checkout plan");
  }
  if (binding.order) {
    if (binding.order.orderId !== observation.orderId) {
      throw new AacpLifecycleError("AACP order binding cannot change order identity");
    }
    if (
      binding.order.onChainOrderId.toLowerCase() !== observation.onChainOrderId.toLowerCase()
    ) {
      throw new AacpLifecycleError("AACP order binding cannot change on-chain order identity");
    }
    if (!ALLOWED_ORDER_TRANSITIONS[binding.order.status].has(observation.status)) {
      throw new AacpLifecycleError(
        `AACP order regressed from ${binding.order.status} to ${observation.status}`,
      );
    }
    if (Date.parse(observation.observedAt) < Date.parse(binding.order.observedAt)) {
      throw new AacpLifecycleError("AACP order observation is older than the retained projection");
    }
    if (binding.order.redoUsed && !observation.redoUsed) {
      throw new AacpLifecycleError("AACP order cannot clear the recorded redo flag");
    }
    if (
      binding.order.status === "DELIVERED" &&
      observation.status === "IN_PROGRESS" &&
      !observation.redoUsed
    ) {
      throw new AacpLifecycleError("A delivered order can resume only through the one-redo path");
    }
  }
  return AacpOrderBindingSchema.parse({
    ...binding,
    order: observation,
    updatedAt: observation.observedAt,
  });
}
