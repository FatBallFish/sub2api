import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import ApiKeys from "./ApiKeys";

function renderApiKeys() {
  return render(
    <MemoryRouter>
      <ApiKeys />
    </MemoryRouter>,
  );
}

describe("ApiKeys", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("loads API keys and reveals a key before copying", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);

    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = input.toString();
      if (url.includes("/reveal")) {
        return Promise.resolve(
          new Response(JSON.stringify({ success: true, data: { key: "sk-live-full-value", expires_in_seconds: 60 } }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }
      if (url.endsWith("/api/v1/settings/public")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              success: true,
              data: {
                site_name: "Mikiko CC",
                api_base_url: "https://api.example.com",
                hide_ccs_import_button: false,
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        );
      }
      if (url.endsWith("/api/v1/usage/dashboard/api-keys-usage")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              success: true,
              data: {
                stats: {
                  "100": { api_key_id: 100, today_actual_cost: 1.5, total_actual_cost: 7.5 },
                },
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        );
      }

      return Promise.resolve(
        new Response(
          JSON.stringify({
            code: 0,
            message: "success",
            data: {
              items: [
                {
                  id: 100,
                  user_id: 1,
                  key: "sk-live-prod-abcdef",
                  name: "Production Gateway",
                  group_id: 10,
                  group: {
                    id: 10,
                    name: "Default",
                    description: "Balanced shared OpenAI routing",
                    platform: "openai",
                    rate_multiplier: 0.8,
                  },
                  status: "active",
                  quota: 100,
                  quota_used: 0,
                  last_used_at: "2026-06-18T08:00:00Z",
                  created_at: "2026-06-01T00:00:00Z",
                  updated_at: "2026-06-01T00:00:00Z",
                },
              ],
              total: 1,
              page: 1,
              page_size: 10,
              pages: 1,
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    });
    globalThis.fetch = fetchMock;

    renderApiKeys();

    expect(screen.getByText("Loading API keys...")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("Production Gateway")).toBeInTheDocument();
    });

    expect(screen.getByText("Default")).toBeInTheDocument();
    expect(screen.getByText("OpenAI")).toBeInTheDocument();
    expect(screen.getByText("0.800x")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText("7.500000 / 100.000000")).toBeInTheDocument();
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/usage/dashboard/api-keys-usage",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ api_key_ids: [100] }),
      }),
    );
    expect(screen.getByRole("link", { name: /open install guide for Production Gateway/i })).toHaveAttribute(
      "href",
      "/console/install-guide?key=100",
    );

    await userEvent.click(screen.getByRole("button", { name: /copy Production Gateway/i }));

    expect(writeText).toHaveBeenCalledWith("sk-live-full-value");
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/keys/100/reveal", expect.objectContaining({ method: "POST" }));

    await userEvent.click(screen.getByRole("button", { name: /import Production Gateway to CCSwitch/i }));

    await waitFor(() => {
      expect(openSpy).toHaveBeenCalledWith(expect.stringMatching(/^ccswitch:\/\/v1\/import\?/), "_self");
    });
    const params = new URLSearchParams(String(openSpy.mock.calls.at(-1)?.[0]).split("?")[1]);
    expect(params.get("app")).toBe("codex");
    expect(params.get("endpoint")).toBe("https://api.example.com");
    expect(params.get("apiKey")).toBe("sk-live-full-value");
  });

  it("creates a new API key and adds it to the list", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      if (url.endsWith("/api/v1/groups/available")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              success: true,
              data: [
                {
                  id: 10,
                  name: "Default",
                  description: "Balanced shared OpenAI routing",
                  platform: "openai",
                  rate_multiplier: 1,
                },
                {
                  id: 11,
                  name: "Production",
                  description: "Lower latency Claude subscription pool",
                  platform: "anthropic",
                  rate_multiplier: 0.75,
                },
              ],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        );
      }
      if (url.endsWith("/api/v1/keys") && init?.method === "POST") {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              success: true,
              data: {
                id: 101,
                user_id: 1,
                key: "sk-local-generated",
                name: "Local Development",
                group_id: 11,
                status: "active",
                quota: 25,
                quota_used: 0,
                last_used_at: null,
                created_at: "2026-06-18T00:00:00Z",
                updated_at: "2026-06-18T00:00:00Z",
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        );
      }

      return Promise.resolve(
        new Response(
          JSON.stringify({
            success: true,
            data: {
              items: [],
              total: 0,
              page: 1,
              page_size: 10,
              pages: 0,
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    });
    globalThis.fetch = fetchMock;

    renderApiKeys();

    await waitFor(() => {
      expect(screen.queryByText("Loading API keys...")).not.toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole("button", { name: /create new key/i }));
    fireEvent.change(screen.getByLabelText("Key Name"), { target: { value: "Local Development" } });
    await userEvent.click(screen.getByRole("button", { name: /select group/i }));
    expect(screen.getByText("Lower latency Claude subscription pool")).toBeInTheDocument();
    expect(screen.getByText("Claude")).toBeInTheDocument();
    expect(screen.getByText("0.750x")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("option", { name: /production lower latency claude subscription pool claude 0\.750x/i }));
    fireEvent.change(screen.getByLabelText("Quota"), { target: { value: "25" } });
    await userEvent.click(screen.getByRole("button", { name: /create key/i }));

    await waitFor(() => {
      expect(screen.getByText("Local Development")).toBeInTheDocument();
    });
    expect(screen.getByText("Production")).toBeInTheDocument();
    expect(screen.getByText("Lower latency Claude subscription pool")).toBeInTheDocument();
    expect(screen.getByText("0.750x")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/keys",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ name: "Local Development", quota: 25, group_id: 11 }),
      }),
    );
  });

  it("edits, disables, and deletes an API key", async () => {
    let currentName = "Production Gateway";
    let currentStatus = "active";
    let currentQuota = 100;
    let currentGroupId: number | null = null;
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      if (url.endsWith("/api/v1/groups/available")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              success: true,
              data: [
                {
                  id: 11,
                  name: "Production",
                  description: "Lower latency Claude subscription pool",
                  platform: "anthropic",
                  rate_multiplier: 0.75,
                },
              ],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        );
      }
      if (url.endsWith("/api/v1/keys/100") && init?.method === "PUT") {
        const body = JSON.parse(String(init.body));
        currentName = body.name ?? currentName;
        currentStatus = body.status ?? currentStatus;
        currentQuota = body.quota ?? currentQuota;
        currentGroupId = body.group_id ?? currentGroupId;
        return Promise.resolve(
          new Response(
            JSON.stringify({
              success: true,
              data: {
                id: 100,
                user_id: 1,
                key: "sk-live-prod-abcdef",
                name: currentName,
                group_id: currentGroupId,
                status: currentStatus,
                quota: currentQuota,
                quota_used: 25,
                last_used_at: null,
                created_at: "2026-06-01T00:00:00Z",
                updated_at: "2026-06-18T00:00:00Z",
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        );
      }
      if (url.endsWith("/api/v1/keys/100") && init?.method === "DELETE") {
        return Promise.resolve(
          new Response(JSON.stringify({ success: true, data: { message: "deleted" } }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }

      return Promise.resolve(
        new Response(
          JSON.stringify({
            success: true,
            data: {
              items: [
                {
                  id: 100,
                  user_id: 1,
                  key: "sk-live-prod-abcdef",
                  name: "Production Gateway",
                  group_id: null,
                  status: "active",
                  quota: 100,
                  quota_used: 25,
                  last_used_at: null,
                  created_at: "2026-06-01T00:00:00Z",
                  updated_at: "2026-06-01T00:00:00Z",
                },
              ],
              total: 1,
              page: 1,
              page_size: 10,
              pages: 1,
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    });
    globalThis.fetch = fetchMock;

    renderApiKeys();

    await screen.findByText("Production Gateway");

    await userEvent.click(screen.getByRole("button", { name: /edit Production Gateway/i }));
    fireEvent.change(screen.getByLabelText("Key Name"), { target: { value: "Renamed Gateway" } });
    await userEvent.click(screen.getByRole("button", { name: /select group/i }));
    await userEvent.click(screen.getByRole("option", { name: /production lower latency claude subscription pool claude 0\.750x/i }));
    fireEvent.change(screen.getByLabelText("Quota"), { target: { value: "50" } });
    await userEvent.click(screen.getByRole("button", { name: /^save changes$/i }));

    await waitFor(() => {
      expect(screen.getByText("Renamed Gateway")).toBeInTheDocument();
    });
    expect(screen.getByText("Production")).toBeInTheDocument();
    expect(screen.getByText("Lower latency Claude subscription pool")).toBeInTheDocument();
    expect(screen.getByText("0.750x")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/keys/100",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ name: "Renamed Gateway", quota: 50, group_id: 11 }),
      }),
    );

    await userEvent.click(screen.getByRole("button", { name: /disable Renamed Gateway/i }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/v1/keys/100",
        expect.objectContaining({
          method: "PUT",
          body: JSON.stringify({ status: "inactive" }),
        }),
      );
    });

    await userEvent.click(screen.getByRole("button", { name: /delete Renamed Gateway/i }));
    await waitFor(() => {
      expect(screen.queryByText("Renamed Gateway")).not.toBeInTheDocument();
    });
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/keys/100", expect.objectContaining({ method: "DELETE" }));
  });
});
