# Frontend New Turnstile Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add Cloudflare Turnstile protection to the new React frontend's password login, email registration, and Google/GitHub new-user registration flows.

**Architecture:** Introduce one reusable, lazily loaded React Turnstile component and let each authentication page own its token and reset lifecycle. Reuse the backend's generic pending OAuth send-code and create-account endpoints when email verification is enabled, while preserving provider-specific completion when it is disabled.

**Tech Stack:** React 19, TypeScript 6, Vite 8, Vitest 4, Testing Library, Cloudflare Turnstile explicit-render API.

---

### Task 1: Reusable Turnstile Widget

**Files:**
- Create: `frontend-new/src/components/auth/TurnstileWidget.tsx`
- Create: `frontend-new/src/components/auth/TurnstileWidget.test.tsx`

**Step 1: Write the failing component tests**

Cover these observable behaviors with a mocked `window.turnstile` API:

```tsx
const turnstile = {
  render: vi.fn((_container, options) => {
    renderOptions = options;
    return "widget-1";
  }),
  reset: vi.fn(),
  remove: vi.fn(),
};

render(<TurnstileWidget ref={ref} siteKey="site-key" onVerify={onVerify} onExpire={onExpire} onError={onError} />);
expect(turnstile.render).toHaveBeenCalledWith(expect.any(HTMLElement), expect.objectContaining({
  sitekey: "site-key",
  theme: "auto",
  size: "flexible",
}));

act(() => renderOptions.callback("verified-token"));
expect(onVerify).toHaveBeenCalledWith("verified-token");

act(() => ref.current?.reset());
expect(turnstile.reset).toHaveBeenCalledWith("widget-1");
```

Also verify that two mounted widgets append only one Cloudflare script, script load failure calls `onError`, expired/error callbacks reach the parent, and unmount calls `remove("widget-1")`.

**Step 2: Run the test to verify RED**

Run:

```bash
cd frontend-new
npm test -- src/components/auth/TurnstileWidget.test.tsx
```

Expected: FAIL because `TurnstileWidget.tsx` does not exist.

**Step 3: Implement the minimal widget**

Define the explicit-render contract locally and augment `Window`:

```tsx
export interface TurnstileWidgetHandle {
  reset(): void;
}

interface TurnstileRenderOptions {
  sitekey: string;
  callback(token: string): void;
  "expired-callback"(): void;
  "error-callback"(): void;
  theme: "light" | "dark" | "auto";
  size: "normal" | "compact" | "flexible";
}
```

Use a module-scoped promise for `https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit`. Resolve immediately when `window.turnstile` already exists; otherwise reuse a script identified by a stable DOM id and resolve/reject from its load/error events.

Implement the component with `forwardRef`, `useImperativeHandle`, and a container ref. Store callbacks in refs so parent renders do not recreate the Cloudflare widget. Render with `theme="auto"` and `size="flexible"`, remove the widget on unmount or site-key replacement, and call `onError` when script initialization fails.

**Step 4: Run the component tests to verify GREEN**

Run:

```bash
npm test -- src/components/auth/TurnstileWidget.test.tsx
```

Expected: all widget tests PASS.

**Step 5: Commit**

```bash
git add frontend-new/src/components/auth/TurnstileWidget.tsx frontend-new/src/components/auth/TurnstileWidget.test.tsx
git commit -m "feat: add reusable Turnstile widget"
```

### Task 2: Authentication API Contracts And OAuth Referral Context

**Files:**
- Modify: `frontend-new/src/api/settings.ts`
- Modify: `frontend-new/src/api/auth.ts`
- Modify: `frontend-new/src/api/auth.test.ts`

**Step 1: Write failing API tests**

Add tests proving that:

```ts
await sendPendingOAuthVerifyCode("oauth@example.com", "challenge-token");
expect(fetchMock).toHaveBeenCalledWith(
  "/api/v1/auth/oauth/pending/send-verify-code",
  expect.objectContaining({
    method: "POST",
    body: JSON.stringify({ email: "oauth@example.com", turnstile_token: "challenge-token" }),
  }),
);

await createPendingOAuthAccount({
  email: "oauth@example.com",
  password: "secret123",
  verify_code: "123456",
  invitation_code: "INVITE",
  aff_code: "AFF123",
});
```

Assert the latter posts to `/api/v1/auth/oauth/pending/create-account` and persists returned auth tokens. Extend the existing OAuth-start test to assert that a trimmed affiliate code is saved in `sessionStorage`, and expose helpers to read and clear that value after OAuth completion.

**Step 2: Run the API tests to verify RED**

Run:

```bash
npm test -- src/api/auth.test.ts
```

Expected: FAIL because the pending OAuth API helpers and affiliate context helpers do not exist.

**Step 3: Implement the API contracts**

Add these public settings fields:

```ts
turnstile_enabled?: boolean;
turnstile_site_key?: string;
```

Add a `CreatePendingOAuthAccountRequest` matching the backend request and API helpers:

```ts
export function sendPendingOAuthVerifyCode(email: string, turnstileToken?: string) {
  return postJSON<SendVerifyCodeResponse>("/auth/oauth/pending/send-verify-code", {
    email,
    turnstile_token: turnstileToken,
  });
}

export async function createPendingOAuthAccount(request: CreatePendingOAuthAccountRequest) {
  const response = await postJSON<AuthResponse>("/auth/oauth/pending/create-account", request);
  persistAuth(response);
  return response;
}
```

Store only the normalized OAuth affiliate code under a dedicated `sessionStorage` key in `startOAuth`. Provide read and clear helpers; ignore storage exceptions so private-mode storage failures cannot block OAuth.

**Step 4: Run the API tests to verify GREEN**

Run:

```bash
npm test -- src/api/auth.test.ts
```

Expected: all auth API tests PASS.

**Step 5: Commit**

```bash
git add frontend-new/src/api/settings.ts frontend-new/src/api/auth.ts frontend-new/src/api/auth.test.ts
git commit -m "feat: add pending OAuth registration APIs"
```

### Task 3: Password Login And Email Registration

**Files:**
- Modify: `frontend-new/src/pages/public/Auth.tsx`
- Modify: `frontend-new/src/pages/public/Auth.test.tsx`

**Step 1: Write failing page tests**

Add a small Turnstile test harness by mocking the widget module and exposing its callbacks/reset spy. Test these cases:

- Public settings enable Turnstile with `turnstile_site_key: "site-key"`; login is disabled before verification, then submits `turnstile_token: "login-token"`.
- A rejected login resets the widget and requires a new token.
- Registration with email verification sends its token to `/auth/send-verify-code` and resets after success; final registration contains `verify_code` but no Turnstile token.
- Registration without email verification submits its token directly to `/auth/register` and resets after a rejected request.
- Existing Turnstile-disabled tests retain their exact request bodies.

**Step 2: Run the page tests to verify RED**

Run:

```bash
npm test -- src/pages/public/Auth.test.tsx
```

Expected: new tests FAIL because the page does not render or submit Turnstile.

**Step 3: Implement page-owned Turnstile state**

Add `turnstileToken`, `turnstileRef`, and an effective requirement derived from both public fields:

```tsx
const turnstileRequired = settings?.turnstile_enabled === true && Boolean(settings.turnstile_site_key);
```

Render the widget in the active login form and initial registration form. On verify, save the token and clear prior errors. On expiration or widget failure, clear it and show `Human verification expired. Please try again.` or `Human verification failed. Please try again.`

Guard handlers as well as buttons. Pass the token to `login`, `sendVerifyCode`, or direct `register` according to the approved data flow. Reset after login/direct-registration failures and after every successful verification-code send. Clear/reset when switching login/register modes.

Do not render Turnstile on the final email-code form because its token was already consumed by the code-send endpoint.

**Step 4: Run the page tests to verify GREEN**

Run:

```bash
npm test -- src/pages/public/Auth.test.tsx
```

Expected: all authentication page tests PASS, including invitation and referral regressions.

**Step 5: Commit**

```bash
git add frontend-new/src/pages/public/Auth.tsx frontend-new/src/pages/public/Auth.test.tsx
git commit -m "feat: protect new login and registration with Turnstile"
```

### Task 4: Google And GitHub Pending Registration

**Files:**
- Modify: `frontend-new/src/pages/public/OAuthCallback.tsx`
- Modify: `frontend-new/src/pages/public/OAuthCallback.test.tsx`

**Step 1: Write failing OAuth callback tests**

Mock public settings and the Turnstile widget. Add tests for:

- With email verification and Turnstile enabled, the completion form shows the widget, verification-code input, and send-code button.
- Send-code stays disabled until Turnstile verifies, posts the resolved email and token to `/auth/oauth/pending/send-verify-code`, then resets the widget.
- Final submission posts email, password, `verify_code`, invitation code, and the stored affiliate code to `/auth/oauth/pending/create-account`.
- Successful completion clears the stored OAuth affiliate code, persists tokens, and redirects.
- With email verification disabled, the existing `/auth/oauth/{provider}/complete-registration` request remains unchanged and no verification-code controls appear.
- Existing-user token exchange and invalid callback fragments do not fetch or render Turnstile unnecessarily.

**Step 2: Run the OAuth tests to verify RED**

Run:

```bash
npm test -- src/pages/public/OAuthCallback.test.tsx
```

Expected: new tests FAIL because the callback only uses provider-specific completion.

**Step 3: Implement the approved OAuth flow**

After an exchange response requests registration completion, load public settings. Preserve the classic frontend fallback of email verification enabled and Turnstile disabled if settings loading fails.

Add verification-code, code-sending, settings, status, and Turnstile state. When email verification is enabled:

```tsx
await sendPendingOAuthVerifyCode(email, turnstileToken);
turnstileRef.current?.reset();
setTurnstileToken("");

const response = await createPendingOAuthAccount({
  email,
  password,
  verify_code: verifyCode.trim(),
  invitation_code: inviteCode.trim() || undefined,
  aff_code: readOAuthAffiliateCode() || undefined,
});
```

When email verification is disabled, continue calling `completeOAuthRegistration`. Clear the stored affiliate context only after a token response succeeds. Retain the resolved email as read-only and preserve invitation-code requirements.

**Step 4: Run the OAuth tests to verify GREEN**

Run:

```bash
npm test -- src/pages/public/OAuthCallback.test.tsx
```

Expected: all OAuth callback tests PASS.

**Step 5: Commit**

```bash
git add frontend-new/src/pages/public/OAuthCallback.tsx frontend-new/src/pages/public/OAuthCallback.test.tsx
git commit -m "feat: verify pending OAuth registrations"
```

### Task 5: Full Verification And Branch Delivery

**Files:**
- Modify only if verification exposes an issue in the files above.

**Step 1: Run all focused authentication tests**

```bash
cd frontend-new
npm test -- src/components/auth/TurnstileWidget.test.tsx src/api/auth.test.ts src/pages/public/Auth.test.tsx src/pages/public/OAuthCallback.test.tsx
```

Expected: all focused tests PASS.

**Step 2: Run the complete frontend test suite**

```bash
npm test
```

Expected: all tests PASS with no unhandled errors.

**Step 3: Run lint and the production build**

```bash
npm run lint
npm run build
```

Expected: both commands exit 0.

**Step 4: Check repository integrity and custom behavior**

```bash
cd ..
git diff --check
git status --short
git log --oneline origin/main..HEAD
```

Inspect the final diff to confirm the custom frontend's invitation code, affiliate code, promo code, registration-disabled state, and Google/GitHub provider selection remain present.

**Step 5: Consolidate only if history needs cleanup, then push**

Keep the design commit and focused implementation commits unless an intermediate commit is broken or redundant. Push the verified `custom_main` branch:

```bash
git push origin custom_main
```

Expected: push succeeds and `git status --short --branch` reports `custom_main...origin/custom_main` with no divergence.
