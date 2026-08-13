import { AddressSchema } from "../contracts/common.js";
import {
  buildAacpOnboardingManifest,
  inspectAacpOnboardingWallet,
} from "../commerce/aacp-onboarding.js";
import { getAacpProductionReadiness } from "../commerce/aacp-production.js";

function walletArgument(): string {
  const index = process.argv.indexOf("--wallet");
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value) throw new Error("Usage: npm run preflight:termix -- --wallet 0x...");
  return AddressSchema.parse(value);
}

const ownerWallet = walletArgument();
const [readiness, wallet] = await Promise.all([
  getAacpProductionReadiness(),
  inspectAacpOnboardingWallet(ownerWallet),
]);
const manifest = buildAacpOnboardingManifest(ownerWallet);
const allIdentitiesRegistered =
  readiness.marketplace.registeredIdentityCount ===
  readiness.marketplace.requiredProviderCount;
const flagshipCurrency = wallet.currencies.find((currency) => currency.symbol === "USDT");

process.stdout.write(`${JSON.stringify({
  schemaVersion: "positioncrew.aacp-onboarding-preflight.v1",
  generatedAt: new Date().toISOString(),
  state: !wallet.nativeGas.present
    ? "GAS_REQUIRED"
    : !allIdentitiesRegistered
      ? "AUTHENTICATED_OWNERSHIP_REVIEW_REQUIRED"
      : flagshipCurrency?.canFundOneFlagshipOrder
        ? "IDENTITIES_MINTED_READY_FOR_LISTINGS_AND_ONE_ORDER"
        : "IDENTITIES_MINTED_LISTINGS_PENDING_ORDER_FUNDS_REQUIRED",
  manifest,
  protocol: {
    state: readiness.state,
    chainId: readiness.network.chainId,
    deployedContracts: `${readiness.protocol.deployedCount}/${readiness.protocol.contractCount}`,
  },
  handles: readiness.marketplace.providers.map((provider) => ({
    service: provider.service,
    handle: provider.handle,
    agentTokenId: provider.agentTokenId,
    status: provider.status,
    owner: provider.identity?.owner ?? null,
    registrationTransaction: provider.identity?.registrationTransaction ?? null,
  })),
  wallet,
  boundaries: [
    "This read-only invocation performed no wallet session, metadata upload, signature, transaction, listing write, or payment.",
    "Four prior mint receipts are checked against the live ERC-8004 registry; listings, runtimes, staking, approvals, and paid orders remain separate actions.",
  ],
}, null, 2)}\n`);
