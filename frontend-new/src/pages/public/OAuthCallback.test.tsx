import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import OAuthCallback from "./OAuthCallback";

interface TurnstileHarnessProps {
  siteKey: string;
  onVerify: (token: string) => void;
  onExpire?: () => void;
  onError?: (error?: string | Error) => void;
}

const turnstileHarness = vi.hoisted(() => ({
  props: null as TurnstileHarnessProps | null,
  reset: vi.fn(),
}));

const tencentHarness = vi.hoisted(() => ({
  verify: vi.fn(),
  reset: vi.fn(),
}));

const aliyunHarness = vi.hoisted(() => ({
  verify: vi.fn(),
  reset: vi.fn(),
}));

vi.mock("../../components/auth/TurnstileWidget", async () => {
  const React = await import("react");

  return {
    default: React.forwardRef(function MockTurnstileWidget(
      props: TurnstileHarnessProps,
      ref: React.ForwardedRef<{ reset(): void }>,
    ) {
      turnstileHarness.props = props;
      React.useImperativeHandle(ref, () => ({ reset: turnstileHarness.reset }));
      return React.createElement("div", {
        role: "group",
        "aria-label": "Security verification",
      });
    }),
  };
});

vi.mock("../../components/auth/TencentCaptchaWidget", async () => {
  const React = await import("react");
  return {
    default: React.forwardRef(function MockTencentCaptchaWidget(
      _props: { appId: string },
      ref: React.ForwardedRef<{ verify(): Promise<unknown>; reset(): void }>,
    ) {
      React.useImperativeHandle(ref, () => ({
        verify: tencentHarness.verify,
        reset: tencentHarness.reset,
      }));
      return null;
    }),
  };
});

vi.mock("../../components/auth/AliyunCaptchaWidget", async () => {
  const React = await import("react");
  return {
    default: React.forwardRef(function MockAliyunCaptchaWidget(
      _props: { sceneId: string; prefix: string },
      ref: React.ForwardedRef<{ verify(): Promise<unknown>; reset(): void }>,
    ) {
      React.useImperativeHandle(ref, () => ({
        verify: aliyunHarness.verify,
        reset: aliyunHarness.reset,
      }));
      return React.createElement("div", { "data-testid": "aliyun-captcha" });
    }),
  };
});

const originalFetch = globalThis.fetch;

function response(data: unknown, ok = true, status = ok ? 200 : 400) {
  return {
    ok,
    status,
    json: async () => ok
      ? { success: true, data }
      : { success: false, message: data },
  };
}

function pendingCompletion(overrides: Record<string, unknown> = {}) {
  return response({
    error: "registration_completion_required",
    provider: "google",
    redirect: "/console",
    resolved_email: "new@example.com",
    invitation_required: false,
    ...overrides,
  });
}

function renderCallback(initialEntry = "/auth/oauth/callback") {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/auth/oauth/callback" element={<OAuthCallback />} />
        <Route path="/auth/callback" element={<OAuthCallback />} />
        <Route path="/console" element={<div>Console landed</div>} />
        <Route path="/reports" element={<div>Reports landed</div>} />
        <Route path="/login" element={<div>Login page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

async function fillPasswords(password = "secret123") {
  fireEvent.change(await screen.findByLabelText("Password"), { target: { value: password } });
  fireEvent.change(screen.getByLabelText("Confirm Password"), { target: { value: password } });
}

describe("OAuthCallback", () => {
  const originalHash = window.location.hash;

  beforeEach(() => {
    vi.useRealTimers();
    localStorage.clear();
    sessionStorage.clear();
    turnstileHarness.props = null;
    turnstileHarness.reset.mockReset();
    tencentHarness.verify.mockReset();
    tencentHarness.reset.mockReset();
    aliyunHarness.verify.mockReset();
    aliyunHarness.reset.mockReset();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    localStorage.clear();
    sessionStorage.clear();
    window.location.hash = originalHash;
    turnstileHarness.props = null;
    turnstileHarness.reset.mockReset();
    tencentHarness.verify.mockReset();
    tencentHarness.reset.mockReset();
    aliyunHarness.verify.mockReset();
    aliyunHarness.reset.mockReset();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("completes a fragment token without loading settings and clears the OAuth affiliate code", async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock;
    sessionStorage.setItem("oauth_aff_code", "AFF-FRAGMENT");
    window.location.hash =
      "#access_token=access-token&refresh_token=refresh-token&expires_in=3600&token_type=Bearer&redirect=%252Freports";

    renderCallback();

    expect(await screen.findByText("Reports landed")).toBeInTheDocument();
    expect(localStorage.getItem("auth_token")).toBe("access-token");
    expect(localStorage.getItem("refresh_token")).toBe("refresh-token");
    expect(sessionStorage.getItem("oauth_aff_code")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("completes an existing-user exchange without loading settings and sanitizes the redirect", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(response({
      access_token: "existing-access",
      refresh_token: "existing-refresh",
      expires_in: 3600,
      redirect: "https://evil.example/steal",
    }));
    globalThis.fetch = fetchMock;
    sessionStorage.setItem("oauth_aff_code", "AFF-EXISTING");

    renderCallback();

    expect(await screen.findByText("Console landed")).toBeInTheDocument();
    expect(localStorage.getItem("auth_token")).toBe("existing-access");
    expect(sessionStorage.getItem("oauth_aff_code")).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/auth/oauth/pending/exchange",
      expect.any(Object),
    );
  });

  it("does not persist a deferred exchange token after the callback unmounts", async () => {
    let resolveExchange!: (value: ReturnType<typeof response>) => void;
    const exchangePromise = new Promise<ReturnType<typeof response>>((resolve) => {
      resolveExchange = resolve;
    });
    const fetchMock = vi.fn().mockImplementationOnce(() => exchangePromise);
    globalThis.fetch = fetchMock;
    sessionStorage.setItem("oauth_aff_code", "AFF-DEFERRED");

    const { unmount } = renderCallback();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    unmount();

    await act(async () => {
      resolveExchange(response({
        access_token: "late-access",
        refresh_token: "late-refresh",
        expires_in: 3600,
        redirect: "/console",
      }));
      await exchangePromise;
    });

    expect(localStorage.getItem("auth_token")).toBeNull();
    expect(localStorage.getItem("refresh_token")).toBeNull();
    expect(sessionStorage.getItem("oauth_aff_code")).toBe("AFF-DEFERRED");
  });

  it("rejects encoded backslashes and ASCII controls in a fragment redirect", async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock;
    window.location.hash = "#access_token=safe-access&redirect=%252Fsafe%255Cevil%2509path";

    renderCallback();

    expect(await screen.findByText("Console landed")).toBeInTheDocument();
    expect(localStorage.getItem("auth_token")).toBe("safe-access");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("falls back safely when a fragment redirect contains malformed percent-encoding", async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock;
    window.location.hash = "#access_token=safe-access&redirect=%25";

    renderCallback();

    expect(await screen.findByText("Console landed")).toBeInTheDocument();
    expect(localStorage.getItem("auth_token")).toBe("safe-access");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ["missing", { resolved_email: undefined, email: undefined }],
    ["blank", { resolved_email: "   ", email: "  " }],
  ])("rejects a pending registration with a %s resolved email", async (_case, emailFields) => {
    const fetchMock = vi.fn().mockResolvedValueOnce(pendingCompletion(emailFields));
    globalThis.fetch = fetchMock;

    renderCallback();

    expect(await screen.findByRole("heading", { name: "Sign in failed" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(/email address.*unavailable/i);
    expect(screen.getByRole("link", { name: "Back to sign in" })).toHaveAttribute("href", "/login");
    expect(screen.queryByText("Complete Google signup")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /send verification code/i })).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("waits for enabled settings and gates sending a code on Turnstile", async () => {
    let resolveSettings!: (value: ReturnType<typeof response>) => void;
    const settingsPromise = new Promise<ReturnType<typeof response>>((resolve) => {
      resolveSettings = resolve;
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(pendingCompletion({
        error: "invitation_required",
        invitation_required: true,
      }))
      .mockImplementationOnce(() => settingsPromise);
    globalThis.fetch = fetchMock;

    renderCallback();

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(screen.getByText("Completing sign in")).toBeInTheDocument();
    expect(screen.queryByText("Complete Google signup")).not.toBeInTheDocument();

    await act(async () => {
      resolveSettings(response({
        email_verify_enabled: true,
        turnstile_enabled: true,
        turnstile_site_key: " oauth-site-key ",
      }));
      await settingsPromise;
    });

    expect(await screen.findByText("Complete Google signup")).toBeInTheDocument();
    expect(screen.getByDisplayValue("new@example.com")).toHaveAttribute("readonly");
    expect(screen.getByLabelText("Invite Code")).toBeInTheDocument();
    expect(screen.getByLabelText("Verification Code")).toBeInTheDocument();
    expect(screen.getByRole("group", { name: /security verification/i })).toBeInTheDocument();
    expect(turnstileHarness.props?.siteKey).toBe("oauth-site-key");
    expect(screen.getByRole("button", { name: /send verification code/i })).toBeDisabled();

    act(() => turnstileHarness.props?.onVerify("turnstile-token"));
    expect(await screen.findByRole("button", { name: /send verification code/i })).toBeEnabled();
  });

  it("sends the exact verification request, consumes and resets Turnstile, and shows the countdown", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(pendingCompletion())
      .mockResolvedValueOnce(response({
        email_verify_enabled: true,
        turnstile_enabled: true,
        turnstile_site_key: "oauth-site-key",
      }))
      .mockResolvedValueOnce(response({ message: "sent", countdown: 45 }));
    globalThis.fetch = fetchMock;

    renderCallback();

    await screen.findByRole("group", { name: /security verification/i });
    act(() => turnstileHarness.props?.onVerify("single-use-token"));
    fireEvent.click(await screen.findByRole("button", { name: /send verification code/i }));

    expect(await screen.findByRole("status")).toHaveTextContent(/code sent/i);
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "/api/v1/auth/oauth/pending/send-verify-code",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          email: "new@example.com",
          turnstile_token: "single-use-token",
        }),
      }),
    );
    expect(turnstileHarness.reset).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: /resend in 45s/i })).toBeDisabled();
  });

  it("decrements the send-code countdown and clears its interval on unmount", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(pendingCompletion())
      .mockResolvedValueOnce(response({ email_verify_enabled: true }))
      .mockResolvedValueOnce(response({ message: "sent", countdown: 45 }));
    globalThis.fetch = fetchMock;

    const { unmount } = renderCallback();
    const sendButton = await screen.findByRole("button", { name: /send verification code/i });
    vi.useFakeTimers();
    const clearIntervalSpy = vi.spyOn(window, "clearInterval");

    await act(async () => {
      fireEvent.click(sendButton);
    });

    expect(screen.getByRole("button", { name: /resend in 45s/i })).toBeDisabled();
    expect(vi.getTimerCount()).toBe(1);
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.getByRole("button", { name: /resend in 44s/i })).toBeDisabled();
    expect(vi.getTimerCount()).toBe(1);

    const clearsBeforeUnmount = clearIntervalSpy.mock.calls.length;
    unmount();

    expect(clearIntervalSpy).toHaveBeenCalledTimes(clearsBeforeUnmount + 1);
    expect(vi.getTimerCount()).toBe(0);
    act(() => vi.advanceTimersByTime(5000));
    expect(vi.getTimerCount()).toBe(0);
  });

  it("discards a Turnstile token delivered while the send request is pending", async () => {
    let resolveSend!: (value: ReturnType<typeof response>) => void;
    const pendingSend = new Promise<ReturnType<typeof response>>((resolve) => {
      resolveSend = resolve;
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(pendingCompletion())
      .mockResolvedValueOnce(response({
        email_verify_enabled: true,
        turnstile_enabled: true,
        turnstile_site_key: "oauth-site-key",
      }))
      .mockImplementationOnce(() => pendingSend);
    globalThis.fetch = fetchMock;

    renderCallback();

    await screen.findByRole("group", { name: /security verification/i });
    act(() => turnstileHarness.props?.onVerify("request-token"));
    const sendButton = await screen.findByRole("button", { name: /send verification code/i });
    fireEvent.click(sendButton);
    act(() => turnstileHarness.props?.onVerify("late-token"));

    await act(async () => {
      resolveSend(response({ message: "sent", countdown: 0 }));
      await pendingSend;
    });

    expect(await screen.findByRole("status")).toHaveTextContent(/code sent/i);
    expect(turnstileHarness.reset).toHaveBeenCalledTimes(1);
    expect(sendButton).toBeDisabled();
  });

  it("keeps sending gated after a rejected code request until Turnstile verifies again", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(pendingCompletion())
      .mockResolvedValueOnce(response({
        email_verify_enabled: true,
        turnstile_enabled: true,
        turnstile_site_key: "oauth-site-key",
      }))
      .mockResolvedValueOnce(response("Unable to send verification code", false));
    globalThis.fetch = fetchMock;

    renderCallback();

    await screen.findByRole("group", { name: /security verification/i });
    act(() => turnstileHarness.props?.onVerify("rejected-token"));
    const sendButton = await screen.findByRole("button", { name: /send verification code/i });
    fireEvent.click(sendButton);

    expect(await screen.findByRole("alert")).toHaveTextContent("Unable to send verification code");
    expect(turnstileHarness.reset).toHaveBeenCalledTimes(1);
    expect(sendButton).toBeDisabled();
    act(() => turnstileHarness.props?.onVerify("replacement-token"));
    expect(await screen.findByRole("button", { name: /send verification code/i })).toBeEnabled();
  });

  it("creates an email-verified account with code, invitation, and stored affiliate but no Turnstile token", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(pendingCompletion({
        provider: "github",
        error: "invitation_required",
        redirect: "/reports",
        resolved_email: "github@example.com",
        invitation_required: true,
      }))
      .mockResolvedValueOnce(response({ email_verify_enabled: true }))
      .mockResolvedValueOnce(response({
        access_token: "created-access",
        refresh_token: "created-refresh",
        expires_in: 3600,
      }));
    globalThis.fetch = fetchMock;
    sessionStorage.setItem("oauth_aff_code", "  AFF-CREATE  ");

    renderCallback();

    expect(await screen.findByText("Complete GitHub signup")).toBeInTheDocument();
    await fillPasswords();
    fireEvent.change(screen.getByLabelText("Invite Code"), { target: { value: "  INVITE-1  " } });
    fireEvent.change(screen.getByLabelText("Verification Code"), { target: { value: "  123456  " } });
    fireEvent.click(screen.getByRole("button", { name: "Complete signup" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "/api/v1/auth/oauth/pending/create-account",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          email: "github@example.com",
          password: "secret123",
          verify_code: "123456",
          invitation_code: "INVITE-1",
          aff_code: "AFF-CREATE",
        }),
      }),
    );
    expect(localStorage.getItem("auth_token")).toBe("created-access");
    expect(sessionStorage.getItem("oauth_aff_code")).toBeNull();
    expect(await screen.findByText("Reports landed")).toBeInTheDocument();
  });

  it("clears expired and failed Turnstile tokens and disables sending", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(pendingCompletion())
      .mockResolvedValueOnce(response({
        email_verify_enabled: true,
        turnstile_enabled: true,
        turnstile_site_key: "oauth-site-key",
      }));

    renderCallback();

    await screen.findByRole("group", { name: /security verification/i });
    act(() => turnstileHarness.props?.onVerify("first-token"));
    const sendButton = await screen.findByRole("button", { name: /send verification code/i });
    expect(sendButton).toBeEnabled();
    act(() => turnstileHarness.props?.onExpire?.());
    expect(await screen.findByRole("alert")).toHaveTextContent(/expired/i);
    expect(sendButton).toBeDisabled();

    act(() => turnstileHarness.props?.onVerify("second-token"));
    await waitFor(() => expect(sendButton).toBeEnabled());
    act(() => turnstileHarness.props?.onError?.("110200"));
    expect(await screen.findByRole("alert")).toHaveTextContent(/failed/i);
    expect(sendButton).toBeDisabled();
  });

  it("uses the provider-specific completion body unchanged when email verification is disabled", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(pendingCompletion({
        provider: "github",
        resolved_email: "github@example.com",
      }))
      .mockResolvedValueOnce(response({
        email_verify_enabled: false,
        turnstile_enabled: true,
        turnstile_site_key: "ignored-site-key",
      }))
      .mockResolvedValueOnce(response({ access_token: "github-access" }));
    globalThis.fetch = fetchMock;

    renderCallback();

    expect(await screen.findByText("Complete GitHub signup")).toBeInTheDocument();
    expect(screen.queryByLabelText("Verification Code")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /send verification code/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: /security verification/i })).not.toBeInTheDocument();
    await fillPasswords();
    fireEvent.click(screen.getByRole("button", { name: "Complete signup" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "/api/v1/auth/oauth/github/complete-registration",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ password: "secret123" }),
      }),
    );
    expect(localStorage.getItem("auth_token")).toBe("github-access");
    expect(await screen.findByText("Console landed")).toBeInTheDocument();
  });

  it("uses a Tencent proof to send a pending OAuth verification code", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(pendingCompletion())
      .mockResolvedValueOnce(response({
        email_verify_enabled: true,
        tencent_captcha_enabled: true,
        tencent_captcha_app_id: "app-1",
      }))
      .mockResolvedValueOnce(response({ message: "sent", countdown: 60 }));
    globalThis.fetch = fetchMock;
    tencentHarness.verify.mockResolvedValue({
      provider: "tencent",
      ticket: "pending-ticket",
      randstr: "@pending-rand",
    });

    renderCallback();
    fireEvent.click(await screen.findByRole("button", { name: /send verification code/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/v1/auth/oauth/pending/send-verify-code",
      expect.objectContaining({
        body: JSON.stringify({
          email: "new@example.com",
          tencent_captcha_ticket: "pending-ticket",
          tencent_captcha_randstr: "@pending-rand",
        }),
      }),
    );
    expect(tencentHarness.reset).toHaveBeenCalledTimes(1);
  });

  it("acquires a fresh Aliyun proof when creating a pending OAuth account", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(pendingCompletion())
      .mockResolvedValueOnce(response({
        email_verify_enabled: true,
        aliyun_captcha_enabled: true,
        aliyun_captcha_scene_id: "scene-1",
        aliyun_captcha_prefix: "prefix-1",
      }))
      .mockResolvedValueOnce(response({ access_token: "created-access" }));
    globalThis.fetch = fetchMock;
    aliyunHarness.verify.mockResolvedValue({ provider: "aliyun", token: "create-param" });

    renderCallback();
    await fillPasswords();
    fireEvent.change(screen.getByLabelText("Verification Code"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Complete signup" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/v1/auth/oauth/pending/create-account",
      expect.objectContaining({
        body: JSON.stringify({
          email: "new@example.com",
          password: "secret123",
          verify_code: "123456",
          aff_code: undefined,
          turnstile_token: "create-param",
        }),
      }),
    );
    expect(aliyunHarness.reset).toHaveBeenCalledTimes(1);
  });

  it("falls back to email verification without Turnstile when settings fail", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(pendingCompletion())
      .mockResolvedValueOnce(response("Settings unavailable", false, 503));
    globalThis.fetch = fetchMock;

    renderCallback();

    expect(await screen.findByText("Complete Google signup")).toBeInTheDocument();
    expect(screen.getByLabelText("Verification Code")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /send verification code/i })).toBeEnabled();
    expect(screen.queryByRole("group", { name: /security verification/i })).not.toBeInTheDocument();
  });

  it.each(["send", "create"] as const)(
    "treats a pending_session from %s as an existing-account error without auth side effects",
    async (branch) => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(pendingCompletion())
        .mockResolvedValueOnce(response({ email_verify_enabled: true }))
        .mockResolvedValueOnce(response({
          auth_result: "pending_session",
          provider: "google",
          intent: "login",
          step: "choose_account_action_required",
          resolved_email: "new@example.com",
        }));
      globalThis.fetch = fetchMock;
      sessionStorage.setItem("oauth_aff_code", "KEEP-ME");

      renderCallback();

      if (branch === "send") {
        fireEvent.click(await screen.findByRole("button", { name: /send verification code/i }));
      } else {
        await fillPasswords();
        fireEvent.change(screen.getByLabelText("Verification Code"), { target: { value: "123456" } });
        fireEvent.click(screen.getByRole("button", { name: "Complete signup" }));
      }

      expect(await screen.findByRole("heading", { name: "Sign in failed" })).toBeInTheDocument();
      expect(screen.getByRole("alert")).toHaveTextContent(/email already has an account/i);
      expect(screen.getByRole("link", { name: "Back to sign in" })).toHaveAttribute("href", "/login");
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
      expect(localStorage.getItem("auth_token")).toBeNull();
      expect(sessionStorage.getItem("oauth_aff_code")).toBe("KEEP-ME");
      expect(screen.queryByText("Console landed")).not.toBeInTheDocument();
    },
  );

  it("blocks duplicate send and account-creation submissions synchronously", async () => {
    let resolveSend!: (value: ReturnType<typeof response>) => void;
    const pendingSend = new Promise<ReturnType<typeof response>>((resolve) => {
      resolveSend = resolve;
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(pendingCompletion())
      .mockResolvedValueOnce(response({ email_verify_enabled: true }))
      .mockImplementationOnce(() => pendingSend)
      .mockResolvedValueOnce(response({ access_token: "created-access" }));
    globalThis.fetch = fetchMock;

    renderCallback();

    const sendButton = await screen.findByRole("button", { name: /send verification code/i });
    fireEvent.click(sendButton);
    fireEvent.click(sendButton);
    expect(fetchMock.mock.calls.filter(([url]) => url === "/api/v1/auth/oauth/pending/send-verify-code")).toHaveLength(1);

    await act(async () => {
      resolveSend(response({ message: "sent", countdown: 0 }));
      await pendingSend;
    });
    await screen.findByRole("status");
    await fillPasswords();
    fireEvent.change(screen.getByLabelText("Verification Code"), { target: { value: "123456" } });
    const completeButton = screen.getByRole("button", { name: "Complete signup" });
    const form = completeButton.closest("form")!;
    fireEvent.submit(form);
    fireEvent.submit(form);

    await waitFor(() => {
      expect(fetchMock.mock.calls.filter(([url]) => url === "/api/v1/auth/oauth/pending/create-account")).toHaveLength(1);
    });
  });

  it("shows an error and returns to login for invalid callback fragments", async () => {
    window.location.hash = "#error=invalid_state&error_description=OAuth%20state%20expired";

    renderCallback();

    expect(await screen.findByText("OAuth state expired")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to sign in" })).toHaveAttribute("href", "/login");
  });

  it("localizes pending and failure chrome while preserving provider details", async () => {
    await i18n.changeLanguage("ja");
    globalThis.fetch = vi.fn(() => new Promise<Response>(() => {}));

    const view = renderCallback();

    expect(screen.getByRole("heading", { name: "ログインを完了しています" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "言語を切り替える" })).toBeInTheDocument();
    expect(document.title).toBe("OAuth ログイン | Mikiko CC");
    view.unmount();

    window.location.hash = "#error=invalid_state&error_description=Provider%20detail";
    renderCallback();

    expect(await screen.findByRole("heading", { name: "ログインに失敗しました" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Provider detail");
    expect(screen.getByRole("link", { name: "ログインに戻る" })).toBeInTheDocument();

    await act(async () => {
      await i18n.changeLanguage("zh-CN");
    });
    expect(screen.getByRole("heading", { name: "登录失败" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Provider detail");
  });

  it("localizes registration completion UI and updates a visible frontend error", async () => {
    await i18n.changeLanguage("ja");
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce(pendingCompletion({ invitation_required: true }))
      .mockResolvedValueOnce(response({
        email_verify_enabled: true,
        turnstile_enabled: true,
        turnstile_site_key: "oauth-site",
      }));

    renderCallback();

    expect(await screen.findByRole("heading", { name: "Google の登録を完了" })).toBeInTheDocument();
    expect(screen.getByLabelText("パスワードの確認")).toBeInTheDocument();
    act(() => turnstileHarness.props?.onError?.("110200"));
    expect(await screen.findByRole("alert")).toHaveTextContent("セキュリティ検証に失敗しました");

    await act(async () => {
      await i18n.changeLanguage("zh-CN");
    });
    expect(screen.getByRole("heading", { name: "完成 Google 注册" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("安全验证失败，请重试。");
  });
});
