import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import Auth from "./Auth";

const originalFetch = globalThis.fetch;

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
  });

  it("logs an existing user in with email and password", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
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
    fireEvent.click(screen.getByRole("button", { name: /sign in/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/v1/auth/login",
        expect.objectContaining({ method: "POST" }),
      );
    });
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

    await screen.findByText(/code sent/i);

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
