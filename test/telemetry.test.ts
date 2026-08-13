import { describe, expect, it } from "vitest";
import {
  annualizedRatePct,
  poolPriceFromSqrtPriceX96,
  venusLiquidityTotalsFixed,
  venusUsdValueFixed,
} from "../src/telemetry/bsc.js";

describe("BSC telemetry math", () => {
  it("converts a Q96 pool price into token0 per token1", () => {
    const sqrtPriceX96 = 3_206_041_112_872_199_382_275_767_303n;
    expect(poolPriceFromSqrtPriceX96(sqrtPriceX96)).toBeGreaterThan(590);
    expect(poolPriceFromSqrtPriceX96(sqrtPriceX96)).toBeLessThan(630);
  });

  it("annualizes a per-block rate using the measured block interval", () => {
    const annualized = annualizedRatePct(267_884_853n, 0.75);
    expect(annualized).toBeGreaterThan(1);
    expect(annualized).toBeLessThan(1.2);
  });

  it("normalizes Venus oracle values into 18-decimal USD across token decimals", () => {
    expect(venusUsdValueFixed(650n * 10n ** 18n, 999_000_000_000_000_000n)).toBe(
      649_350_000_000_000_000_000n,
    );
    expect(venusUsdValueFixed(2n * 10n ** 8n, 60_000n * 10n ** 28n)).toBe(
      120_000n * 10n ** 18n,
    );
  });

  it("reconstructs liquidity and shortfall with liquidation thresholds and VAI debt", () => {
    const liquid = venusLiquidityTotalsFixed([
      {
        suppliedUsd: 1_000n * 10n ** 18n,
        borrowedUsd: 100n * 10n ** 18n,
        liquidationThreshold: 8_000n * 10n ** 14n,
        collateralEnabled: true,
      },
      {
        suppliedUsd: 500n * 10n ** 18n,
        borrowedUsd: 0n,
        liquidationThreshold: 6_500n * 10n ** 14n,
        collateralEnabled: true,
      },
    ], 25n * 10n ** 18n);
    expect(liquid.collateralValueUsd).toBe(1_500n * 10n ** 18n);
    expect(liquid.liquidationWeightedCollateralUsd).toBe(1_125n * 10n ** 18n);
    expect(liquid.debtValueUsd).toBe(125n * 10n ** 18n);
    expect(liquid.liquidityUsd).toBe(1_000n * 10n ** 18n);
    expect(liquid.shortfallUsd).toBe(0n);

    const short = venusLiquidityTotalsFixed([
      {
        suppliedUsd: 100n * 10n ** 18n,
        borrowedUsd: 90n * 10n ** 18n,
        liquidationThreshold: 8_000n * 10n ** 14n,
        collateralEnabled: true,
      },
    ]);
    expect(short.liquidityUsd).toBe(0n);
    expect(short.shortfallUsd).toBe(10n * 10n ** 18n);
  });
});
