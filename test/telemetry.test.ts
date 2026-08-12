import { describe, expect, it } from "vitest";
import { annualizedRatePct, poolPriceFromSqrtPriceX96 } from "../src/telemetry/bsc.js";

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
});
