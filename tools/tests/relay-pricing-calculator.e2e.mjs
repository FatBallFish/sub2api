import assert from "node:assert/strict";
import { mkdir, readFile, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { chromium } from "/Users/fatballfish/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs";

const root = new URL("../../", import.meta.url);
const outputDir = new URL("../../.codex-tmp/e2e/", import.meta.url);
await mkdir(outputDir, { recursive: true });

const server = createServer(async (request, response) => {
  if (request.url === "/" || request.url === "/relay-pricing-calculator.html") {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(await readFile(new URL("tools/relay-pricing-calculator.html", root)));
    return;
  }
  response.writeHead(404);
  response.end();
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
const baseUrl = `http://127.0.0.1:${address.port}/relay-pricing-calculator.html`;
const browser = await chromium.launch({ headless: true });

try {
  const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.waitForSelector('html[data-app-ready="true"]', { timeout: 3000 });
  assert.equal(await page.locator("#price-groups-body tr").count(), 12);

  await page.locator("#duplicate-day").click();
  assert.equal(await page.locator("#price-day-select").inputValue(), "day-2026-07-27");
  await page.reload({ waitUntil: "networkidle" });
  assert.equal(await page.locator("#price-day-select").inputValue(), "day-2026-07-27");

  await page.getByRole("button", { name: "Stripe 收款" }).click();
  assert.equal(await page.locator("#stripe-table-body tr").count(), 50);
  await page.locator("#stripe-custom-amount").fill("1");
  await page.locator("#stripe-custom-amount").blur();
  assert.match(await page.locator("#stripe-custom-results").innerText(), /67\.10%/);
  await page.waitForTimeout(250);
  await page.screenshot({ path: new URL("stripe-desktop.png", outputDir).pathname, fullPage: true });

  await page.getByRole("button", { name: "盈利模板" }).click();
  await page.locator("#create-profit-template").click();
  assert.equal(await page.locator("#profit-template-select option").count(), 2);
  assert.equal(await page.locator("#profit-table-body tr").count(), 50);
  await page.waitForTimeout(250);
  await page.screenshot({ path: new URL("profit-desktop.png", outputDir).pathname, fullPage: true });

  await page.getByRole("button", { name: "每日价格" }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.locator("#export-price-image").click();
  const download = await downloadPromise;
  const pngPath = new URL("price-export.png", outputDir);
  await download.saveAs(pngPath.pathname);
  const png = await readFile(pngPath);
  assert.equal(png.subarray(1, 4).toString("ascii"), "PNG");
  assert.equal(png.readUInt32BE(16), 1400);
  assert.ok(png.readUInt32BE(20) > 900);
  assert.ok((await stat(pngPath)).size > 40_000);

  await page.screenshot({ path: new URL("desktop.png", outputDir).pathname, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload({ waitUntil: "networkidle" });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true);
  await page.screenshot({ path: new URL("mobile.png", outputDir).pathname, fullPage: true });
  assert.equal(pageErrors.length, 0, pageErrors.join("\n"));

  const filePage = await context.newPage();
  await filePage.goto(new URL("tools/relay-pricing-calculator.html", root).href, { waitUntil: "load" });
  await filePage.waitForSelector('html[data-app-ready="true"]');
  assert.equal(await filePage.locator("#price-groups-body tr").count(), 12);
  console.log("E2E PASS: direct file load, daily prices, Stripe rows, templates, persistence, PNG export, desktop/mobile screenshots");
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
