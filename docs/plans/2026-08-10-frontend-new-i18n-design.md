# New Frontend Internationalization Design

## Goal

Add complete internationalization support to `frontend-new` for English, Simplified Chinese, Traditional Chinese, and Japanese. Users can switch languages from the top-right of every frontend flow. The browser remembers the choice and restores it on later visits.

The implementation covers frontend-owned static copy. Backend-configurable content, including announcements, plan names, group names, model names, custom document titles, and Markdown bodies, remains unchanged.

## Locale Behavior

Supported locale identifiers are:

- `en`
- `zh-CN`
- `zh-TW`
- `ja`

Locale selection follows this precedence:

1. A valid value stored under `sub2api.frontend.locale.v1`.
2. The browser locale on a user's first visit.
3. English when the browser locale is unsupported.

Browser locale normalization maps `zh-CN` and `zh-SG` to Simplified Chinese, `zh-TW`, `zh-HK`, and `zh-MO` to Traditional Chinese, and all `ja-*` variants to Japanese. Invalid persisted values are ignored.

Changing the locale applies immediately without navigation or a page reload, persists the selection when storage is available, and updates both `document.documentElement.lang` and localized browser-facing metadata such as `document.title`. Storage failures do not prevent the application from rendering.

## Architecture

Use `i18next` with `react-i18next` at the application root. This provides established fallback, interpolation, pluralization, and testing behavior without maintaining a custom translation runtime.

Translation resources are split into focused namespaces such as `common`, `public`, `auth`, `console`, and `errors`. Every locale has the same key structure, and missing translations fall back to English.

A reusable `LanguageSwitcher` renders a globe icon and a menu with language names in their native form:

- English
- 简体中文
- 繁體中文
- 日本語

The switcher appears in the public navigation, console top bar, authentication screen, and standalone payment, OAuth callback, loading, error, and blocked-region flows where no shared layout is present. Responsive layouts retain an accessible icon-only trigger when horizontal space is limited. The selected language has an explicit checked state, and trigger/menu labels are localized for assistive technology.

## Translation Scope

All frontend-owned visible and accessibility copy is translated, including:

- Navigation labels, headings, content, form labels, placeholders, and buttons.
- Loading, empty, success, validation, and fallback error states.
- Modal copy, tooltips, pagination, table labels, and accessibility labels.
- Public, authentication, payment, OAuth callback, console, and region-blocked pages.
- Dates, numbers, and currency presentation, while preserving business values and currency codes.

Backend-provided data is never passed through the static translation catalog. This includes administrator-authored content and any names or descriptions configurable through the backend.

## Legal Document Titles

The four built-in agreement identifiers receive localized display names:

- `terms`
- `usage-policy`
- `supported-regions`
- `service-specific-terms`

The localized display name is used consistently in the login consent checkbox, login agreement modal, public footer links, and legal document page heading. The backend title is not modified. Unknown or custom document identifiers retain their configured backend title. Document Markdown always remains backend-provided content.

## Localized API Errors

The API client normalizes stable error identifiers from the response `reason`, string `code`, `error_code`, and supported nested error objects. `ApiError` retains the normalized identifier, HTTP status, raw message, and payload.

A shared localized error resolver is used by current inline errors and any future Toast surface. It resolves messages in this order:

1. A translation for the normalized business error identifier.
2. A localized fallback key supplied by the calling workflow.
3. The original backend message when no reliable localized alternative exists.

Known authentication, registration, payment, API key, and other common frontend operation codes receive translations in all four locales. HTTP status alone is not treated as a semantic business error because different failures can share the same status. Endpoints without a stable business error identifier therefore keep useful backend detail rather than displaying an inaccurate generic translation.

## Failure Handling

- Unsupported or malformed locale values fall back through browser detection to English.
- Unavailable browser storage is treated as non-fatal.
- Missing translation keys fall back to English and remain detectable in tests.
- Unknown API error identifiers preserve the original backend message.
- Locale changes update third-party captcha language inputs through the synchronized HTML language attribute.

## Testing And Acceptance

Automated coverage includes:

- Browser locale normalization, fallback, persistence, and reload restoration.
- Runtime switching across all four locales and `<html lang>` synchronization.
- Language switcher behavior in public, authentication, console, and standalone layouts.
- Translation resource key parity and representative fixed-copy coverage for every page.
- Localized built-in agreement titles in all four locales and preservation of custom titles.
- Known API error identifier translation and unknown-error fallback behavior.
- Localized dates, numbers, currency, page titles, tooltips, and accessibility labels.
- A practical static check that catches newly introduced hardcoded user-facing copy while allowing backend dynamic content and non-UI constants.

Verification consists of the complete `frontend-new` Vitest suite, ESLint, TypeScript and Vite production build, followed by browser checks at desktop and mobile widths for public, authentication, and console language menus and representative localized pages.
