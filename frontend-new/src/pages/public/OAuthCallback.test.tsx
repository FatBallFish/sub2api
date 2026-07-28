import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import OAuthCallback from "./OAuthCallback";

function renderCallback(initialEntry = "/auth/oauth/callback") {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/auth/oauth/callback" element={<OAuthCallback />} />
        <Route path="/auth/callback" element={<OAuthCallback />} />
        <Route path="/console" element={<div>Console landed</div>} />
        <Route path="/login" element={<div>Login page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("OAuthCallback", () => {
  const originalHash = window.location.hash;

  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    localStorage.clear();
    window.location.hash = originalHash;
    vi.restoreAllMocks();
  });

  it("stores token fragments and redirects to the requested console path", async () => {
    window.location.hash =
      "#access_token=access-token&refresh_token=refresh-token&expires_in=3600&token_type=Bearer&redirect=%252Fconsole";

    renderCallback();

    await waitFor(() => {
      expect(localStorage.getItem("auth_token")).toBe("access-token");
    });
    expect(localStorage.getItem("refresh_token")).toBe("refresh-token");
    expect(localStorage.getItem("token_expires_at")).toMatch(/^\d+$/);
    expect(await screen.findByText("Console landed")).toBeInTheDocument();
  });

  it("resumes pending OAuth and shows completion fields when backend requires registration", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: {
          error: "invitation_required",
          provider: "google",
          redirect: "/console",
          resolved_email: "new@example.com",
          invitation_required: true,
        },
      }),
    });

    renderCallback();

    expect(await screen.findByText("Complete Google signup")).toBeInTheDocument();
    expect(screen.getByDisplayValue("new@example.com")).toBeInTheDocument();
    expect(screen.getByLabelText("Invite Code")).toBeInTheDocument();
  });

  it("completes pending GitHub OAuth registration through the GitHub endpoint", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: {
            error: "registration_completion_required",
            provider: "github",
            redirect: "/console",
            resolved_email: "github@example.com",
            invitation_required: false,
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: {
            access_token: "github-access",
            refresh_token: "github-refresh",
            expires_in: 3600,
          },
        }),
      });
    globalThis.fetch = fetchMock;

    renderCallback();

    expect(await screen.findByText("Complete GitHub signup")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "secret123" } });
    fireEvent.change(screen.getByLabelText("Confirm Password"), { target: { value: "secret123" } });
    fireEvent.click(screen.getByRole("button", { name: "Complete signup" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenLastCalledWith(
        "/api/v1/auth/oauth/github/complete-registration",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ password: "secret123" }),
        }),
      );
    });
    expect(localStorage.getItem("auth_token")).toBe("github-access");
    expect(await screen.findByText("Console landed")).toBeInTheDocument();
  });

  it("shows an error and returns to login for invalid callback fragments", async () => {
    window.location.hash = "#error=invalid_state&error_description=OAuth%20state%20expired";

    renderCallback();

    expect(await screen.findByText("OAuth state expired")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to sign in" })).toHaveAttribute("href", "/login");
  });
});
