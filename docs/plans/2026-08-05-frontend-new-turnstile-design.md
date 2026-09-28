# Frontend New Turnstile Design

## Goal

Add Cloudflare Turnstile verification to the new React frontend's password login, email registration, and Google/GitHub new-user registration flows while preserving the established behavior of the classic Vue frontend.

## Scope

- Password login in `frontend-new`.
- Direct email registration with and without email verification enabled.
- Google and GitHub OAuth completion for new users.
- Public Turnstile configuration exposed by the existing settings endpoint.
- Focused component, page, and API tests plus full frontend verification.

Existing-user OAuth login remains unchanged. The backend Turnstile service and public settings response already provide the required server-side behavior and configuration.

## Architecture

Create a reusable React `TurnstileWidget` component for all authentication surfaces. The component loads the Cloudflare Turnstile script only when mounted, renders one widget with the public site key, reports verified, expired, and error states to its parent, and exposes an imperative `reset()` method. It removes its rendered widget during unmount and shares a single script-loading promise across instances.

Extend the new frontend's `PublicSettings` type with `turnstile_enabled` and `turnstile_site_key`. Pages render the widget only when Turnstile is enabled and a site key is available. This retains the current compatible behavior when public settings fail to load; the server remains the final enforcement point.

The existing login and registration API request types already accept `turnstile_token`. Add new frontend API helpers for the existing generic pending OAuth endpoints:

- `POST /auth/oauth/pending/send-verify-code`
- `POST /auth/oauth/pending/create-account`

No backend changes are required.

## Authentication Flows

### Password Login

When Turnstile is enabled, the submit button remains disabled until the widget returns a token. The login request includes `turnstile_token`. Any login failure clears the token and resets the widget because a challenge token must not be reused.

When Turnstile is disabled, the existing request body and interaction remain unchanged.

### Email Registration With Email Verification

The initial registration form renders Turnstile when enabled. Sending the email verification code requires a valid challenge token and sends it to `/auth/send-verify-code`. After a successful send, the widget and token are reset immediately because the token has been consumed.

The final `/auth/register` request includes the email verification code but does not reuse the Turnstile token. The backend intentionally avoids duplicate Turnstile verification after the protected code-send step.

### Email Registration Without Email Verification

The registration form requires a valid Turnstile token when enabled and sends it directly in the `/auth/register` request. A failed registration resets the widget and token.

### Google And GitHub New-User Registration

If email verification is enabled, an upstream-verified Google or GitHub email does not bypass the application's email verification policy. The completion view renders the resolved email, password fields, invitation code when required, Turnstile, a verification-code field, and a send-code action.

The send-code action requires Turnstile and calls `/auth/oauth/pending/send-verify-code`. A successful send resets the widget. Final account creation calls `/auth/oauth/pending/create-account` with the resolved email, password, email verification code, and invitation code. This matches the classic frontend's generic pending OAuth create-account flow.

If email verification is disabled, the current provider-specific Google/GitHub completion endpoint remains in use. Existing-user OAuth login continues to exchange the pending session and issue tokens without displaying registration controls.

## State And Error Handling

Each page owns the current Turnstile token and a widget ref. Verification clears any prior Turnstile error. Expiration or widget failure clears the token, reports a specific user-facing error, and prevents protected submission.

Buttons remain disabled while a request is in flight. Missing Turnstile verification is represented by disabled protected actions and is also checked in submit handlers. Successful one-time operations and authentication failures reset consumed or potentially consumed challenge tokens.

Switching between login and registration clears the active Turnstile token and resets the widget so a token from one operation cannot be submitted to another.

## Testing

Component tests cover singleton script loading, widget rendering, verify/expire/error callbacks, imperative reset, and cleanup.

Authentication page tests cover:

- Turnstile-gated password login and token submission.
- Widget reset after login failure.
- Token use and reset when sending a registration verification code.
- Direct registration token submission when email verification is disabled.
- Unchanged request bodies and behavior when Turnstile is disabled.

OAuth callback tests cover:

- The pending send-code and create-account endpoints when email verification is enabled.
- Turnstile gating and reset after sending a code.
- The existing provider-specific completion endpoint when email verification is disabled.
- Unchanged existing-user OAuth token exchange.

Verification consists of focused Vitest runs, the complete `frontend-new` test suite, lint, a production build, and `git diff --check`.

## Acceptance Criteria

- All three new-frontend authentication surfaces honor the public Turnstile settings.
- A Turnstile token is never reused after successful code sending or a failed authentication attempt.
- Google/GitHub new users complete application-level email verification when it is enabled.
- Existing invitation-code, affiliate-code, promo-code, registration-disabled, and OAuth login behavior remains intact.
- Turnstile-disabled deployments retain their current behavior.
