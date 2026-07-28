import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import UsageHistory from "./UsageHistory";

function jsonResponse(data: unknown) {
  return new Response(JSON.stringify({ success: true, data }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("UsageHistory", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("renders usage metrics and rows from the usage endpoints", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = input.toString();
      if (url.includes("/usage/stats")) {
        return Promise.resolve(
          jsonResponse({
            total_requests: 1294,
            total_tokens: 14200000,
            total_actual_cost: 42.912345,
            average_duration_ms: 1400,
          }),
        );
      }
      return Promise.resolve(
        jsonResponse({
          items: [
            {
              id: 1,
              api_key_id: 9,
              request_id: "req_1",
              model: "claude-3-5-sonnet",
              inbound_endpoint: "/v1/chat/completions",
              upstream_endpoint: "/v1/messages",
              input_tokens: 1024,
              output_tokens: 400,
              cache_read_tokens: 2800,
              cache_creation_tokens: 0,
              actual_cost: 0.054321,
              total_cost: 0.054321,
              funding_source: "mixed",
              global_plan_cost: 0.04,
              balance_cost: 0.014321,
              group_subscription_cost: 0,
              first_token_ms: 120,
              duration_ms: 1200,
              created_at: "2026-06-18T08:00:00Z",
              api_key: { id: 9, name: "Prod-CLI" },
            },
          ],
          total: 1,
          page: 1,
          page_size: 20,
        }),
      );
    });
    globalThis.fetch = fetchMock;

    render(<UsageHistory />);

    expect(screen.getByText("Loading usage history...")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("1,294")).toBeInTheDocument();
    });

    expect(screen.getByText("14.2M")).toBeInTheDocument();
    expect(screen.getByText("42.912345")).toBeInTheDocument();
    expect(screen.getAllByText("Prod-CLI").length).toBeGreaterThan(0);
    expect(screen.getByText("claude-3-5-sonnet")).toBeInTheDocument();
    expect(screen.getByText("1,024 / 400")).toBeInTheDocument();
    expect(screen.getByText("Mixed funding")).toBeInTheDocument();
    expect(screen.getByText("0.054321")).toBeInTheDocument();
    expect(screen.getByText("Plan 0.040000 + Wallet 0.014321")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/api/v1/usage?page=1&page_size=20"), expect.any(Object));
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("start_date="), expect.any(Object));
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/api/v1/usage/stats?start_date="), expect.any(Object));

    const objectUrl = "blob:usage-history";
    const createObjectURL = vi.spyOn(URL, "createObjectURL").mockReturnValue(objectUrl);
    const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const click = vi.fn();
    const anchor = document.createElement("a");
    anchor.click = click;
    const createElement = vi.spyOn(document, "createElement");
    createElement.mockImplementation((tagName: string, options?: ElementCreationOptions) => {
      if (tagName === "a") return anchor;
      return Document.prototype.createElement.call(document, tagName, options);
    });

    fireEvent.click(screen.getByRole("button", { name: /export csv/i }));

    const blob = createObjectURL.mock.calls[0][0] as Blob;
    await expect(blob.text()).resolves.toContain("0.054321,Mixed funding,0.040000,0.014321,0.000000");
    expect(anchor.download).toBe("usage-history.csv");
    expect(anchor.href).toBe(objectUrl);
    expect(click).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalledWith(objectUrl);
  });

  it("reloads usage logs when searching by model", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = input.toString();
      if (url.includes("/usage/stats")) {
        return Promise.resolve(jsonResponse({ total_requests: 0, total_tokens: 0, total_actual_cost: 0, average_duration_ms: 0 }));
      }
      return Promise.resolve(jsonResponse({ items: [], total: 0, page: 1, page_size: 20 }));
    });
    globalThis.fetch = fetchMock;

    render(<UsageHistory />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/api/v1/usage?"), expect.any(Object)));

    fireEvent.change(screen.getByPlaceholderText("Search by model or endpoint..."), { target: { value: "codex" } });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("model=codex"), expect.any(Object));
    });
  });

  it("refreshes usage history with the current filters", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = input.toString();
      if (url.includes("/usage/stats")) {
        return Promise.resolve(jsonResponse({ total_requests: 0, total_tokens: 0, total_actual_cost: 0, average_duration_ms: 0 }));
      }
      return Promise.resolve(jsonResponse({ items: [], total: 0, page: 1, page_size: 20 }));
    });
    globalThis.fetch = fetchMock;

    render(<UsageHistory />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/api/v1/usage?"), expect.any(Object)));

    fireEvent.change(screen.getByPlaceholderText("Search by model or endpoint..."), { target: { value: "codex" } });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("model=codex"), expect.any(Object));
    });
    const callsBeforeRefresh = fetchMock.mock.calls.length;

    fireEvent.click(screen.getByRole("button", { name: /refresh usage history/i }));

    await waitFor(() => {
      expect(fetchMock.mock.calls.length).toBeGreaterThan(callsBeforeRefresh);
    });
    const refreshCalls = fetchMock.mock.calls.slice(callsBeforeRefresh).map(([request]) => request.toString());
    expect(refreshCalls.some((url) => url.includes("/api/v1/usage?") && url.includes("model=codex"))).toBe(true);
  });

  it("persists custom visible columns in browser storage", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = input.toString();
      if (url.includes("/usage/stats")) {
        return Promise.resolve(jsonResponse({ total_requests: 0, total_tokens: 0, total_actual_cost: 0, average_duration_ms: 0 }));
      }
      return Promise.resolve(jsonResponse({ items: [], total: 0, page: 1, page_size: 20 }));
    });
    globalThis.fetch = fetchMock;

    const { unmount } = render(<UsageHistory />);

    await waitFor(() => expect(screen.getByText("Usage History")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /columns/i }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Tokens" }));

    expect(localStorage.getItem("mikiko.usage-history.columns.v1")).toContain("Credits");
    expect(localStorage.getItem("mikiko.usage-history.columns.v1")).not.toContain("Tokens");

    unmount();
    render(<UsageHistory />);

    await waitFor(() => expect(screen.getByText("Usage History")).toBeInTheDocument());
    expect(screen.queryByRole("columnheader", { name: "Tokens" })).not.toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Credits" })).toBeInTheDocument();
  });

  it("filters stats and logs by selected API key", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = input.toString();
      if (url === "/api/v1/settings/public") {
        return Promise.resolve(jsonResponse({ table_default_page_size: 20, table_page_size_options: [20, 50] }));
      }
      if (url.includes("/api/v1/keys?")) {
        return Promise.resolve(jsonResponse({
          items: [
            { id: 9, name: "Prod-CLI", key: "sk-....prod", group_id: null, status: "active", quota: 0, quota_used: 0, last_used_at: null, created_at: "2026-06-01T00:00:00Z", updated_at: "2026-06-01T00:00:00Z" },
            { id: 12, name: "Web-App", key: "sk-....web", group_id: null, status: "active", quota: 0, quota_used: 0, last_used_at: null, created_at: "2026-06-01T00:00:00Z", updated_at: "2026-06-01T00:00:00Z" },
          ],
          total: 2,
          page: 1,
          page_size: 100,
          pages: 1,
        }));
      }
      if (url.includes("/usage/stats")) {
        return Promise.resolve(jsonResponse({ total_requests: 1, total_tokens: 100, total_actual_cost: 1, average_duration_ms: 100 }));
      }
      if (url.includes("api_key_id=9")) {
        return Promise.resolve(
          jsonResponse({
            items: [
              {
                id: 1,
                api_key_id: 9,
                request_id: "req_1",
                model: "claude-3-5-sonnet",
                input_tokens: 10,
                output_tokens: 20,
                cache_read_tokens: 0,
                cache_creation_tokens: 0,
                actual_cost: 0.1,
                total_cost: 0.1,
                duration_ms: 100,
                created_at: "2026-06-18T08:00:00Z",
                api_key: { id: 9, name: "Prod-CLI" },
              },
            ],
            total: 1,
            page: 1,
            page_size: 20,
          }),
        );
      }
      return Promise.resolve(
        jsonResponse({
          items: [
            {
              id: 1,
              api_key_id: 9,
              request_id: "req_1",
              model: "claude-3-5-sonnet",
              input_tokens: 10,
              output_tokens: 20,
              cache_read_tokens: 0,
              cache_creation_tokens: 0,
              actual_cost: 0.1,
              total_cost: 0.1,
              duration_ms: 100,
              created_at: "2026-06-18T08:00:00Z",
              api_key: { id: 9, name: "Prod-CLI" },
            },
            {
              id: 2,
              api_key_id: 12,
              request_id: "req_2",
              model: "gpt-5.5",
              input_tokens: 30,
              output_tokens: 40,
              cache_read_tokens: 0,
              cache_creation_tokens: 0,
              actual_cost: 0.2,
              total_cost: 0.2,
              duration_ms: 200,
              created_at: "2026-06-18T09:00:00Z",
              api_key: { id: 12, name: "Web-App" },
            },
          ],
          total: 2,
          page: 1,
          page_size: 20,
        }),
      );
    });
    globalThis.fetch = fetchMock;

    render(<UsageHistory />);

    await waitFor(() => {
      expect(screen.getAllByText("Prod-CLI").length).toBeGreaterThan(0);
    });

    fireEvent.change(screen.getByLabelText("API key"), { target: { value: "9" } });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("api_key_id=9"), expect.any(Object));
    });
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/api/v1/usage?"), expect.any(Object));
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/api/v1/usage/stats?"), expect.any(Object));
    const apiKeySelect = screen.getByLabelText("API key") as HTMLSelectElement;
    expect(Array.from(apiKeySelect.options).map((option) => option.textContent)).toEqual([
      "All API Keys",
      "Prod-CLI",
      "Web-App",
    ]);
  });

  it("filters stats and logs by today and paginates using configured page sizes", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = input.toString();
      if (url === "/api/v1/settings/public") {
        return Promise.resolve(jsonResponse({ table_default_page_size: 50, table_page_size_options: [10, 50, 100] }));
      }
      if (url.includes("/usage/stats")) {
        return Promise.resolve(jsonResponse({ total_requests: 50, total_tokens: 5000, total_actual_cost: 5, average_duration_ms: 250 }));
      }
      return Promise.resolve(jsonResponse({ items: [], total: 125, page: 1, page_size: 50 }));
    });
    globalThis.fetch = fetchMock;

    render(<UsageHistory />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/v1/settings/public", expect.any(Object));
    });
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/api/v1/usage?page=1&page_size=50"), expect.any(Object));
    });

    fireEvent.change(screen.getByLabelText("Time range"), { target: { value: "today" } });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining(`start_date=${today}`),
        expect.any(Object),
      );
    });
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining(`end_date=${today}`), expect.any(Object));
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining(`/api/v1/usage/stats?start_date=${today}&end_date=${today}`), expect.any(Object));

    fireEvent.change(screen.getByLabelText("Rows per page"), { target: { value: "100" } });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("page_size=100"),
        expect.any(Object),
      );
    });
    expect(screen.getByText("Page 1 of 2")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Next page" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("page=2"),
        expect.any(Object),
      );
    });
  });
});
