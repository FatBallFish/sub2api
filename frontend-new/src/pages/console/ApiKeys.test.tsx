import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import ApiKeys from "./ApiKeys";
import i18n from "../../i18n";

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
      if (url.endsWith("/api/v1/groups/rates")) {
        return Promise.resolve(
          new Response(JSON.stringify({ success: true, data: { "10": 0.55 } }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
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
    expect(await screen.findByText("0.550x")).toBeInTheDocument();
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

  it("localizes the API key table and actions while keeping backend fields raw across a runtime switch", async () => {
    await i18n.changeLanguage("zh-CN");
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = input.toString();
      if (url.endsWith("/api/v1/groups/available")) {
        return Promise.resolve(new Response(JSON.stringify({ success: true, data: [] }), { status: 200 }));
      }
      if (url.endsWith("/api/v1/groups/rates")) {
        return Promise.resolve(new Response(JSON.stringify({ success: true, data: {} }), { status: 200 }));
      }
      if (url.endsWith("/api/v1/settings/public")) {
        return Promise.resolve(new Response(JSON.stringify({ success: true, data: { hide_ccs_import_button: true } }), { status: 200 }));
      }
      if (url.endsWith("/api/v1/usage/dashboard/api-keys-usage")) {
        return Promise.resolve(new Response(JSON.stringify({ success: true, data: { stats: {} } }), { status: 200 }));
      }
      return Promise.resolve(new Response(JSON.stringify({
        success: true,
        data: {
          items: [{
            id: 100,
            user_id: 1,
            key: "sk-live-prod-abcdef",
            name: "Production Gateway",
            group_id: 10,
            group: { id: 10, name: "Backend Group", description: "Backend group description", platform: "openai", rate_multiplier: 0.75 },
            status: "active",
            quota: 0,
            quota_used: 12.5,
            last_used_at: null,
            created_at: "2026-06-01T00:00:00Z",
            updated_at: "2026-06-01T00:00:00Z",
          }],
          total: 1,
          page: 1,
          page_size: 10,
          pages: 1,
        },
      }), { status: 200, headers: { "Content-Type": "application/json" } }));
    });
    globalThis.fetch = fetchMock;

    renderApiKeys();

    expect(screen.getByText("正在加载 API 密钥...")).toBeInTheDocument();
    await screen.findByText("Production Gateway");
    expect(screen.getByRole("heading", { name: "API 密钥" })).toBeInTheDocument();
    expect(screen.getByText("Backend Group")).toBeInTheDocument();
    expect(screen.getByText("Backend group description")).toBeInTheDocument();
    expect(screen.getAllByText("启用").length).toBeGreaterThan(0);
    expect(screen.getByText("无限制", { exact: false })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "复制 Production Gateway" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "编辑 Production Gateway" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "停用 Production Gateway" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "删除 Production Gateway" })).toBeInTheDocument();
    expect(document.title).toBe("API 密钥 | Mikiko CC");
    const initialRequests = fetchMock.mock.calls.length;

    await userEvent.click(screen.getByRole("button", { name: "全部密钥" }));
    expect(screen.queryByText("正在加载 API 密钥...")).not.toBeInTheDocument();
    expect(screen.getByText("Production Gateway")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(initialRequests);

    await act(async () => {
      await i18n.changeLanguage("ja");
    });

    expect(screen.getByRole("heading", { name: "API キー" })).toBeInTheDocument();
    expect(screen.getByText("Backend Group")).toBeInTheDocument();
    expect(screen.getByText("Backend group description")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Production Gateway を編集" })).toBeInTheDocument();
    expect(screen.getByText("無制限", { exact: false })).toBeInTheDocument();
    expect(document.title).toBe("API キー | Mikiko CC");
    expect(fetchMock).toHaveBeenCalledTimes(initialRequests);
  });

  it("localizes modal, group selection, validation, and creation success", async () => {
    await i18n.changeLanguage("zh-CN");
    let createAttempts = 0;
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      if (url.endsWith("/api/v1/groups/available")) {
        return Promise.resolve(new Response(JSON.stringify({ success: true, data: [{
          id: 11,
          name: "Tokyo Premium",
          description: "Backend configured routing",
          platform: "anthropic",
          rate_multiplier: 0.75,
        }] }), { status: 200, headers: { "Content-Type": "application/json" } }));
      }
      if (url.endsWith("/api/v1/groups/rates")) {
        return Promise.resolve(new Response(JSON.stringify({ success: true, data: {} }), { status: 200 }));
      }
      if (url.endsWith("/api/v1/settings/public")) {
        return Promise.resolve(new Response(JSON.stringify({ success: true, data: {} }), { status: 200 }));
      }
      if (url.endsWith("/api/v1/keys") && init?.method === "POST") {
        createAttempts += 1;
        if (createAttempts === 1) {
          return Promise.resolve(new Response(JSON.stringify({
            success: false,
            reason: "CUSTOM_MUTATION_CODE",
            message: "Configured mutation detail",
          }), { status: 400, headers: { "Content-Type": "application/json" } }));
        }
        return Promise.resolve(new Response(JSON.stringify({ success: true, data: {
          id: 101,
          user_id: 1,
          key: "sk-created",
          name: "Tokyo Client",
          group_id: 11,
          status: "active",
          quota: 25,
          quota_used: 0,
          last_used_at: null,
          created_at: "2026-06-01T00:00:00Z",
          updated_at: "2026-06-01T00:00:00Z",
        } }), { status: 200, headers: { "Content-Type": "application/json" } }));
      }
      return Promise.resolve(new Response(JSON.stringify({ success: true, data: { items: [], total: 0, page: 1, page_size: 10, pages: 0 } }), { status: 200, headers: { "Content-Type": "application/json" } }));
    });
    globalThis.fetch = fetchMock;

    renderApiKeys();
    await screen.findByText("暂无 API 密钥");
    await userEvent.click(screen.getByRole("button", { name: "创建新密钥" }));

    expect(screen.getByRole("heading", { name: "创建 API 密钥" })).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "创建 API 密钥" })).toBeInTheDocument();
    expect(screen.getByLabelText("密钥名称")).toHaveValue("本地开发");
    await waitFor(() => expect(screen.getByLabelText("密钥名称")).toHaveFocus());
    await userEvent.tab({ shift: true });
    expect(screen.getByRole("button", { name: "创建密钥" })).toHaveFocus();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "创建 API 密钥" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "创建新密钥" })).toHaveFocus();

    await userEvent.click(screen.getByRole("button", { name: "创建新密钥" }));
    expect(screen.getAllByText("分组").length).toBeGreaterThan(0);
    expect(screen.getByLabelText("配额")).toHaveAttribute("placeholder", "无限制");
    await userEvent.click(screen.getByRole("button", { name: "选择分组" }));
    expect(screen.getByText("Tokyo Premium")).toBeInTheDocument();
    expect(screen.getByText("Backend configured routing")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("option", { name: /Tokyo Premium Backend configured routing Claude 0\.750x/ }));

    fireEvent.change(screen.getByLabelText("密钥名称"), { target: { value: " " } });
    await userEvent.click(screen.getByRole("button", { name: "创建密钥" }));
    expect(screen.getByText("请输入密钥名称。")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("密钥名称"), { target: { value: "Tokyo Client" } });
    fireEvent.change(screen.getByLabelText("配额"), { target: { value: "25" } });
    await userEvent.click(screen.getByRole("button", { name: "创建密钥" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Configured mutation detail");
    expect(screen.getByRole("dialog", { name: "创建 API 密钥" })).toBeInTheDocument();
    expect(screen.getByText("暂无 API 密钥")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "关闭错误提示" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "创建密钥" }));

    expect(await screen.findByText("已创建 API 密钥“Tokyo Client”。")).toBeInTheDocument();
    expect(screen.getByText("Tokyo Client")).toBeInTheDocument();
    const requestCount = fetchMock.mock.calls.length;

    await act(async () => {
      await i18n.changeLanguage("ja");
    });

    expect(screen.getByText("API キー「Tokyo Client」を作成しました。")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(requestCount);
  });

  it("keeps the table available after clipboard failure and provides accessible CCSwitch dialog recovery", async () => {
    await i18n.changeLanguage("zh-CN");
    const writeText = vi.fn()
      .mockRejectedValueOnce(new DOMException("Clipboard blocked", "NotAllowedError"))
      .mockResolvedValueOnce(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = input.toString();
      if (url.includes("/reveal")) {
        return Promise.resolve(new Response(JSON.stringify({ success: true, data: { key: "sk-live-full-value" } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }));
      }
      if (url.endsWith("/api/v1/groups/available")) {
        return Promise.resolve(new Response(JSON.stringify({ success: true, data: [] }), { status: 200 }));
      }
      if (url.endsWith("/api/v1/groups/rates")) {
        return Promise.resolve(new Response(JSON.stringify({ success: true, data: {} }), { status: 200 }));
      }
      if (url.endsWith("/api/v1/settings/public")) {
        return Promise.resolve(new Response(JSON.stringify({ success: true, data: { hide_ccs_import_button: false } }), { status: 200 }));
      }
      if (url.endsWith("/api/v1/usage/dashboard/api-keys-usage")) {
        return Promise.resolve(new Response(JSON.stringify({ success: true, data: { stats: {} } }), { status: 200 }));
      }
      return Promise.resolve(new Response(JSON.stringify({
        success: true,
        data: {
          items: [{
            id: 100,
            user_id: 1,
            key: "sk-live-prod-abcdef",
            name: "Production Gateway",
            group_id: 10,
            group: { id: 10, name: "Antigravity Group", platform: "antigravity", rate_multiplier: 0.75 },
            status: "active",
            quota: 100,
            quota_used: 2,
            last_used_at: null,
            created_at: "2026-06-01T00:00:00Z",
            updated_at: "2026-06-01T00:00:00Z",
          }],
          total: 1,
          page: 1,
          page_size: 10,
          pages: 1,
        },
      }), { status: 200, headers: { "Content-Type": "application/json" } }));
    });
    globalThis.fetch = fetchMock;

    renderApiKeys();
    await screen.findByText("Production Gateway");
    const copyButton = screen.getByRole("button", { name: "复制 Production Gateway" });
    await userEvent.click(copyButton);

    expect(await screen.findByRole("alert")).toHaveTextContent("无法复制此 API 密钥。");
    expect(screen.getByText("Production Gateway")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "API 密钥" })).toBeInTheDocument();

    await act(async () => {
      await i18n.changeLanguage("ja");
    });
    expect(screen.getByRole("alert")).toHaveTextContent("この API キーをコピーできませんでした。");

    await userEvent.click(screen.getByRole("button", { name: "エラーを閉じる" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Production Gateway をコピー" }));
    expect(await screen.findByText("API キー「Production Gateway」をコピーしました。")).toBeInTheDocument();

    const importButton = screen.getByRole("button", { name: "Production Gateway を CCSwitch にインポート" });
    await userEvent.click(importButton);
    const dialog = screen.getByRole("dialog", { name: "CCSwitch にインポート" });
    expect(within(dialog).getByRole("button", { name: "Claude Code" })).toHaveFocus();
    await userEvent.tab({ shift: true });
    expect(within(dialog).getByRole("button", { name: "キャンセル" })).toHaveFocus();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "CCSwitch にインポート" })).not.toBeInTheDocument();
    expect(importButton).toHaveFocus();
  });

  it("localizes stable API errors and preserves unknown backend messages", async () => {
    await i18n.changeLanguage("ja");
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      success: false,
      reason: "API_KEY_NOT_FOUND",
      message: "backend english should not leak",
    }), { status: 404, headers: { "Content-Type": "application/json" } }));
    globalThis.fetch = fetchMock;

    const { unmount } = renderApiKeys();
    expect(await screen.findByRole("heading", { name: "API キーを利用できません" })).toBeInTheDocument();
    expect(screen.getByText("API キーが見つかりません。")).toBeInTheDocument();
    unmount();

    globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      success: false,
      reason: "CUSTOM_BACKEND_CODE",
      message: "Configured backend detail",
    }), { status: 400, headers: { "Content-Type": "application/json" } }));
    renderApiKeys();
    expect(await screen.findByText("Configured backend detail")).toBeInTheDocument();
  });
});
