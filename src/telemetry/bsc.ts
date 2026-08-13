import {
  decodeFunctionResult,
  encodeFunctionData,
  formatEther,
  formatUnits,
  isAddress,
  parseAbi,
  toHex,
  type Address,
  type Hex,
} from "viem";
import {
  LendingRescueRequestSchema,
  type LendingRescueRequest,
} from "../contracts/lending-rescue.js";
import { FIXED_SCALE, formatFixed } from "../core/fixed.js";

const MAINNET_RPC = "https://bsc-dataseed.bnbchain.org";
const TESTNET_RPC = "https://bsc-testnet-dataseed.bnbchain.org";

const PANCAKE_V3_FACTORY = "0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865" as Address;
const NATIVE_BNB = "0x0000000000000000000000000000000000000000" as Address;
const WBNB = "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c" as Address;
const USDT = "0x55d398326f99059fF775485246999027B3197955" as Address;
const VENUS_COMPTROLLER = "0xfD36E2c2a6789Db23113685031d7F16329158384" as Address;
const VENUS_VUSDT = "0xfD5840Cd36d94D7229439859C0112a4185BC0255" as Address;
const VENUS_VBNB = "0xA07c5b74C9B40447a954e1466938b865b6BBea36" as Address;

const AACP_CONTRACTS = [
  ["ACPCore", "0x4e07f9C438ba784653b39eB9aE39b1eFF470b6c9"],
  ["TermiXDispute", "0x5f57167F7180C6608bdDeE0df7a47b6Ec46b419B"],
  ["TermiXStaking", "0xBd64B6BbcFcF4Ac78a9e1bdb55a3a128D2e5156e"],
  ["TermiXReputation", "0x28093b19B2bC80225EB4FD0b4665475E41523f98"],
  ["TermiXTreasury", "0x5683d92A8dF9203B007a44Aad3AB1d870870bc13"],
  ["TermiXHook", "0xcF7f3282Da845dBF5493Ca32d94e6720dd3F1D9d"],
  ["MockUSDC", "0x2d01552B05c9b1874373b784AD68398dd7E4B0a8"],
  ["MockAgentNFT", "0x23932e45071ba6Ef687331F429b79C09C34D5eb0"],
] as const satisfies readonly (readonly [string, Address])[];

const FACTORY_ABI = parseAbi([
  "function getPool(address tokenA, address tokenB, uint24 fee) view returns (address pool)",
]);
const POOL_ABI = parseAbi([
  "function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint32 feeProtocol, bool unlocked)",
  "function liquidity() view returns (uint128)",
]);
const VTOKEN_ABI = parseAbi([
  "function supplyRatePerBlock() view returns (uint256)",
  "function borrowRatePerBlock() view returns (uint256)",
  "function getCash() view returns (uint256)",
  "function totalBorrows() view returns (uint256)",
  "function getAccountSnapshot(address account) view returns (uint256 errorCode, uint256 vTokenBalance, uint256 borrowBalance, uint256 exchangeRateMantissa)",
  "function underlying() view returns (address)",
]);
const COMPTROLLER_ABI = parseAbi([
  "function getAccountLiquidity(address account) view returns (uint256 errorCode, uint256 liquidity, uint256 shortfall)",
  "function getAssetsIn(address account) view returns (address[] markets)",
  "function markets(address market) view returns (bool isListed, uint256 collateralFactorMantissa, bool isVenus, uint256 liquidationThresholdMantissa, uint256 liquidationIncentiveMantissa, uint96 marketPoolId, bool isBorrowAllowed)",
  "function getEffectiveLtvFactor(address account, address market, uint8 weightingStrategy) view returns (uint256)",
  "function oracle() view returns (address)",
  "function vaiController() view returns (address)",
]);
const ERC20_ABI = parseAbi([
  "function balanceOf(address account) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
]);
const ORACLE_ABI = parseAbi([
  "function getUnderlyingPrice(address vToken) view returns (uint256)",
]);
const VAI_CONTROLLER_ABI = parseAbi([
  "function getVAIAddress() view returns (address)",
  "function getVAIRepayAmount(address account) view returns (uint256)",
]);

interface RpcCall {
  method: string;
  params: unknown[];
}

interface RpcResult {
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

interface RpcBlock {
  number: Hex;
  timestamp: Hex;
}

async function rpcBatch(rpcUrl: string, calls: readonly RpcCall[]): Promise<unknown[]> {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(
      calls.map((call, index) => ({
        jsonrpc: "2.0",
        id: index + 1,
        method: call.method,
        params: call.params,
      })),
    ),
  });
  if (!response.ok) throw new Error(`BSC RPC returned HTTP ${response.status}`);
  const payload: unknown = await response.json();
  const entries = (Array.isArray(payload) ? payload : [payload]) as RpcResult[];
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  return calls.map((_, index) => {
    const entry = byId.get(index + 1);
    if (!entry) throw new Error(`BSC RPC omitted response ${index + 1}`);
    if (entry.error) throw new Error(`BSC RPC ${entry.error.code}: ${entry.error.message}`);
    if (entry.result === undefined) throw new Error(`BSC RPC response ${index + 1} has no result`);
    return entry.result;
  });
}

async function rpcBatchChunked(
  rpcUrl: string,
  calls: readonly RpcCall[],
  chunkSize = 10,
): Promise<unknown[]> {
  const results: unknown[] = [];
  for (let index = 0; index < calls.length; index += chunkSize) {
    results.push(...await rpcBatch(rpcUrl, calls.slice(index, index + chunkSize)));
  }
  return results;
}

function rpcHex(value: unknown, label: string): Hex {
  if (typeof value !== "string" || !value.startsWith("0x")) {
    throw new Error(`${label} returned an invalid hex value`);
  }
  return value as Hex;
}

function rpcBlock(value: unknown, label: string): RpcBlock {
  if (typeof value !== "object" || value === null) throw new Error(`${label} is unavailable`);
  const candidate = value as Partial<RpcBlock>;
  return {
    number: rpcHex(candidate.number, `${label} number`),
    timestamp: rpcHex(candidate.timestamp, `${label} timestamp`),
  };
}

function ethCall(to: Address, data: Hex, blockTag: Hex): RpcCall {
  return { method: "eth_call", params: [{ to, data }, blockTag] };
}

export interface ChainProbe {
  chainId: 56 | 97;
  name: string;
  blockNumber: string;
  blockTimestamp: string;
  blockAgeSeconds: number;
  gasPriceGwei: string;
  rpcLatencyMs: number;
  rpcUrl: string;
  explorerUrl: string;
}

export interface SystemTelemetry {
  schemaVersion: "positioncrew.system-telemetry.v1";
  generatedAt: string;
  mainnet: ChainProbe;
  testnet: ChainProbe;
  market: {
    pair: "WBNB/USDT";
    venue: "PancakeSwap V3";
    poolAddress: Address;
    feeTier: 100;
    spotPriceUsd: string;
    tick: number;
    liquidityRaw: string;
    observedAt: string;
    explorerUrl: string;
  };
  venus: {
    market: "vUSDT";
    address: Address;
    supplyAprPct: string;
    borrowAprPct: string;
    availableLiquidityUsd: string;
    totalBorrowsUsd: string;
    observedAt: string;
    explorerUrl: string;
  };
  aacp: {
    chainId: 97;
    state: "CONTRACTS_VERIFIED_BACKEND_GATED";
    deployedCount: number;
    contractCount: number;
    contracts: Array<{
      name: string;
      address: Address;
      deployed: boolean;
      explorerUrl: string;
    }>;
    docsUrl: string;
    boundary: string;
  };
}

export interface VenusAccountProbe {
  schemaVersion: "positioncrew.venus-account-probe.v1";
  generatedAt: string;
  chainId: 56;
  account: Address;
  state: "NO_POSITION" | "LIQUID" | "SHORTFALL";
  nativeBalanceBnb: string;
  usdtBalance: string;
  liquidityUsd: string;
  shortfallUsd: string;
  enteredMarkets: Address[];
  position: {
    collateralValueUsd: string;
    liquidationWeightedCollateralUsd: string;
    debtValueUsd: string;
    healthFactor: string | null;
    markets: Array<{
      vToken: Address;
      symbol: string;
      underlying: Address;
      decimals: number;
      suppliedAmount: string;
      borrowedAmount: string;
      walletAmount: string;
      priceUsd: string;
      collateralFactorBps: number;
      liquidationThresholdBps: number;
      collateralEnabled: boolean;
    }>;
  };
  rescueRequest: LendingRescueRequest | null;
  source: {
    comptroller: Address;
    blockNumber: string;
    explorerUrl: string;
  };
  boundary: string;
}

export interface VenusRescueRequestOptions {
  targetHealthFactor?: string;
  stressPriceDropBps?: number;
  maxActionUsd?: string;
  maxGasUsd?: string;
  maxSlippageBps?: number;
}

function nowMs(): number {
  return Date.now();
}

function decimal(value: number, digits = 2): string {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
    useGrouping: false,
  });
}

function tokenAmount(raw: bigint, decimals: number): string {
  const rendered = formatUnits(raw, decimals);
  return rendered.includes(".") ? rendered.replace(/0+$/, "").replace(/\.$/, "") : rendered;
}

function oraclePriceFixed(priceRaw: bigint, underlyingDecimals: number): bigint {
  return (priceRaw * 10n ** BigInt(underlyingDecimals)) / FIXED_SCALE;
}

export function venusUsdValueFixed(amountRaw: bigint, oraclePriceRaw: bigint): bigint {
  return (amountRaw * oraclePriceRaw) / FIXED_SCALE;
}

export function venusLiquidityTotalsFixed(
  markets: readonly {
    suppliedUsd: bigint;
    borrowedUsd: bigint;
    liquidationThreshold: bigint;
    collateralEnabled: boolean;
  }[],
  additionalDebtUsd = 0n,
): {
  collateralValueUsd: bigint;
  liquidationWeightedCollateralUsd: bigint;
  debtValueUsd: bigint;
  liquidityUsd: bigint;
  shortfallUsd: bigint;
} {
  let collateralValueUsd = 0n;
  let liquidationWeightedCollateralUsd = 0n;
  let debtValueUsd = additionalDebtUsd;
  for (const market of markets) {
    if (market.collateralEnabled) {
      collateralValueUsd += market.suppliedUsd;
      liquidationWeightedCollateralUsd +=
        (market.suppliedUsd * market.liquidationThreshold) / FIXED_SCALE;
    }
    debtValueUsd += market.borrowedUsd;
  }
  return {
    collateralValueUsd,
    liquidationWeightedCollateralUsd,
    debtValueUsd,
    liquidityUsd: liquidationWeightedCollateralUsd >= debtValueUsd
      ? liquidationWeightedCollateralUsd - debtValueUsd
      : 0n,
    shortfallUsd: debtValueUsd > liquidationWeightedCollateralUsd
      ? debtValueUsd - liquidationWeightedCollateralUsd
      : 0n,
  };
}

function minimumPositiveGasLimit(estimatedGasUsd: bigint): string {
  const doubled = estimatedGasUsd * 2n;
  const floor = 100_000_000_000_000_000n;
  return formatFixed(doubled > floor ? doubled : floor, 6);
}

export function poolPriceFromSqrtPriceX96(sqrtPriceX96: bigint): number {
  const ratio = (Number(sqrtPriceX96) / 2 ** 96) ** 2;
  return ratio === 0 ? 0 : 1 / ratio;
}

export function annualizedRatePct(ratePerBlock: bigint, secondsPerBlock: number): number {
  if (secondsPerBlock <= 0) return 0;
  const blocksPerYear = 31_536_000 / secondsPerBlock;
  return Number(formatUnits(ratePerBlock, 18)) * blocksPerYear * 100;
}

async function chainProbe(
  chainId: 56 | 97,
  name: string,
  rpcUrl: string,
  explorerUrl: string,
): Promise<{ probe: ChainProbe; secondsPerBlock: number }> {
  const startedAt = nowMs();
  const [latestValue, gasPriceValue] = await rpcBatch(rpcUrl, [
    { method: "eth_getBlockByNumber", params: ["latest", false] },
    { method: "eth_gasPrice", params: [] },
  ]);
  const latest = rpcBlock(latestValue, `${name} latest block`);
  const latestNumber = BigInt(latest.number);
  const latestTimestamp = BigInt(latest.timestamp);
  const priorNumber = latestNumber > 120n ? latestNumber - 120n : 0n;
  const [priorValue] = await rpcBatch(rpcUrl, [
    { method: "eth_getBlockByNumber", params: [toHex(priorNumber), false] },
  ]);
  const prior = rpcBlock(priorValue, `${name} prior block`);
  const gasPrice = BigInt(rpcHex(gasPriceValue, `${name} gas price`));
  const observedAt = Math.floor(Date.now() / 1000);
  const secondsPerBlock = Math.max(
    0.1,
    Number(latestTimestamp - BigInt(prior.timestamp)) / 120,
  );
  return {
    probe: {
      chainId,
      name,
      blockNumber: latestNumber.toString(),
      blockTimestamp: new Date(Number(latestTimestamp) * 1000).toISOString(),
      blockAgeSeconds: Math.max(0, observedAt - Number(latestTimestamp)),
      gasPriceGwei: decimal(Number(formatUnits(gasPrice, 9)), 3),
      rpcLatencyMs: Math.max(1, nowMs() - startedAt),
      rpcUrl,
      explorerUrl: `${explorerUrl}/block/${latestNumber}`,
    },
    secondsPerBlock,
  };
}

export async function getSystemTelemetry(): Promise<SystemTelemetry> {
  const [mainnet, testnet] = await Promise.all([
    chainProbe(56, "BNB Smart Chain", MAINNET_RPC, "https://bscscan.com"),
    chainProbe(97, "BSC Testnet", TESTNET_RPC, "https://testnet.bscscan.com"),
  ]);
  const mainnetBlockTag = toHex(BigInt(mainnet.probe.blockNumber));
  const testnetBlockTag = toHex(BigInt(testnet.probe.blockNumber));

  const [mainnetValues, aacpCodes] = await Promise.all([
    rpcBatch(MAINNET_RPC, [
      ethCall(
        PANCAKE_V3_FACTORY,
        encodeFunctionData({
          abi: FACTORY_ABI,
          functionName: "getPool",
          args: [WBNB, USDT, 100],
        }),
        mainnetBlockTag,
      ),
      ethCall(
        VENUS_VUSDT,
        encodeFunctionData({ abi: VTOKEN_ABI, functionName: "supplyRatePerBlock" }),
        mainnetBlockTag,
      ),
      ethCall(
        VENUS_VUSDT,
        encodeFunctionData({ abi: VTOKEN_ABI, functionName: "borrowRatePerBlock" }),
        mainnetBlockTag,
      ),
      ethCall(
        VENUS_VUSDT,
        encodeFunctionData({ abi: VTOKEN_ABI, functionName: "getCash" }),
        mainnetBlockTag,
      ),
      ethCall(
        VENUS_VUSDT,
        encodeFunctionData({ abi: VTOKEN_ABI, functionName: "totalBorrows" }),
        mainnetBlockTag,
      ),
    ]),
    rpcBatch(
      TESTNET_RPC,
      AACP_CONTRACTS.map(([, address]) => ({
        method: "eth_getCode",
        params: [address, testnetBlockTag],
      })),
    ),
  ]);

  const poolAddress = decodeFunctionResult({
    abi: FACTORY_ABI,
    functionName: "getPool",
    data: rpcHex(mainnetValues[0], "PancakeSwap pool"),
  });
  if (poolAddress === "0x0000000000000000000000000000000000000000") {
    throw new Error("PancakeSwap WBNB/USDT 0.01% pool is unavailable");
  }

  const [slot0Value, liquidityValue] = await rpcBatch(MAINNET_RPC, [
    ethCall(
      poolAddress,
      encodeFunctionData({ abi: POOL_ABI, functionName: "slot0" }),
      mainnetBlockTag,
    ),
    ethCall(
      poolAddress,
      encodeFunctionData({ abi: POOL_ABI, functionName: "liquidity" }),
      mainnetBlockTag,
    ),
  ]);
  const slot0 = decodeFunctionResult({
    abi: POOL_ABI,
    functionName: "slot0",
    data: rpcHex(slot0Value, "PancakeSwap slot0"),
  });
  const liquidity = decodeFunctionResult({
    abi: POOL_ABI,
    functionName: "liquidity",
    data: rpcHex(liquidityValue, "PancakeSwap liquidity"),
  });
  const supplyRate = decodeFunctionResult({
    abi: VTOKEN_ABI,
    functionName: "supplyRatePerBlock",
    data: rpcHex(mainnetValues[1], "Venus supply rate"),
  });
  const borrowRate = decodeFunctionResult({
    abi: VTOKEN_ABI,
    functionName: "borrowRatePerBlock",
    data: rpcHex(mainnetValues[2], "Venus borrow rate"),
  });
  const cash = decodeFunctionResult({
    abi: VTOKEN_ABI,
    functionName: "getCash",
    data: rpcHex(mainnetValues[3], "Venus cash"),
  });
  const totalBorrows = decodeFunctionResult({
    abi: VTOKEN_ABI,
    functionName: "totalBorrows",
    data: rpcHex(mainnetValues[4], "Venus total borrows"),
  });

  const generatedAt = new Date().toISOString();
  const contracts = AACP_CONTRACTS.map(([name, address], index) => {
    const bytecode = rpcHex(aacpCodes[index], `${name} bytecode`);
    return {
      name,
      address,
      deployed: bytecode !== "0x",
      explorerUrl: `https://testnet.bscscan.com/address/${address}`,
    };
  });

  return {
    schemaVersion: "positioncrew.system-telemetry.v1",
    generatedAt,
    mainnet: mainnet.probe,
    testnet: testnet.probe,
    market: {
      pair: "WBNB/USDT",
      venue: "PancakeSwap V3",
      poolAddress,
      feeTier: 100,
      spotPriceUsd: decimal(poolPriceFromSqrtPriceX96(slot0[0]), 2),
      tick: slot0[1],
      liquidityRaw: liquidity.toString(),
      observedAt: generatedAt,
      explorerUrl: `https://bscscan.com/address/${poolAddress}`,
    },
    venus: {
      market: "vUSDT",
      address: VENUS_VUSDT,
      supplyAprPct: decimal(annualizedRatePct(supplyRate, mainnet.secondsPerBlock), 2),
      borrowAprPct: decimal(annualizedRatePct(borrowRate, mainnet.secondsPerBlock), 2),
      availableLiquidityUsd: decimal(Number(formatUnits(cash, 18)), 0),
      totalBorrowsUsd: decimal(Number(formatUnits(totalBorrows, 18)), 0),
      observedAt: generatedAt,
      explorerUrl: `https://bscscan.com/address/${VENUS_VUSDT}`,
    },
    aacp: {
      chainId: 97,
      state: "CONTRACTS_VERIFIED_BACKEND_GATED",
      deployedCount: contracts.filter((contract) => contract.deployed).length,
      contractCount: contracts.length,
      contracts,
      docsUrl: "https://docs.termix.ai/aacp/overview",
      boundary:
        "AACP contracts are deployed on BSC testnet. Terminal settlement remains disabled until the documented backend config and proof flow are reachable.",
    },
  };
}

export async function inspectVenusAccount(
  accountInput: string,
  options: VenusRescueRequestOptions = {},
): Promise<VenusAccountProbe> {
  if (!isAddress(accountInput)) throw new Error("A valid EVM account address is required");
  const account = accountInput as Address;
  const [blockValue] = await rpcBatch(MAINNET_RPC, [
    { method: "eth_getBlockByNumber", params: ["latest", false] },
  ]);
  const block = rpcBlock(blockValue, "BNB Smart Chain latest block");
  const [
    liquidityValue,
    enteredMarketsValue,
    oracleValue,
    vaiControllerValue,
    nativeBalanceValue,
    usdtBalanceValue,
    gasPriceValue,
  ] =
    await rpcBatch(MAINNET_RPC, [
      ethCall(
        VENUS_COMPTROLLER,
        encodeFunctionData({
          abi: COMPTROLLER_ABI,
          functionName: "getAccountLiquidity",
          args: [account],
        }),
        block.number,
      ),
      ethCall(
        VENUS_COMPTROLLER,
        encodeFunctionData({
          abi: COMPTROLLER_ABI,
          functionName: "getAssetsIn",
          args: [account],
        }),
        block.number,
      ),
      ethCall(
        VENUS_COMPTROLLER,
        encodeFunctionData({ abi: COMPTROLLER_ABI, functionName: "oracle" }),
        block.number,
      ),
      ethCall(
        VENUS_COMPTROLLER,
        encodeFunctionData({ abi: COMPTROLLER_ABI, functionName: "vaiController" }),
        block.number,
      ),
      { method: "eth_getBalance", params: [account, block.number] },
      ethCall(
        USDT,
        encodeFunctionData({ abi: ERC20_ABI, functionName: "balanceOf", args: [account] }),
        block.number,
      ),
      { method: "eth_gasPrice", params: [] },
    ]);
  const [errorCode, liquidity, shortfall] = decodeFunctionResult({
    abi: COMPTROLLER_ABI,
    functionName: "getAccountLiquidity",
    data: rpcHex(liquidityValue, "Venus account liquidity"),
  });
  const enteredMarkets = decodeFunctionResult({
    abi: COMPTROLLER_ABI,
    functionName: "getAssetsIn",
    data: rpcHex(enteredMarketsValue, "Venus entered markets"),
  });
  const oracle = decodeFunctionResult({
    abi: COMPTROLLER_ABI,
    functionName: "oracle",
    data: rpcHex(oracleValue, "Venus oracle"),
  });
  const vaiController = decodeFunctionResult({
    abi: COMPTROLLER_ABI,
    functionName: "vaiController",
    data: rpcHex(vaiControllerValue, "Venus VAI controller"),
  });
  const nativeBalance = BigInt(rpcHex(nativeBalanceValue, "BNB balance"));
  const usdtBalance = decodeFunctionResult({
    abi: ERC20_ABI,
    functionName: "balanceOf",
    data: rpcHex(usdtBalanceValue, "USDT balance"),
  });
  const gasPrice = BigInt(rpcHex(gasPriceValue, "BSC gas price"));
  if (errorCode !== 0n) throw new Error(`Venus Comptroller returned error code ${errorCode}`);

  const [vaiAddressValue, vaiDebtValue] = await rpcBatch(MAINNET_RPC, [
    ethCall(
      vaiController,
      encodeFunctionData({ abi: VAI_CONTROLLER_ABI, functionName: "getVAIAddress" }),
      block.number,
    ),
    ethCall(
      vaiController,
      encodeFunctionData({
        abi: VAI_CONTROLLER_ABI,
        functionName: "getVAIRepayAmount",
        args: [account],
      }),
      block.number,
    ),
  ]);
  const vaiAddress = decodeFunctionResult({
    abi: VAI_CONTROLLER_ABI,
    functionName: "getVAIAddress",
    data: rpcHex(vaiAddressValue, "VAI address"),
  });
  const vaiDebtRaw = decodeFunctionResult({
    abi: VAI_CONTROLLER_ABI,
    functionName: "getVAIRepayAmount",
    data: rpcHex(vaiDebtValue, "VAI debt"),
  });

  const entered = new Set(enteredMarkets.map((market) => market.toLowerCase()));
  const activeMarkets = [...enteredMarkets];

  const marketCalls: RpcCall[] = [];
  for (const vToken of activeMarkets) {
    marketCalls.push(
      ethCall(
        VENUS_COMPTROLLER,
        encodeFunctionData({ abi: COMPTROLLER_ABI, functionName: "markets", args: [vToken] }),
        block.number,
      ),
      ethCall(
        VENUS_COMPTROLLER,
        encodeFunctionData({
          abi: COMPTROLLER_ABI,
          functionName: "getEffectiveLtvFactor",
          args: [account, vToken, 0],
        }),
        block.number,
      ),
      ethCall(
        VENUS_COMPTROLLER,
        encodeFunctionData({
          abi: COMPTROLLER_ABI,
          functionName: "getEffectiveLtvFactor",
          args: [account, vToken, 1],
        }),
        block.number,
      ),
      ethCall(
        vToken,
        encodeFunctionData({
          abi: VTOKEN_ABI,
          functionName: "getAccountSnapshot",
          args: [account],
        }),
        block.number,
      ),
      ethCall(
        oracle,
        encodeFunctionData({ abi: ORACLE_ABI, functionName: "getUnderlyingPrice", args: [vToken] }),
        block.number,
      ),
    );
    if (vToken.toLowerCase() !== VENUS_VBNB.toLowerCase()) {
      marketCalls.push(
        ethCall(
          vToken,
          encodeFunctionData({ abi: VTOKEN_ABI, functionName: "underlying" }),
          block.number,
        ),
      );
    }
  }
  marketCalls.push(
    ethCall(
      oracle,
      encodeFunctionData({
        abi: ORACLE_ABI,
        functionName: "getUnderlyingPrice",
        args: [VENUS_VBNB],
      }),
      block.number,
    ),
  );
  const marketValues = await rpcBatchChunked(MAINNET_RPC, marketCalls);
  let marketCursor = 0;
  const rawMarkets = activeMarkets.map((vToken) => {
    const listed = decodeFunctionResult({
      abi: COMPTROLLER_ABI,
      functionName: "markets",
      data: rpcHex(marketValues[marketCursor++], `${vToken} listing`),
    });
    const effectiveCollateralFactor = decodeFunctionResult({
      abi: COMPTROLLER_ABI,
      functionName: "getEffectiveLtvFactor",
      data: rpcHex(marketValues[marketCursor++], `${vToken} effective collateral factor`),
    });
    const liquidationThreshold = decodeFunctionResult({
      abi: COMPTROLLER_ABI,
      functionName: "getEffectiveLtvFactor",
      data: rpcHex(marketValues[marketCursor++], `${vToken} effective liquidation threshold`),
    });
    const accountSnapshot = decodeFunctionResult({
      abi: VTOKEN_ABI,
      functionName: "getAccountSnapshot",
      data: rpcHex(marketValues[marketCursor++], `${vToken} account snapshot`),
    });
    const priceRaw = decodeFunctionResult({
      abi: ORACLE_ABI,
      functionName: "getUnderlyingPrice",
      data: rpcHex(marketValues[marketCursor++], `${vToken} oracle price`),
    });
    const underlying = vToken.toLowerCase() === VENUS_VBNB.toLowerCase()
      ? NATIVE_BNB
      : decodeFunctionResult({
          abi: VTOKEN_ABI,
          functionName: "underlying",
          data: rpcHex(marketValues[marketCursor++], `${vToken} underlying`),
        });
    if (!listed[0]) throw new Error(`Venus market ${vToken} is no longer listed`);
    if (accountSnapshot[0] !== 0n) {
      throw new Error(`Venus market ${vToken} returned snapshot error ${accountSnapshot[0]}`);
    }
    if (priceRaw <= 0n) throw new Error(`Venus market ${vToken} has no oracle price`);
    return {
      vToken,
      underlying,
      collateralFactor: effectiveCollateralFactor,
      collateralEnabled: entered.has(vToken.toLowerCase()),
      suppliedRaw: (accountSnapshot[1] * accountSnapshot[3]) / FIXED_SCALE,
      borrowedRaw: accountSnapshot[2],
      priceRaw,
      liquidationThreshold,
    };
  });
  const vBnbPriceRaw = decodeFunctionResult({
    abi: ORACLE_ABI,
    functionName: "getUnderlyingPrice",
    data: rpcHex(marketValues[marketCursor], "vBNB oracle price"),
  });

  const uniqueUnderlyings = [...new Map(rawMarkets.map((market) => [
    market.underlying.toLowerCase(),
    market.underlying,
  ])).values()];
  const tokenCalls: RpcCall[] = [];
  for (const underlying of uniqueUnderlyings) {
    if (underlying.toLowerCase() === NATIVE_BNB.toLowerCase()) continue;
    tokenCalls.push(
      ethCall(
        underlying,
        encodeFunctionData({ abi: ERC20_ABI, functionName: "decimals" }),
        block.number,
      ),
      ethCall(
        underlying,
        encodeFunctionData({ abi: ERC20_ABI, functionName: "symbol" }),
        block.number,
      ),
      ethCall(
        underlying,
        encodeFunctionData({ abi: ERC20_ABI, functionName: "balanceOf", args: [account] }),
        block.number,
      ),
    );
  }
  tokenCalls.push(
    ethCall(
      vaiAddress,
      encodeFunctionData({ abi: ERC20_ABI, functionName: "balanceOf", args: [account] }),
      block.number,
    ),
  );
  const tokenValues = tokenCalls.length > 0
    ? await rpcBatchChunked(MAINNET_RPC, tokenCalls)
    : [];
  let tokenCursor = 0;
  const tokenMetadata = new Map<string, { symbol: string; decimals: number; walletRaw: bigint }>();
  for (const underlying of uniqueUnderlyings) {
    if (underlying.toLowerCase() === NATIVE_BNB.toLowerCase()) {
      tokenMetadata.set(underlying.toLowerCase(), {
        symbol: "BNB",
        decimals: 18,
        walletRaw: nativeBalance,
      });
      continue;
    }
    const decimals = decodeFunctionResult({
      abi: ERC20_ABI,
      functionName: "decimals",
      data: rpcHex(tokenValues[tokenCursor++], `${underlying} decimals`),
    });
    const symbol = decodeFunctionResult({
      abi: ERC20_ABI,
      functionName: "symbol",
      data: rpcHex(tokenValues[tokenCursor++], `${underlying} symbol`),
    });
    const walletRaw = decodeFunctionResult({
      abi: ERC20_ABI,
      functionName: "balanceOf",
      data: rpcHex(tokenValues[tokenCursor++], `${underlying} wallet balance`),
    });
    if (symbol.length > 16) throw new Error(`Unsupported Venus token symbol: ${symbol}`);
    tokenMetadata.set(underlying.toLowerCase(), { symbol, decimals, walletRaw });
  }
  const vaiWalletRaw = decodeFunctionResult({
    abi: ERC20_ABI,
    functionName: "balanceOf",
    data: rpcHex(tokenValues[tokenCursor], "VAI wallet balance"),
  });

  const observedAt = new Date(Number(BigInt(block.timestamp)) * 1_000).toISOString();
  const sourceId = `venus-mainnet-block-${BigInt(block.number)}`;
  const decodedMarkets = rawMarkets.map((market) => {
    const metadata = tokenMetadata.get(market.underlying.toLowerCase());
    if (!metadata) throw new Error(`Missing token metadata for ${market.underlying}`);
    const suppliedUsd = venusUsdValueFixed(market.suppliedRaw, market.priceRaw);
    const borrowedUsd = venusUsdValueFixed(market.borrowedRaw, market.priceRaw);
    return {
      ...market,
      ...metadata,
      suppliedUsd,
      borrowedUsd,
      priceFixed: oraclePriceFixed(market.priceRaw, metadata.decimals),
      collateralFactorBps: Number((market.collateralFactor * 10_000n) / FIXED_SCALE),
      liquidationThresholdBps: Number(
        (market.liquidationThreshold * 10_000n) / FIXED_SCALE,
      ),
    };
  });
  const {
    collateralValueUsd,
    liquidationWeightedCollateralUsd,
    debtValueUsd,
    liquidityUsd: expectedLiquidity,
    shortfallUsd: expectedShortfall,
  } = venusLiquidityTotalsFixed(decodedMarkets, vaiDebtRaw);

  const accountingDifference =
    (expectedLiquidity > liquidity ? expectedLiquidity - liquidity : liquidity - expectedLiquidity) +
    (expectedShortfall > shortfall ? expectedShortfall - shortfall : shortfall - expectedShortfall);
  if (accountingDifference > FIXED_SCALE) {
    throw new Error(
      `Venus market reconstruction does not match Comptroller account liquidity ` +
      `(expected liquidity ${formatFixed(expectedLiquidity, 6)}, actual ${formatFixed(liquidity, 6)}; ` +
      `expected shortfall ${formatFixed(expectedShortfall, 6)}, actual ${formatFixed(shortfall, 6)})`,
    );
  }

  const bnbPriceFixed = oraclePriceFixed(vBnbPriceRaw, 18);
  const estimatedGasUsd = (gasPrice * 350_000n * bnbPriceFixed) / FIXED_SCALE;
  const generatedAt = new Date().toISOString();
  const source = {
    sourceId,
    label: `Venus Classic account and oracle snapshot at BSC block ${BigInt(block.number)}`,
    uri: `https://bscscan.com/block/${BigInt(block.number)}`,
    observedAt,
  };
  const collateral = decodedMarkets
    .filter((market) => market.collateralEnabled && market.suppliedRaw > 0n)
    .map((market) => ({
      symbol: market.symbol,
      address: market.underlying,
      decimals: market.decimals,
      amount: tokenAmount(market.suppliedRaw, market.decimals),
      priceUsd: formatFixed(market.priceFixed, 8),
      sourceId,
      observedAt,
      liquidationThresholdBps: market.liquidationThresholdBps,
      collateralEnabled: true,
    }));
  const debt = decodedMarkets
    .filter((market) => market.borrowedRaw > 0n)
    .map((market) => ({
      symbol: market.symbol,
      address: market.underlying,
      decimals: market.decimals,
      amount: tokenAmount(market.borrowedRaw, market.decimals),
      priceUsd: formatFixed(market.priceFixed, 8),
      sourceId,
      observedAt,
    }));
  if (vaiDebtRaw > 0n) {
    debt.push({
      symbol: "VAI",
      address: vaiAddress,
      decimals: 18,
      amount: tokenAmount(vaiDebtRaw, 18),
      priceUsd: "1",
      sourceId,
      observedAt,
    });
  }
  const availableAssets = decodedMarkets.map((market) => ({
    symbol: market.symbol,
    address: market.underlying,
    decimals: market.decimals,
    availableAmount: tokenAmount(market.walletRaw, market.decimals),
  }));
  if (vaiDebtRaw > 0n || vaiWalletRaw > 0n) {
    availableAssets.push({
      symbol: "VAI",
      address: vaiAddress,
      decimals: 18,
      availableAmount: tokenAmount(vaiWalletRaw, 18),
    });
  }
  const rescueRequest = collateral.length > 0 && debt.length > 0
    ? LendingRescueRequestSchema.parse({
        schemaVersion: "positioncrew.lending-rescue.request.v1",
        service: "LENDING_RESCUE",
        requestId: `venus-live-${account.toLowerCase().slice(2, 10)}-${Date.now()}`,
        chainId: 56,
        account,
        protocol: "Venus Classic",
        requestedAt: generatedAt,
        deadline: new Date(Date.parse(generatedAt) + 5 * 60_000).toISOString(),
        maxDataAgeSeconds: 300,
        maxActionUsd: options.maxActionUsd ?? "250",
        maxGasUsd: options.maxGasUsd ?? minimumPositiveGasLimit(estimatedGasUsd),
        maxSlippageBps: options.maxSlippageBps ?? 30,
        sources: [source],
        market: VENUS_COMPTROLLER,
        position: { collateral, debt },
        availableAssets,
        allowedActions: ["REPAY_DEBT", "ADD_COLLATERAL"],
        targetHealthFactor: options.targetHealthFactor ?? "1.25",
        stressPriceDropBps: options.stressPriceDropBps ?? 1_000,
        oracleDeviationToleranceBps: 100,
        estimatedGasUsd: formatFixed(estimatedGasUsd, 6),
      })
    : null;
  const state =
    activeMarkets.length === 0 ? "NO_POSITION" : shortfall > 0n ? "SHORTFALL" : "LIQUID";

  return {
    schemaVersion: "positioncrew.venus-account-probe.v1",
    generatedAt,
    chainId: 56,
    account,
    state,
    nativeBalanceBnb: decimal(Number(formatEther(nativeBalance)), 6),
    usdtBalance: decimal(Number(formatUnits(usdtBalance, 18)), 2),
    liquidityUsd: decimal(Number(formatUnits(liquidity, 18)), 6),
    shortfallUsd: decimal(Number(formatUnits(shortfall, 18)), 6),
    enteredMarkets: [...enteredMarkets],
    position: {
      collateralValueUsd: formatFixed(collateralValueUsd, 6),
      liquidationWeightedCollateralUsd: formatFixed(liquidationWeightedCollateralUsd, 6),
      debtValueUsd: formatFixed(debtValueUsd, 6),
      healthFactor: debtValueUsd === 0n
        ? null
        : formatFixed((liquidationWeightedCollateralUsd * FIXED_SCALE) / debtValueUsd, 8),
      markets: decodedMarkets.map((market) => ({
        vToken: market.vToken,
        symbol: market.symbol,
        underlying: market.underlying,
        decimals: market.decimals,
        suppliedAmount: tokenAmount(market.suppliedRaw, market.decimals),
        borrowedAmount: tokenAmount(market.borrowedRaw, market.decimals),
        walletAmount: tokenAmount(market.walletRaw, market.decimals),
        priceUsd: formatFixed(market.priceFixed, 8),
        collateralFactorBps: market.collateralFactorBps,
        liquidationThresholdBps: market.liquidationThresholdBps,
        collateralEnabled: market.collateralEnabled,
      })),
    },
    rescueRequest,
    source: {
      comptroller: VENUS_COMPTROLLER,
      blockNumber: BigInt(block.number).toString(),
      explorerUrl: `https://bscscan.com/block/${BigInt(block.number)}`,
    },
    boundary:
      rescueRequest
        ? "The embedded rescue request was reconstructed from block-pinned Venus Classic balances, collateral factors, liquidation thresholds, oracle prices, and wallet inventory. It remains unsigned and must be revalidated before execution."
        : "This block-pinned Venus Classic account has no reconstructable collateral-and-debt pair, so no rescue request was produced.",
  };
}
