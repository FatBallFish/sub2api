# New Frontend Account Actions Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add password visibility controls, affiliate reward transfer, and a complete redemption-code page to the new frontend.

**Architecture:** Extend the existing React pages and typed API layer without backend changes. Reuse the console bootstrap outlet context for account totals, call the legacy-compatible user endpoints directly, and keep all feedback in the established localized-message pattern.

**Tech Stack:** React 19, TypeScript, React Router 7, i18next, Phosphor Icons, Tailwind CSS 4, Vitest, Testing Library

---

### Task 1: Password Visibility Controls

**Files:**
- Modify: `frontend-new/src/pages/public/Auth.test.tsx`
- Modify: `frontend-new/src/pages/public/Auth.tsx`
- Modify: `frontend-new/src/i18n/resources/en.ts`
- Modify: `frontend-new/src/i18n/resources/zh-CN.ts`
- Modify: `frontend-new/src/i18n/resources/zh-TW.ts`
- Modify: `frontend-new/src/i18n/resources/ja.ts`

**Step 1: Write the failing tests**

Add login and registration tests that enter a password, click the translated visibility button, assert `type="text"`, click again, and assert `type="password"` with the value unchanged.

**Step 2: Run tests to verify they fail**

Run: `npm test -- src/pages/public/Auth.test.tsx`

Expected: FAIL because the visibility buttons do not exist.

**Step 3: Write the minimal implementation**

Add local visibility state, `Eye`/`EyeSlash` buttons, and translated `showPassword`/`hidePassword` labels to both auth modes. Keep buttons `type="button"` and preserve the existing input attributes.

**Step 4: Run tests to verify they pass**

Run: `npm test -- src/pages/public/Auth.test.tsx`

Expected: PASS.

### Task 2: Affiliate Transfer API And UI

**Files:**
- Modify: `frontend-new/src/types/console.ts`
- Modify: `frontend-new/src/api/console.ts`
- Modify: `frontend-new/src/api/console.test.ts`
- Modify: `frontend-new/src/pages/console/Referral.test.tsx`
- Modify: `frontend-new/src/pages/console/Referral.tsx`
- Modify: `frontend-new/src/i18n/resources/remainingConsole.ts`

**Step 1: Write failing API tests**

Assert that `transferAffiliateRewards()` sends `POST /user/aff/transfer` and returns `{ transferred_quota, balance }`.

**Step 2: Run the API test and verify it fails**

Run: `npm test -- src/api/console.test.ts`

Expected: FAIL because the API function is missing.

**Step 3: Implement the typed API call**

Add `ConsoleAffiliateTransfer` and call `postJSON` with no request body.

**Step 4: Write failing referral UI tests**

Cover zero-reward disabled state, one-click transfer, pending state, success state plus data reload, and localized API errors.

**Step 5: Run the referral tests and verify they fail**

Run: `npm test -- src/pages/console/Referral.test.tsx`

Expected: FAIL because no transfer control exists.

**Step 6: Implement transfer UI and translations**

Add the action beside the available/pending reward statistic. Prevent duplicate requests, reload referral data after success, and render success/error status with `role="status"` or `role="alert"`.

**Step 7: Run focused tests**

Run: `npm test -- src/api/console.test.ts src/pages/console/Referral.test.tsx`

Expected: PASS.

### Task 3: Redemption API

**Files:**
- Create: `frontend-new/src/types/redeem.ts`
- Create: `frontend-new/src/api/redeem.ts`
- Create: `frontend-new/src/api/redeem.test.ts`

**Step 1: Write failing tests**

Assert `redeemCode(code)` posts `{ code }` to `/redeem` and `getRedeemHistory()` gets `/redeem/history`, preserving balance, concurrency, subscription, and admin-adjustment fields.

**Step 2: Run tests to verify they fail**

Run: `npm test -- src/api/redeem.test.ts`

Expected: FAIL because the module does not exist.

**Step 3: Implement the API and types**

Create narrow response and history types and use `postJSON`/`getJSON`.

**Step 4: Run tests to verify they pass**

Run: `npm test -- src/api/redeem.test.ts`

Expected: PASS.

### Task 4: Redemption Page

**Files:**
- Create: `frontend-new/src/pages/console/Redeem.tsx`
- Create: `frontend-new/src/pages/console/Redeem.test.tsx`
- Modify: `frontend-new/src/i18n/resources/remainingConsole.ts`
- Modify: `frontend-new/src/api/settings.ts`

**Step 1: Write failing page tests**

Cover initial history loading, current wallet context, blank input, trimmed redemption payload, submitting state, type-specific success details, API failure, refreshed history, administrator adjustments, subscription rows, empty history, and optional contact information.

**Step 2: Run tests to verify they fail**

Run: `npm test -- src/pages/console/Redeem.test.tsx`

Expected: FAIL because the page does not exist.

**Step 3: Implement the page**

Build the form, result feedback, four-rule information section, and history list. Consume wallet/user data through `useOutletContext`, read public contact information through the existing settings API, and avoid redundant sequential requests where calls are independent.

**Step 4: Run tests to verify they pass**

Run: `npm test -- src/pages/console/Redeem.test.tsx`

Expected: PASS.

### Task 5: Route, Navigation, And Localization Integrity

**Files:**
- Modify: `frontend-new/src/App.tsx`
- Modify: `frontend-new/src/App.test.tsx`
- Modify: `frontend-new/src/layouts/ConsoleLayout.tsx`
- Modify: `frontend-new/src/layouts/ConsoleLayout.test.tsx`
- Modify: `frontend-new/src/i18n/resources/en.ts`
- Modify: `frontend-new/src/i18n/resources/zh-CN.ts`
- Modify: `frontend-new/src/i18n/resources/zh-TW.ts`
- Modify: `frontend-new/src/i18n/resources/ja.ts`
- Modify: `frontend-new/src/i18n/resources/remainingConsole.ts`

**Step 1: Write failing integration tests**

Assert a translated Redeem navigation item points to `/console/redeem` and the route renders the redemption page inside the authenticated console shell.

**Step 2: Run tests to verify they fail**

Run: `npm test -- src/App.test.tsx src/layouts/ConsoleLayout.test.tsx`

Expected: FAIL because the route and item are missing.

**Step 3: Wire the page and translations**

Add a Phosphor ticket/gift icon menu item, lazy-free route import consistent with current pages, route metadata, and complete locale keys.

**Step 4: Run focused and i18n tests**

Run: `npm test -- src/App.test.tsx src/layouts/ConsoleLayout.test.tsx src/i18n/resources.test.ts src/i18n/staticAnalysis.test.ts src/i18n/staticCopy.test.ts`

Expected: PASS.

### Task 6: Full Verification

**Files:**
- Verify all files changed above.

**Step 1: Run the complete test suite**

Run: `npm test`

Expected: all tests PASS.

**Step 2: Run lint**

Run: `npm run lint`

Expected: exit code 0 with no errors.

**Step 3: Run the production build**

Run: `npm run build`

Expected: exit code 0 and a generated Vite production bundle.

**Step 4: Review the final diff**

Run: `git diff --check && git status --short`

Expected: no whitespace errors; only scoped feature files and the pre-existing unrelated workspace changes are listed.
