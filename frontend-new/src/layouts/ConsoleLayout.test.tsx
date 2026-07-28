import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import ConsoleLayout from "./ConsoleLayout";
import type { ConsoleBootstrap } from "../types/console";

const bootstrap: ConsoleBootstrap = {
  user: { id: 1, email: "user@example.com", name: "User", role: "user" },
  wallet: { available_balance: 120.5, add_on_credits: 10.5, currency: "USD" },
  global_plan: {
    active: true,
    name: "Pro Plan",
    quota_limit: 60,
    quota_used: 51,
    quota_remaining: 9,
    used_percent: 85,
    current_period_end: "2026-06-22T00:00:00Z",
    expires_at: "2026-07-15T00:00:00Z",
  },
  unread_announcements: 2,
  affiliate_enabled: true,
};

describe("ConsoleLayout", () => {
  afterEach(() => {
    localStorage.clear();
  });

  it("renders bootstrap user, wallet, and global plan state in the shell", () => {
    render(
      <MemoryRouter initialEntries={["/console"]}>
        <Routes>
          <Route path="/console" element={<ConsoleLayout bootstrap={bootstrap} />}>
            <Route index element={<div>Overview content</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText("user@example.com")).toBeInTheDocument();
    expect(screen.getAllByText(/120\.500000/).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Pro Plan").length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: /playground/i })).toHaveAttribute("href", "/console/playground");
    expect(screen.getByText("Overview content")).toBeInTheDocument();
  });

  it("hides referral navigation when the backend disables affiliate", () => {
    render(
      <MemoryRouter initialEntries={["/console"]}>
        <Routes>
          <Route path="/console" element={<ConsoleLayout bootstrap={{ ...bootstrap, affiliate_enabled: false }} />}>
            <Route index element={<div>Overview content</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.queryByRole("link", { name: /referral/i })).not.toBeInTheDocument();
  });

  it("opens an avatar menu and logs out", async () => {
    localStorage.setItem("auth_token", "token");
    localStorage.setItem("auth_user", JSON.stringify({ id: 1, email: "user@example.com" }));

    render(
      <MemoryRouter initialEntries={["/console"]}>
        <Routes>
          <Route path="/console" element={<ConsoleLayout bootstrap={bootstrap} />}>
            <Route index element={<div>Overview content</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: /open account menu/i }));
    fireEvent.click(screen.getByRole("button", { name: /log out/i }));

    await waitFor(() => {
      expect(localStorage.getItem("auth_token")).toBeNull();
    });
  });

  it("toggles the console theme and persists the preference", () => {
    render(
      <MemoryRouter initialEntries={["/console"]}>
        <Routes>
          <Route path="/console" element={<ConsoleLayout bootstrap={bootstrap} />}>
            <Route index element={<div>Overview content</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: /switch to dark theme/i }));

    expect(localStorage.getItem("mikiko.console.theme.v1")).toBe("dark");
    expect(screen.getByTestId("console-shell")).toHaveAttribute("data-theme", "dark");
    expect(screen.getByRole("main")).toHaveClass("console-main");
    expect(screen.getByText(/120\.500000/)).toHaveClass("console-credit-balance");
    expect(screen.getByRole("button", { name: /switch to light theme/i })).toBeInTheDocument();
  });

  it("restores the persisted console theme without changing public pages", () => {
    localStorage.setItem("mikiko.console.theme.v1", "dark");

    render(
      <MemoryRouter initialEntries={["/console"]}>
        <Routes>
          <Route path="/console" element={<ConsoleLayout bootstrap={bootstrap} />}>
            <Route index element={<div>Overview content</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByTestId("console-shell")).toHaveAttribute("data-theme", "dark");
    expect(screen.getByRole("button", { name: /switch to light theme/i })).toBeInTheDocument();
  });
});
