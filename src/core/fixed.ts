const SCALE_DECIMALS = 18;
export const FIXED_SCALE = 10n ** BigInt(SCALE_DECIMALS);

const DECIMAL_PATTERN = /^(0|[1-9]\d*)(?:\.(\d{1,18}))?$/;

export function parseFixed(value: string): bigint {
  const match = DECIMAL_PATTERN.exec(value);
  if (!match) {
    throw new Error(`Invalid unsigned decimal: ${value}`);
  }

  const whole = BigInt(match[1] ?? "0");
  const fraction = (match[2] ?? "").padEnd(SCALE_DECIMALS, "0");
  return whole * FIXED_SCALE + BigInt(fraction || "0");
}

export function formatFixed(value: bigint, maxDecimals = 6): string {
  if (value < 0n) {
    return `-${formatFixed(-value, maxDecimals)}`;
  }

  const whole = value / FIXED_SCALE;
  if (maxDecimals === 0) {
    return whole.toString();
  }

  const fraction = (value % FIXED_SCALE)
    .toString()
    .padStart(SCALE_DECIMALS, "0")
    .slice(0, maxDecimals)
    .replace(/0+$/, "");

  return fraction.length > 0 ? `${whole}.${fraction}` : whole.toString();
}

export function multiplyFixed(left: bigint, right: bigint): bigint {
  return (left * right) / FIXED_SCALE;
}

export function divideFixed(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) {
    throw new Error("Cannot divide by zero");
  }
  return (numerator * FIXED_SCALE) / denominator;
}

export function ceilDivide(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) {
    throw new Error("Denominator must be positive");
  }
  return (numerator + denominator - 1n) / denominator;
}

export function ratioFromBps(bps: number): bigint {
  return (BigInt(bps) * FIXED_SCALE) / 10_000n;
}

export function tokenBaseUnitsForUsd(
  usdValue: bigint,
  tokenPriceUsd: bigint,
  tokenDecimals: number,
): bigint {
  if (tokenPriceUsd <= 0n) {
    throw new Error("Token price must be positive");
  }
  return ceilDivide(usdValue * 10n ** BigInt(tokenDecimals), tokenPriceUsd);
}

export function fixedTokenAmountFromBaseUnits(
  baseUnits: bigint,
  tokenDecimals: number,
): bigint {
  return (baseUnits * FIXED_SCALE) / 10n ** BigInt(tokenDecimals);
}

export function minimum(left: bigint, right: bigint): bigint {
  return left <= right ? left : right;
}
