import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import {
  createPublicClient,
  defineChain,
  http,
  keccak256,
  parseAbi,
  parseEventLogs,
  stringToHex,
} from "viem";

const baseUrl = new URL(
  process.env.POSITIONCREW_BASE_URL ?? "https://positioncrew.dolepee.com",
);
const outputPath = resolve(
  process.env.POSITIONCREW_HEALTH_OUTPUT ?? "/tmp/positioncrew-production-health.json",
);
const expectedServices = new Set([
  "LENDING_RESCUE",
  "LP_REBALANCE",
  "YIELD_OPTIMIZATION",
  "BOUNDED_GRID",
]);
const checks = [];
const bscTestnetRpc =
  process.env.BSC_TESTNET_RPC_URL ?? "https://data-seed-prebsc-1-s1.bnbchain.org:8545";
const bscTestnet = defineChain({
  id: 97,
  name: "BSC Testnet",
  nativeCurrency: { name: "tBNB", symbol: "tBNB", decimals: 18 },
  rpcUrls: { default: { http: [bscTestnetRpc] } },
});
const identityClient = createPublicClient({ chain: bscTestnet, transport: http() });
const identityAbi = parseAbi([
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function tokenURI(uint256 tokenId) view returns (string)",
]);
const erc8183CommerceAbi = parseAbi([
  "function getJob(uint256 jobId) view returns ((uint256 id,address client,address provider,address evaluator,string description,uint256 budget,uint256 expiredAt,uint8 status,address hook,uint256 submittedAt,bytes32 deliverable))",
  "function paymentToken() view returns (address)",
  "function platformFeeBP() view returns (uint256)",
]);
const erc8183RouterAbi = parseAbi([
  "function policyWhitelist(address policy) view returns (bool)",
  "event JobRegistered(uint256 indexed jobId,address indexed policy,address indexed client)",
]);
const erc8183PolicyAbi = parseAbi([
  "function disputeWindow() view returns (uint256)",
  "function voteQuorum() view returns (uint256)",
]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function localUrl(input) {
  const url = new URL(input, baseUrl);
  assert(url.origin === baseUrl.origin, `Refusing cross-origin discovery URL: ${url}`);
  return url;
}

function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
    .join(",")}}`;
}

async function fetchJson(name, input) {
  const url = localUrl(input);
  const startedAt = performance.now();
  const response = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "PositionCrew-Production-Monitor/1.0" },
    signal: AbortSignal.timeout(15_000),
  });
  const latencyMs = Math.max(1, Math.round(performance.now() - startedAt));
  const body = await response.json().catch(() => null);
  checks.push({ name, url: url.toString(), status: response.status, latencyMs });
  assert(response.ok, `${name} returned HTTP ${response.status}`);
  assert(body && typeof body === "object", `${name} did not return a JSON object`);
  return body;
}

function decodeAgentUri(agentUri) {
  const separator = agentUri.indexOf(",");
  assert(separator > 0, "ERC-8004 agent URI is not a data URI");
  const metadata = agentUri.slice(0, separator);
  const payload = agentUri.slice(separator + 1);
  const json = metadata.endsWith(";base64")
    ? Buffer.from(payload, "base64").toString("utf8")
    : decodeURIComponent(payload);
  return JSON.parse(json);
}

async function verifyIdentity(entry) {
  const identity = entry.identity;
  assert(identity?.protocol === "ERC-8004", `${entry.service} has no ERC-8004 identity`);
  assert(identity.chainId === 97, `${entry.service} identity is not on BSC testnet`);
  const startedAt = performance.now();
  const contract = { address: identity.registry, abi: identityAbi };
  const [owner, agentUri, receipt] = await Promise.all([
    identityClient.readContract({ ...contract, functionName: "ownerOf", args: [BigInt(identity.agentId)] }),
    identityClient.readContract({ ...contract, functionName: "tokenURI", args: [BigInt(identity.agentId)] }),
    identityClient.getTransactionReceipt({ hash: identity.registrationTransaction }),
  ]);
  const latencyMs = Math.max(1, Math.round(performance.now() - startedAt));
  checks.push({
    name: `${entry.service}:erc8004-identity`,
    url: bscTestnetRpc,
    status: 200,
    latencyMs,
  });
  assert(owner.toLowerCase() === identity.owner.toLowerCase(), `${entry.service} identity owner mismatch`);
  assert(receipt.status === "success", `${entry.service} registration transaction failed`);
  const registration = decodeAgentUri(agentUri);
  assert(registration.name?.startsWith("PositionCrew "), `${entry.service} identity name mismatch`);
  const discoveredManifest = new URL(entry.manifestUrl);
  assert(
    registration.services?.some((service) => {
      const registeredEndpoint = new URL(service.endpoint);
      return (
        registeredEndpoint.protocol === "https:" &&
        registeredEndpoint.hostname === "positioncrew.dolepee.com" &&
        registeredEndpoint.pathname === discoveredManifest.pathname
      );
    }),
    `${entry.service} identity does not bind its manifest`,
  );
  return { agentId: identity.agentId, owner, registrationTransaction: identity.registrationTransaction };
}

const report = {
  schemaVersion: "positioncrew.production-health-report.v1",
  checkedAt: new Date().toISOString(),
  baseUrl: baseUrl.origin,
  status: "FAILED",
  checks,
  providers: [],
  error: null,
};

try {
  const marketplace = await fetchJson(
    "marketplace-manifest",
    "/.well-known/positioncrew.json",
  );
  assert(
    marketplace.schemaVersion === "positioncrew.marketplace-manifest.v1",
    "Unexpected marketplace manifest schema",
  );
  assert(Array.isArray(marketplace.providers), "Marketplace providers are missing");
  assert(marketplace.providers.length === 4, "Marketplace must expose exactly four providers");
  assert(
    marketplace.claims?.settlement === "IN_MEMORY_CONFORMANCE",
    "Marketplace settlement boundary changed unexpectedly",
  );
  assert(
    marketplace.claims?.providerIdentity === "ERC8004_BSC_TESTNET_VERIFIED",
    "Marketplace identity claim changed unexpectedly",
  );

  const openApi = await fetchJson("openapi", marketplace.openApiUrl);
  assert(openApi.openapi === "3.1.0", "OpenAPI version is not 3.1.0");
  assert(Object.keys(openApi.paths ?? {}).length === 4, "OpenAPI does not expose four job paths");

  for (const entry of marketplace.providers) {
    assert(expectedServices.has(entry.service), `Unexpected provider service: ${entry.service}`);
    const identity = await verifyIdentity(entry);
    const manifest = await fetchJson(`${entry.service}:manifest`, entry.manifestUrl);
    assert(manifest.provider?.service === entry.service, `${entry.service} manifest mismatch`);
    assert(manifest.identity?.agentId === identity.agentId, `${entry.service} manifest identity mismatch`);
    assert(manifest.provider?.relationship === "FIRST_PARTY", `${entry.service} ownership is unclear`);
    assert(
      manifest.commerce?.settlement === "IN_MEMORY_CONFORMANCE",
      `${entry.service} settlement boundary changed unexpectedly`,
    );

    const health = await fetchJson(`${entry.service}:health`, manifest.transport?.health?.url);
    assert(health.status === "OPERATIONAL", `${entry.service} is ${health.status}`);
    assert(health.conformance?.score === 100, `${entry.service} conformance is not 100/100`);

    const requestSchema = await fetchJson(
      `${entry.service}:request-schema`,
      manifest.transport?.schemas?.request,
    );
    const deliverableSchema = await fetchJson(
      `${entry.service}:deliverable-schema`,
      manifest.transport?.schemas?.deliverable,
    );
    assert(requestSchema.type === "object", `${entry.service} request schema is invalid`);
    assert(deliverableSchema.type === "object", `${entry.service} deliverable schema is invalid`);

    const job = await fetchJson(`${entry.service}:job`, manifest.transport?.job?.url);
    assert(job.result?.request?.service === entry.service, `${entry.service} job routed incorrectly`);
    assert(job.result?.job?.state === "COMPLETED", `${entry.service} job did not complete`);
    assert(job.result?.evaluation?.score === 100, `${entry.service} job score is not 100/100`);

    report.providers.push({
      providerId: manifest.provider.providerId,
      service: entry.service,
      health: health.status,
      conformanceScore: health.conformance.score,
      jobState: job.result.job.state,
      evaluationHash: job.result.evaluation.evaluationHash,
      identity,
    });
  }

  assert(
    new Set(report.providers.map((provider) => provider.service)).size === 4,
    "Provider services are duplicated",
  );

  const commerceLedger = await fetchJson("erc8183-ledger", "/api/commerce/erc8183");
  assert(
    commerceLedger.schemaVersion === "positioncrew.erc8183-testnet-ledger.v1",
    "Unexpected ERC-8183 ledger schema",
  );
  assert(commerceLedger.summary.completedLifecycles === 7, "ERC-8183 lifecycle count changed");
  assert(commerceLedger.summary.fundedCompletedJobs === 6, "ERC-8183 funded count changed");
  assert(commerceLedger.summary.externalBuyerJobs === 0, "ERC-8183 operator boundary changed");
  assert(commerceLedger.jobs.length === 7, "ERC-8183 ledger must contain seven jobs");
  assert(
    new Set(
      commerceLedger.jobs
        .filter((job) => job.runType === "FUNDED_CATEGORY_RECEIPT")
        .map((job) => job.service),
    ).size === 4,
    "ERC-8183 flagship receipts do not cover all four services",
  );

  const commerceAddress = commerceLedger.protocol.commerce;
  const routerAddress = commerceLedger.protocol.router;
  const policyAddress = commerceLedger.protocol.policy;
  const [paymentToken, platformFeeBps, policyWhitelisted, disputeWindow, voteQuorum] =
    await Promise.all([
      identityClient.readContract({ address: commerceAddress, abi: erc8183CommerceAbi, functionName: "paymentToken" }),
      identityClient.readContract({ address: commerceAddress, abi: erc8183CommerceAbi, functionName: "platformFeeBP" }),
      identityClient.readContract({ address: routerAddress, abi: erc8183RouterAbi, functionName: "policyWhitelist", args: [policyAddress] }),
      identityClient.readContract({ address: policyAddress, abi: erc8183PolicyAbi, functionName: "disputeWindow" }),
      identityClient.readContract({ address: policyAddress, abi: erc8183PolicyAbi, functionName: "voteQuorum" }),
    ]);
  assert(paymentToken.toLowerCase() === commerceLedger.protocol.paymentToken.toLowerCase(), "ERC-8183 payment token mismatch");
  assert(platformFeeBps === 0n, "ERC-8183 platform fee changed");
  assert(policyWhitelisted, "ERC-8183 policy is no longer whitelisted");
  assert(disputeWindow === 900n, "ERC-8183 dispute window changed");
  assert(voteQuorum === 1n, "ERC-8183 vote quorum changed");

  report.commerce = [];
  for (const ledgerJob of commerceLedger.jobs) {
    const startedAt = performance.now();
    const [onchainJob, registerReceipt, settleReceipt, manifest] = await Promise.all([
      identityClient.readContract({
        address: commerceAddress,
        abi: erc8183CommerceAbi,
        functionName: "getJob",
        args: [BigInt(ledgerJob.jobId)],
      }),
      identityClient.getTransactionReceipt({ hash: ledgerJob.transactions.register }),
      identityClient.getTransactionReceipt({ hash: ledgerJob.transactions.settle }),
      fetchJson(`erc8183-job-${ledgerJob.jobId}-manifest`, ledgerJob.manifestUrl),
    ]);
    // APEX clears jobPolicy after settlement, so policy provenance lives in JobRegistered.
    const registrationEvents = parseEventLogs({
      abi: erc8183RouterAbi,
      eventName: "JobRegistered",
      logs: registerReceipt.logs,
    });
    assert(registerReceipt.status === "success", `ERC-8183 job ${ledgerJob.jobId} registration failed`);
    assert(registrationEvents.length === 1, `ERC-8183 job ${ledgerJob.jobId} registration event missing`);
    const registration = registrationEvents[0].args;
    checks.push({
      name: `erc8183-job-${ledgerJob.jobId}-chain`,
      url: bscTestnetRpc,
      status: 200,
      latencyMs: Math.max(1, Math.round(performance.now() - startedAt)),
    });
    assert(onchainJob.status === 3, `ERC-8183 job ${ledgerJob.jobId} is not completed`);
    assert(
      onchainJob.client.toLowerCase() === commerceLedger.parties.client.toLowerCase(),
      `ERC-8183 job ${ledgerJob.jobId} client mismatch`,
    );
    assert(
      onchainJob.provider.toLowerCase() === commerceLedger.parties.provider.toLowerCase(),
      `ERC-8183 job ${ledgerJob.jobId} provider mismatch`,
    );
    assert(
      onchainJob.budget === BigInt(ledgerJob.budgetBaseUnits),
      `ERC-8183 job ${ledgerJob.jobId} budget mismatch`,
    );
    assert(
      onchainJob.deliverable.toLowerCase() === ledgerJob.manifestHash.toLowerCase(),
      `ERC-8183 job ${ledgerJob.jobId} onchain manifest mismatch`,
    );
    assert(
      registration.jobId === BigInt(ledgerJob.jobId),
      `ERC-8183 job ${ledgerJob.jobId} registration ID mismatch`,
    );
    assert(
      registration.policy.toLowerCase() === policyAddress.toLowerCase(),
      `ERC-8183 job ${ledgerJob.jobId} registered policy mismatch`,
    );
    assert(
      registration.client.toLowerCase() === commerceLedger.parties.client.toLowerCase(),
      `ERC-8183 job ${ledgerJob.jobId} registered client mismatch`,
    );
    assert(settleReceipt.status === "success", `ERC-8183 job ${ledgerJob.jobId} settlement failed`);
    assert(
      keccak256(stringToHex(canonicalJson(manifest))).toLowerCase() === ledgerJob.manifestHash.toLowerCase(),
      `ERC-8183 job ${ledgerJob.jobId} public manifest hash mismatch`,
    );
    report.commerce.push({
      jobId: ledgerJob.jobId,
      service: ledgerJob.service,
      status: "COMPLETED",
      budgetBaseUnits: ledgerJob.budgetBaseUnits,
      manifestHash: ledgerJob.manifestHash,
      registrationTransaction: ledgerJob.transactions.register,
      settlementTransaction: ledgerJob.transactions.settle,
    });
  }
  report.status = "OPERATIONAL";
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
} finally {
  report.completedAt = new Date().toISOString();
  report.checkCount = checks.length;
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(report, null, 2));
  console.log(`Production health report: ${outputPath}`);
}
