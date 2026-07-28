# Payment Dashboard Currency and Stripe Wallets Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Correct legacy payment dashboard currency aggregation and add effective Apple Pay/Google Pay controls to legacy Stripe checkout.

**Architecture:** Reuse the upstream currency-grouped dashboard contract. Store Stripe wallet display preferences as validated provider config, snapshot them per order, expose only the normalized non-sensitive values, and pass them to Stripe Payment Element.

**Tech Stack:** Go 1.24, Ent, Stripe Go v85, Vue 3, TypeScript, Vitest, Stripe.js Payment Element.

---

### Task 1: Currency-Aware Dashboard Statistics

**Files:**
- Create: `backend/internal/service/payment_stats_test.go`
- Modify: `backend/internal/service/payment_service.go`
- Modify: `backend/internal/service/payment_stats.go`
- Modify: `frontend/src/types/payment.ts`
- Modify: `frontend/src/components/admin/payment/OrderStatsCards.vue`
- Modify: `frontend/src/components/admin/payment/DailyRevenueChart.vue`
- Modify: `frontend/src/components/admin/payment/PaymentMethodChart.vue`
- Modify: `frontend/src/components/admin/payment/TopUsersLeaderboard.vue`
- Modify: `frontend/src/views/admin/orders/AdminPaymentDashboardView.vue`

**Step 1: Write the failing backend tests**

Add mixed CNY/USD orders and assert maps instead of a cross-currency scalar:

```go
require.Equal(t, CurrencyAmounts{"CNY": 10, "USD": 10}, stats.TodayAmount)
require.Equal(t, CurrencyAmounts{"CNY": 15, "USD": 10}, stats.TotalAmount)
```

**Step 2: Verify RED**

Run:

```bash
cd backend && go test -tags=unit ./internal/service -run 'TestComputeBasicStatsGroupsAmountsByCurrency|TestPaymentDashboardBreakdownsGroupAmountsAndRankingsByCurrency' -count=1
```

Expected: FAIL because dashboard amount fields are scalar `float64` values.

**Step 3: Apply the tested upstream implementation**

Reuse non-test changes from upstream commit `6d99e668d`, which introduces:

```go
type CurrencyAmounts map[string]float64
```

Aggregate with `PaymentOrderCurrency(order)` and render each currency with
`Intl.NumberFormat` instead of a hard-coded currency symbol.

**Step 4: Verify GREEN**

Run the same targeted Go command and the related frontend tests/type check.

### Task 2: Stripe Wallet Configuration Validation

**Files:**
- Modify: `backend/internal/payment/provider/stripe.go`
- Test: `backend/internal/payment/provider/stripe_test.go`
- Modify: `frontend/src/components/payment/providerConfig.ts`
- Test: `frontend/src/components/payment/__tests__/providerConfig.spec.ts`
- Modify: `frontend/src/i18n/locales/zh/admin/settings.ts`
- Modify: `frontend/src/i18n/locales/en/admin/settings.ts`

**Step 1: Write failing tests**

Test missing values default to `auto`, explicit `never` is retained, and an
unknown value is rejected. Test that both admin fields expose exactly the
`auto` and `never` values.

**Step 2: Verify RED**

Run:

```bash
cd backend && go test ./internal/payment/provider -run StripeWallet -count=1
cd frontend && pnpm exec vitest run src/components/payment/__tests__/providerConfig.spec.ts
```

Expected: FAIL because wallet config and normalization do not exist.

**Step 3: Implement minimal validation and fields**

Normalize with a helper equivalent to:

```go
func normalizeStripeWalletPreference(raw string) (string, error) {
    switch strings.ToLower(strings.TrimSpace(raw)) {
    case "", "auto":
        return "auto", nil
    case "never":
        return "never", nil
    default:
        return "", fmt.Errorf("must be auto or never")
    }
}
```

Add non-sensitive select fields with `defaultValue: 'auto'`.

**Step 4: Verify GREEN**

Rerun both targeted commands.

### Task 3: Snapshot and Expose Wallet Preferences

**Files:**
- Modify: `backend/internal/service/payment_order.go`
- Modify: `backend/internal/service/payment_order_provider_snapshot.go`
- Test: `backend/internal/service/payment_order_provider_snapshot_test.go`
- Modify: `backend/internal/handler/payment_handler.go`
- Test: `backend/internal/handler/payment_handler_order_result_test.go`

**Step 1: Write failing tests**

Assert Stripe snapshots contain normalized `stripe_apple_pay` and
`stripe_google_pay`, legacy Stripe snapshots resolve to `auto`, and sanitized
Stripe order responses include only:

```json
{"stripe_wallets":{"apple_pay":"never","google_pay":"auto"}}
```

**Step 2: Verify RED**

Run targeted service and handler tests with `-tags=unit -count=1`.

**Step 3: Implement snapshot and DTO mapping**

Extend the internal snapshot parser and add a public normalized preferences
helper. Add an optional `stripe_wallets` field to `PaymentOrderResult`; omit it
for other providers.

**Step 4: Verify GREEN**

Rerun the targeted tests and the full affected Go packages.

### Task 4: Apply Preferences to Stripe Payment Element

**Files:**
- Modify: `frontend/src/types/payment.ts`
- Modify: `frontend/src/views/user/StripePaymentView.vue`
- Test: `frontend/src/views/user/__tests__/StripePaymentView.spec.ts`

**Step 1: Write the failing component test**

Return a Stripe order with `apple_pay: 'never'` and `google_pay: 'auto'`, then
assert:

```ts
expect(stripeElements.create).toHaveBeenCalledWith('payment', expect.objectContaining({
  wallets: { applePay: 'never', googlePay: 'auto' },
}))
```

**Step 2: Verify RED**

Run:

```bash
cd frontend && pnpm exec vitest run src/views/user/__tests__/StripePaymentView.spec.ts
```

Expected: FAIL because `wallets` is not supplied.

**Step 3: Implement minimal mapping**

Normalize the order DTO values and pass the camel-case object to
`elements.create('payment', options)` while preserving layout and method order.

**Step 4: Verify GREEN**

Rerun the component test, payment-related frontend tests, type check, and build.

### Task 5: Acceptance and First Squash Push

**Files:**
- No planned production changes.

**Step 1: Run acceptance gates**

Run targeted coverage, full affected unit packages, frontend coverage, critical
tests, lint checks, and builds. Run integration/E2E commands when their required
services are available and record any exact environment blocker.

**Step 2: Inspect the complete custom diff**

Confirm no unrelated working-tree files are included and all existing custom
features remain present.

**Step 3: Back up and squash**

Create a timestamped `backup/custom_main-before-squash-*` ref. Soft-reset
`custom_main` to its merge base with `origin/main`, create one custom commit,
then push with `--force-with-lease`.

### Task 6: Rebase onto Current Main and Final Push

**Files:**
- Conflict-dependent; preserve custom behavior in every resolution.

**Step 1: Fast-forward local main**

Update `main` from `origin/main` without creating a merge commit.

**Step 2: Rebase custom_main**

Rebase the squashed custom commit onto `origin/main`. Expect the dashboard patch
to be recognized as upstream-equivalent; manually inspect rather than blindly
retaining a duplicate.

**Step 3: Run fresh full verification**

Repeat the acceptance commands on the rebased tree and inspect the final diff
against `origin/main`.

**Step 4: Final force push with lease**

Push the rebased `custom_main`, verify the remote commit ID, and restore any
temporary GitHub credential selection.
