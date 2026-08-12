import {
  BoundedGridDeliverableSchema,
  BoundedGridRequestSchema,
  type BoundedGridDeliverable,
  type BoundedGridRequest,
  type GridOrderSchema,
} from "../contracts/bounded-grid.js";
import type { z } from "zod";
import {
  FIXED_SCALE,
  divideFixed,
  formatFixed,
  multiplyFixed,
  parseFixed,
  ratioFromBps,
} from "../core/fixed.js";
import { clampNonNegative, validateEvidence } from "./provider-utils.js";

type GridOrder = z.infer<typeof GridOrderSchema>;

function emptyResult(
  request: BoundedGridRequest,
  now: Date,
  expiresAt: string,
  status: BoundedGridDeliverable["status"],
  summary: string,
  limitations: string[],
): BoundedGridDeliverable {
  return BoundedGridDeliverableSchema.parse({
    schemaVersion: "capitalops.bounded-grid.deliverable.v1",
    service: "BOUNDED_GRID",
    requestId: request.requestId,
    generatedAt: now.toISOString(),
    expiresAt,
    status,
    decision: status === "NO_ACTION" ? "NO_GRID" : "NONE",
    orders: [],
    grossSpreadCaptureUsd: "0",
    estimatedFeesUsd: "0",
    estimatedSlippageUsd: "0",
    estimatedGasUsd: "0",
    expectedNetProfitUsd: "0",
    worstCaseLossUsd: "0",
    maximumInventoryUsd: "0",
    summary,
    cancellationConditions: ["Refresh market evidence before constructing another grid."],
    limitations,
  });
}

export function createBoundedGridDeliverable(
  input: BoundedGridRequest,
  now: Date,
): BoundedGridDeliverable {
  const request = BoundedGridRequestSchema.parse(input);
  const evidence = validateEvidence({
    sources: request.sources,
    observations: [request.marketState],
    requestedAt: request.requestedAt,
    deadline: request.deadline,
    maxDataAgeSeconds: request.maxDataAgeSeconds,
    now,
  });
  if (evidence.status !== "OK") {
    return emptyResult(
      request,
      now,
      evidence.expiresAt,
      evidence.status,
      "Grid evidence is unsafe or expired; no orders were proposed.",
      evidence.reasons,
    );
  }

  const mid = parseFixed(request.marketState.midPrice);
  const lower = parseFixed(request.constraints.lowerPrice);
  const upper = parseFixed(request.constraints.upperPrice);
  const capital = parseFixed(request.constraints.capitalUsd);
  const liquidity = parseFixed(request.marketState.liquidityUsd);
  if (
    mid <= lower ||
    mid >= upper ||
    liquidity < parseFixed(request.constraints.minimumLiquidityUsd) ||
    request.marketState.realizedVolatilityBps > request.constraints.maximumVolatilityBps ||
    capital > parseFixed(request.maxActionUsd)
  ) {
    return emptyResult(
      request,
      now,
      evidence.expiresAt,
      "NO_ACTION",
      "The requested grid fails range, liquidity, volatility, or capital policy.",
      ["No order is emitted when any hard market constraint fails."],
    );
  }

  const step = (upper - lower) / BigInt(request.constraints.levelCount - 1);
  const levels = Array.from({ length: request.constraints.levelCount }, (_, index) =>
    lower + step * BigInt(index),
  );
  const buyLevels = levels.filter((price) => price < mid);
  const sellLevels = levels.filter((price) => price > mid);
  if (buyLevels.length === 0 || sellLevels.length === 0 || step <= 0n) {
    return emptyResult(
      request,
      now,
      evidence.expiresAt,
      "NO_ACTION",
      "The requested range cannot form both buy and sell sides.",
      ["At least one valid level is required on each side of the mid price."],
    );
  }

  const buyCapital = capital / 2n;
  const sellCapital = capital - buyCapital;
  const buyQuotePerOrder = buyCapital / BigInt(buyLevels.length);
  const sellQuotePerOrder = sellCapital / BigInt(sellLevels.length);
  const orders: GridOrder[] = [
    ...buyLevels.map((price) => ({
      side: "BUY" as const,
      price: formatFixed(price, 8),
      baseAmount: formatFixed(divideFixed(buyQuotePerOrder, price), 12),
      maximumQuoteAmount: formatFixed(buyQuotePerOrder, 6),
    })),
    ...sellLevels.map((price) => ({
      side: "SELL" as const,
      price: formatFixed(price, 8),
      baseAmount: formatFixed(divideFixed(sellQuotePerOrder, price), 12),
      maximumQuoteAmount: formatFixed(sellQuotePerOrder, 6),
    })),
  ];
  const spacingRatio = divideFixed(step, mid);
  const turnover = capital * BigInt(request.constraints.expectedCompletedCycles);
  const grossSpreadCapture = multiplyFixed(turnover / 2n, spacingRatio);
  const twoLegTurnover = turnover * 2n;
  const fees = multiplyFixed(
    twoLegTurnover,
    ratioFromBps(request.marketState.venueFeeBps),
  );
  const slippage = multiplyFixed(twoLegTurnover, ratioFromBps(request.maxSlippageBps));
  const gas = parseFixed(request.constraints.estimatedGasUsd);
  const netProfit = clampNonNegative(grossSpreadCapture - fees - slippage - gas);
  const downsideRatio = divideFixed(mid - lower, mid);
  const worstCaseLoss = multiplyFixed(buyCapital, downsideRatio) + fees + slippage + gas;
  const maximumInventory = buyCapital > sellCapital ? buyCapital : sellCapital;
  const economicsPass =
    grossSpreadCapture > fees + slippage + gas &&
    netProfit >= parseFixed(request.constraints.minimumExpectedNetProfitUsd) &&
    worstCaseLoss <= parseFixed(request.constraints.maximumLossUsd) &&
    maximumInventory <= parseFixed(request.constraints.maximumInventoryUsd) &&
    gas <= parseFixed(request.maxGasUsd);

  if (!economicsPass) {
    return emptyResult(
      request,
      now,
      evidence.expiresAt,
      "NO_ACTION",
      "The grid was rejected because net profit, inventory, or worst-case loss fails policy.",
      [
        `Projected gross ${formatFixed(grossSpreadCapture, 4)} USD, net ${formatFixed(netProfit, 4)} USD, worst-case loss ${formatFixed(worstCaseLoss, 4)} USD.`,
      ],
    );
  }

  const orderExpiry = new Date(
    Math.min(
      Date.parse(evidence.expiresAt),
      now.getTime() + request.constraints.orderExpirySeconds * 1_000,
    ),
  ).toISOString();
  return BoundedGridDeliverableSchema.parse({
    schemaVersion: "capitalops.bounded-grid.deliverable.v1",
    service: "BOUNDED_GRID",
    requestId: request.requestId,
    generatedAt: now.toISOString(),
    expiresAt: orderExpiry,
    status: "ACTIONABLE",
    decision: "BUILD_GRID",
    orders,
    grossSpreadCaptureUsd: formatFixed(grossSpreadCapture, 6),
    estimatedFeesUsd: formatFixed(fees, 6),
    estimatedSlippageUsd: formatFixed(slippage, 6),
    estimatedGasUsd: formatFixed(gas, 6),
    expectedNetProfitUsd: formatFixed(netProfit, 6),
    worstCaseLossUsd: formatFixed(worstCaseLoss, 6),
    maximumInventoryUsd: formatFixed(maximumInventory, 6),
    summary: `Build ${orders.length} bounded orders from ${request.constraints.lowerPrice} to ${request.constraints.upperPrice}; projected net profit is ${formatFixed(netProfit, 2)} USD.`,
    cancellationConditions: [
      `Cancel at ${orderExpiry}.`,
      `Cancel if volatility exceeds ${request.constraints.maximumVolatilityBps} bps.`,
      `Cancel if available liquidity falls below ${request.constraints.minimumLiquidityUsd} USD.`,
      `Cancel if inventory reaches ${request.constraints.maximumInventoryUsd} USD.`,
    ],
    limitations: [
      `The profit model assumes ${request.constraints.expectedCompletedCycles} completed cycles; fills are not guaranteed.`,
      "No averaging or replacement orders may exceed the frozen capital, loss, or inventory limits.",
    ],
  });
}
