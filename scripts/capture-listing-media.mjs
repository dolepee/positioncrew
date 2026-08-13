import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium, expect } from "@playwright/test";

const BASE_URL = process.env.POSITIONCREW_CAPTURE_URL ?? "https://positioncrew.dolepee.com";
const OUTPUT_DIR = path.resolve("web/public/listing-media");
const VIEWPORT = { width: 1200, height: 675 };

const requestedService = process.env.POSITIONCREW_CAPTURE_SERVICE;
const allCaptures = [
  { service: "LENDING_RESCUE", fileName: "lending-rescue.png", heading: "Lending Rescue v1" },
  { service: "LP_REBALANCE", fileName: "lp-rebalance.png", heading: "LP Range Operator v1" },
  { service: "YIELD_OPTIMIZATION", fileName: "yield-optimization.png", heading: "Yield Allocator v1", probe: ".yield-market-probe" },
  { service: "BOUNDED_GRID", fileName: "bounded-grid.png", heading: "Bounded Grid Builder v1", probe: ".grid-market-probe" },
];
const captures = requestedService
  ? allCaptures.filter((capture) => capture.service === requestedService)
  : allCaptures;

if (captures.length === 0) {
  throw new Error(`Unknown POSITIONCREW_CAPTURE_SERVICE: ${requestedService}`);
}

await mkdir(OUTPUT_DIR, { recursive: true });

const browser = await chromium.launch({ headless: true });
try {
  for (const capture of captures) {
    const context = await browser.newContext({
      colorScheme: "light",
      deviceScaleFactor: 1,
      viewport: VIEWPORT,
    });
    const page = await context.newPage();

    await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Try lending rescue free" }).waitFor();
    await page.getByRole("button", { name: "Try lending rescue free" }).click();

    const providerSelect = page.getByRole("combobox", { name: "Provider" });
    await providerSelect.waitFor();
    await providerSelect.selectOption(capture.service);
    await expect(providerSelect).toHaveValue(capture.service);
    await expect(page.getByRole("heading", { name: capture.heading })).toBeVisible();
    await expect(page.locator(".job-composer")).toHaveAttribute("aria-busy", "false");
    if (capture.probe) {
      await page.locator(`${capture.probe} .wallet-probe-result, ${capture.probe} .wallet-probe-error`).first().waitFor({
        state: "visible",
        timeout: 30_000,
      });
    }

    await page.addStyleTag({
      content: "html { scrollbar-width: none; } ::-webkit-scrollbar { display: none; }",
    });

    const lockedMode = page.getByRole("button", { name: "Locked receipt" });
    await lockedMode.click();
    await expect(lockedMode).toHaveAttribute("aria-pressed", "true");

    const runButton = page.locator(".primary-action");
    await runButton.waitFor({ state: "visible" });
    await expect(runButton).toBeEnabled();
    await runButton.click();

    const result = page.getByRole("region", { name: "Provider result" });
    try {
      await result.getByText("Locked historical fixture", { exact: false }).waitFor({
        state: "visible",
        timeout: 30_000,
      });
    } catch (error) {
      const debugPath = `/tmp/positioncrew-${capture.service.toLowerCase()}-capture-failure.png`;
      await page.screenshot({ fullPage: true, path: debugPath, type: "png" });
      process.stderr.write(`${await result.innerText()}\nCapture failure screenshot: ${debugPath}\n`);
      throw error;
    }

    await page.locator(".job-layout").evaluate((element) => {
      window.scrollTo({
        behavior: "instant",
        left: 0,
        top: element.getBoundingClientRect().top + window.scrollY - 65,
      });
    });

    const outputPath = path.join(OUTPUT_DIR, capture.fileName);
    await page.screenshot({
      animations: "disabled",
      fullPage: false,
      path: outputPath,
      type: "png",
    });
    process.stdout.write(`${capture.service}\t${VIEWPORT.width}x${VIEWPORT.height}\t${outputPath}\n`);
    await context.close();
  }
} finally {
  await browser.close();
}
