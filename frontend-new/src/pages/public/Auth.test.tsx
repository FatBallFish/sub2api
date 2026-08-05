import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import Auth from "./Auth";

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

const originalFetch = globalThis.fetch;

interface MockFetchResponse {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}

function createDeferredResponse() {
  let resolve!: (response: MockFetchResponse) => void;
  const promise = new Promise<MockFetchResponse>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

async function withMutableWindowLocation(run: () => Promise<void>) {
  const originalLocation = Object.getOwnPropertyDescriptor(window, "location");
  if (!originalLocation) throw new Error("window.location is unavailable");

  Object.defineProperty(window, "location", {
    configurable: true,
    value: { href: window.location.href },
  });

  try {
    await run();
  } finally {
    Object.defineProperty(window, "location", originalLocation);
  }
}

describe("Auth page", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    globalThis.fetch = originalFetch;
    localStorage.clear();
    turnstileHarness.props = null;
    turnstileHarness.reset.mockReset();
  });

  it("keeps Turnstile-disabled login request bodies unchanged", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: {
            turnstile_enabled: false,
            turnstile_site_key: "unused-site-key",
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: {
            access_token: "access-token",
            refresh_token: "refresh-token",
            expires_in: 3600,
            token_type: "Bearer",
            user: { id: 12, email: "dev@example.com" },
          },
        }),
      });
    globalThis.fetch = fetchMock;

    render(
      <MemoryRouter initialEntries={["/login"]}>
        <Auth />
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByRole("button", { name: /sign in/i })).toBeEnabled());
    expect(screen.queryByRole("group", { name: /security verification/i })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Email Address"), { target: { value: "dev@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "secret123" } });
    fireEvent.click(screen.getByRole("button", { name: /sign in/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/v1/auth/login",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ email: "dev@example.com", password: "secret123" }),
        }),
      );
    });
  });

  it("uses backend-enforced login when public settings cannot be loaded", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("settings network failure"))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: {
            access_token: "fallback-access-token",
            refresh_token: "fallback-refresh-token",
            expires_in: 3600,
            token_type: "Bearer",
            user: { id: 18, email: "fallback@example.com" },
          },
        }),
      });
    globalThis.fetch = fetchMock;

    render(
      <MemoryRouter initialEntries={["/login"]}>
        <Auth />
      </MemoryRouter>,
    );

    const submit = screen.getByRole("button", { name: /sign in/i });
    await waitFor(() => expect(submit).toBeEnabled());
    expect(screen.queryByRole("group", { name: /security verification/i })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Email Address"), { target: { value: "fallback@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "secret123" } });
    fireEvent.click(submit);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/v1/auth/login",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          email: "fallback@example.com",
          password: "secret123",
        }),
      }),
    );
  });

  it.each([undefined, "   "])(
    "does not require Turnstile when its enabled setting has site key %s",
    async (siteKey) => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            data: {
              turnstile_enabled: true,
              turnstile_site_key: siteKey,
            },
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            data: {
              access_token: "access-token",
              refresh_token: "refresh-token",
              expires_in: 3600,
              token_type: "Bearer",
              user: { id: 12, email: "dev@example.com" },
            },
          }),
        });
      globalThis.fetch = fetchMock;

      render(
        <MemoryRouter initialEntries={["/login"]}>
          <Auth />
        </MemoryRouter>,
      );

      const submit = screen.getByRole("button", { name: /sign in/i });
      await waitFor(() => expect(submit).toBeEnabled());
      expect(screen.queryByRole("group", { name: /security verification/i })).not.toBeInTheDocument();
      fireEvent.change(screen.getByLabelText("Email Address"), { target: { value: "dev@example.com" } });
      fireEvent.change(screen.getByLabelText("Password"), { target: { value: "secret123" } });
      fireEvent.click(submit);

      await waitFor(() => {
        expect(fetchMock).toHaveBeenLastCalledWith(
          "/api/v1/auth/login",
          expect.objectContaining({
            method: "POST",
            body: JSON.stringify({ email: "dev@example.com", password: "secret123" }),
          }),
        );
      });
    },
  );

  it("blocks programmatic auth submission while public settings are unresolved", async () => {
    let resolveSettings!: (response: {
      ok: boolean;
      status: number;
      json: () => Promise<{ success: boolean; data: object }>;
    }) => void;
    const settingsRequest = new Promise<{
      ok: boolean;
      status: number;
      json: () => Promise<{ success: boolean; data: object }>;
    }>((resolve) => {
      resolveSettings = resolve;
    });
    const fetchMock = vi.fn().mockReturnValue(settingsRequest);
    globalThis.fetch = fetchMock;

    render(
      <MemoryRouter initialEntries={["/login"]}>
        <Auth />
      </MemoryRouter>,
    );

    const submit = screen.getByRole("button", { name: /sign in/i });
    expect(submit).toBeDisabled();
    fireEvent.submit(submit.closest("form")!);

    expect(await screen.findByText(/authentication settings are still loading/i)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalledWith("/api/v1/auth/login", expect.any(Object));
    expect(fetchMock).not.toHaveBeenCalledWith("/api/v1/auth/register", expect.any(Object));
    expect(fetchMock).not.toHaveBeenCalledWith("/api/v1/auth/send-verify-code", expect.any(Object));

    await act(async () => {
      resolveSettings({
        ok: true,
        status: 200,
        json: async () => ({ success: true, data: { turnstile_enabled: false } }),
      });
      await settingsRequest;
    });
  });

  it("gates password login on Turnstile and submits its token", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: { turnstile_enabled: true, turnstile_site_key: "login-site-key" },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: {
            access_token: "access-token",
            refresh_token: "refresh-token",
            expires_in: 3600,
            token_type: "Bearer",
            user: { id: 12, email: "dev@example.com" },
          },
        }),
      });
    globalThis.fetch = fetchMock;

    render(
      <MemoryRouter initialEntries={["/login"]}>
        <Auth />
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByLabelText("Email Address"), { target: { value: "dev@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "secret123" } });
    const submit = screen.getByRole("button", { name: /sign in/i });
    expect(submit).toBeDisabled();

    await screen.findByRole("group", { name: /security verification/i });
    expect(turnstileHarness.props?.siteKey).toBe("login-site-key");
    expect(submit).toBeDisabled();
    fireEvent.submit(submit.closest("form")!);
    expect(await screen.findByRole("alert")).toHaveTextContent(/complete the security verification/i);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    act(() => turnstileHarness.props?.onVerify("login-challenge"));
    await waitFor(() => expect(submit).toBeEnabled());
    expect(screen.queryByText(/complete the security verification/i)).not.toBeInTheDocument();
    fireEvent.click(submit);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenLastCalledWith(
        "/api/v1/auth/login",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            email: "dev@example.com",
            password: "secret123",
            turnstile_token: "login-challenge",
          }),
        }),
      );
    });
  });

  it("allows only one protected login submission while its request is pending", async () => {
    const pendingLogin = createDeferredResponse();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: { turnstile_enabled: true, turnstile_site_key: "login-site-key" },
        }),
      })
      .mockImplementation(() => pendingLogin.promise);
    globalThis.fetch = fetchMock;

    render(
      <MemoryRouter initialEntries={["/login"]}>
        <Auth />
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByLabelText("Email Address"), { target: { value: "dev@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "secret123" } });
    const submit = screen.getByRole("button", { name: /sign in/i });
    const form = submit.closest("form")!;
    await screen.findByRole("group", { name: /security verification/i });
    act(() => turnstileHarness.props?.onVerify("single-use-login-token"));
    await waitFor(() => expect(submit).toBeEnabled());

    fireEvent.submit(form);
    fireEvent.submit(form);
    const loginCalls = fetchMock.mock.calls.filter(([url]) => url === "/api/v1/auth/login");

    await act(async () => {
      pendingLogin.resolve({
        ok: false,
        status: 400,
        json: async () => ({ success: false, message: "Invalid credentials" }),
      });
      await pendingLogin.promise;
    });
    await screen.findByText("Invalid credentials");

    expect(loginCalls).toHaveLength(1);
    expect(loginCalls[0]).toEqual([
      "/api/v1/auth/login",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          email: "dev@example.com",
          password: "secret123",
          turnstile_token: "single-use-login-token",
        }),
      }),
    ]);
  });

  it("does not switch auth modes while a login request is pending", async () => {
    const pendingLogin = createDeferredResponse();
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ success: true, data: { turnstile_enabled: false } }),
      })
      .mockImplementation(() => pendingLogin.promise);

    render(
      <MemoryRouter initialEntries={["/login"]}>
        <Auth />
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByLabelText("Email Address"), { target: { value: "dev@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "secret123" } });
    const submit = screen.getByRole("button", { name: /sign in/i });
    await waitFor(() => expect(submit).toBeEnabled());
    fireEvent.submit(submit.closest("form")!);

    const loginMode = screen.getByRole("button", { name: "Login" });
    const registerMode = screen.getByRole("button", { name: "Create account" });
    expect(loginMode).toBeDisabled();
    expect(registerMode).toBeDisabled();
    fireEvent.click(registerMode);
    expect(screen.getByRole("heading", { name: "Sign in to Gateway" })).toBeInTheDocument();

    await act(async () => {
      pendingLogin.resolve({
        ok: false,
        status: 400,
        json: async () => ({ success: false, message: "Invalid credentials" }),
      });
      await pendingLogin.promise;
    });
    await screen.findByText("Invalid credentials");
    await waitFor(() => expect(registerMode).toBeEnabled());
    fireEvent.click(registerMode);
    expect(await screen.findByRole("heading", { name: "Create your account" })).toBeInTheDocument();
  });

  it("resets Turnstile after a rejected password login", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: { turnstile_enabled: true, turnstile_site_key: "login-site-key" },
        }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({ success: false, message: "Invalid credentials" }),
      });
    globalThis.fetch = fetchMock;

    render(
      <MemoryRouter initialEntries={["/login"]}>
        <Auth />
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByLabelText("Email Address"), { target: { value: "dev@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "bad-password" } });
    const submit = screen.getByRole("button", { name: /sign in/i });
    await screen.findByRole("group", { name: /security verification/i });
    act(() => turnstileHarness.props?.onVerify("consumed-token"));
    await waitFor(() => expect(submit).toBeEnabled());
    fireEvent.click(submit);

    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid credentials");
    expect(turnstileHarness.reset).toHaveBeenCalledTimes(1);
    expect(submit).toBeDisabled();
  });

  it("resets consumed Turnstile verification when password login requires 2FA", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: { turnstile_enabled: true, turnstile_site_key: "login-site-key" },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: {
            requires_2fa: true,
            temp_token: "temporary-2fa-token",
          },
        }),
      });
    globalThis.fetch = fetchMock;

    render(
      <MemoryRouter initialEntries={["/login"]}>
        <Auth />
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByLabelText("Email Address"), { target: { value: "dev@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "secret123" } });
    const submit = screen.getByRole("button", { name: /sign in/i });
    await screen.findByRole("group", { name: /security verification/i });
    act(() => turnstileHarness.props?.onVerify("consumed-2fa-token"));
    await waitFor(() => expect(submit).toBeEnabled());
    fireEvent.click(submit);

    expect(await screen.findByText(/two-factor authentication is enabled/i)).toHaveTextContent(
      "Two-factor authentication is enabled. Please use the classic console login for now.",
    );
    expect(turnstileHarness.reset).toHaveBeenCalledTimes(1);
    expect(submit).toBeDisabled();
  });

  it("clears verification on Turnstile expiration and errors", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: { turnstile_enabled: true, turnstile_site_key: "login-site-key" },
      }),
    });

    render(
      <MemoryRouter initialEntries={["/login"]}>
        <Auth />
      </MemoryRouter>,
    );

    const submit = screen.getByRole("button", { name: /sign in/i });
    await screen.findByRole("group", { name: /security verification/i });
    act(() => turnstileHarness.props?.onVerify("first-token"));
    await waitFor(() => expect(submit).toBeEnabled());
    act(() => turnstileHarness.props?.onExpire?.());
    expect(await screen.findByText(/security verification expired/i)).toBeInTheDocument();
    expect(submit).toBeDisabled();

    act(() => turnstileHarness.props?.onVerify("second-token"));
    await waitFor(() => expect(submit).toBeEnabled());
    act(() => turnstileHarness.props?.onError?.("110200"));
    expect(await screen.findByText(/security verification failed/i)).toBeInTheDocument();
    expect(submit).toBeDisabled();
  });

  it("sends code then registers a new user", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: {
            registration_enabled: true,
            email_verify_enabled: true,
            github_oauth_enabled: false,
            google_oauth_enabled: false,
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ success: true, data: { message: "sent", countdown: 60 } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: {
            access_token: "new-token",
            refresh_token: "new-refresh",
            expires_in: 3600,
            token_type: "Bearer",
            user: { id: 13, email: "new@example.com" },
          },
        }),
      });
    globalThis.fetch = fetchMock;

    render(
      <MemoryRouter initialEntries={["/register?invitation_code=INVITE"]}>
        <Auth />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: /create account/i }));
    fireEvent.change(screen.getByLabelText("Email Address"), { target: { value: "new@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "secret123" } });
    fireEvent.click(await screen.findByRole("button", { name: /send verification code/i }));

    expect(await screen.findByRole("status")).toHaveTextContent(/code sent/i);

    fireEvent.change(await screen.findByLabelText("Verification Code"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: /verify & create account/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenLastCalledWith(
        "/api/v1/auth/register",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining("\"invitation_code\":\"INVITE\""),
        }),
      );
    });
  });

  it("uses Turnstile for the email verification send but not final registration", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: {
            registration_enabled: true,
            email_verify_enabled: true,
            turnstile_enabled: true,
            turnstile_site_key: "register-site-key",
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ success: true, data: { message: "sent", countdown: 60 } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: {
            access_token: "new-token",
            refresh_token: "new-refresh",
            expires_in: 3600,
            token_type: "Bearer",
            user: { id: 13, email: "new@example.com" },
          },
        }),
      });
    globalThis.fetch = fetchMock;

    render(
      <MemoryRouter initialEntries={["/register"]}>
        <Auth />
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByLabelText("Email Address"), { target: { value: "new@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "secret123" } });
    const sendButton = await screen.findByRole("button", { name: /send verification code/i });
    expect(sendButton).toBeDisabled();
    await screen.findByRole("group", { name: /security verification/i });
    act(() => turnstileHarness.props?.onVerify("send-code-token"));
    await waitFor(() => expect(sendButton).toBeEnabled());
    fireEvent.click(sendButton);

    await screen.findByText(/code sent/i);
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/v1/auth/send-verify-code",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          email: "new@example.com",
          turnstile_token: "send-code-token",
        }),
      }),
    );
    expect(turnstileHarness.reset).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(screen.queryByRole("group", { name: /security verification/i })).not.toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText("Verification Code"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: /verify & create account/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenLastCalledWith(
        "/api/v1/auth/register",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            email: "new@example.com",
            password: "secret123",
            verify_code: "123456",
          }),
        }),
      );
    });
  });

  it("allows only one protected send-code submission while its request is pending", async () => {
    const pendingSendCode = createDeferredResponse();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: {
            registration_enabled: true,
            email_verify_enabled: true,
            turnstile_enabled: true,
            turnstile_site_key: "register-site-key",
          },
        }),
      })
      .mockImplementation(() => pendingSendCode.promise);
    globalThis.fetch = fetchMock;

    render(
      <MemoryRouter initialEntries={["/register"]}>
        <Auth />
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByLabelText("Email Address"), { target: { value: "new@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "secret123" } });
    const submit = await screen.findByRole("button", { name: /send verification code/i });
    const form = submit.closest("form")!;
    await screen.findByRole("group", { name: /security verification/i });
    act(() => turnstileHarness.props?.onVerify("single-use-send-token"));
    await waitFor(() => expect(submit).toBeEnabled());

    fireEvent.submit(form);
    fireEvent.submit(form);
    const sendCalls = fetchMock.mock.calls.filter(([url]) => url === "/api/v1/auth/send-verify-code");

    await act(async () => {
      pendingSendCode.resolve({
        ok: false,
        status: 400,
        json: async () => ({ success: false, message: "Unable to send code" }),
      });
      await pendingSendCode.promise;
    });
    await screen.findByText("Unable to send code");

    expect(sendCalls).toHaveLength(1);
    expect(sendCalls[0]?.[1]).toEqual(expect.objectContaining({
      method: "POST",
      body: JSON.stringify({
        email: "new@example.com",
        turnstile_token: "single-use-send-token",
      }),
    }));
  });

  it("submits Turnstile directly and resets it after rejected registration", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: {
            registration_enabled: true,
            email_verify_enabled: false,
            turnstile_enabled: true,
            turnstile_site_key: "register-site-key",
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({ success: false, message: "Account already exists" }),
      });
    globalThis.fetch = fetchMock;

    render(
      <MemoryRouter initialEntries={["/register"]}>
        <Auth />
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByLabelText("Email Address"), { target: { value: "direct@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "secret123" } });
    const submit = await screen.findByRole("button", { name: /register account/i });
    await screen.findByRole("group", { name: /security verification/i });
    act(() => turnstileHarness.props?.onVerify("register-token"));
    await waitFor(() => expect(submit).toBeEnabled());
    fireEvent.click(submit);

    expect(await screen.findByText("Account already exists")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/v1/auth/register",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          email: "direct@example.com",
          password: "secret123",
          turnstile_token: "register-token",
        }),
      }),
    );
    expect(turnstileHarness.reset).toHaveBeenCalledTimes(1);
    expect(submit).toBeDisabled();
  });

  it("allows only one protected direct registration while its request is pending", async () => {
    const pendingRegistration = createDeferredResponse();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: {
            registration_enabled: true,
            email_verify_enabled: false,
            turnstile_enabled: true,
            turnstile_site_key: "register-site-key",
          },
        }),
      })
      .mockImplementation(() => pendingRegistration.promise);
    globalThis.fetch = fetchMock;

    render(
      <MemoryRouter initialEntries={["/register"]}>
        <Auth />
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByLabelText("Email Address"), { target: { value: "direct@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "secret123" } });
    const submit = await screen.findByRole("button", { name: /register account/i });
    const form = submit.closest("form")!;
    await screen.findByRole("group", { name: /security verification/i });
    act(() => turnstileHarness.props?.onVerify("single-use-register-token"));
    await waitFor(() => expect(submit).toBeEnabled());

    fireEvent.submit(form);
    fireEvent.submit(form);
    const registerCalls = fetchMock.mock.calls.filter(([url]) => url === "/api/v1/auth/register");

    await act(async () => {
      pendingRegistration.resolve({
        ok: false,
        status: 400,
        json: async () => ({ success: false, message: "Account already exists" }),
      });
      await pendingRegistration.promise;
    });
    await screen.findByText("Account already exists");

    expect(registerCalls).toHaveLength(1);
    expect(registerCalls[0]?.[1]).toEqual(expect.objectContaining({
      method: "POST",
      body: JSON.stringify({
        email: "direct@example.com",
        password: "secret123",
        turnstile_token: "single-use-register-token",
      }),
    }));
  });

  it("resets verification when switching between login and registration", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: {
          registration_enabled: true,
          email_verify_enabled: true,
          turnstile_enabled: true,
          turnstile_site_key: "shared-site-key",
        },
      }),
    });

    render(
      <MemoryRouter initialEntries={["/login"]}>
        <Auth />
      </MemoryRouter>,
    );

    const loginSubmit = screen.getByRole("button", { name: /sign in/i });
    await screen.findByRole("group", { name: /security verification/i });
    act(() => turnstileHarness.props?.onVerify("login-only-token"));
    await waitFor(() => expect(loginSubmit).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: /create account/i }));

    expect(turnstileHarness.reset).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole("button", { name: /send verification code/i })).toBeDisabled();
  });

  it("registers directly when backend disables email verification", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: {
            registration_enabled: true,
            email_verify_enabled: false,
            github_oauth_enabled: false,
            google_oauth_enabled: false,
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: {
            access_token: "new-token",
            refresh_token: "new-refresh",
            expires_in: 3600,
            token_type: "Bearer",
            user: { id: 13, email: "new@example.com" },
          },
        }),
      });
    globalThis.fetch = fetchMock;

    render(
      <MemoryRouter initialEntries={["/register"]}>
        <Auth />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: /create account/i }));
    fireEvent.change(screen.getByLabelText("Email Address"), { target: { value: "direct@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "secret123" } });
    expect(await screen.findByRole("button", { name: /register account/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /send verification code/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /register account/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/v1/auth/register",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            email: "direct@example.com",
            password: "secret123",
          }),
        }),
      );
    });
    expect(fetchMock).not.toHaveBeenCalledWith("/api/v1/auth/send-verify-code", expect.any(Object));
  });

  it("blocks programmatic registration submission when registration is closed", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: {
          registration_enabled: false,
          email_verify_enabled: true,
          turnstile_enabled: false,
        },
      }),
    });
    globalThis.fetch = fetchMock;

    render(
      <MemoryRouter initialEntries={["/register"]}>
        <Auth />
      </MemoryRouter>,
    );

    expect(await screen.findByRole("alert")).toHaveTextContent("Registration is currently closed.");
    const submit = screen.getByRole("button", { name: /send verification code/i });
    expect(submit).toBeDisabled();
    fireEvent.submit(submit.closest("form")!);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock).not.toHaveBeenCalledWith("/api/v1/auth/send-verify-code", expect.any(Object));
    expect(fetchMock).not.toHaveBeenCalledWith("/api/v1/auth/register", expect.any(Object));
  });

  it("blocks programmatic verification requests when an invitation is required but missing", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: {
          registration_enabled: true,
          email_verify_enabled: true,
          invitation_code_enabled: true,
          turnstile_enabled: false,
        },
      }),
    });
    globalThis.fetch = fetchMock;

    render(
      <MemoryRouter initialEntries={["/register"]}>
        <Auth />
      </MemoryRouter>,
    );

    const submit = await screen.findByRole("button", { name: /send verification code/i });
    fireEvent.change(screen.getByLabelText("Email Address"), { target: { value: "invite@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "secret123" } });
    fireEvent.submit(submit.closest("form")!);

    expect(await screen.findByRole("alert")).toHaveTextContent("Invitation code is required.");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalledWith("/api/v1/auth/send-verify-code", expect.any(Object));
    expect(fetchMock).not.toHaveBeenCalledWith("/api/v1/auth/register", expect.any(Object));
  });

  it("preserves promo codes in direct registration request bodies", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: {
            registration_enabled: true,
            email_verify_enabled: false,
            turnstile_enabled: false,
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: {
            access_token: "promo-token",
            refresh_token: "promo-refresh",
            expires_in: 3600,
            token_type: "Bearer",
            user: { id: 16, email: "promo@example.com" },
          },
        }),
      });
    globalThis.fetch = fetchMock;

    render(
      <MemoryRouter initialEntries={["/register?promo_code=LAUNCH2026"]}>
        <Auth />
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByLabelText("Email Address"), { target: { value: "promo@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "secret123" } });
    const submit = await screen.findByRole("button", { name: /register account/i });
    fireEvent.click(submit);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenLastCalledWith(
        "/api/v1/auth/register",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            email: "promo@example.com",
            password: "secret123",
            promo_code: "LAUNCH2026",
          }),
        }),
      );
    });
  });

  it("prefills the visible invite code field from ref links and submits it as affiliate code", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: {
            registration_enabled: true,
            email_verify_enabled: false,
            invitation_code_enabled: false,
            github_oauth_enabled: false,
            google_oauth_enabled: false,
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: {
            access_token: "ref-token",
            refresh_token: "ref-refresh",
            expires_in: 3600,
            token_type: "Bearer",
            user: { id: 15, email: "ref@example.com" },
          },
        }),
      });
    globalThis.fetch = fetchMock;

    render(
      <MemoryRouter initialEntries={["/register?ref=GBHPSSPYWV6A"]}>
        <Auth />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: /create account/i }));
    const inviteCode = await screen.findByLabelText("Invite Code");
    expect(inviteCode).toHaveValue("GBHPSSPYWV6A");

    fireEvent.change(screen.getByLabelText("Email Address"), { target: { value: "ref@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "secret123" } });
    fireEvent.click(screen.getByRole("button", { name: /register account/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/v1/auth/register",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            email: "ref@example.com",
            password: "secret123",
            aff_code: "GBHPSSPYWV6A",
          }),
        }),
      );
    });
  });

  it("requires and submits an invitation code when public settings require it", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: {
            registration_enabled: true,
            email_verify_enabled: false,
            invitation_code_enabled: true,
            github_oauth_enabled: false,
            google_oauth_enabled: false,
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: {
            access_token: "invite-token",
            refresh_token: "invite-refresh",
            expires_in: 3600,
            token_type: "Bearer",
            user: { id: 14, email: "invite@example.com" },
          },
        }),
      });
    globalThis.fetch = fetchMock;

    render(
      <MemoryRouter initialEntries={["/register"]}>
        <Auth />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: /create account/i }));
    fireEvent.change(screen.getByLabelText("Email Address"), { target: { value: "invite@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "secret123" } });
    fireEvent.change(await screen.findByLabelText("Invite Code (required)"), { target: { value: "INVITE-2026" } });
    fireEvent.click(screen.getByRole("button", { name: /register account/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/v1/auth/register",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            email: "invite@example.com",
            password: "secret123",
            invitation_code: "INVITE-2026",
          }),
        }),
      );
    });
  });

  it("renders only OAuth providers enabled by public settings", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: {
          registration_enabled: true,
          email_verify_enabled: true,
          github_oauth_enabled: true,
          google_oauth_enabled: false,
        },
      }),
    });
    globalThis.fetch = fetchMock;

    render(
      <MemoryRouter initialEntries={["/login"]}>
        <Auth />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /github/i })).toBeInTheDocument();
    });
    expect(screen.queryByRole("button", { name: /google/i })).not.toBeInTheDocument();
  });

  it.each(["google", "github"] as const)("passes the registration referral code to %s OAuth", async (provider) => {
    await withMutableWindowLocation(async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: {
            registration_enabled: true,
            email_verify_enabled: true,
            github_oauth_enabled: true,
            google_oauth_enabled: true,
          },
        }),
      });

      render(
        <MemoryRouter initialEntries={["/register?ref=AFF123"]}>
          <Auth />
        </MemoryRouter>,
      );

      fireEvent.click(await screen.findByRole("button", { name: new RegExp(provider, "i") }));

      expect(window.location.href).toBe(
        `/api/v1/auth/oauth/${provider}/start?redirect=%2Fconsole&aff_code=AFF123`,
      );
    });
  });

  it("does not pass a registration invitation code to Google OAuth as an affiliate code", async () => {
    await withMutableWindowLocation(async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: {
            registration_enabled: true,
            email_verify_enabled: true,
            github_oauth_enabled: true,
            google_oauth_enabled: true,
          },
        }),
      });

      render(
        <MemoryRouter initialEntries={["/register?invitation_code=SYSTEM-CODE"]}>
          <Auth />
        </MemoryRouter>,
      );

      fireEvent.click(await screen.findByRole("button", { name: /google/i }));

      expect(window.location.href).toBe("/api/v1/auth/oauth/google/start?redirect=%2Fconsole");
    });
  });

  it("redirects authenticated users away from auth pages", async () => {
    localStorage.setItem("auth_token", "token");
    localStorage.setItem("auth_user", JSON.stringify({ id: 7, email: "signed@example.com" }));

    render(
      <MemoryRouter initialEntries={["/login"]}>
        <Auth />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /sign in/i })).not.toBeInTheDocument();
    });
  });
});
