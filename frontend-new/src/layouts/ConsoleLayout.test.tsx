import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import ConsoleLayout from "./ConsoleLayout";
import type { ConsoleBootstrap } from "../types/console";
import i18n from "../i18n";

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
    expect(screen.getByRole("button", { name: "Change language" })).toBeInTheDocument();
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

  it("localizes shell navigation, controls, credits, breadcrumb, and title without changing backend values", async () => {
    await i18n.changeLanguage("zh-CN");

    render(
      <MemoryRouter initialEntries={["/console/api-keys"]}>
        <Routes>
          <Route path="/console" element={<ConsoleLayout bootstrap={bootstrap} />}>
            <Route path="api-keys" element={<div>Dynamic child</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByRole("link", { name: "API 密钥" })).toHaveAttribute("href", "/console/api-keys");
    expect(screen.getByRole("link", { name: "API 密钥" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "概览" })).not.toHaveAttribute("aria-current");
    expect(screen.getAllByText("API 密钥").length).toBeGreaterThan(1);
    expect(screen.getByText("额度")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "切换到深色主题" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "打开账户菜单" })).toBeInTheDocument();
    expect(screen.getByLabelText("2 条未读公告")).toBeInTheDocument();
    expect(screen.getAllByText("Pro Plan").length).toBeGreaterThan(0);
    expect(screen.getByText("user@example.com")).toBeInTheDocument();
    expect(document.title).toBe("API 密钥 | Mikiko CC");

    fireEvent.click(screen.getByRole("button", { name: "打开账户菜单" }));
    expect(screen.getByText("用户")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "退出登录" })).toBeInTheDocument();

    await act(async () => {
      await i18n.changeLanguage("ja");
    });

    expect(screen.getByRole("link", { name: "API キー" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ダークテーマに切り替え" })).toBeInTheDocument();
    expect(screen.getByText("クレジット")).toBeInTheDocument();
    expect(screen.getByText("ユーザー")).toBeInTheDocument();
    expect(document.title).toBe("API キー | Mikiko CC");
  });

  it("uses explicit localized identity for the install guide route", async () => {
    await i18n.changeLanguage("zh-TW");

    render(
      <MemoryRouter initialEntries={["/console/install-guide?key=100"]}>
        <Routes>
          <Route path="/console" element={<ConsoleLayout bootstrap={bootstrap} />}>
            <Route path="install-guide" element={<div>Install child</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText("Install child")).toBeInTheDocument();
    expect(screen.getByText("安裝指南")).toBeInTheDocument();
    expect(document.title).toBe("安裝指南 | Mikiko CC");
    expect(screen.getByRole("link", { name: "概覽" })).not.toHaveAttribute("aria-current");
  });

  it("provides an accessible mobile navigation drawer while keeping top controls available", async () => {
    render(
      <MemoryRouter initialEntries={["/console"]}>
        <Routes>
          <Route path="/console" element={<ConsoleLayout bootstrap={bootstrap} />}>
            <Route index element={<div>Overview content</div>} />
            <Route path="api-keys" element={<div>API key content</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    const menuButton = screen.getByRole("button", { name: "Open navigation" });
    expect(menuButton).toHaveAttribute("aria-expanded", "false");
    expect(menuButton).toHaveClass("lg:hidden");
    expect(screen.getByRole("main")).toHaveClass("ml-0", "lg:ml-64");
    expect(screen.getByRole("button", { name: "Change language" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Switch to dark theme" })).toBeInTheDocument();

    fireEvent.click(menuButton);
    expect(menuButton).toHaveAttribute("aria-expanded", "true");
    const drawer = screen.getByRole("dialog", { name: "Console navigation" });
    expect(drawer).toBeInTheDocument();
    expect(within(drawer).getByRole("button", { name: "Close navigation" })).toHaveFocus();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Console navigation" })).not.toBeInTheDocument();
    await waitFor(() => expect(menuButton).toHaveFocus());

    fireEvent.click(menuButton);
    fireEvent.click(within(screen.getByRole("dialog", { name: "Console navigation" })).getByRole("link", { name: "API Keys" }));
    expect(screen.queryByRole("dialog", { name: "Console navigation" })).not.toBeInTheDocument();
  });
});
