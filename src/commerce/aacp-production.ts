import { z } from "zod";
import {
  decodeFunctionResult,
  encodeFunctionData,
  getAddress,
  parseAbi,
} from "viem";
import termixIdentityEvidence from "../../evidence/termix-identities.mainnet.json" with { type: "json" };
import termixListingEvidence from "../../evidence/termix-listings.mainnet.json" with { type: "json" };
import { AddressSchema, ServiceTypeSchema } from "../contracts/common.js";
import {
  TERMIX_RUNTIME_DEFAULT_POLL_SECONDS,
  TERMIX_RUNTIME_EXPIRY_BUFFER_SECONDS,
  TERMIX_RUNTIME_TOKEN_LIFETIME_HOURS,
} from "./aacp-runtime.js";

export const AACP_BSC_API = "https://platform-backend.prod.termix.live";
export const AACP_BSC_RPC = "https://bsc-rpc.publicnode.com";
export const AACP_BSC_RPC_FALLBACK = "https://bsc-dataseed.bnbchain.org";
export const AACP_DOCS_URL = "https://docs.termix.ai/aacp/overview";
export const AACP_DOCS_INDEX_URL = "https://docs.termix.ai/llms.txt";
export const AACP_OPENAPI_URL = "https://docs.termix.ai/api-reference/openapi.json";

export const AACP_ORDER_GUARD_ACTIONS = [
  "approveEscrow",
  "createOrder",
  "cancelPending",
  "acceptOrder",
  "submitDelivery",
  "cancelExpired",
  "releaseEscrow",
  "requestRedo",
  "claimAfterTimeout",
  "openChallenge",
] as const;

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

const ERC8004_IDENTITY_ABI = parseAbi([
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function tokenURI(uint256 tokenId) view returns (string)",
]);

const TransactionHashSchema = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const Sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);

const AacpMainnetIdentityEvidenceSchema = z
  .object({
    schemaVersion: z.literal("positioncrew.termix-identities.v1"),
    network: z.literal("bsc-mainnet"),
    chainId: z.literal(56),
    identityRegistry: AddressSchema,
    owner: AddressSchema,
    providers: z.array(
      z
        .object({
          service: ServiceTypeSchema,
          handle: z.string().regex(/^positioncrew-[a-z0-9-]+\.agent$/),
          agentTokenId: z.string().regex(/^\d+$/),
          metadataUrl: z.string().url(),
          metadataSha256: Sha256Schema,
          description: z.string().min(1),
          tags: z.array(z.string().min(1)).min(1),
          registrationTransaction: TransactionHashSchema,
          blockNumber: z.number().int().positive(),
          blockTimestamp: z.string().datetime(),
          gasCostBnb: z.string().regex(/^0\.\d+$/),
        })
        .strict(),
    ).length(4),
    totalGasCostBnb: z.string().regex(/^0\.\d+$/),
    verifiedAt: z.string().datetime(),
    boundaries: z.array(z.string().min(1)).min(1),
  })
  .strict();

const AacpMainnetListingEvidenceSchema = z
  .object({
    schemaVersion: z.literal("positioncrew.termix-listings.v1"),
    network: z.literal("bsc-mainnet"),
    chainId: z.literal(56),
    owner: AddressSchema,
    listings: z.array(
      z
        .object({
          service: ServiceTypeSchema,
          handle: z.string().regex(/^positioncrew-[a-z0-9-]+\.agent$/),
          agentId: z.string().min(1),
          agentTokenId: z.string().regex(/^\d+$/),
          listingId: z.string().min(1),
          listingUrl: z.string().url(),
          title: z.string().min(1),
          category: z.literal("Market & Protocol Research"),
          skillTag: z.string().min(1),
          tags: z.array(z.string().min(1)).min(1),
          basePrice: z.literal("5"),
          currency: z.literal("USDC"),
          deliveryDays: z.literal(1),
          instantBuyable: z.literal(true),
          publicSearch: z.literal(true),
          challengeWindowHours: z.literal(24),
          settlementType: z.literal("escrow"),
          proofMethod: z.literal("optimistic"),
          bondAmount: z.literal("0"),
          packageScope: z.literal("One bounded decision or explicit refusal"),
          coverImageUrl: z.string().url(),
          coverImageState: z.literal("DEFAULT_PLATFORM_BANNER"),
          createdAt: z.string().datetime(),
        })
        .strict(),
    ).length(4),
    verifiedAt: z.string().datetime(),
    boundaries: z.array(z.string().min(1)).min(1),
  })
  .strict();

const ContractDescriptorSchema = z
  .object({
    name: z.string().min(1),
    address: AddressSchema,
    abi: z.string().min(1),
    configured: z.boolean(),
  })
  .passthrough();

const CurrencyContractsSchema = z
  .object({
    escrow: AddressSchema,
    staking: AddressSchema,
    campaignVault: AddressSchema,
  })
  .strict();

export const AacpSettlementCurrencySchema = z
  .object({
    symbol: z.enum(["USDC", "USDT"]),
    decimals: z.number().int().min(1).max(18),
    address: AddressSchema,
    default: z.boolean(),
    protocolFeeBps: z.number().int().min(0).max(10_000),
    providerLockBps: z.number().int().min(0).max(10_000).nullable(),
    contracts: CurrencyContractsSchema,
  })
  .strict();

export const AacpProductionConfigSchema = z
  .object({
    environment: z.literal("production"),
    chainId: z.literal(56),
    network: z.literal("bnb-chain"),
    networkLabel: z.string().min(1),
    explorerBaseUrl: z.string().url(),
    protocolFeeBps: z.number().int().min(0).max(10_000),
    campaignProtocolFeeBps: z.number().int().min(0).max(10_000),
    settlementCurrency: z
      .object({
        symbol: z.enum(["USDC", "USDT"]),
        decimals: z.number().int().min(1).max(18),
        address: AddressSchema,
      })
      .strict(),
    settlementCurrencies: z.array(AacpSettlementCurrencySchema).min(1),
    settlementChains: z
      .array(
        z
          .object({
            id: z.literal(56),
            name: z.string().min(1),
            default: z.boolean(),
            explorerBaseUrl: z.string().url(),
          })
          .strict(),
      )
      .min(1),
    contracts: z
      .object({
        identityRegistry: ContractDescriptorSchema,
        agentNft: ContractDescriptorSchema,
        escrow: ContractDescriptorSchema,
        staking: ContractDescriptorSchema,
        reputation: ContractDescriptorSchema,
        usdc: ContractDescriptorSchema,
        campaignVault: ContractDescriptorSchema,
      })
      .passthrough(),
  })
  .passthrough()
  .superRefine((value, context) => {
    const currencies = new Set<string>();
    let defaultCount = 0;
    for (const [index, currency] of value.settlementCurrencies.entries()) {
      if (currencies.has(currency.symbol)) {
        context.addIssue({
          code: "custom",
          path: ["settlementCurrencies", index, "symbol"],
          message: `duplicate settlement currency ${currency.symbol}`,
        });
      }
      currencies.add(currency.symbol);
      if (currency.default) defaultCount += 1;
      if (currency.providerLockBps === null) {
        context.addIssue({
          code: "custom",
          path: ["settlementCurrencies", index, "providerLockBps"],
          message: "providerLockBps must be available before preparing an order",
        });
      }
    }
    if (defaultCount !== 1) {
      context.addIssue({
        code: "custom",
        path: ["settlementCurrencies"],
        message: "exactly one settlement currency must be the default",
      });
    }
    if (!currencies.has("USDC") || !currencies.has("USDT")) {
      context.addIssue({
        code: "custom",
        path: ["settlementCurrencies"],
        message: "the documented BNB deployment must expose both USDC and USDT",
      });
    }
    const defaultCurrency = value.settlementCurrencies.find((currency) => currency.default);
    if (
      defaultCurrency &&
      (defaultCurrency.symbol !== value.settlementCurrency.symbol ||
        defaultCurrency.decimals !== value.settlementCurrency.decimals ||
        defaultCurrency.address.toLowerCase() !== value.settlementCurrency.address.toLowerCase())
    ) {
      context.addIssue({
        code: "custom",
        path: ["settlementCurrency"],
        message: "settlementCurrency must match the default settlementCurrencies entry",
      });
    }
    const defaultChainCount = value.settlementChains.filter((chain) => chain.default).length;
    if (defaultChainCount !== 1) {
      context.addIssue({
        code: "custom",
        path: ["settlementChains"],
        message: "exactly one settlement chain must be the default",
      });
    }
    if (
      value.contracts.identityRegistry.address.toLowerCase() !==
      value.contracts.agentNft.address.toLowerCase()
    ) {
      context.addIssue({
        code: "custom",
        path: ["contracts", "agentNft", "address"],
        message: "agentNft must resolve to the shared ERC-8004 identity registry",
      });
    }
    if (defaultCurrency) {
      const aliases = [
        ["escrow", value.contracts.escrow.address, defaultCurrency.contracts.escrow],
        ["staking", value.contracts.staking.address, defaultCurrency.contracts.staking],
        ["campaignVault", value.contracts.campaignVault.address, defaultCurrency.contracts.campaignVault],
      ] as const;
      for (const [name, alias, expected] of aliases) {
        if (alias.toLowerCase() !== expected.toLowerCase()) {
          context.addIssue({
            code: "custom",
            path: ["contracts", name, "address"],
            message: `${name} must match the default settlement currency contract`,
          });
        }
      }
    }
    const usdc = value.settlementCurrencies.find((currency) => currency.symbol === "USDC");
    if (usdc && value.contracts.usdc.address.toLowerCase() !== usdc.address.toLowerCase()) {
      context.addIssue({
        code: "custom",
        path: ["contracts", "usdc", "address"],
        message: "the USDC contract alias must match the USDC settlement currency",
      });
    }
    for (const [name, descriptor] of Object.entries(value.contracts)) {
      if (
        typeof descriptor !== "object" ||
        descriptor === null ||
        !("address" in descriptor) ||
        !("configured" in descriptor)
      ) {
        continue;
      }
      const address = String(descriptor.address);
      if (!descriptor.configured || address.toLowerCase() === ZERO_ADDRESS) {
        context.addIssue({
          code: "custom",
          path: ["contracts", name],
          message: `${name} must be configured at a non-zero address`,
        });
      }
    }
  });

export type AacpProductionConfig = z.infer<typeof AacpProductionConfigSchema>;

export interface AacpProviderBlueprint {
  service: z.infer<typeof ServiceTypeSchema>;
  mintName: string;
  handle: string;
  displayName: string;
  category: "Market & Protocol Research";
  description: string;
  tags: string[];
  listing: {
    title: string;
    category: "Market & Protocol Research";
    basePrice: "5";
    currency: "USDC";
    deliveryDays: 1;
    description: string;
    skillTag: string;
    tags: string[];
    instantBuyable: true;
    publicSearch: true;
    challengeWindowHours: 24;
    settlementType: "escrow";
    proofMethod: "optimistic";
    bondAmount: "0";
    coverImageUrl: string;
    coverImageAlt: string;
  };
}

function blueprint(
  service: AacpProviderBlueprint["service"],
  mintName: string,
  displayName: string,
  description: string,
  title: string,
  skillTag: string,
  coverSlug: string,
  agentTags: string[],
  listingTags: string[] = agentTags,
): AacpProviderBlueprint {
  return {
    service,
    mintName,
    handle: `${mintName}.agent`,
    displayName,
    category: "Market & Protocol Research",
    description,
    tags: agentTags,
    listing: {
      title,
      category: "Market & Protocol Research",
      basePrice: "5",
      currency: "USDC",
      deliveryDays: 1,
      description: `${description} The deliverable is machine-readable JSON with source commitments, execution bounds, expiry, and an explicit refusal when the evidence or buyer limits do not support a safe action. A no-wallet trial is available at https://positioncrew.dolepee.com.`,
      skillTag,
      tags: listingTags,
      instantBuyable: true,
      publicSearch: true,
      challengeWindowHours: 24,
      settlementType: "escrow",
      proofMethod: "optimistic",
      bondAmount: "0",
      coverImageUrl: `https://positioncrew.dolepee.com/listing-media/${coverSlug}.png`,
      coverImageAlt: `${displayName} example deliverable with bounded inputs, decision, execution guards, and evidence status.`,
    },
  };
}

export const AACP_PROVIDER_BLUEPRINTS: readonly AacpProviderBlueprint[] = [
  blueprint(
    "LENDING_RESCUE",
    "positioncrew-lending-rescue",
    "PositionCrew Lending Rescue",
    "Computes the smallest bounded Venus debt repayment or collateral top-up needed to reach a buyer-selected health factor.",
    "Rescue a Venus lending position",
    "On-chain Analytics",
    "lending-rescue",
    ["Monitor", "On-chain Analytics", "Financial Advisor"],
    ["On-chain Analytics", "Financial Advisor", "Portfolio Management"],
  ),
  blueprint(
    "LP_REBALANCE",
    "positioncrew-lp-rebalance",
    "PositionCrew LP Range Operator",
    "Evaluates a PancakeSwap V3 position and proposes a cost-, slippage-, inventory-, and break-even-bounded range shift or HOLD.",
    "Rebalance a PancakeSwap V3 LP range",
    "DeFi Yield Optimizer",
    "lp-rebalance",
    ["DeFi Yield Optimizer", "Portfolio Management", "On-chain Analytics"],
  ),
  blueprint(
    "YIELD_OPTIMIZATION",
    "positioncrew-yield-optimizer",
    "PositionCrew Yield Allocator",
    "Compares block-pinned Venus stablecoin markets and returns a liquidity-, concentration-, migration-cost-, and risk-bounded allocation or HOLD.",
    "Optimise a Venus stablecoin allocation",
    "DeFi Yield Optimizer",
    "yield-optimization",
    ["DeFi Yield Optimizer", "Portfolio Management", "On-chain Analytics"],
  ),
  blueprint(
    "BOUNDED_GRID",
    "positioncrew-bounded-grid",
    "PositionCrew Bounded Grid Builder",
    "Constructs or rejects a PancakeSwap WBNB/USDT grid under explicit volatility, fee, slippage, inventory, gas, and maximum-loss limits.",
    "Build or reject a bounded PancakeSwap grid",
    "Trading Bot",
    "bounded-grid",
    ["Trading Bot", "Quant Strategy", "Technical Analysis"],
  ),
] as const;

export const AACP_MAINNET_IDENTITY_EVIDENCE =
  AacpMainnetIdentityEvidenceSchema.parse(termixIdentityEvidence);

export const AACP_MAINNET_LISTING_EVIDENCE =
  AacpMainnetListingEvidenceSchema.parse(termixListingEvidence);

for (const blueprintValue of AACP_PROVIDER_BLUEPRINTS) {
  const identity = AACP_MAINNET_IDENTITY_EVIDENCE.providers.find(
    (candidate) => candidate.service === blueprintValue.service,
  );
  if (!identity) {
    throw new Error(`Missing mainnet identity evidence for ${blueprintValue.service}`);
  }
  if (
    identity.handle !== blueprintValue.handle ||
    identity.description !== blueprintValue.description ||
    JSON.stringify(identity.tags) !== JSON.stringify(blueprintValue.tags)
  ) {
    throw new Error(`Mainnet identity evidence drifted for ${blueprintValue.service}`);
  }
  const listing = AACP_MAINNET_LISTING_EVIDENCE.listings.find(
    (candidate) => candidate.service === blueprintValue.service,
  );
  if (!listing) {
    throw new Error(`Missing mainnet listing evidence for ${blueprintValue.service}`);
  }
  if (
    listing.handle !== blueprintValue.handle ||
    listing.agentTokenId !== identity.agentTokenId ||
    listing.title !== blueprintValue.listing.title ||
    listing.category !== blueprintValue.listing.category ||
    listing.skillTag !== blueprintValue.listing.skillTag ||
    JSON.stringify(listing.tags) !== JSON.stringify(blueprintValue.listing.tags) ||
    listing.basePrice !== blueprintValue.listing.basePrice ||
    listing.currency !== blueprintValue.listing.currency ||
    listing.deliveryDays !== blueprintValue.listing.deliveryDays ||
    listing.instantBuyable !== blueprintValue.listing.instantBuyable ||
    listing.publicSearch !== blueprintValue.listing.publicSearch ||
    listing.challengeWindowHours !== blueprintValue.listing.challengeWindowHours ||
    listing.settlementType !== blueprintValue.listing.settlementType ||
    listing.proofMethod !== blueprintValue.listing.proofMethod ||
    listing.bondAmount !== blueprintValue.listing.bondAmount
  ) {
    throw new Error(`Mainnet listing evidence drifted for ${blueprintValue.service}`);
  }
}

const ListingDetailSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    category: z.string().min(1),
    skillTag: z.string().min(1),
    tags: z.array(z.string().min(1)).min(1),
    description: z.string().min(1),
    status: z.string().min(1),
    instantBuyable: z.boolean(),
    coverImageUrl: z.string().url(),
    coverImageAlt: z.string().nullable(),
    basePrice: z.string().min(1),
    currency: z.string().min(1),
    deliveryDays: z.number().int().positive(),
    proofMethod: z.string().min(1),
    settlementType: z.string().min(1),
    challengeWindowHours: z.number().int().nonnegative(),
    bondAmount: z.string(),
    publicSearch: z.boolean(),
    createdAt: z.string().datetime(),
    providerAgent: z
      .object({
          id: z.string().min(1),
          agentTokenId: z.string().regex(/^\d+$/),
          name: z.string().min(1),
          a2aStatus: z.string().min(1),
          presence: z.string().min(1),
          verified: z.boolean(),
        })
        .passthrough(),
    packages: z.array(
      z
        .object({
          id: z.enum(["basic", "standard", "premium"]),
          price: z.string().min(1),
          scope: z.string().min(1),
          delivery: z.string().min(1),
        })
        .passthrough(),
    ).length(3),
  })
  .passthrough();

interface FetchOptions {
  fetchImpl?: typeof fetch;
  now?: Date;
}

async function fetchJson(
  url: string,
  fetchImpl: typeof fetch,
): Promise<unknown> {
  const response = await fetchImpl(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "PositionCrew-AACP-Readiness/1.0",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`AACP upstream returned HTTP ${response.status}`);
  return response.json();
}

export async function fetchAacpProductionConfig(
  options: FetchOptions = {},
): Promise<AacpProductionConfig> {
  const fetchImpl = options.fetchImpl ?? fetch;
  return AacpProductionConfigSchema.parse(
    await fetchJson(`${AACP_BSC_API}/api/v1/config/contracts`, fetchImpl),
  );
}

interface RpcResponse {
  id: number;
  result?: unknown;
  error?: { code: number; message: string };
}

async function rpcBatch(
  rpcUrl: string,
  calls: Array<{ method: string; params: unknown[] }>,
  fetchImpl: typeof fetch,
): Promise<unknown[]> {
  const response = await fetchImpl(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(
      calls.map((call, index) => ({ jsonrpc: "2.0", id: index + 1, ...call })),
    ),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`BSC RPC returned HTTP ${response.status}`);
  const payload = (await response.json()) as RpcResponse[];
  if (!Array.isArray(payload) || payload.length !== calls.length) {
    throw new Error("BSC RPC returned an incomplete batch");
  }
  const byId = new Map(payload.map((entry) => [entry.id, entry]));
  return calls.map((_, index) => {
    const entry = byId.get(index + 1);
    if (!entry) throw new Error(`BSC RPC omitted response ${index + 1}`);
    if (entry.error) throw new Error(`BSC RPC ${entry.error.code}: ${entry.error.message}`);
    return entry.result;
  });
}

function contractTargets(config: AacpProductionConfig) {
  const values = [
    { name: "IdentityRegistry", kind: "IDENTITY", currency: null, address: config.contracts.identityRegistry.address },
    { name: "TermixReputation", kind: "REPUTATION", currency: null, address: config.contracts.reputation.address },
    ...config.settlementCurrencies.flatMap((currency) => [
      { name: `${currency.symbol} token`, kind: "TOKEN", currency: currency.symbol, address: currency.address },
      { name: `${currency.symbol} escrow`, kind: "ESCROW", currency: currency.symbol, address: currency.contracts.escrow },
      { name: `${currency.symbol} staking`, kind: "STAKING", currency: currency.symbol, address: currency.contracts.staking },
      { name: `${currency.symbol} campaign`, kind: "CAMPAIGN", currency: currency.symbol, address: currency.contracts.campaignVault },
    ]),
  ];
  const unique = new Map(values.map((value) => [value.address.toLowerCase(), value]));
  return [...unique.values()];
}

async function probeContracts(
  config: AacpProductionConfig,
  fetchImpl: typeof fetch,
) {
  if (
    AACP_MAINNET_IDENTITY_EVIDENCE.identityRegistry.toLowerCase() !==
    config.contracts.identityRegistry.address.toLowerCase()
  ) {
    throw new Error("Recorded identity registry does not match the live TermiX config");
  }
  const targets = contractTargets(config);
  const identityCalls = AACP_MAINNET_IDENTITY_EVIDENCE.providers.flatMap((identity) => [
    {
      method: "eth_call",
      params: [
        {
          to: config.contracts.identityRegistry.address,
          data: encodeFunctionData({
            abi: ERC8004_IDENTITY_ABI,
            functionName: "ownerOf",
            args: [BigInt(identity.agentTokenId)],
          }),
        },
        "latest",
      ],
    },
    {
      method: "eth_call",
      params: [
        {
          to: config.contracts.identityRegistry.address,
          data: encodeFunctionData({
            abi: ERC8004_IDENTITY_ABI,
            functionName: "tokenURI",
            args: [BigInt(identity.agentTokenId)],
          }),
        },
        "latest",
      ],
    },
  ]);
  const calls = [
    { method: "eth_chainId", params: [] },
    { method: "eth_blockNumber", params: [] },
    ...targets.map((target) => ({ method: "eth_getCode", params: [target.address, "latest"] })),
    ...identityCalls,
  ];
  let values: unknown[] | null = null;
  let selectedRpc = AACP_BSC_RPC;
  let firstError: unknown = null;
  for (const rpcUrl of [AACP_BSC_RPC, AACP_BSC_RPC_FALLBACK]) {
    try {
      values = await rpcBatch(rpcUrl, calls, fetchImpl);
      selectedRpc = rpcUrl;
      break;
    } catch (error) {
      firstError ??= error;
    }
  }
  if (!values) throw firstError instanceof Error ? firstError : new Error("BSC RPC unavailable");
  if (values[0] !== "0x38") throw new Error(`AACP RPC chain mismatch: ${String(values[0])}`);
  const blockNumber = BigInt(String(values[1])).toString();
  const contracts = targets.map((target, index) => {
    const code = String(values![index + 2]);
    if (!/^0x[0-9a-fA-F]*$/.test(code)) throw new Error(`${target.name} returned invalid bytecode`);
    return {
      ...target,
      deployed: code !== "0x",
      codeBytes: Math.max(0, (code.length - 2) / 2),
      explorerUrl: `${config.explorerBaseUrl}/address/${target.address}`,
    };
  });
  const identityOffset = 2 + targets.length;
  const identities = AACP_MAINNET_IDENTITY_EVIDENCE.providers.map((identity, index) => {
    const owner = getAddress(
      decodeFunctionResult({
        abi: ERC8004_IDENTITY_ABI,
        functionName: "ownerOf",
        data: String(values![identityOffset + index * 2]) as `0x${string}`,
      }),
    );
    const metadataUrl = decodeFunctionResult({
      abi: ERC8004_IDENTITY_ABI,
      functionName: "tokenURI",
      data: String(values![identityOffset + index * 2 + 1]) as `0x${string}`,
    });
    if (owner.toLowerCase() !== AACP_MAINNET_IDENTITY_EVIDENCE.owner.toLowerCase()) {
      throw new Error(`ERC-8004 owner mismatch for ${identity.handle}`);
    }
    if (metadataUrl !== identity.metadataUrl) {
      throw new Error(`ERC-8004 metadata URI mismatch for ${identity.handle}`);
    }
    return {
      ...identity,
      owner,
      onchainVerified: true as const,
      explorerUrl: `${config.explorerBaseUrl}/tx/${identity.registrationTransaction}`,
    };
  });
  return { rpcUrl: selectedRpc, blockNumber, contracts, identities };
}

type VerifiedAacpIdentity = Awaited<ReturnType<typeof probeContracts>>["identities"][number];

function recordedIdentity(
  config: AacpProductionConfig,
  identity: (typeof AACP_MAINNET_IDENTITY_EVIDENCE.providers)[number],
): VerifiedAacpIdentity {
  return {
    ...identity,
    owner: getAddress(AACP_MAINNET_IDENTITY_EVIDENCE.owner),
    onchainVerified: true,
    explorerUrl: `${config.explorerBaseUrl}/tx/${identity.registrationTransaction}`,
  };
}

async function discoverProvider(
  blueprintValue: AacpProviderBlueprint,
  identity: VerifiedAacpIdentity,
  fetchImpl: typeof fetch,
) {
  const recorded = AACP_MAINNET_LISTING_EVIDENCE.listings.find(
    (candidate) => candidate.service === blueprintValue.service,
  );
  if (!recorded) {
    throw new Error(`Recorded Agent.family listing missing for ${blueprintValue.handle}`);
  }
  let listing: z.infer<typeof ListingDetailSchema>;
  try {
    listing = ListingDetailSchema.parse(
      await fetchJson(
        `${AACP_BSC_API}/api/v1/listings/${encodeURIComponent(recorded.listingId)}`,
        fetchImpl,
      ),
    );
  } catch {
    return {
      service: blueprintValue.service,
      handle: blueprintValue.handle,
      agentId: null,
      agentTokenId: identity.agentTokenId,
      listingId: recorded.listingId,
      listingStatus: null,
      listingUrl: recorded.listingUrl,
      liveListingVerified: false,
      a2aStatus: null,
      presence: null,
      verified: false,
      status: "LISTING_DISCOVERY_UNAVAILABLE" as const,
      identity,
    };
  }

  const expectedFields = [
    ["listing ID", listing.id, recorded.listingId],
    ["title", listing.title, blueprintValue.listing.title],
    ["category", listing.category, blueprintValue.listing.category],
    ["skill tag", listing.skillTag, blueprintValue.listing.skillTag],
    ["description", listing.description, blueprintValue.listing.description],
    ["status", listing.status, "PUBLISHED"],
    ["base price", listing.basePrice, blueprintValue.listing.basePrice],
    ["currency", listing.currency, blueprintValue.listing.currency],
    ["delivery days", listing.deliveryDays, blueprintValue.listing.deliveryDays],
    ["instant buy", listing.instantBuyable, blueprintValue.listing.instantBuyable],
    ["public search", listing.publicSearch, blueprintValue.listing.publicSearch],
    ["challenge window", listing.challengeWindowHours, blueprintValue.listing.challengeWindowHours],
    ["settlement type", listing.settlementType, blueprintValue.listing.settlementType],
    ["proof method", listing.proofMethod, blueprintValue.listing.proofMethod],
    ["bond amount", listing.bondAmount, blueprintValue.listing.bondAmount],
    ["cover image", listing.coverImageUrl, recorded.coverImageUrl],
    ["created at", listing.createdAt, recorded.createdAt],
    ["agent ID", listing.providerAgent.id, recorded.agentId],
    ["agent token ID", listing.providerAgent.agentTokenId, identity.agentTokenId],
    ["agent handle", listing.providerAgent.name, blueprintValue.handle],
  ] as const;
  for (const [field, actual, expected] of expectedFields) {
    if (actual !== expected) {
      throw new Error(`Agent.family ${field} mismatch for ${blueprintValue.handle}`);
    }
  }
  if (JSON.stringify(listing.tags) !== JSON.stringify(blueprintValue.listing.tags)) {
    throw new Error(`Agent.family listing tags mismatch for ${blueprintValue.handle}`);
  }
  for (const packageId of ["basic", "standard", "premium"] as const) {
    const servicePackage = listing.packages.find((candidate) => candidate.id === packageId);
    if (
      !servicePackage ||
      servicePackage.price !== blueprintValue.listing.basePrice ||
      servicePackage.delivery !== String(blueprintValue.listing.deliveryDays) ||
      servicePackage.scope !== recorded.packageScope
    ) {
      throw new Error(`Agent.family ${packageId} package mismatch for ${blueprintValue.handle}`);
    }
  }

  const online = listing.providerAgent.a2aStatus === "ONLINE";
  return {
    service: blueprintValue.service,
    handle: blueprintValue.handle,
    agentId: listing.providerAgent.id,
    agentTokenId: listing.providerAgent.agentTokenId,
    listingId: listing.id,
    listingStatus: listing.status,
    listingUrl: recorded.listingUrl,
    liveListingVerified: true,
    a2aStatus: listing.providerAgent.a2aStatus,
    presence: listing.providerAgent.presence,
    verified: listing.providerAgent.verified,
    status: online ? "ONLINE_AND_LISTED" as const : "LISTED_OFFLINE" as const,
    identity,
  };
}

export async function getAacpProductionReadiness(options: FetchOptions = {}) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const generatedAt = (options.now ?? new Date()).toISOString();
  const config = await fetchAacpProductionConfig({ fetchImpl });
  const [chain, providers] = await Promise.all([
    probeContracts(config, fetchImpl),
    Promise.all(
      AACP_PROVIDER_BLUEPRINTS.map((item) => {
        const identity = AACP_MAINNET_IDENTITY_EVIDENCE.providers.find(
          (candidate) => candidate.service === item.service,
        );
        if (!identity) throw new Error(`Recorded mainnet identity missing for ${item.service}`);
        return discoverProvider(item, recordedIdentity(config, identity), fetchImpl);
      }),
    ),
  ]);
  const deployedCount = chain.contracts.filter((contract) => contract.deployed).length;
  const listedCount = providers.filter((provider) => provider.listingStatus === "PUBLISHED").length;
  const onlineCount = providers.filter((provider) => provider.status === "ONLINE_AND_LISTED").length;
  const allContractsDeployed = deployedCount === chain.contracts.length;
  const registeredIdentityCount = chain.identities.filter((identity) => identity.onchainVerified).length;
  const discoveryDegraded = providers.some(
    (provider) => provider.status.includes("UNAVAILABLE") || provider.status.includes("DEGRADED"),
  );
  const state = !allContractsDeployed
    ? "PROTOCOL_DEGRADED"
    : discoveryDegraded
      ? "MARKETPLACE_DISCOVERY_DEGRADED"
      : listedCount === providers.length && onlineCount === providers.length
      ? "PROVIDERS_ONLINE"
      : listedCount === providers.length
        ? "LISTINGS_PUBLISHED_RUNTIME_PENDING"
        : registeredIdentityCount === providers.length
          ? "IDENTITIES_MINTED_LISTINGS_PENDING"
          : "ONBOARDING_PENDING";
  return {
    schemaVersion: "positioncrew.aacp-production-readiness.v1" as const,
    generatedAt,
    state,
    source: {
      apiBase: AACP_BSC_API,
      configUrl: `${AACP_BSC_API}/api/v1/config/contracts`,
      rpcUrl: chain.rpcUrl,
      docsUrl: AACP_DOCS_URL,
    },
    network: {
      chainId: config.chainId,
      name: config.networkLabel,
      blockNumber: chain.blockNumber,
      explorerUrl: config.explorerBaseUrl,
    },
    protocol: {
      protocolFeeBps: config.protocolFeeBps,
      currencyCount: config.settlementCurrencies.length,
      deployedCount,
      contractCount: chain.contracts.length,
      contracts: chain.contracts,
      currencies: config.settlementCurrencies.map((currency) => ({
        symbol: currency.symbol,
        decimals: currency.decimals,
        address: currency.address,
        default: currency.default,
        protocolFeeBps: currency.protocolFeeBps,
        providerLockBps: currency.providerLockBps,
        escrow: currency.contracts.escrow,
        staking: currency.contracts.staking,
      })),
    },
    integration: {
      guide: {
        status: "CURRENT_HUMAN_GUIDE_VERIFIED" as const,
        indexUrl: AACP_DOCS_INDEX_URL,
        openApiUrl: AACP_OPENAPI_URL,
        openApiStatus: "SAMPLE_SPEC_NOT_USED" as const,
      },
      runtime: {
        status: "PREISSUED_TOKEN_ADAPTER_IMPLEMENTED" as const,
        ownerSignerOnHost: true,
        autoRenewsToken: true,
        tokenLifetimeHours: TERMIX_RUNTIME_TOKEN_LIFETIME_HOURS,
        expiryBufferSeconds: TERMIX_RUNTIME_EXPIRY_BUFFER_SECONDS,
        pollSeconds: TERMIX_RUNTIME_DEFAULT_POLL_SECONDS,
        automaticConversationKinds: [
          "DIRECT_MESSAGE",
          "QUOTE_NEGOTIATION",
          "PREPAYMENT_ORDER",
        ],
        operatorRequiredConversationKinds: [
          "ORDER_DELIVERY",
          "CHALLENGE",
          "OPERATOR_CASE",
        ],
      },
      orderGuard: {
        status: "STRICT_LOCAL_LIFECYCLE_IMPLEMENTED" as const,
        chainId: 56 as const,
        signerOnGuard: false,
        broadcastsTransactions: false,
        abiDecodedIntentBinding: true,
        minedTransactionBinding: true,
        indexerReconciliationRequired: true,
        guardedActions: AACP_ORDER_GUARD_ACTIONS,
      },
      lifecycle: [
        "WALLET_SESSION",
        "AGENT_PREPARE_MINT_INDEX",
        "LISTING_CREATE_PUBLISH",
        "A2A_RUNTIME",
        "CHECKOUT_APPROVE_CREATE",
        "PENDING_OR_EXPIRED_CANCELLATION",
        "PROVIDER_ACCEPT",
        "ARTIFACT_REGISTER_SUBMIT",
        "BUYER_RELEASE_REDO_DISPUTE_OR_TIMEOUT",
        "INDEXER_RECONCILE",
      ],
    },
    marketplace: {
      requiredProviderCount: AACP_PROVIDER_BLUEPRINTS.length,
      registeredIdentityCount,
      indexedProviderCount: providers.filter((provider) => provider.agentId !== null).length,
      publishedListingCount: listedCount,
      onlineProviderCount: onlineCount,
      discoveryDegraded,
      providers,
    },
    boundaries: [
      "This record validates the production AACP config, independent BSC bytecode, four wallet-owned ERC-8004 identities, and four exact public Agent.family listings on BNB Chain mainnet.",
      onlineCount === AACP_PROVIDER_BLUEPRINTS.length
        ? "All four 5 USDC listings reported an online A2A runtime when this record was generated; presence is live state, not a durable uptime claim. It does not claim stake, token approval, paid order, delivery, settlement, reputation result, external purchase, or revenue."
        : "The four listings are published at 5 USDC each; it does not claim an online A2A runtime, stake, token approval, paid order, delivery, settlement, reputation result, external purchase, or revenue.",
      "Agent.family's default banner remains on the four listings until the prepared PositionCrew media is uploaded through the supported editor flow.",
      "PositionCrew's no-wallet trial and deterministic conformance scorer remain separate from AACP escrow and operator-granted dispute adjudication.",
      "The dedicated Lending Rescue provider uses an isolated root-only owner signer to rotate its scoped 12-hour runtime token; the poller never receives signing material, and the first automatic rotation remains pending verification.",
    ],
  };
}

export function unavailableAacpProductionReadiness(now = new Date()) {
  return {
    schemaVersion: "positioncrew.aacp-production-readiness.v1" as const,
    generatedAt: now.toISOString(),
    state: "SOURCE_UNAVAILABLE" as const,
    source: {
      apiBase: AACP_BSC_API,
      configUrl: `${AACP_BSC_API}/api/v1/config/contracts`,
      rpcUrl: AACP_BSC_RPC,
      docsUrl: AACP_DOCS_URL,
    },
    network: {
      chainId: 56 as const,
      name: "BNB Chain",
      blockNumber: null,
      explorerUrl: "https://bscscan.com",
    },
    protocol: {
      protocolFeeBps: null,
      currencyCount: null,
      deployedCount: 0,
      contractCount: 0,
      contracts: [],
      currencies: [],
    },
    integration: {
      guide: {
        status: "CURRENT_HUMAN_GUIDE_VERIFIED" as const,
        indexUrl: AACP_DOCS_INDEX_URL,
        openApiUrl: AACP_OPENAPI_URL,
        openApiStatus: "SAMPLE_SPEC_NOT_USED" as const,
      },
      runtime: {
        status: "PREISSUED_TOKEN_ADAPTER_IMPLEMENTED" as const,
        ownerSignerOnHost: true,
        autoRenewsToken: true,
        tokenLifetimeHours: TERMIX_RUNTIME_TOKEN_LIFETIME_HOURS,
        expiryBufferSeconds: TERMIX_RUNTIME_EXPIRY_BUFFER_SECONDS,
        pollSeconds: TERMIX_RUNTIME_DEFAULT_POLL_SECONDS,
        automaticConversationKinds: [
          "DIRECT_MESSAGE",
          "QUOTE_NEGOTIATION",
          "PREPAYMENT_ORDER",
        ],
        operatorRequiredConversationKinds: [
          "ORDER_DELIVERY",
          "CHALLENGE",
          "OPERATOR_CASE",
        ],
      },
      orderGuard: {
        status: "STRICT_LOCAL_LIFECYCLE_IMPLEMENTED" as const,
        chainId: 56 as const,
        signerOnGuard: false,
        broadcastsTransactions: false,
        abiDecodedIntentBinding: true,
        minedTransactionBinding: true,
        indexerReconciliationRequired: true,
        guardedActions: AACP_ORDER_GUARD_ACTIONS,
      },
      lifecycle: [
        "WALLET_SESSION",
        "AGENT_PREPARE_MINT_INDEX",
        "LISTING_CREATE_PUBLISH",
        "A2A_RUNTIME",
        "CHECKOUT_APPROVE_CREATE",
        "PENDING_OR_EXPIRED_CANCELLATION",
        "PROVIDER_ACCEPT",
        "ARTIFACT_REGISTER_SUBMIT",
        "BUYER_RELEASE_REDO_DISPUTE_OR_TIMEOUT",
        "INDEXER_RECONCILE",
      ],
    },
    marketplace: {
      requiredProviderCount: AACP_PROVIDER_BLUEPRINTS.length,
      registeredIdentityCount: 0,
      indexedProviderCount: 0,
      publishedListingCount: 0,
      onlineProviderCount: 0,
      discoveryDegraded: true,
      providers: AACP_PROVIDER_BLUEPRINTS.map((provider) => ({
        service: provider.service,
        handle: provider.handle,
        agentId: null,
        agentTokenId: null,
        listingId: null,
        listingStatus: null,
        listingUrl: null,
        liveListingVerified: false,
        a2aStatus: null,
        presence: null,
        verified: false,
        status: "UPSTREAM_UNAVAILABLE" as const,
        identity: null,
      })),
    },
    boundaries: [
      "TermiX production config or BSC RPC could not be validated at this time; no cached deployment claim is substituted.",
      "This record does not claim that a wallet-signed agent mint, paid order, delivery, settlement, reputation result, or external purchase has occurred.",
      "PositionCrew's no-wallet trial and deterministic conformance scorer remain separate from AACP escrow and operator-granted dispute adjudication.",
      "The dedicated Lending Rescue provider uses an isolated root-only owner signer to rotate its scoped 12-hour runtime token; the poller never receives signing material, and the first automatic rotation remains pending verification.",
    ],
  };
}

export type AacpProductionReadiness =
  | Awaited<ReturnType<typeof getAacpProductionReadiness>>
  | ReturnType<typeof unavailableAacpProductionReadiness>;
