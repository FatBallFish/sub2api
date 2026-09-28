# New Frontend Internationalization Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Internationalize all frontend-owned copy in `frontend-new` for English, Simplified Chinese, Traditional Chinese, and Japanese, with a persistent top-right language switcher and localized stable API errors.

**Architecture:** Initialize `i18next` and `react-i18next` before rendering React, backed by locale modules with English fallback and an explicit local-storage/browser detector. Reuse one accessible language menu across shared and standalone layouts, normalize backend error identifiers into a shared localized resolver, and keep all backend-configurable values outside the translation catalog.

**Tech Stack:** React 19, TypeScript 6, Vite 8, i18next, react-i18next, Phosphor Icons, Vitest, Testing Library, ESLint.

---

### Task 1: Install The Runtime And Build Locale Initialization

**Files:**
- Modify: `frontend-new/package.json`
- Modify: `frontend-new/package-lock.json`
- Create: `frontend-new/src/i18n/locales.ts`
- Create: `frontend-new/src/i18n/resources/en.ts`
- Create: `frontend-new/src/i18n/resources/zh-CN.ts`
- Create: `frontend-new/src/i18n/resources/zh-TW.ts`
- Create: `frontend-new/src/i18n/resources/ja.ts`
- Create: `frontend-new/src/i18n/index.ts`
- Create: `frontend-new/src/i18n/index.test.ts`
- Modify: `frontend-new/src/main.tsx`
- Modify: `frontend-new/src/test/setup.ts`

**Step 1: Write failing locale tests**

Cover normalization, persisted locale precedence, browser detection, invalid persisted values, storage exceptions, English fallback, and HTML language synchronization. The core assertions should include:

```ts
expect(normalizeLocale("zh-HK")).toBe("zh-TW");
expect(normalizeLocale("zh-SG")).toBe("zh-CN");
expect(normalizeLocale("ja-JP")).toBe("ja");
expect(normalizeLocale("fr-FR")).toBeNull();
expect(resolveInitialLocale({ stored: "ja", browser: ["zh-CN"] })).toBe("ja");
expect(resolveInitialLocale({ stored: null, browser: ["zh-TW"] })).toBe("zh-TW");
expect(resolveInitialLocale({ stored: "bad", browser: ["fr-FR"] })).toBe("en");
```

**Step 2: Run the focused test and confirm failure**

Run: `npm test -- src/i18n/index.test.ts`

Expected: FAIL because the i18n modules do not exist.

**Step 3: Install and implement the runtime**

Run: `npm install i18next react-i18next`

Define `SUPPORTED_LOCALES`, `LOCALE_STORAGE_KEY`, locale guards, browser normalization, safe storage helpers, and a single initialized i18next instance. Configure `fallbackLng: "en"`, `supportedLngs`, `returnNull: false`, React Suspense disabled, and an `i18n.on("languageChanged")` handler that safely persists the locale and sets `document.documentElement.lang`.

Start every resource module with the same nested namespaces and use `as const` for the English resource so translation keys remain reviewable. Initialize i18n before importing/rendering `App` in `main.tsx`. Reset the instance to English in the shared Vitest setup so tests cannot leak language state.

**Step 4: Run focused tests**

Run: `npm test -- src/i18n/index.test.ts`

Expected: PASS.

**Step 5: Commit**

```bash
git add frontend-new/package.json frontend-new/package-lock.json frontend-new/src/i18n frontend-new/src/main.tsx frontend-new/src/test/setup.ts
git commit -m "feat(frontend-new): add i18n runtime"
```

### Task 2: Add The Reusable Language Switcher

**Files:**
- Create: `frontend-new/src/components/LanguageSwitcher.tsx`
- Create: `frontend-new/src/components/LanguageSwitcher.test.tsx`
- Modify: `frontend-new/src/layouts/PublicLayout.tsx`
- Modify: `frontend-new/src/layouts/PublicLayout.test.tsx`
- Modify: `frontend-new/src/layouts/ConsoleLayout.tsx`
- Modify: `frontend-new/src/layouts/ConsoleLayout.test.tsx`
- Modify: `frontend-new/src/pages/public/Auth.tsx`
- Modify: `frontend-new/src/pages/public/Auth.test.tsx`
- Modify: `frontend-new/src/index.css`

**Step 1: Write failing component and layout tests**

Render the switcher with initialized i18n, open it, select `繁體中文`, and assert the language, storage, HTML attribute, checked state, and translated trigger label change. Add one assertion to each layout test confirming the top-right trigger exists.

```ts
await user.click(screen.getByRole("button", { name: /language/i }));
await user.click(screen.getByRole("menuitemradio", { name: "繁體中文" }));
expect(i18n.resolvedLanguage).toBe("zh-TW");
expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe("zh-TW");
expect(document.documentElement.lang).toBe("zh-TW");
```

**Step 2: Run tests and confirm failure**

Run: `npm test -- src/components/LanguageSwitcher.test.tsx src/layouts/PublicLayout.test.tsx src/layouts/ConsoleLayout.test.tsx src/pages/public/Auth.test.tsx`

Expected: FAIL because the switcher and translation keys are absent.

**Step 3: Implement the menu and mount it**

Use `Globe`, `Check`, and `CaretDown` from `@phosphor-icons/react`. Implement a stable 32-pixel trigger, click-outside and Escape dismissal, `aria-haspopup="menu"`, `menuitemradio` options, localized labels, and native language names. Mount it in public navigation, beside the console theme control, and at the top-right of authentication. Preserve mobile width by hiding the current-language text below the appropriate breakpoint.

**Step 4: Run focused tests**

Run the Task 2 command and expect PASS.

**Step 5: Commit**

```bash
git add frontend-new/src/components/LanguageSwitcher.tsx frontend-new/src/components/LanguageSwitcher.test.tsx frontend-new/src/layouts frontend-new/src/pages/public/Auth.tsx frontend-new/src/pages/public/Auth.test.tsx frontend-new/src/index.css frontend-new/src/i18n/resources
git commit -m "feat(frontend-new): add persistent language switcher"
```

### Task 3: Localize Stable API Errors And Agreement Titles

**Files:**
- Modify: `frontend-new/src/api/client.ts`
- Modify: `frontend-new/src/api/client.test.ts`
- Create: `frontend-new/src/utils/localizedError.ts`
- Create: `frontend-new/src/utils/localizedError.test.ts`
- Modify: `frontend-new/src/utils/loginAgreement.ts`
- Create: `frontend-new/src/utils/loginAgreement.test.ts`
- Modify: `frontend-new/src/components/auth/LoginAgreementPrompt.tsx`
- Modify: `frontend-new/src/pages/public/PublicMarkdownPage.tsx`
- Modify: `frontend-new/src/pages/public/legal/LegalDocument.tsx`
- Modify: `frontend-new/src/layouts/PublicLayout.tsx`
- Modify: `frontend-new/src/i18n/resources/*.ts`

**Step 1: Write failing normalization and title tests**

Verify `ApiError.code` prefers `reason`, then string `code`, `error_code`, and nested `error.code`; numeric HTTP envelope codes must not become business identifiers. Verify known codes resolve through `errors.<CODE>`, unknown identifiers preserve the backend message, and missing messages use the caller's fallback key.

Verify the four built-in agreement IDs return translated titles in every locale while an unknown ID returns its configured title.

**Step 2: Run focused tests and confirm failure**

Run: `npm test -- src/api/client.test.ts src/utils/localizedError.test.ts src/utils/loginAgreement.test.ts src/layouts/PublicLayout.test.tsx src/pages/public/legal/LegalMarkdown.test.tsx`

Expected: FAIL on missing normalized codes and localized titles.

**Step 3: Implement shared resolvers**

Extend the API envelope parser without changing successful payload behavior. Implement:

```ts
localizedErrorMessage(error: unknown, fallbackKey: TranslationKey): string
localizedAgreementTitle(document: LoginAgreementDocument, t: TFunction): string
```

Add translations for known stable authentication, payment, API key, quota, and authorization codes discovered in current backend handlers. Use localized agreement titles in the checkbox, prompt tabs, footer links, and page heading. Never translate Markdown or unknown configured titles.

**Step 4: Run focused tests**

Run the Task 3 command and expect PASS.

**Step 5: Commit**

```bash
git add frontend-new/src/api/client.ts frontend-new/src/api/client.test.ts frontend-new/src/utils frontend-new/src/components/auth/LoginAgreementPrompt.tsx frontend-new/src/pages/public/PublicMarkdownPage.tsx frontend-new/src/pages/public/legal frontend-new/src/layouts/PublicLayout.tsx frontend-new/src/i18n/resources
git commit -m "feat(frontend-new): localize API errors and legal titles"
```

### Task 4: Internationalize The Public Marketing And Pricing Pages

**Files:**
- Modify: `frontend-new/src/layouts/PublicLayout.tsx`
- Modify: `frontend-new/src/pages/public/Home.tsx`
- Modify: `frontend-new/src/pages/public/Home.test.tsx`
- Modify: `frontend-new/src/pages/public/Pricing.tsx`
- Modify: `frontend-new/src/pages/public/Pricing.test.tsx`
- Modify: `frontend-new/src/pages/public/ModelPricing.tsx`
- Modify: `frontend-new/src/pages/public/ModelPricing.test.tsx`
- Modify: `frontend-new/src/pages/public/Blog.tsx`
- Modify: `frontend-new/src/pages/public/Team.tsx`
- Modify: `frontend-new/src/pages/public/PublicMarkdownPage.tsx`
- Modify: `frontend-new/src/pages/public/legal/Privacy.tsx`
- Modify: `frontend-new/src/pages/public/legal/Terms.tsx`
- Modify: `frontend-new/src/utils/format.ts`
- Modify: `frontend-new/src/utils/format.test.ts`
- Modify: `frontend-new/src/i18n/resources/*.ts`

**Step 1: Add failing representative locale tests**

For each page, render once in Japanese or Traditional Chinese and assert the main heading, important controls, empty/loading state, and at least one formatted value. Add formatter tests showing locale-aware grouping, dates, and currency while values remain unchanged.

**Step 2: Run public page tests and confirm failure**

Run: `npm test -- src/pages/public src/layouts/PublicLayout.test.tsx src/utils/format.test.ts`

Expected: FAIL because pages still render English literals.

**Step 3: Replace fixed copy and locale-enable formatters**

Use `useTranslation` in components and pass `t` into module-level label builders rather than calling hooks outside React. Convert static arrays to translation-key descriptors. Update formatter helpers to accept or obtain the active locale without altering backend values. Keep brand name, API protocol names, model names, group names, and backend plan data unchanged.

**Step 4: Run public page tests**

Run the Task 4 command and expect PASS.

**Step 5: Commit**

```bash
git add frontend-new/src/layouts/PublicLayout.tsx frontend-new/src/pages/public frontend-new/src/utils/format.ts frontend-new/src/utils/format.test.ts frontend-new/src/i18n/resources
git commit -m "feat(frontend-new): translate public pages"
```

### Task 5: Internationalize Authentication, OAuth, Captcha, And Payment Flows

**Files:**
- Modify: `frontend-new/src/App.tsx`
- Modify: `frontend-new/src/App.test.tsx`
- Modify: `frontend-new/src/pages/public/Auth.tsx`
- Modify: `frontend-new/src/pages/public/Auth.test.tsx`
- Modify: `frontend-new/src/pages/public/OAuthCallback.tsx`
- Modify: `frontend-new/src/pages/public/OAuthCallback.test.tsx`
- Modify: `frontend-new/src/pages/public/PaymentResult.tsx`
- Modify: `frontend-new/src/pages/public/StripePayment.tsx`
- Modify: `frontend-new/src/components/auth/CaptchaChallenge.tsx`
- Modify: `frontend-new/src/components/auth/AliyunCaptchaWidget.tsx`
- Modify: `frontend-new/src/components/auth/TencentCaptchaWidget.tsx`
- Modify: `frontend-new/src/components/auth/TurnstileWidget.tsx`
- Modify: `frontend-new/src/components/auth/*.test.tsx`
- Modify: `frontend-new/src/i18n/resources/*.ts`

**Step 1: Add failing flow tests**

Test login/register modes, verification states, agreement validation, captcha labels/errors, OAuth pending/success/failure states, payment pending/success/failure states, initial loading, console failure, and region block in at least one non-English locale. Assert known API codes use localized messages and unknown errors retain backend details.

**Step 2: Run flow tests and confirm failure**

Run: `npm test -- src/App.test.tsx src/pages/public/Auth.test.tsx src/pages/public/OAuthCallback.test.tsx src/components/auth`

Expected: FAIL on English fixed copy.

**Step 3: Translate flows and mount standalone switchers**

Replace all fixed copy and frontend fallback errors with translation keys. Use the shared localized error resolver in catches. Add the language switcher to standalone OAuth, payment, loading, failure, and region-block surfaces through a small reusable standalone-page placement wrapper where it removes duplication. Preserve external provider error messages when no stable code exists.

**Step 4: Run flow tests**

Run the Task 5 command and expect PASS.

**Step 5: Commit**

```bash
git add frontend-new/src/App.tsx frontend-new/src/App.test.tsx frontend-new/src/pages/public frontend-new/src/components/auth frontend-new/src/i18n/resources
git commit -m "feat(frontend-new): translate authentication and payment flows"
```

### Task 6: Internationalize The Console Shell, Overview, And API Keys

**Files:**
- Modify: `frontend-new/src/layouts/ConsoleLayout.tsx`
- Modify: `frontend-new/src/layouts/ConsoleLayout.test.tsx`
- Modify: `frontend-new/src/pages/console/Overview.tsx`
- Modify: `frontend-new/src/pages/console/Overview.test.tsx`
- Modify: `frontend-new/src/pages/console/ApiKeys.tsx`
- Modify: `frontend-new/src/pages/console/ApiKeys.test.tsx`
- Modify: `frontend-new/src/i18n/resources/*.ts`

**Step 1: Add failing console tests**

Render the shell and pages in Simplified Chinese and Japanese. Assert navigation, breadcrumb, theme/account controls, credit unit, overview chart/table labels, API key modal labels, group selectors, copy/edit/enable/delete actions, validation, success, loading, and empty states. Confirm user, plan, group, and API key names remain exactly as returned by fixtures.

**Step 2: Run focused tests and confirm failure**

Run: `npm test -- src/layouts/ConsoleLayout.test.tsx src/pages/console/Overview.test.tsx src/pages/console/ApiKeys.test.tsx`

Expected: FAIL on untranslated labels.

**Step 3: Translate the shell and pages**

Store navigation translation keys rather than translated strings so active-route logic remains stable. Translate all frontend-generated feedback through the shared error resolver. Keep backend group names/descriptions and plan/user data untouched.

**Step 4: Run focused tests**

Run the Task 6 command and expect PASS.

**Step 5: Commit**

```bash
git add frontend-new/src/layouts/ConsoleLayout.tsx frontend-new/src/layouts/ConsoleLayout.test.tsx frontend-new/src/pages/console/Overview.tsx frontend-new/src/pages/console/Overview.test.tsx frontend-new/src/pages/console/ApiKeys.tsx frontend-new/src/pages/console/ApiKeys.test.tsx frontend-new/src/i18n/resources
git commit -m "feat(frontend-new): translate console shell and API keys"
```

### Task 7: Internationalize Billing And Remaining Console Pages

**Files:**
- Modify: `frontend-new/src/pages/console/Billing.tsx`
- Modify: `frontend-new/src/pages/console/Billing.test.tsx`
- Modify: `frontend-new/src/pages/console/Announcements.tsx`
- Modify: `frontend-new/src/pages/console/Announcements.test.tsx`
- Modify: `frontend-new/src/pages/console/InstallGuide.tsx`
- Modify: `frontend-new/src/pages/console/InstallGuide.test.tsx`
- Modify: `frontend-new/src/pages/console/Playground.tsx`
- Modify: `frontend-new/src/pages/console/Playground.test.tsx`
- Modify: `frontend-new/src/pages/console/Referral.tsx`
- Modify: `frontend-new/src/pages/console/Referral.test.tsx`
- Modify: `frontend-new/src/pages/console/UsageHistory.tsx`
- Modify: `frontend-new/src/pages/console/UsageHistory.test.tsx`
- Modify: `frontend-new/src/i18n/resources/*.ts`

**Step 1: Add failing representative tests**

For every page, test the primary heading, controls, table/card labels, dialogs, pagination, accessible action labels, and success/error/empty/loading states in a non-English locale. Keep announcement content, plan content, transaction references, models, endpoint names, and generated configuration values unchanged.

**Step 2: Run remaining console tests and confirm failure**

Run: `npm test -- src/pages/console`

Expected: FAIL on untranslated fixed copy.

**Step 3: Translate all remaining console copy**

Use interpolation for dynamic labels such as order references, copy actions, usage ranges, and counts. Use i18next plural rules for count-sensitive copy. Route API catches through the localized resolver. Use `Intl` with the active locale for frontend-owned date, number, and currency presentation.

**Step 4: Run console tests**

Run the Task 7 command and expect PASS.

**Step 5: Commit**

```bash
git add frontend-new/src/pages/console frontend-new/src/i18n/resources
git commit -m "feat(frontend-new): translate billing and console pages"
```

### Task 8: Add Translation Integrity And Hardcoded-Copy Guards

**Files:**
- Create: `frontend-new/src/i18n/resources.test.ts`
- Create: `frontend-new/src/i18n/staticCopy.test.ts`
- Modify: `frontend-new/src/i18n/resources/*.ts`
- Modify: any `frontend-new/src/**/*.tsx` files identified by the guard

**Step 1: Write resource parity and source scan tests**

Flatten each locale resource and assert it has exactly the English keys and non-empty values. Scan production TSX files for fixed JSX text and user-facing string attributes, with a small documented allowlist for brand names, protocol/model identifiers, URLs, input examples, and backend-derived values.

**Step 2: Run tests and inspect every failure**

Run: `npm test -- src/i18n/resources.test.ts src/i18n/staticCopy.test.ts`

Expected: FAIL with any missing locale keys or remaining fixed copy.

**Step 3: Complete resources and remove remaining hardcoded copy**

Add real translations rather than copying English into non-English resources. Keep the allowlist narrow and explain each category in the test. Do not include tests, backend content, CSS classes, route paths, event names, API field names, or technical identifiers in translation resources.

**Step 4: Run integrity tests and a source search**

Run:

```bash
npm test -- src/i18n/resources.test.ts src/i18n/staticCopy.test.ts
rg -n '>[^<{]*[A-Za-z][^<{]*<' src --glob '*.tsx'
rg -n '(aria-label|placeholder|title)="[^"]*[A-Za-z][^"]*"' src --glob '*.tsx'
```

Expected: Tests PASS; search output contains only explicitly reviewed technical/brand/example literals.

**Step 5: Commit**

```bash
git add frontend-new/src
git commit -m "test(frontend-new): enforce translation completeness"
```

### Task 9: Full Automated And Browser Verification

**Files:**
- Modify only files required to fix verified regressions.

**Step 1: Run the full frontend test suite**

Run: `npm test`

Expected: all Vitest tests PASS.

**Step 2: Run lint**

Run: `npm run lint`

Expected: exit code 0 with no errors.

**Step 3: Run the production build**

Run: `npm run build`

Expected: TypeScript and Vite build succeed.

**Step 4: Run browser checks**

Start Vite on an available localhost port. At desktop and mobile widths, verify:

- Public, login, console, OAuth/payment, and blocked-region entry points expose a top-right switcher.
- All four locales apply without reload and survive a reload.
- No controls overlap or truncate in Simplified Chinese, Traditional Chinese, or Japanese.
- Captcha components observe the updated HTML language.
- Built-in agreement names are localized while configured Markdown remains unchanged.
- Representative known error codes display localized copy and unknown messages remain visible.

Capture screenshots of the public navigation, authentication page, and console top bar in at least one CJK locale.

**Step 5: Review final diff and commit fixes**

Run:

```bash
git diff --check
git status --short
git diff --stat
```

Commit any verification fixes with a scoped message. Do not amend the earlier design commit.

### Task 10: Push The Completed Branch

**Files:** None.

**Step 1: Confirm branch and clean state**

Run: `git status --short --branch`

Expected: `custom_main` is clean and ahead of `origin/custom_main` by the new commits.

**Step 2: Review outgoing commits**

Run: `git log --oneline origin/custom_main..HEAD`

Expected: the design, plan, implementation, test, and any verification-fix commits are present.

**Step 3: Push**

Run: `git push origin custom_main`

Expected: push succeeds and local `custom_main` matches `origin/custom_main`.
