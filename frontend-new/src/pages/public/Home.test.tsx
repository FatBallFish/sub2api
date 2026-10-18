import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import Home from "./Home";

const originalFetch = globalThis.fetch;

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location-probe">{`${location.pathname}${location.search}`}</div>;
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

describe("Home page", () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, data: {} }),
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
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

  it("starts a silent OIDC login for anonymous sso=silent entries", async () => {
    await withMutableWindowLocation(async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ success: true, data: { oidc_console_oauth_enabled: true } }),
      });
      render(
        <MemoryRouter initialEntries={["/?sso=silent"]}>
          <LocationProbe />
          <Home />
        </MemoryRouter>,
      );

      await waitFor(() => {
        expect(window.location.href).toContain("/api/v1/auth/oauth/oidc-console/start");
      });
      expect(window.location.href).toContain("prompt=none");
      expect(window.location.href).toContain("fallback=%2F");
      expect(window.location.href).toContain("redirect=%2Fconsole");
      // sso 参数被摘除，刷新/后退不会重复触发。
      await waitFor(() => {
        expect(screen.getByTestId("location-probe")).toHaveTextContent("/");
      });
    });
  });

  it("takes authenticated sso=silent visitors straight to the console", async () => {
    localStorage.setItem("auth_token", "token");
    localStorage.setItem("auth_user", JSON.stringify({ id: 7, email: "signed@example.com" }));

    render(
      <MemoryRouter initialEntries={["/?sso=silent"]}>
        <LocationProbe />
        <Home />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("location-probe")).toHaveTextContent("/console");
    });
  });

  it("does nothing for sso=silent when the console OIDC entrance is disabled", async () => {
    await withMutableWindowLocation(async () => {
      const initialHref = window.location.href;
      render(
        <MemoryRouter initialEntries={["/?sso=silent"]}>
          <LocationProbe />
          <Home />
        </MemoryRouter>,
      );

      await waitFor(() => {
        expect(screen.getByTestId("location-probe")).toHaveTextContent("/");
      });
      expect(window.location.href).toBe(initialHref);
      expect(screen.getByRole("link", { name: /get api key/i })).toHaveAttribute("href", "/login");
    });
  });
});
