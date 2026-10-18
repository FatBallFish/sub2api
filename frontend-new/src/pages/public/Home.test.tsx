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

  it("heals a token-without-user session on sso=silent and goes straight to the console", async () => {
    // 历史版本 OIDC 登录只落地 token、缺 auth_user：静默入口应先补齐档案再直达。
    localStorage.setItem("auth_token", "stale-token");
    localStorage.setItem("token_expires_at", String(Date.now() + 60_000));
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: { id: 7, email: "healed@example.com", username: "healed" },
      }),
    });

    await withMutableWindowLocation(async () => {
      const initialHref = window.location.href;
      render(
        <MemoryRouter initialEntries={["/?sso=silent"]}>
          <LocationProbe />
          <Home />
        </MemoryRouter>,
      );

      await waitFor(() => {
        expect(screen.getByTestId("location-probe")).toHaveTextContent("/console");
      });
      expect(JSON.parse(localStorage.getItem("auth_user") || "null")).toMatchObject({
        id: 7,
        email: "healed@example.com",
      });
      // 会话补齐后不再重复发起 OIDC 授权。
      expect(window.location.href).not.toContain("/api/v1/auth/oauth/oidc-console/start");
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
      expect(initialHref).not.toContain("/api/v1/auth/oauth/oidc-console/start");
    });
  });

  it("falls back to the silent OIDC attempt when the stale session profile cannot be healed", async () => {
    localStorage.setItem("auth_token", "stale-token");
    localStorage.setItem("token_expires_at", String(Date.now() + 60_000));
    globalThis.fetch = vi.fn()
      // /auth/me 失败（服务器 500，非 401，避免触发登录重定向副作用）。
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({ success: false, message: "boom" }),
      })
      // 随后的公开设置拉取：OIDC 入口开启。
      .mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ success: true, data: { oidc_console_oauth_enabled: true } }),
      });

    await withMutableWindowLocation(async () => {
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
