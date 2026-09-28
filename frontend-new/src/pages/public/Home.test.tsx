import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import i18n from "../../i18n";
import Home from "./Home";

describe("Home page", () => {
  afterEach(() => {
    localStorage.clear();
  });

  it("routes hero CTAs to login for anonymous visitors", () => {
    render(
      <MemoryRouter>
        <Home />
      </MemoryRouter>,
    );

    expect(screen.getByRole("link", { name: /get api key/i })).toHaveAttribute("href", "/login");
    expect(screen.getByRole("link", { name: /get started for free/i })).toHaveAttribute("href", "/login");
  });

  it("routes hero CTAs directly to console for authenticated visitors", () => {
    localStorage.setItem("auth_token", "token");
    localStorage.setItem("auth_user", JSON.stringify({ id: 7, email: "signed@example.com" }));

    render(
      <MemoryRouter>
        <Home />
      </MemoryRouter>,
    );

    expect(screen.getByRole("link", { name: /get api key/i })).toHaveAttribute("href", "/console");
    expect(screen.getByRole("link", { name: /get started for free/i })).toHaveAttribute("href", "/console");
  });

  it("renders Japanese fixed copy and updates the page title on a runtime language change", async () => {
    await i18n.changeLanguage("ja");
    render(<MemoryRouter><Home /></MemoryRouter>);

    expect(screen.getByRole("heading", { name: "すべての AI コーディングサービスを、ひとつのエンドポイントで。" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "API キーを取得" })).toHaveAttribute("href", "/login");
    expect(document.title).toBe("ホーム | Mikiko CC");

    await i18n.changeLanguage("zh-TW");
    expect(document.title).toBe("首頁 | Mikiko CC");
  });
});
