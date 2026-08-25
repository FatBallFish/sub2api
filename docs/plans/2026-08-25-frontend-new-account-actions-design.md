# New Frontend Account Actions Design

## Goal

Restore three user-facing account actions in `frontend-new`: password visibility controls on login and registration, affiliate credit transfer, and the complete user redemption-code workflow.

## Scope

- Add an accessible icon button to both password fields in `Auth.tsx`. It toggles between masked and plain text without changing the field value, focus, validation, or submit behavior.
- Add a transfer-to-balance action to the referral page. It transfers all currently available affiliate rewards through the existing endpoint and refreshes referral state after success.
- Add a `/console/redeem` page and navigation item. The page includes code redemption, result feedback, redemption history, current balance/concurrency context, and the four legacy "About redemption codes" rules.
- Add English, Simplified Chinese, Traditional Chinese, and Japanese copy for all new visible and accessible text.
- Keep backend routes and persistence unchanged.

## Architecture And Data Flow

The UI will use the existing React, React Router, i18next, Phosphor Icons, and API-client conventions in `frontend-new`.

Affiliate transfer uses `POST /api/v1/user/aff/transfer`. The button is disabled while no rewards are available or while a transfer is running. On success, the page shows the transferred amount and returned balance, then reloads `/console/referral`. API failures use the existing localized error pipeline while retaining useful backend messages.

Redemption uses `POST /api/v1/redeem` with `{ code }` and loads history from `GET /api/v1/redeem/history`. A successful redemption clears the input, displays type-specific details, and refreshes history. Balance and concurrency context come from console bootstrap via the existing layout outlet context so the page does not introduce a duplicate bootstrap request.

## Interface Design

The additions follow the new console's quiet, work-focused visual language. Password controls are compact icon-only buttons inside the field with translated accessible labels. Referral transfer is a clear command beside available rewards rather than a separate nested panel. The redemption page uses unframed page sections and restrained bordered surfaces for the form, outcome, explanatory rules, and activity list.

History preserves all legacy record distinctions: balance, concurrency, subscription, administrator balance adjustment, and administrator concurrency adjustment. Unknown types fall back to a localized unknown label without hiding the underlying value.

## Error And Empty States

- Password visibility is local UI state and does not alter form errors.
- Transfer errors appear inline; repeat clicks are blocked while pending.
- Redemption rejects blank input client-side, preserves API error detail, and allows retry.
- History has explicit loading, load-error, populated, and empty states.
- Missing contact information simply omits the contact badge from the redemption-code guidance.

## Testing

Component tests cover both auth modes, transfer disabled/success/error states, redemption request payloads, success/error results, history rendering, and empty/loading states. API tests verify methods, paths, payloads, and response typing. Router/layout tests verify the new menu and route. Static i18n tests continue to enforce complete locale resources.
