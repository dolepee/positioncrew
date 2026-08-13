import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

const lendingFixture = JSON.parse(
  readFileSync(
    new URL("../fixtures/lending-rescue/stressed-venus-position.v1.json", import.meta.url),
    "utf8",
  ),
) as Record<string, unknown>;

const lpFixture = JSON.parse(
  readFileSync(
    new URL("../fixtures/lp-rebalance/out-of-range-v3-position.v1.json", import.meta.url),
    "utf8",
  ),
) as Record<string, unknown>;

function liveLendingRequest(now: Date, account: string, blockNumber: string) {
  const observedAt = new Date(now.getTime() - 5_000).toISOString();
  const sourceId = `venus-mainnet-block-${blockNumber}`;
  const rebase = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(rebase);
    if (typeof value !== "object" || value === null) return value;
    return Object.fromEntries(Object.entries(value).map(([key, child]) => {
      if (key === "observedAt") return [key, observedAt];
      if (key === "sourceId") return [key, sourceId];
      return [key, rebase(child)];
    }));
  };
  const request = rebase(structuredClone(lendingFixture)) as Record<string, unknown>;
  request.requestId = `venus-live-e2e-${now.getTime()}`;
  request.account = account;
  request.requestedAt = now.toISOString();
  request.deadline = new Date(now.getTime() + 5 * 60_000).toISOString();
  request.sources = [{
    sourceId,
    label: `Venus Classic account and oracle snapshot at BSC block ${blockNumber}`,
    uri: `https://bscscan.com/block/${blockNumber}`,
    observedAt,
  }];
  return request;
}

function liveLpRequest(now: Date, tokenId: string, blockNumber: string) {
  const observedAt = new Date(now.getTime() - 5_000).toISOString();
  const sourceId = `pancake-position-mainnet-block-${blockNumber}`;
  const rebase = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(rebase);
    if (typeof value !== "object" || value === null) return value;
    return Object.fromEntries(Object.entries(value).map(([key, child]) => {
      if (key === "observedAt") return [key, observedAt];
      if (key === "sourceId") return [key, sourceId];
      return [key, rebase(child)];
    }));
  };
  const request = rebase(structuredClone(lpFixture)) as Record<string, unknown>;
  request.requestId = `pancake-position-live-e2e-${now.getTime()}`;
  request.protocol = "PancakeSwap V3 position analysis";
  request.requestedAt = now.toISOString();
  request.deadline = new Date(now.getTime() + 5 * 60_000).toISOString();
  request.sources = [{
    sourceId,
    label: `PancakeSwap V3 position at BSC block ${blockNumber}`,
    uri: `https://bscscan.com/block/${blockNumber}`,
    observedAt,
  }];
  return request;
}

test("a cold buyer can discover, hire, and inspect the lending provider", async ({ page }) => {
  await page.goto("/#marketplace");
  await expect(page.getByRole("heading", { name: "Hire a capital operator." })).toBeVisible();
  await expect(page.getByText("4/4", { exact: true }).last()).toBeVisible();
  await expect(page.getByRole("button", { name: /Lending Rescue v1/ })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("button", { name: "Try lending rescue free" })).toBeVisible();

  await page.getByRole("button", { name: "Open free lending rescue trial" }).click();
  await expect(page.getByRole("heading", { name: "Define the job. Inspect the action." })).toBeVisible();
  await expect(page.getByText("Free provider trial", { exact: true })).toBeVisible();
  await expect(page.getByText("5 TEST_USDC listed price · no wallet required", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Interactive" })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Run lending rescue" }).click();

  await expect(page.getByRole("heading", { name: "Repay 152 USDT" })).toBeVisible();
  await expect(page.getByText(/inputs were not fetched live/)).toBeVisible();
  await expect(page.getByText("100/100", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "JSON" }).click();
  await expect(page.getByText("application/json", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Receipt", exact: true }).click();
  await expect(page.getByText("Evaluation", { exact: true })).toBeVisible();
  await expect(page.getByText("SESSION EMBEDDED", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Locked receipt" }).click();
  await expect(page.getByText(/Historical August 12 fixture/)).toBeVisible();
  await page.getByRole("button", { name: "Run lending rescue" }).click();
  await expect(page.getByText(/Locked historical fixture/)).toBeVisible();
  await page.getByRole("button", { name: "Receipt", exact: true }).click();
  const receiptLink = page.getByRole("link", { name: "Public receipt" });
  await expect(receiptLink).toBeVisible();
  const receiptPath = await receiptLink.getAttribute("href");
  expect(receiptPath).toMatch(/^\/api\/receipts\/sha256:[a-f0-9]{64}$/);
  const receipt = await page.request.get(receiptPath!);
  expect(receipt.status()).toBe(200);
  expect((await receipt.json()).schemaVersion).toBe("positioncrew.public-receipt.v1");
});

test("live BSC telemetry and Venus wallet risk are independently inspectable", async ({ page }) => {
  await page.goto("/#marketplace");
  await expect(page.getByText("LIVE BSC DATA", { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(".market-system-panel").getByText("4/4", { exact: true })).toBeVisible();

  await page.goto("/#jobs");
  await page.getByPlaceholder("0x account address").fill("0x0000000000000000000000000000000000000001");
  await page.getByRole("button", { name: "Inspect" }).click();
  await expect(page.getByText("NO POSITION", { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("link", { name: /Block [0-9,]+/ })).toHaveAttribute("href", /bscscan\.com\/block/);
});

test("a block-pinned Venus position can become the provider request", async ({ page }) => {
  const account = "0x1111111111111111111111111111111111111111";
  const blockNumber = "115607036";
  const now = new Date();
  const rescueRequest = liveLendingRequest(now, account, blockNumber);
  await page.route("**/api/wallets/*/venus", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        schemaVersion: "positioncrew.venus-account-probe.v1",
        generatedAt: now.toISOString(),
        chainId: 56,
        account,
        state: "LIQUID",
        nativeBalanceBnb: "0.25",
        usdtBalance: "200",
        liquidityUsd: "40",
        shortfallUsd: "0",
        enteredMarkets: [
          "0xA07c5b74C9B40447a954e1466938b865b6BBea36",
          "0xfD5840Cd36d94D7229439859C0112a4185BC0255",
        ],
        position: {
          collateralValueUsd: "1200",
          liquidationWeightedCollateralUsd: "960",
          debtValueUsd: "920",
          healthFactor: "1.04347826",
          markets: [{
            vToken: "0xA07c5b74C9B40447a954e1466938b865b6BBea36",
            symbol: "WBNB",
            underlying: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c",
            decimals: 18,
            suppliedAmount: "2",
            borrowedAmount: "0",
            walletAmount: "0.5",
            priceUsd: "600",
            collateralFactorBps: 8000,
            liquidationThresholdBps: 8000,
            collateralEnabled: true,
          }],
        },
        rescueRequest,
        source: {
          comptroller: "0xfD36E2c2a6789Db23113685031d7F16329158384",
          blockNumber,
          explorerUrl: `https://bscscan.com/block/${blockNumber}`,
        },
        boundary: "Block-pinned Venus Classic reconstruction.",
      }),
    });
  });

  await page.goto("/#jobs");
  await page.getByPlaceholder("0x account address").fill(account);
  await page.getByRole("button", { name: "Inspect" }).click();
  await expect(page.getByText("1.04347826", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Use live position" }).click();
  await expect(page.getByText(`Block-pinned Venus position from BSC block ${blockNumber}`, { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Run lending rescue" }).click();
  await expect(page.getByRole("heading", { name: "Repay 152 USDT" })).toBeVisible();
  await expect(page.getByText(/Block-pinned Venus input/)).toBeVisible();
});

test("a block-pinned Pancake market can become a bounded grid request", async ({ page }) => {
  await page.goto("/#jobs");
  await page.getByRole("combobox", { name: "Provider" }).selectOption("BOUNDED_GRID");
  await expect(page.getByText("READY", { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("PancakeSwap market probe", { exact: true })).toBeVisible();
  await expect(page.getByText(/Block-pinned PancakeSwap market from BSC block/)).toBeVisible();
  await page.getByRole("button", { name: "Run bounded grid" }).click();
  await expect(page.getByRole("heading", { name: /Build [45] bounded orders/ })).toBeVisible();
  await expect(page.getByText(/Block-pinned PancakeSwap input/)).toBeVisible();

  const response = await page.request.get("/api/markets/pancake/wbnb-usdt/grid");
  expect(response.status()).toBe(200);
  const probe = await response.json();
  expect(probe).toMatchObject({
    schemaVersion: "positioncrew.pancake-grid-probe.v1",
    chainId: 56,
    state: "READY",
    market: { pair: "WBNB/USDT", feeTier: 100 },
    gridRequest: { service: "BOUNDED_GRID", chainId: 56 },
  });
  expect(probe.market.realizedVolatilityBps).toBeGreaterThanOrEqual(0);
  expect(probe.market.volatilitySampleCount).toBeGreaterThanOrEqual(3);
  expect(probe.source.explorerUrl).toMatch(/^https:\/\/bscscan\.com\/block\//);
});

test("a block-pinned Pancake position can become an LP rebalance request", async ({ page }) => {
  const tokenId = "1456267";
  const blockNumber = "115618500";
  const now = new Date();
  const lpRequest = liveLpRequest(now, tokenId, blockNumber);
  await page.route(`**/api/positions/pancake/${tokenId}`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        schemaVersion: "positioncrew.pancake-position-probe.v1",
        generatedAt: now.toISOString(),
        chainId: 56,
        state: "READY",
        position: {
          tokenId,
          owner: "0x556B9306565093C855AEA9AE92A594704c2Cd59e",
          custody: "MASTER_CHEF_V3",
          positionManager: "0x46A15B0b27311cedF172AB29E4f4766fbE7F4364",
          pool: "0x36696169C63e42cd08ce11f5deeBbCeBae652050",
          pair: "USDT/WBNB",
          feeTier: 500,
          lowerTick: -120,
          upperTick: 120,
          currentTick: 150,
          inRange: false,
          liquidity: "1000000",
          token0Amount: "10000",
          token1Amount: "0",
          positionValueUsd: "10000",
          uncollectedFeesUsd: "42",
        },
        market: {
          activeLiquidityUsd: "1000000",
          realizedVolatilityBps: 400,
          volumeRunRate24hUsd: "5000000",
          feesRunRate24hUsd: "2000",
          measurementWindowSeconds: 3600,
          swapCount: 240,
        },
        lpRequest,
        source: {
          blockNumber,
          blockTimestamp: now.toISOString(),
          explorerUrl: `https://bscscan.com/block/${blockNumber}`,
          positionExplorerUrl: `https://bscscan.com/nft/0x46A15B0b27311cedF172AB29E4f4766fbE7F4364/${tokenId}`,
          poolExplorerUrl: "https://bscscan.com/address/0x36696169C63e42cd08ce11f5deeBbCeBae652050",
        },
        boundary: "Read-only block-pinned position reconstruction with an exact swap window.",
      }),
    });
  });

  await page.goto("/#jobs");
  await page.getByRole("combobox", { name: "Provider" }).selectOption("LP_REBALANCE");
  await expect(page.getByRole("heading", { name: "PancakeSwap LP position" })).toBeVisible();
  await expect(page.getByLabel("PancakeSwap position NFT ID")).toHaveValue(tokenId);
  await page.getByRole("button", { name: "Inspect" }).click();
  await expect(page.getByText("OUT OF RANGE", { exact: true })).toBeVisible();
  await expect(page.getByText("$10,000", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Use live position" }).click();
  await expect(page.getByText(`Block-pinned PancakeSwap position from BSC block ${blockNumber}`, { exact: false })).toBeVisible();
  await expect(page.getByLabel("Current tick")).toBeDisabled();
  await page.getByRole("button", { name: "Run lp rebalance" }).click();
  await expect(page.getByRole("heading", { name: "SHIFT range to 0...240" })).toBeVisible();
  await expect(page.locator(".result-boundary")).toContainText("Block-pinned PancakeSwap position");
});

test("block-pinned Venus stablecoin rates can become a yield request", async ({ page }) => {
  await page.goto("/#jobs");
  await page.getByRole("combobox", { name: "Provider" }).selectOption("YIELD_OPTIMIZATION");
  await expect(page.getByText("READY", { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("Venus stablecoin probe", { exact: true })).toBeVisible();
  await expect(page.getByText(/Block-pinned Venus yield market from BSC block/)).toBeVisible();
  await expect(page.getByLabel("Leading base APY (bps)")).toBeDisabled();
  await page.getByRole("button", { name: "Run yield optimisation" }).click();
  await expect(page.getByRole("heading", { name: /SUPPLY to venus-core-/ })).toBeVisible();
  await expect(page.getByText(/Block-pinned Venus yield input/)).toBeVisible();

  const response = await page.request.get("/api/markets/venus/stable-yields");
  expect(response.status()).toBe(200);
  const probe = await response.json();
  expect(probe).toMatchObject({
    schemaVersion: "positioncrew.venus-yield-probe.v1",
    chainId: 56,
    state: "READY",
    yieldRequest: { service: "YIELD_OPTIMIZATION", chainId: 56 },
  });
  expect(probe.markets).toHaveLength(4);
  expect(probe.markets.every((market: { availableLiquidityUsd: string }) =>
    Number(market.availableLiquidityUsd) > 0)).toBe(true);
  expect(probe.source.measuredSecondsPerBlock).toBeGreaterThan(0);
  expect(probe.source.explorerUrl).toMatch(/^https:\/\/bscscan\.com\/block\//);
});

test("all four mandatory capital jobs return category-specific results", async ({ page }) => {
  await page.goto("/#jobs");
  const provider = page.getByRole("combobox", { name: "Provider" });
  await expect(provider).toBeVisible();
  const cases = [
    { value: "LP_REBALANCE", button: "Run lp rebalance", output: "SHIFT range to 0...240" },
    { value: "YIELD_OPTIMIZATION", button: "Run yield optimisation", output: /SUPPLY to venus-core-/ },
    { value: "BOUNDED_GRID", button: "Run bounded grid", output: "Build 4 bounded orders" },
  ];
  for (const candidate of cases) {
    await provider.selectOption(candidate.value);
    if (candidate.value === "BOUNDED_GRID" || candidate.value === "YIELD_OPTIMIZATION") {
      await expect(page.getByText("READY", { exact: true })).toBeVisible({ timeout: 20_000 });
    }
    await page.getByRole("button", { name: candidate.button }).click();
    await expect(page.getByRole("heading", {
      name: candidate.value === "BOUNDED_GRID" ? /Build [45] bounded orders/ : candidate.output,
    })).toBeVisible();
  }
  await expect(page.getByText("3 jobs", { exact: true })).toBeVisible();
});

test("an undersized action cap fails closed", async ({ page }) => {
  await page.goto("/#jobs");
  await expect(page.getByRole("combobox", { name: "Provider" })).toBeVisible();
  const actionCap = page.getByLabel("Maximum action (USD)");
  await expect(actionCap).toBeEnabled();
  await actionCap.fill("100");
  await page.getByRole("button", { name: "Run lending rescue" }).click();
  await expect(page.getByText("REFUSED CONSTRAINTS", { exact: true })).toBeVisible();
  await expect(page.getByText("No allowed rescue action fits the wallet inventory and safety limits.", { exact: true })).toBeVisible();
});

test("every non-lending provider accepts custom bounds and fails closed", async ({ page }) => {
  await page.goto("/#jobs");
  const provider = page.getByRole("combobox", { name: "Provider" });
  const cases = [
    {
      service: "LP_REBALANCE",
      field: "Minimum net benefit (USD)",
      value: "1000",
      button: "Run lp rebalance",
      decision: "HOLD",
    },
    {
      service: "YIELD_OPTIMIZATION",
      field: "Minimum net benefit (USD)",
      value: "1000",
      button: "Run yield optimisation",
      decision: "HOLD",
    },
    {
      service: "BOUNDED_GRID",
      field: "Maximum loss (USD)",
      value: "1",
      button: "Run bounded grid",
      decision: "NO GRID",
    },
  ];

  for (const candidate of cases) {
    await provider.selectOption(candidate.service);
    if (candidate.service === "BOUNDED_GRID" || candidate.service === "YIELD_OPTIMIZATION") {
      await expect(page.getByText("READY", { exact: true })).toBeVisible({ timeout: 20_000 });
    }
    await page.getByLabel(candidate.field).fill(candidate.value);
    await expect(page.getByText(
      candidate.service === "BOUNDED_GRID"
        ? /Block-pinned PancakeSwap market/
        : candidate.service === "YIELD_OPTIMIZATION"
          ? /Block-pinned Venus yield market/
        : /Current-clock scenario with custom bounds/,
    )).toBeVisible();
    await page.getByRole("button", { name: candidate.button }).click();
    await expect(page.getByRole("heading", { name: candidate.decision })).toBeVisible();
    await page.getByTitle("Reset interactive bounds").click();
    await expect(page.getByText(
      candidate.service === "BOUNDED_GRID"
        ? /Block-pinned PancakeSwap market/
        : candidate.service === "YIELD_OPTIMIZATION"
          ? /Block-pinned Venus yield market/
        : /Current-clock simulation seeded from the August 12 fixture/,
    )).toBeVisible();
  }
});

test("the evidence page separates conformance from advantage claims", async ({ page, request }) => {
  const publicationResponse = await request.get("/evidence/agent-advantage-status.json");
  expect(publicationResponse.ok()).toBe(true);
  expect(await publicationResponse.json()).toMatchObject({
    schemaVersion: "positioncrew.agent-advantage-publication.v1",
    status: "PENDING_INDEPENDENT_BLIND_EVALUATION",
    taskCount: 3,
    supportedAdvantageCount: null,
  });
  await page.goto("/#evidence");
  await expect(page.getByRole("heading", { name: "Evidence register" })).toBeVisible();
  await expect(page.getByText("4/4", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("3/3", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("6", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("DELIVERED", { exact: true })).toHaveCount(3);
  await expect(page.getByText("source-committed agent runs", { exact: true })).toBeVisible();
  await expect(page.getByText(/source 3b28703/).first()).toBeVisible();
  await expect(page.getByText("No advantage result is claimed.", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Funded provider receipts" })).toBeVisible();
  await expect(page.getByText("0.6 U", { exact: true })).toBeVisible();
  await expect(page.getByText("Verified integration, disclosed operator.", { exact: true })).toBeVisible();
  await expect(page.getByText(/not external purchases, revenue, or the pending blind Agent Advantage result/)).toBeVisible();
  const aacpSection = page.getByRole("region", { name: "AACP deployment and provider onboarding" });
  await expect(aacpSection).toBeVisible();
  await expect(aacpSection.getByText("10/10", { exact: true })).toBeVisible();
  await expect(aacpSection.getByText("USDC + USDT", { exact: true })).toBeVisible();
  await expect(aacpSection.getByText(/does not claim that a wallet-signed agent mint, paid order/)).toBeVisible();

  const aacpResponse = await page.request.get("/api/commerce/aacp");
  expect(aacpResponse.status()).toBe(200);
  const aacp = await aacpResponse.json();
  expect(aacp).toMatchObject({
    schemaVersion: "positioncrew.aacp-production-readiness.v1",
    state: "ONBOARDING_PENDING",
    network: { chainId: 56 },
    protocol: { deployedCount: 10, contractCount: 10, currencyCount: 2 },
    marketplace: { requiredProviderCount: 4 },
  });
  expect(aacp.marketplace.providers).toHaveLength(4);

  const commerceResponse = await page.request.get("/api/commerce/erc8183");
  expect(commerceResponse.status()).toBe(200);
  const commerce = await commerceResponse.json();
  expect(commerce.schemaVersion).toBe("positioncrew.erc8183-testnet-ledger.v1");
  expect(commerce.summary).toMatchObject({
    completedLifecycles: 7,
    fundedCompletedJobs: 6,
    mandatoryCategoriesCovered: 4,
    totalEscrowDisplay: "0.6 U",
    externalBuyerJobs: 0,
    externalRevenue: "0",
  });
  expect(commerce.jobs.filter((job: { runType: string }) => job.runType === "FUNDED_CATEGORY_RECEIPT")).toHaveLength(4);

  const benchmarkResponse = await page.request.get("/api/benchmarks/repeatability");
  expect(benchmarkResponse.status()).toBe(200);
  const benchmark = await benchmarkResponse.json();
  expect(benchmark.schemaVersion).toBe("positioncrew.benchmark-repeatability-matrix.v1");
  expect(benchmark.records).toHaveLength(3);
  expect(benchmark.records.every((record: { runs: unknown[] }) => record.runs.length === 2)).toBe(true);

  const captureResponse = await page.request.get("/api/benchmarks/captures");
  expect(captureResponse.status()).toBe(200);
  const captures = await captureResponse.json();
  expect(captures.manifestHash).toBe("sha256:2ea15ab328fba502d17e55a27a574cfc31b1d2f4bd04a3c23f8f79d003c9e9a1");
  expect(captures.benchmarks.flatMap((item: { candidates: unknown[] }) => item.candidates)).toHaveLength(6);
});

test("the evidence page exposes the precommitted public marketplace deliveries", async ({ page, request }) => {
  const response = await request.get("/api/benchmarks/marketplace-provenance");
  expect(response.ok()).toBeTruthy();
  const provenance = await response.json();
  expect(provenance.aggregate).toMatchObject({
    plannedAttemptCount: 6,
    recordedAttemptCount: 6,
    successCount: 6,
    allAttemptsSucceeded: true,
  });

  await page.goto("/#evidence");
  const deliverySection = page.getByRole("region", { name: "Hired through the public marketplace" });
  await expect(deliverySection).toBeVisible();
  await expect(deliverySection.getByText("6/6", { exact: true }).first()).toBeVisible();
  await expect(deliverySection.getByText("public Provider jobs", { exact: true })).toBeVisible();
  await expect(deliverySection.getByText("0", { exact: true })).toBeVisible();
  await expect(deliverySection.getByText("retries or replacements", { exact: true })).toBeVisible();
  await expect(deliverySection.getByText("3/3", { exact: true })).toBeVisible();
  await expect(deliverySection.getByText("exact output pairs", { exact: true })).toBeVisible();
  await expect(deliverySection.getByRole("link", { name: /Raw record/ })).toHaveAttribute(
    "href",
    "/api/benchmarks/marketplace-provenance",
  );
});

test("a published Agent Advantage status exposes the committed report without changing its scope", async ({ page }) => {
  await page.route("**/evidence/agent-advantage-status.json", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        schemaVersion: "positioncrew.agent-advantage-publication.v1",
        status: "PUBLISHED",
        reportUrl: "/evidence/agent-advantage/",
        reportHash: `sha256:${"1".repeat(64)}`,
        evidenceManifestHash: `sha256:${"2".repeat(64)}`,
        publishedAt: "2026-08-13T03:30:00.000Z",
        taskCount: 3,
        supportedAdvantageCount: 2,
        agentBlindQualityScore: 287,
        boundary:
          "This fixture verifies the published user interface only and is not a real Agent Advantage result.",
      }),
    });
  });
  await page.goto("/#evidence");
  await expect(page.getByText("Published", { exact: true })).toBeVisible();
  await expect(page.getByText("Independent result published.")).toBeVisible();
  await expect(page.getByText(/2\/3 frozen tasks support the pre-registered advantage rule/)).toBeVisible();
  await expect(page.getByRole("link", { name: "Open independently scored report" })).toHaveAttribute(
    "href",
    "/evidence/agent-advantage/",
  );
  await expect(page.getByText(/scope remains limited to the published report/)).toBeVisible();
});

test("the evidence page exposes every scheduled production outcome after the fixed epoch", async ({ page }) => {
  await page.route("**/api/operations/production**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        schemaVersion: "positioncrew.production-track-record.v1",
        generatedAt: "2026-08-13T07:30:00.000Z",
        status: "DEGRADED",
        epoch: {
          schemaVersion: "positioncrew.production-monitor-epoch.v1",
          startedAt: "2026-08-13T04:00:00.000Z",
          baseUrl: "https://positioncrew.dolepee.com",
          workflow: {
            owner: "dolepee",
            repository: "positioncrew",
            file: "production-smoke.yml",
            url: "https://github.com/dolepee/positioncrew/actions/workflows/production-smoke.yml",
            snapshotUrl:
              "https://raw.githubusercontent.com/dolepee/positioncrew/production-monitor/evidence/production-track-record.json",
            event: "schedule",
            cadenceMinutes: 30,
          },
          verification: {
            expectedCheckCountAtEpoch: 57,
            scope: ["Providers and public receipts"],
          },
          aggregation: {
            coverage: "LATEST_100_SCHEDULED_RUNS",
            excludeEvents: ["push", "workflow_dispatch"],
          },
          boundary: "Production verification only.",
        },
        source: {
          provider: "GITHUB_ACTIONS_SNAPSHOT",
          snapshotUrl:
            "https://raw.githubusercontent.com/dolepee/positioncrew/production-monitor/evidence/production-track-record.json",
          workflowUrl: "https://github.com/dolepee/positioncrew/actions/workflows/production-smoke.yml",
          sourceStatus: "AVAILABLE",
        },
        summary: {
          totalScheduledRunsSinceEpoch: 2,
          observedRunCount: 2,
          completedRuns: 2,
          successfulRuns: 1,
          unsuccessfulRuns: 1,
          pendingRuns: 0,
          rollingPassRatePct: 50,
          rollingWindowStartedAt: "2026-08-13T05:47:00.000Z",
          rollingWindowEndedAt: "2026-08-13T06:17:00.000Z",
        },
        runs: [
          {
            runId: 102,
            status: "completed",
            conclusion: "failure",
            createdAt: "2026-08-13T06:17:00.000Z",
            completedAt: "2026-08-13T06:20:00.000Z",
            headSha: "2".repeat(40),
            url: "https://github.com/dolepee/positioncrew/actions/runs/102",
          },
          {
            runId: 101,
            status: "completed",
            conclusion: "success",
            createdAt: "2026-08-13T05:47:00.000Z",
            completedAt: "2026-08-13T05:50:00.000Z",
            headSha: "1".repeat(40),
            url: "https://github.com/dolepee/positioncrew/actions/runs/101",
          },
        ],
        boundary: "Not financial performance or Agent Advantage.",
      }),
    });
  });

  await page.goto("/#evidence");
  await expect(page.getByRole("heading", { name: "Production verification record" })).toBeVisible();
  await expect(page.getByText("1 unsuccessful", { exact: true })).toBeVisible();
  await expect(page.getByText("50%", { exact: true })).toBeVisible();
  await expect(page.getByText("failures remain visible", { exact: false })).toBeVisible();
  await expect(page.getByRole("link", { name: /Run #102/ })).toHaveAttribute(
    "href",
    "https://github.com/dolepee/positioncrew/actions/runs/102",
  );
  await expect(page.getByText("Non-cherry-picked operating evidence.", { exact: true })).toBeVisible();
});

test("the app has no page-level horizontal overflow", async ({ page }) => {
  for (const route of ["#marketplace", "#jobs", "#evidence"]) {
    await page.goto(`/${route}`);
    await expect(page.locator("main h1")).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflow).toBe(false);
  }
});

test("providers expose machine-readable manifests and exact schemas", async ({ page, request }) => {
  await page.goto("/");
  const manifestLink = page.getByRole("link", { name: "Inspect provider manifest" });
  await expect(manifestLink).toHaveAttribute(
    "href",
    "/api/providers/lending-rescue/manifest",
  );

  const marketplaceResponse = await request.get("/.well-known/positioncrew.json");
  expect(marketplaceResponse.ok()).toBeTruthy();
  const marketplace = await marketplaceResponse.json();
  expect(marketplace.providers).toHaveLength(4);
  expect(marketplace.claims.agentAdvantage).toBe("PENDING_INDEPENDENT_BLIND_EVALUATION");
  expect(marketplace.claims.judgeTrial).toBe("NO_WALLET_PROVIDER_CALL");
  expect(marketplace.operatingRecordUrl).toMatch(/\/api\/operations\/production$/);

  const providerResponse = await request.get("/api/providers/lending-rescue/manifest");
  expect(providerResponse.ok()).toBeTruthy();
  const provider = await providerResponse.json();
  expect(provider.provider.service).toBe("LENDING_RESCUE");
  expect(provider.commerce.settlement).toBe("IN_MEMORY_CONFORMANCE");
  expect(provider.pricing.judgeTrial).toMatchObject({
    amount: "0",
    walletRequired: false,
    settlement: "NO_PAYMENT",
  });

  const schemaResponse = await request.get(
    "/api/schemas/positioncrew.lending-rescue.request.v1",
  );
  expect(schemaResponse.ok()).toBeTruthy();
  const schema = await schemaResponse.json();
  expect(schema.$id).toBe("positioncrew.lending-rescue.request.v1");
  expect(schema.required).toContain("targetHealthFactor");
});
