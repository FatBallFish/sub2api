import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import vm from "node:vm";

const htmlUrl = new URL("../relay-pricing-calculator.html", import.meta.url);

async function loadCore() {
  const html = await readFile(htmlUrl, "utf8");
  const match = html.match(/<script id="calculator-core">([\s\S]*?)<\/script>/);
  assert.ok(match, "calculator-core script should exist");

  const sandbox = { window: {} };
  vm.runInNewContext(match[1], sandbox, { filename: "calculator-core.js" });
  return sandbox.window.PricingCalculatorCore;
}

test("calculates Stripe net receipt using the workbook fee assumptions", async () => {
  const core = await loadCore();
  assert.deepEqual(
    JSON.parse(JSON.stringify(core.calculateStripe(1, 0.029, 0.3))),
    {
      amount: 1,
      fee: 0.329,
      net: 0.671,
      lossRate: 0.329,
      collectionRate: 0.671,
    },
  );
});

test("converts USD to CNY using the supplied exchange rate", async () => {
  const core = await loadCore();
  assert.equal(core.usdToCny(0.02, 6.8), 0.136);
});

test("classifies a lower current price as a decrease", async () => {
  const core = await loadCore();
  assert.equal(core.comparePrice(0.013, 0.016).status, "down");
});

test("matches the workbook profitability at representative tiers", async () => {
  const core = await loadCore();
  const input = {
    costPrice: 0.01470588235,
    salePrice: 0.02,
    rate: 0.029,
    fixedFee: 0.3,
  };

  assert.ok(Math.abs(core.calculateProfitability(1, input).actualMargin - (-0.09581835693)) < 1e-10);
  assert.ok(Math.abs(core.calculateProfitability(10, input).actualMargin - 0.21860348831) < 1e-10);
  assert.ok(Math.abs(core.calculateProfitability(30, input).actualMargin - 0.23486564256) < 1e-10);
});

test("rejects non-positive money inputs", async () => {
  const core = await loadCore();
  assert.throws(() => core.calculateStripe(0, 0.029, 0.3), /greater than zero/i);
  assert.throws(
    () => core.calculateProfitability(1, {
      costPrice: 0.01,
      salePrice: 0,
      rate: 0.029,
      fixedFee: 0.3,
    }),
    /sale price/i,
  );
});
