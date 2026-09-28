# New Frontend Agreement and Model Pricing Design

## Scope

Bring `frontend-new` to parity with the classic frontend for login agreement consent, configured legal documents, user-specific group multipliers, model availability, and non-token pricing.

## Design

- Treat `/settings/public` as the only source for login agreement state and documents. Consent is stored with `login_agreement_revision`; a revision change invalidates prior consent. Checkbox and modal modes gate email login, registration, and OAuth.
- Show `/privacy`, `/terms`, footer links, and dynamic `/legal/:documentId` pages only when the agreement feature is enabled and the requested configured document has content. Unavailable legal routes redirect home.
- Overlay `/groups/rates` on available groups and existing API key summaries. Console model pricing applies the same user rates in the backend so displayed prices match billing.
- Use the existing gateway model availability diagnosis for every configured group/model pair. Unsupported models remain visible without calculated prices, while groups supporting none of the configured models are removed from selection.
- Preserve token pricing fields for token models. Image and per-request models return `billing_mode` plus structured `request_prices`, and the frontend renders their parameter tiers separately from token input/output/cache pricing.

## Failure Behavior

- Public settings failures do not invent legal content or consent requirements.
- User-rate lookup failures fall back to default group multipliers and are logged.
- Availability lookup failures retain the existing fail-open behavior to avoid hiding valid models because of an internal lookup error.

## Verification

- Backend unit tests cover custom multipliers, unsupported combinations, group filtering, and image tier prices.
- Frontend tests cover agreement revision/modes, legal route/footer visibility, effective API key rates, unsupported rows, and per-request rendering.
- Run the full `frontend-new` test/build/lint suite and relevant backend service/server tests before commit.
