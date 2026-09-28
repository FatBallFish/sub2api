# Relay Pricing Calculator Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a polished, offline, single-file HTML tool for daily relay pricing, Stripe net-receipt analysis, and multi-template profitability analysis.

**Architecture:** Keep the production application entirely in `tools/relay-pricing-calculator.html`, with a pure calculation core exposed as `window.PricingCalculatorCore` and a DOM application layer in a second inline script. Persist a versioned state object to `localStorage`; draw export images directly with Canvas so the tool has no runtime dependencies.

**Tech Stack:** HTML5, CSS, vanilla JavaScript, Canvas 2D, localStorage, Node.js built-in test runner, Playwright for browser verification.

---

### Task 1: Calculation Core and Default Data

**Files:**
- Create: `tools/tests/relay-pricing-calculator.test.mjs`
- Create: `tools/relay-pricing-calculator.html`

**Step 1: Write the failing core test**

Create a Node test that reads the HTML, extracts the inline script marked `calculator-core`, evaluates it in a VM sandbox, and asserts:

```js
assert.deepEqual(core.calculateStripe(1, 0.029, 0.3), {
  amount: 1,
  fee: 0.329,
  net: 0.671,
  lossRate: 0.329,
  collectionRate: 0.671,
});
assert.equal(core.usdToCny(0.02, 6.8), 0.136);
assert.equal(core.comparePrice(0.013, 0.016).status, "down");
```

Also assert the profitability formula matches the workbook at `$1`, `$10`, and `$30`, and rejects non-positive inputs.

**Step 2: Run test to verify it fails**

Run:

```bash
/Users/fatballfish/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test tools/tests/relay-pricing-calculator.test.mjs
```

Expected: FAIL because `tools/relay-pricing-calculator.html` or the core API does not exist.

**Step 3: Add the minimal HTML and pure core**

Create the document shell and an inline core script exposing:

```js
window.PricingCalculatorCore = Object.freeze({
  round,
  calculateStripe,
  calculateProfitability,
  usdToCny,
  comparePrice,
  findPreviousDay,
  validateState,
  createDefaultState,
});
```

Embed the verified 2026-07-22 through 2026-07-26 history, the 12 stable group IDs, default Stripe assumptions, exchange rate 6.8, and one profitability template.

**Step 4: Run test to verify it passes**

Run the same Node test command.

Expected: PASS with all calculation and default-data tests green.

**Step 5: Commit**

```bash
git add tools/relay-pricing-calculator.html tools/tests/relay-pricing-calculator.test.mjs
git commit -m "feat: add pricing calculator core"
```

### Task 2: Local State and Navigation Shell

**Files:**
- Modify: `tools/tests/relay-pricing-calculator.test.mjs`
- Modify: `tools/relay-pricing-calculator.html`

**Step 1: Write failing state tests**

Add tests for versioned state validation, malformed import rejection, preservation of at least one price day/template, and deterministic cloning of a selected date.

**Step 2: Run tests to verify they fail**

Expected: FAIL because state mutation helpers are missing.

**Step 3: Implement state helpers and the application shell**

Add `clonePriceDay`, `normalizeImportedState`, safe localStorage load/save, tab navigation, global assumptions, toast/status feedback, import/export controls, and reset confirmation. Keep all handlers delegated from stable root elements.

**Step 4: Run tests to verify they pass**

Expected: all core/state tests PASS.

**Step 5: Commit**

```bash
git add tools/relay-pricing-calculator.html tools/tests/relay-pricing-calculator.test.mjs
git commit -m "feat: add local pricing workspace state"
```

### Task 3: Daily Price Editor and Comparison

**Files:**
- Modify: `tools/tests/relay-pricing-calculator.test.mjs`
- Modify: `tools/relay-pricing-calculator.html`

**Step 1: Write failing comparison tests**

Test chronological previous-day selection, stable-ID matching, `up/down/same/new` classification, price deltas, and behavior when dates are created out of order.

**Step 2: Run tests to verify they fail**

Expected: FAIL for missing comparison view-model helpers.

**Step 3: Implement the daily price workspace**

Render date selection, duplicate/delete actions, editable publication metadata, all 12 groups, USD inputs, RMB conversions, comparison labels, semantic row fills, and the change legend. Use the same view model for screen and image export.

**Step 4: Run tests to verify they pass**

Expected: all comparison tests PASS.

**Step 5: Commit**

```bash
git add tools/relay-pricing-calculator.html tools/tests/relay-pricing-calculator.test.mjs
git commit -m "feat: add daily price comparison editor"
```

### Task 4: Stripe Receipt Table and Custom Calculator

**Files:**
- Modify: `tools/tests/relay-pricing-calculator.test.mjs`
- Modify: `tools/relay-pricing-calculator.html`

**Step 1: Write failing table-generation tests**

Assert `buildStripeRows(1, 50, assumptions)` returns 50 rows and representative values match Excel:

```js
assert.equal(rows[0].fee, 0.329);
assert.equal(rows[9].net, 9.41);
assert.equal(rows[29].collectionRate, 0.961);
```

**Step 2: Run tests to verify they fail**

Expected: FAIL because row generation is missing.

**Step 3: Implement the Stripe view**

Render a compact custom-amount result strip and the `$1-$50` table with gross amount, fee, net receipt, loss rate, and collection rate. Recalculate immediately when assumptions or custom amount change.

**Step 4: Run tests to verify they pass**

Expected: all Stripe tests PASS.

**Step 5: Commit**

```bash
git add tools/relay-pricing-calculator.html tools/tests/relay-pricing-calculator.test.mjs
git commit -m "feat: add Stripe receipt analysis"
```

### Task 5: Profitability Templates

**Files:**
- Modify: `tools/tests/relay-pricing-calculator.test.mjs`
- Modify: `tools/relay-pricing-calculator.html`

**Step 1: Write failing template tests**

Test profitability rows `$1-$50`, template duplication with a unique ID, and edge cases where sale price or Stripe net receipt is zero.

**Step 2: Run tests to verify they fail**

Expected: FAIL because template row and mutation helpers are missing.

**Step 3: Implement the profitability workspace**

Add template selector, create/copy/delete actions, editable name/cost/sale inputs, RMB conversions, per-dollar summary metrics, and the tier table. Apply semantic margin bands without relying on color alone.

**Step 4: Run tests to verify they pass**

Expected: all profitability tests PASS.

**Step 5: Commit**

```bash
git add tools/relay-pricing-calculator.html tools/tests/relay-pricing-calculator.test.mjs
git commit -m "feat: add profitability templates"
```

### Task 6: PNG and JSON Export Workflows

**Files:**
- Modify: `tools/tests/relay-pricing-calculator.test.mjs`
- Modify: `tools/relay-pricing-calculator.html`

**Step 1: Write failing export-model tests**

Test wrapped text line calculation, deterministic PNG filename, sanitized JSON serialization, and import validation that leaves current state untouched on failure.

**Step 2: Run tests to verify they fail**

Expected: FAIL because export helpers are missing.

**Step 3: Implement exports**

Add Canvas layout/drawing functions for the price announcement PNG, JSON download, file-picker JSON import, download cleanup, and user-visible errors. Use device-independent fixed canvas dimensions and measure wrapped content before sizing.

**Step 4: Run tests to verify they pass**

Expected: all export tests PASS.

**Step 5: Commit**

```bash
git add tools/relay-pricing-calculator.html tools/tests/relay-pricing-calculator.test.mjs
git commit -m "feat: add pricing data and image exports"
```

### Task 7: Visual Finish and Browser Verification

**Files:**
- Create: `tools/tests/relay-pricing-calculator.e2e.mjs`
- Modify: `tools/relay-pricing-calculator.html`

**Step 1: Write the failing Playwright smoke test**

Serve the repository locally, load the HTML, and assert all three views render, date duplication persists after reload, a template can be created, and PNG export produces a non-empty download.

**Step 2: Run the browser test to verify it fails**

Run with bundled Node.js and Playwright. Expected: FAIL until stable selectors and all workflows exist.

**Step 3: Apply final responsive and accessibility styling**

Finish the compact financial-workbench CSS, focus states, sticky headers, mobile overflow behavior, reduced-motion support, tooltips, empty/error states, and print-safe sizing.

**Step 4: Run complete verification**

Run:

```bash
/Users/fatballfish/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test tools/tests/relay-pricing-calculator.test.mjs
/Users/fatballfish/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node tools/tests/relay-pricing-calculator.e2e.mjs
```

Capture desktop and mobile screenshots, inspect them visually, and check the downloaded PNG dimensions and nontransparent pixel count. Expected: all tests PASS with no console errors or layout overlap.

**Step 5: Commit**

```bash
git add tools/relay-pricing-calculator.html tools/tests/relay-pricing-calculator.test.mjs tools/tests/relay-pricing-calculator.e2e.mjs
git commit -m "test: verify relay pricing calculator"
```
