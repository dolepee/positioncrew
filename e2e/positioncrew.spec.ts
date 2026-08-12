import { expect, test } from "@playwright/test";

test("a cold buyer can discover, hire, and inspect the lending provider", async ({ page }) => {
  await page.goto("/#marketplace");
  await expect(page.getByRole("heading", { name: "Hire a capital operator." })).toBeVisible();
  await expect(page.getByText("4/4", { exact: true }).last()).toBeVisible();
  await expect(page.getByRole("button", { name: /Lending Rescue v1/ })).toBeVisible();

  await page.getByRole("button", { name: "Open lending rescue workspace" }).click();
  await expect(page.getByRole("heading", { name: "Define the job. Inspect the action." })).toBeVisible();
  await page.getByRole("button", { name: "Run lending rescue" }).click();

  await expect(page.getByRole("heading", { name: "Repay 152 USDT" })).toBeVisible();
  await expect(page.getByText("100/100", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "JSON" }).click();
  await expect(page.getByText("application/json", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Receipt" }).click();
  await expect(page.getByText("Evaluation", { exact: true })).toBeVisible();
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

test("the evidence page separates conformance from advantage claims", async ({ page }) => {
  await page.goto("/#evidence");
  await expect(page.getByRole("heading", { name: "Evidence register" })).toBeVisible();
  await expect(page.getByText("4/4", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("No advantage result is claimed.", { exact: true })).toBeVisible();
  await expect(page.getByText(/not represented as AACP or mainnet settlement/)).toBeVisible();
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
