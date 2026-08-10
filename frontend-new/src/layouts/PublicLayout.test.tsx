import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import i18n from "../i18n";
import PublicLayout from "./PublicLayout";

describe("PublicLayout", () => {
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("shows sign in for anonymous visitors", () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route element={<PublicLayout />}>
            <Route path="/" element={<div>Home</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByRole("link", { name: /sign in/i })).toHaveAttribute("href", "/login");
    expect(screen.getByRole("button", { name: "Change language" })).toBeInTheDocument();
  });

  it("keeps primary header actions within the narrow-screen layout", () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route element={<PublicLayout />}>
            <Route path="/" element={<div>Home</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    const languageTrigger = screen.getByRole("button", { name: "Change language" });
    const header = languageTrigger.closest("nav");
    const actions = languageTrigger.parentElement?.parentElement;
    const signIn = screen.getByRole("link", { name: /sign in/i });
    const openConsole = screen.getByRole("link", { name: /open console/i });

    expect(header).toHaveClass("px-4", "sm:px-8");
    expect(actions).toHaveClass("gap-2", "sm:gap-4");
    expect(signIn).toHaveClass("hidden", "sm:inline");
    expect(openConsole).toHaveClass("px-3", "sm:px-4");
    expect(openConsole).not.toHaveClass("hidden");
  });

  it("shows the current account and routes console CTAs for authenticated visitors", () => {
    localStorage.setItem("auth_token", "token");
    localStorage.setItem("auth_user", JSON.stringify({ id: 7, email: "signed@example.com" }));

    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route element={<PublicLayout />}>
            <Route path="/" element={<div>Home</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.queryByRole("link", { name: /sign in/i })).not.toBeInTheDocument();
    expect(screen.getByText("signed@example.com")).toBeInTheDocument();
    expect(screen.getByText("signed@example.com").closest("a")).toHaveClass("hidden", "sm:flex");
    expect(screen.getByRole("link", { name: /open console/i })).toHaveAttribute("href", "/console");
  });

  it("only shows configured legal document links when agreements are enabled", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: {
          login_agreement_enabled: true,
          login_agreement_documents: [
            { id: "terms", title: "Service Terms", content_md: "Terms" },
          ],
        },
      }),
    });

    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route element={<PublicLayout />}>
            <Route path="/" element={<div>Home</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByRole("link", { name: "Terms of Service" })).toBeInTheDocument());
    expect(screen.queryByRole("link", { name: /privacy/i })).not.toBeInTheDocument();
  });

  it("localizes built-in footer document titles while preserving custom titles", async () => {
    await i18n.changeLanguage("zh-TW");
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: {
          login_agreement_enabled: true,
          login_agreement_documents: [
            { id: "terms", title: "后台默认标题", content_md: "Terms" },
            { id: "privacy", title: "Custom Privacy Notice", content_md: "Privacy" },
          ],
        },
      }),
    });

    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route element={<PublicLayout />}>
            <Route path="/" element={<div>Home</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByRole("link", { name: "服務條款" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Custom Privacy Notice" })).toBeInTheDocument();
  });

  it("localizes Japanese navigation and footer copy", async () => {
    await i18n.changeLanguage("ja");
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, data: { login_agreement_enabled: false, login_agreement_documents: [] } }),
    });
    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes><Route element={<PublicLayout />}><Route path="/" element={<div>Home</div>} /></Route></Routes>
      </MemoryRouter>,
    );

    expect(screen.getAllByRole("link", { name: "料金" })).toHaveLength(2);
    expect(screen.getByRole("link", { name: "ログイン" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "コンソールを開く" })).toBeInTheDocument();
    expect(screen.getByText("プロダクト")).toBeInTheDocument();
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
  });
});
