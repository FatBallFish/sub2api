# Price Group Management and Selected Export Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add persistent per-day price-group management and non-persistent selected-group PNG export to the standalone pricing calculator.

**Architecture:** Extend the existing pure core with group mutation, default restoration, and comparison filtering helpers. Keep dialog UI and transient export selection in the application layer; only the modified daily `groups` arrays are persisted in the existing versioned state.

**Tech Stack:** HTML5, CSS, vanilla JavaScript, native dialog/checkbox controls, Canvas 2D, localStorage, Node.js test runner, Playwright.

---

### Task 1: Group Mutation Core

**Files:**
- Modify: `tools/tests/relay-pricing-calculator.test.mjs`
- Modify: `tools/relay-pricing-calculator.html`

**Step 1: Write failing tests**

Test that `createPriceGroup` validates required values and returns a unique `custom-N` ID, `removePriceGroup` removes only the requested row, and `restoreDefaultGroups` returns exactly the 12 built-in groups while preserving matching current prices.

**Step 2: Run tests and verify RED**

```bash
/Users/fatballfish/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test tools/tests/relay-pricing-calculator.test.mjs
```

Expected: FAIL because the group helpers are missing.

**Step 3: Implement the pure helpers**

Extract a default group template, implement unique ID generation across all days, mutation helpers, restoration rules, and stricter duplicate-ID state validation. Export the helpers through `PricingCalculatorCore`.

**Step 4: Run tests and verify GREEN**

Expected: all unit tests PASS.

**Step 5: Commit**

```bash
git add tools/relay-pricing-calculator.html
git add -f tools/tests/relay-pricing-calculator.test.mjs
git commit -m "feat: add daily price group management core"
```

### Task 2: Group Management Dialog

**Files:**
- Modify: `tools/tests/relay-pricing-calculator.e2e.mjs`
- Modify: `tools/relay-pricing-calculator.html`

**Step 1: Write a failing browser flow**

Open the management dialog, add a custom group, reload and verify persistence; delete it, reload and verify removal; remove an internal group, restore defaults, and verify 12 internal groups return with matching prices retained.

**Step 2: Run browser test and verify RED**

```bash
/Users/fatballfish/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node tools/tests/relay-pricing-calculator.e2e.mjs
```

Expected: FAIL because dialog controls do not exist.

**Step 3: Implement the dialog**

Add the `管理分组` trigger, accessible native dialog, add form, row deletion, restore confirmation, immediate persistence, and compact responsive styling.

**Step 4: Run unit and browser tests**

Expected: all tests PASS with no page errors.

**Step 5: Commit**

```bash
git add tools/relay-pricing-calculator.html
git add -f tools/tests/relay-pricing-calculator.e2e.mjs
git commit -m "feat: add daily price group management dialog"
```

### Task 3: Selected Group Export

**Files:**
- Modify: `tools/tests/relay-pricing-calculator.test.mjs`
- Modify: `tools/tests/relay-pricing-calculator.e2e.mjs`
- Modify: `tools/relay-pricing-calculator.html`

**Step 1: Write failing unit and browser tests**

Test `filterPriceComparison` preserves display order and rejects an empty selection. In Playwright, assert the export dialog defaults to all checked, clearing disables export, choosing a subset downloads a shorter PNG, and reopening restores all checked.

**Step 2: Run tests and verify RED**

Expected: FAIL because filtering and export selection dialog are missing.

**Step 3: Implement transient export selection**

Open a fresh checkbox list for every export action, add select-all/clear/count states, pass selected IDs into Canvas rendering, and leave selection out of persisted state and backups.

**Step 4: Run tests and verify GREEN**

Expected: unit and browser tests PASS.

**Step 5: Commit**

```bash
git add tools/relay-pricing-calculator.html
git add -f tools/tests/relay-pricing-calculator.test.mjs tools/tests/relay-pricing-calculator.e2e.mjs
git commit -m "feat: export selected daily price groups"
```

### Task 4: Visual Verification and Pull Request

**Files:**
- Modify if needed: `tools/relay-pricing-calculator.html`

**Step 1: Run complete verification**

Run unit tests, Playwright E2E, `git diff --check`, and direct `file://` loading. Capture desktop/mobile dialog screenshots and inspect the selected-group PNG.

**Step 2: Verify the target branch**

Fetch `origin`, confirm `origin/custom_main`, and inspect the feature diff against that target. Resolve conflicts without discarding existing feature commits.

**Step 3: Push and create PR**

Push `codex/relay-pricing-calculator` and create a ready PR targeting `custom_main` with summary and test evidence.

**Step 4: Report PR URL**

Return the PR link, branch, changed file, and fresh verification results.
