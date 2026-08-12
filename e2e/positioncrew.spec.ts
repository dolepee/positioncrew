import { expect, test } from "@playwright/test";

test("a cold buyer can discover, hire, and inspect the lending provider", async ({ page }) => {
  await page.goto("/#marketplace");
  await expect(page.getByRole("heading", { name: "Hire a capital operator." })).toBeVisible();
  await expect(page.getByText("4/4", { exact: true }).last()).toBeVisible();
  await expect(page.getByRole("button", { name: /Lending Rescue v1/ })).toBeVisible({ timeout: 20_000 });

  await page.getByRole("button", { name: "Open lending rescue workspace" }).click();
  await expect(page.getByRole("heading", { name: "Define the job. Inspect the action." })).toBeVisible();
  await page.getByRole("button", { name: "Run lending rescue" }).click();

  await expect(page.getByRole("heading", { name: "Repay 152 USDT" })).toBeVisible();
  await expect(page.getByText("100/100", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "JSON" }).click();
  await expect(page.getByText("application/json", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Receipt" }).click();
  await expect(page.getByText("Evaluation", { exact: true })).toBeVisible();
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
  await expect(page.getByText("8/8", { exact: true })).toBeVisible();

  await page.goto("/#jobs");
  await page.getByPlaceholder("0x account address").fill("0x0000000000000000000000000000000000000001");
  await page.getByRole("button", { name: "Inspect" }).click();
  await expect(page.getByText("NO POSITION", { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("link", { name: /Block [0-9,]+/ })).toHaveAttribute("href", /bscscan\.com\/address/);
});

test("all four mandatory capital jobs return category-specific results", async ({ page }) => {
  await page.goto("/#jobs");
  const provider = page.getByRole("combobox", { name: "Provider" });
  await expect(provider).toBeVisible();
  const cases = [
    { value: "LP_REBALANCE", button: "Run lp rebalance", output: "SHIFT range to 0...240" },
    { value: "YIELD_OPTIMIZATION", button: "Run yield optimisation", output: "MIGRATE to beefy-usdt-vault" },
    { value: "BOUNDED_GRID", button: "Run bounded grid", output: "Build 4 bounded orders" },
  ];
  for (const candidate of cases) {
    await provider.selectOption(candidate.value);
    await page.getByRole("button", { name: candidate.button }).click();
    await expect(page.getByRole("heading", { name: candidate.output })).toBeVisible();
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
      field: "Candidate APY (bps)",
      value: "300",
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
    await page.getByLabel(candidate.field).fill(candidate.value);
    await expect(page.getByText("Custom bounds", { exact: true })).toBeVisible();
    await expect(page.getByText("Custom parameters are evaluated but are not covered by the locked benchmark hash.", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: candidate.button }).click();
    await expect(page.getByRole("heading", { name: candidate.decision })).toBeVisible();
    await page.getByTitle("Reset to frozen fixture").click();
    await expect(page.getByText("Frozen fixture", { exact: true })).toBeVisible();
    await expect(page.getByText("Exact frozen input matches the committed fixture.", { exact: true })).toBeVisible();
  }
});

test("the evidence page separates conformance from advantage claims", async ({ page }) => {
  await page.goto("/#evidence");
  await expect(page.getByRole("heading", { name: "Evidence register" })).toBeVisible();
  await expect(page.getByText("4/4", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("3/3", { exact: true })).toBeVisible();
  await expect(page.getByText("6", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("REPEATABLE", { exact: true })).toHaveCount(3);
  await expect(page.getByText("source-committed agent runs", { exact: true })).toBeVisible();
  await expect(page.getByText(/source 3b28703/).first()).toBeVisible();
  await expect(page.getByText("No advantage result is claimed.", { exact: true })).toBeVisible();
  await expect(page.getByText(/backend proof completion is not represented as available/)).toBeVisible();

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

  const providerResponse = await request.get("/api/providers/lending-rescue/manifest");
  expect(providerResponse.ok()).toBeTruthy();
  const provider = await providerResponse.json();
  expect(provider.provider.service).toBe("LENDING_RESCUE");
  expect(provider.commerce.settlement).toBe("IN_MEMORY_CONFORMANCE");

  const schemaResponse = await request.get(
    "/api/schemas/positioncrew.lending-rescue.request.v1",
  );
  expect(schemaResponse.ok()).toBeTruthy();
  const schema = await schemaResponse.json();
  expect(schema.$id).toBe("positioncrew.lending-rescue.request.v1");
  expect(schema.required).toContain("targetHealthFactor");
});
