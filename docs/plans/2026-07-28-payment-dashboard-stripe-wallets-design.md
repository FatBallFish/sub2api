# Payment Dashboard Currency and Stripe Wallets Design

## Context

The legacy admin payment dashboard adds every completed order's `pay_amount`
even when the orders use different currencies. The payment order schema stores
the amount paid by the user and a provider snapshot containing the payment
currency, but it does not store the provider's net settlement after fees.

Stripe's documentation also distinguishes wallets from PaymentIntent payment
method types. Apple Pay and Google Pay have no independent PaymentIntent API
enum. They are presented when `card` is enabled and the browser/account is
eligible. Payment Element controls them with `wallets.applePay` and
`wallets.googlePay`, whose values are `auto` or `never`.

## Decisions

### Revenue reporting

Report `pay_amount` grouped by the order's snapshotted ISO 4217 payment
currency. Apply the same rule to today/total/average cards, daily series,
payment-method distributions, and top-user rankings.

Do not convert all revenue to USD. The configured exchange-rate list is not a
complete historical FX source, and the database does not contain net settlement
or provider fee data. A single converted total would therefore imply precision
the system cannot support.

Remote `main` already contains this behavior in commit `6d99e668d`. Reuse that
tested implementation before the requested squash; the later rebase onto
`origin/main` can drop the duplicate patch while preserving the behavior.

### Stripe wallet configuration

Add two Stripe provider config fields:

- `applePay`: `auto` or `never`, default `auto`
- `googlePay`: `auto` or `never`, default `auto`

These are provider configuration values, not entries in `supported_types` and
not values sent to `payment_method_types`. `card` remains the underlying Stripe
payment method.

Validate the values in the Stripe provider constructor so API callers cannot
persist an enabled malformed Stripe instance. Missing values normalize to
`auto` for backward compatibility.

## Data Flow

1. The admin edits `applePay` and `googlePay` in the existing Stripe provider
   dialog.
2. The backend encrypts and stores them with the other provider configuration.
3. Order creation copies the normalized non-sensitive preferences into the
   order's provider snapshot.
4. The authenticated order response exposes the snapshot as
   `stripe_wallets.apple_pay` and `stripe_wallets.google_pay` only for Stripe
   orders.
5. `StripePaymentView` maps those values to Payment Element's camel-case
   `wallets.applePay` and `wallets.googlePay` options.

Snapshotting keeps a pending order's checkout behavior stable if an admin edits
the provider later. Legacy Stripe orders without the fields resolve to
`auto`/`auto`.

## Error Handling

- Reject any non-empty wallet preference other than `auto` or `never` during
  Stripe provider validation.
- Do not expose secrets or the complete provider config in order responses.
- Non-Stripe orders omit `stripe_wallets`.
- The frontend defensively normalizes missing or unknown response values to
  `auto`.

## Testing

- Backend unit tests cover valid/default/invalid wallet preferences, snapshot
  persistence, sanitized order DTOs, and mixed-currency dashboard aggregation.
- Frontend unit tests cover the provider field definitions and the exact
  Payment Element `wallets` options.
- Existing payment service tests, frontend critical tests, type checking, and
  builds provide regression coverage.
- Browser E2E is run when the repository's available environment can start the
  required services; otherwise the exact blocker is reported.

## Git Integration

After both requirements pass verification, create a backup ref, squash every
commit after the `custom_main`/`main` merge base into one custom commit, and
force-push with `--force-with-lease`. Then fast-forward local `main` to
`origin/main`, rebase the squashed `custom_main` onto it, resolve conflicts while
preserving custom behavior, rerun verification, and force-push with lease again.
