import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import InstallGuide from "./InstallGuide";

describe("InstallGuide", () => {
  const originalLocation = window.location;

  afterEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: originalLocation,
    });
  });

  it("loads existing keys and reveals the selected key before copying config", async () => {
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { origin: "https://console.example.com" },
    });

    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

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
          new Response(JSON.stringify({ success: true, data: { api_base_url: "https://console.example.com" } }), {
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
                  key: "sk-live-prod-abcdef",
                  name: "Production Gateway",
                  group_id: 10,
                  group: { id: 10, name: "Default", platform: "openai" },
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

    render(
      <MemoryRouter initialEntries={["/console/install-guide?key=100"]}>
        <InstallGuide />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText("Production Gateway")).toBeInTheDocument();
    });
    expect(screen.getByText("~/.codex/config.toml")).toBeInTheDocument();
    expect(screen.getByText("~/.codex/auth.json")).toBeInTheDocument();
    expect(screen.getByText(/base_url = "https:\/\/console.example.com\/v1"/i)).toBeInTheDocument();
    expect(screen.getByText(/"OPENAI_API_KEY": "sk-....cdef"/i)).toBeInTheDocument();
    expect(screen.queryByText(/api_key = "sk-....cdef"/i)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /copy all configuration/i }));

    expect(fetchMock).toHaveBeenCalledWith("/api/v1/keys/100/reveal", expect.objectContaining({ method: "POST" }));
    const copied = String(writeText.mock.calls.at(-1)?.[0] ?? "");
    expect(copied).toContain("# ~/.codex/config.toml");
    expect(copied).toContain('"OPENAI_API_KEY": "sk-live-full-value"');
    expect(copied).not.toContain('api_key = "sk-live-full-value"');
  });

  it("localizes the guide and copy controls without translating API key data or refetching", async () => {
    await i18n.changeLanguage("ja");
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = input.toString();
      if (url.includes("/reveal")) {
        return Promise.resolve(new Response(JSON.stringify({ success: true, data: { key: "sk-live-value" } })));
      }
      if (url.endsWith("/api/v1/settings/public")) {
        return Promise.resolve(new Response(JSON.stringify({ success: true, data: {} })));
      }
      return Promise.resolve(new Response(JSON.stringify({
        success: true,
        data: {
          items: [{
            id: 100,
            key: "sk-live-prod-abcdef",
            name: "Production Gateway",
            group_id: 10,
            group: { id: 10, name: "Default", platform: "openai" },
            status: "active",
            quota: 100,
            quota_used: 25,
            last_used_at: null,
            created_at: "2026-06-01T00:00:00Z",
            updated_at: "2026-06-01T00:00:00Z",
          }],
          total: 1,
          page: 1,
          page_size: 20,
          pages: 1,
        },
      })));
    });
    globalThis.fetch = fetchMock;

    render(
      <MemoryRouter initialEntries={["/console/install-guide"]}>
        <InstallGuide />
      </MemoryRouter>,
    );

    expect(await screen.findByRole("heading", { name: "インストールガイド" })).toBeInTheDocument();
    expect(document.title).toBe("インストールガイド | Mikiko CC");
    expect(screen.getByRole("heading", { name: "APIキーを選択" })).toBeInTheDocument();
    expect(screen.getByText("Production Gateway")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "~/.codex/config.toml をコピー" })).toBeInTheDocument();

    const requestCount = fetchMock.mock.calls.length;
    await i18n.changeLanguage("zh-CN");
    expect(await screen.findByRole("heading", { name: "安装指南" })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(requestCount);

    await userEvent.click(screen.getByRole("button", { name: "复制全部配置" }));
    expect(writeText).toHaveBeenCalled();
  });
});
