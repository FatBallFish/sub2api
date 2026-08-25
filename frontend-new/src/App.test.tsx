import { act, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import i18n from "./i18n";
import App from "./App";

const jsonResponse = (data: unknown) =>
  new Response(JSON.stringify({ success: true, data }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

const blockedPublicSettings = {
  site_name: "Mikiko",
  region_block_frontend_enabled: true,
  region_block_frontend_blocked: true,
  region_block_current_region: "CN",
};

describe("App console routes", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("renders the region block page when public settings mark the current visitor blocked", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = input.toString();
      if (url === "/api/v1/settings/public") {
        return Promise.resolve(jsonResponse(blockedPublicSettings));
      }
      return Promise.reject(new Error(`Unexpected request ${url}`));
    });
    globalThis.fetch = fetchMock;

    render(
      <App
        RouterComponent={MemoryRouter}
        routerProps={{ initialEntries: ["/console"] }}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Service unavailable in your region")).toBeInTheDocument();
    });
    expect(screen.getByText(/CN/)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("renders the region block page for auth routes when frontend blocking is enabled", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = input.toString();
      if (url === "/api/v1/settings/public") {
        return Promise.resolve(jsonResponse(blockedPublicSettings));
      }
      return Promise.reject(new Error(`Unexpected request ${url}`));
    });
    globalThis.fetch = fetchMock;

    render(
      <App
        RouterComponent={MemoryRouter}
        routerProps={{ initialEntries: ["/login"] }}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Service unavailable in your region")).toBeInTheDocument();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not block public landing routes when frontend blocking is enabled", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = input.toString();
      if (url === "/api/v1/settings/public") {
        return Promise.resolve(jsonResponse(blockedPublicSettings));
      }
      if (url === "/api/v1/public/pricing") {
        return Promise.resolve(jsonResponse({ plans: [], add_ons: [] }));
      }
      return Promise.reject(new Error(`Unexpected request ${url}`));
    });
    globalThis.fetch = fetchMock;

    render(
      <App
        RouterComponent={MemoryRouter}
        routerProps={{ initialEntries: ["/pricing"] }}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Subscription & Credits")).toBeInTheDocument();
    });
    expect(screen.queryByText("Service unavailable in your region")).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/public/pricing", expect.any(Object));
  });

  it("loads console bootstrap before rendering console routes", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = input.toString();

      if (url === "/api/v1/settings/public") {
        return Promise.resolve(jsonResponse({ site_name: "Mikiko" }));
      }

      if (url.includes("/console/overview")) {
        return Promise.resolve(
          jsonResponse({
            stats: {
              available_credits: 88.25,
              total_requests: 24,
              active_api_keys: 1,
              usage_today: 1.25,
              changes: { available_credits: 0, total_requests: 0, usage_today: 0 },
            },
            usage_trend: [{ date: "2026-06-18", requests: 24, credits: 1.25, tokens: 1200 }],
            primary_key: {
              id: 1,
              name: "Loaded Key",
              masked_key: "sk-....load",
              last_used_at: "2026-06-18T08:00:00Z",
              environments: 1,
            },
            referral_summary: { earnings: 0, invited: 0, orders: 0 },
            latest_announcements: [],
          }),
        );
      }

      return Promise.resolve(
        jsonResponse({
          user: { id: 7, email: "loaded@example.com", role: "user" },
          wallet: { available_balance: 88.25, add_on_credits: 30, currency: "USD" },
          global_plan: {
            active: true,
            name: "Loaded Plan",
            quota_limit: 100,
            quota_used: 25,
            quota_remaining: 75,
            used_percent: 25,
          },
          unread_announcements: 1,
        }),
      );
    });
    globalThis.fetch = fetchMock;

    render(
      <App
        RouterComponent={MemoryRouter}
        routerProps={{ initialEntries: ["/console"] }}
      />,
    );

    expect(screen.getByText("Loading...")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("Loading console...")).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(screen.getByText("loaded@example.com")).toBeInTheDocument();
    });

    expect(screen.getAllByText("Loaded Plan").length).toBeGreaterThan(0);
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/console/bootstrap", expect.any(Object));
  });

  it("renders the redemption page at its authenticated console route", async () => {
    await act(async () => {
      await i18n.changeLanguage("en");
    });
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = input.toString();
      if (url === "/api/v1/settings/public") return Promise.resolve(jsonResponse({ site_name: "Mikiko" }));
      if (url === "/api/v1/console/bootstrap") {
        return Promise.resolve(jsonResponse({
          user: { id: 7, email: "redeem@example.com", role: "user" },
          wallet: { available_balance: 18.75, add_on_credits: 0, currency: "USD" },
          global_plan: {
            active: true,
            name: "Starter",
            quota_limit: 10,
            quota_used: 2,
            quota_remaining: 8,
            used_percent: 20,
          },
          unread_announcements: 0,
          affiliate_enabled: true,
        }));
      }
      if (url === "/api/v1/user/profile") {
        return Promise.resolve(jsonResponse({ id: 7, balance: 18.75, concurrency: 4 }));
      }
      if (url === "/api/v1/redeem/history") return Promise.resolve(jsonResponse([]));
      return Promise.reject(new Error(`Unexpected request ${url}`));
    });
    globalThis.fetch = fetchMock;

    render(
      <App
        RouterComponent={MemoryRouter}
        routerProps={{ initialEntries: ["/console/redeem"] }}
      />,
    );

    expect(await screen.findByRole("heading", { name: "Redeem Code", level: 1 })).toBeInTheDocument();
    expect(screen.getByTestId("console-shell")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Redeem" })).toHaveAttribute("aria-current", "page");
    expect(document.title).toBe("Redeem | Mikiko CC");
  });

  it("refreshes console bootstrap on an interval so credit state stays current", async () => {
    let bootstrapRefresh: (() => void) | undefined;
    const setIntervalSpy = vi.spyOn(window, "setInterval").mockImplementation((handler: TimerHandler, timeout?: number) => {
      if (timeout === 60_000 && typeof handler === "function") {
        bootstrapRefresh = () => {
          handler();
        };
      }
      return 1;
    });
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = input.toString();

      if (url === "/api/v1/settings/public") {
        return Promise.resolve(jsonResponse({ site_name: "Mikiko" }));
      }

      if (url.includes("/console/overview")) {
        return Promise.resolve(
          jsonResponse({
            stats: {
              available_credits: 88.25,
              total_requests: 24,
              active_api_keys: 1,
              usage_today: 1.25,
              changes: { available_credits: 0, total_requests: 0, usage_today: 0 },
            },
            usage_trend: [{ date: "2026-06-18", requests: 24, credits: 1.25, tokens: 1200 }],
            primary_key: undefined,
            referral_summary: { earnings: 0, invited: 0, orders: 0 },
            latest_announcements: [],
          }),
        );
      }

      const bootstrapCalls = fetchMock.mock.calls.filter(([request]) => request.toString() === "/api/v1/console/bootstrap").length;
      return Promise.resolve(
        jsonResponse({
          user: { id: 7, email: "loaded@example.com", role: "user" },
          wallet: { available_balance: bootstrapCalls > 1 ? 91.5 : 88.25, add_on_credits: 30, currency: "USD" },
          global_plan: {
            active: true,
            name: bootstrapCalls > 1 ? "Refreshed Plan" : "Loaded Plan",
            quota_limit: 100,
            quota_used: bootstrapCalls > 1 ? 20 : 25,
            quota_remaining: bootstrapCalls > 1 ? 80 : 75,
            used_percent: bootstrapCalls > 1 ? 20 : 25,
          },
          unread_announcements: 1,
        }),
      );
    });
    globalThis.fetch = fetchMock;

    render(
      <App
        RouterComponent={MemoryRouter}
        routerProps={{ initialEntries: ["/console"] }}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("loaded@example.com")).toBeInTheDocument();
    });
    expect(screen.getAllByText(/88\.250000/).length).toBeGreaterThan(0);
    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 60_000);

    bootstrapRefresh?.();

    await waitFor(() => {
      expect(screen.getAllByText(/91\.500000/).length).toBeGreaterThan(0);
    });
    expect(screen.getAllByText("Refreshed Plan").length).toBeGreaterThan(0);
  });

  it("renders payment result route and verifies returned order", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = input.toString();
      if (url === "/api/v1/settings/public") {
        return Promise.resolve(
          new Response(JSON.stringify({ success: true, data: {} }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }
      if (url === "/api/v1/payment/public/orders/verify") {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              success: true,
              data: {
                out_trade_no: "sub2_paid",
                status: "COMPLETED",
                paid: true,
                created_at: "2026-06-18T08:00:00Z",
                expires_at: "2026-06-18T09:00:00Z",
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        );
      }
      return Promise.reject(new Error(`Unexpected request ${url}`));
    });
    globalThis.fetch = fetchMock;

    render(
      <App
        RouterComponent={MemoryRouter}
        routerProps={{ initialEntries: ["/payment/result?out_trade_no=sub2_paid"] }}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Payment completed")).toBeInTheDocument();
    });

    expect(screen.getByText("sub2_paid")).toBeInTheDocument();
    expect(screen.getByText("Completed")).toBeInTheDocument();
    expect(screen.getByText("Created")).toBeInTheDocument();
    expect(screen.getByText("Expires")).toBeInTheDocument();
    expect(screen.queryByText("Amount")).not.toBeInTheDocument();
    expect(screen.queryByText("Credited")).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(/NaN|undefined/);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/payment/public/orders/verify",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ out_trade_no: "sub2_paid" }),
      }),
    );
  });

  it("localizes initial loading and blocked-region copy without translating backend values", async () => {
    await i18n.changeLanguage("zh-TW");
    let resolveSettings!: (value: Response) => void;
    const settingsPromise = new Promise<Response>((resolve) => {
      resolveSettings = resolve;
    });
    globalThis.fetch = vi.fn().mockReturnValue(settingsPromise);

    render(<App RouterComponent={MemoryRouter} routerProps={{ initialEntries: ["/login"] }} />);

    expect(screen.getByText("載入中...")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "切換語言" })).toBeInTheDocument();
    expect(document.title).toBe("載入中 | Mikiko CC");

    resolveSettings(jsonResponse(blockedPublicSettings));

    expect(await screen.findByRole("heading", { name: "你所在的地區暫不提供服務" })).toBeInTheDocument();
    expect(screen.getByText(/CN/)).toBeInTheDocument();
    expect(screen.getByText("Mikiko")).toBeInTheDocument();
    expect(document.title).toBe("服務不可用 | Mikiko CC");
  });

  it("localizes the console bootstrap failure and preserves a useful backend message", async () => {
    await i18n.changeLanguage("zh-CN");
    globalThis.fetch = vi.fn((input: RequestInfo | URL) => {
      if (input.toString() === "/api/v1/settings/public") return Promise.resolve(jsonResponse({}));
      return Promise.resolve(new Response(JSON.stringify({
        success: false,
        message: "Backend diagnostic",
      }), {
        status: 503,
        headers: { "Content-Type": "application/json" },
      }));
    });

    render(<App RouterComponent={MemoryRouter} routerProps={{ initialEntries: ["/console"] }} />);

    expect(await screen.findByRole("heading", { name: "控制台暂时不可用" })).toBeInTheDocument();
    expect(screen.getByText("Backend diagnostic")).toBeInTheDocument();
    expect(document.title).toBe("控制台不可用 | Mikiko CC");

    await act(async () => {
      await i18n.changeLanguage("ja");
    });
    expect(screen.getByText("Backend diagnostic")).toBeInTheDocument();
  });

  it("updates a synthetic console error without replaying the bootstrap request", async () => {
    await i18n.changeLanguage("zh-CN");
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      if (input.toString() === "/api/v1/settings/public") return Promise.resolve(jsonResponse({}));
      return Promise.resolve(new Response(null, { status: 503 }));
    });
    globalThis.fetch = fetchMock;

    render(<App RouterComponent={MemoryRouter} routerProps={{ initialEntries: ["/console"] }} />);

    expect(await screen.findByText("无法加载控制台。")).toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(([input]) => input.toString() === "/api/v1/console/bootstrap")).toHaveLength(1);

    await act(async () => {
      await i18n.changeLanguage("ja");
    });

    expect(screen.getByText("コンソールを読み込めませんでした。")).toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(([input]) => input.toString() === "/api/v1/console/bootstrap")).toHaveLength(1);
  });
});
