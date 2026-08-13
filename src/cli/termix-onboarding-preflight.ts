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
const handlesAvailable = readiness.marketplace.providers.every(
  (provider) => provider.status === "HANDLE_AVAILABLE",
);
const flagshipCurrency = wallet.currencies.find((currency) => currency.symbol === "USDT");

process.stdout.write(`${JSON.stringify({
  schemaVersion: "positioncrew.aacp-onboarding-preflight.v1",
  generatedAt: new Date().toISOString(),
  state: !wallet.nativeGas.present
    ? "GAS_REQUIRED"
    : !handlesAvailable
      ? "AUTHENTICATED_OWNERSHIP_REVIEW_REQUIRED"
      : flagshipCurrency?.canFundOneFlagshipOrder
        ? "READY_FOR_ONBOARDING_AND_ONE_ORDER"
        : "READY_FOR_ONBOARDING_ORDER_FUNDS_REQUIRED",
  manifest,
  protocol: {
    state: readiness.state,
    chainId: readiness.network.chainId,
    deployedContracts: `${readiness.protocol.deployedCount}/${readiness.protocol.contractCount}`,
  },
  handles: readiness.marketplace.providers.map((provider) => ({
    service: provider.service,
    handle: provider.handle,
    status: provider.status,
  })),
  wallet,
  boundaries: [
    "No wallet session, metadata upload, signature, transaction, listing write, or payment was performed.",
    "If a handle is already indexed, authenticated owner inspection is required before any replacement is prepared.",
  ],
}, null, 2)}\n`);
