import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
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

    await waitFor(() => expect(screen.getByRole("link", { name: "Service Terms" })).toBeInTheDocument());
    expect(screen.queryByRole("link", { name: /privacy/i })).not.toBeInTheDocument();
  });
});
