import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";
import Announcements from "./Announcements";

function jsonResponse(data: unknown) {
  return new Response(JSON.stringify({ success: true, data }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("Announcements", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("renders announcements from the user announcements endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse([
        {
          id: 1,
          title: "US Region Now Available",
          content: "Lower latency across North America.",
          notify_mode: "silent",
          created_at: "2026-06-18T08:00:00Z",
          updated_at: "2026-06-18T08:00:00Z",
        },
        {
          id: 2,
          title: "Scheduled Maintenance",
          content: "## Maintenance window\n\nBrief **maintenance** window with `api` checks.",
          notify_mode: "popup",
          read_at: "2026-06-18T09:00:00Z",
          created_at: "2026-06-17T08:00:00Z",
          updated_at: "2026-06-17T08:00:00Z",
        },
      ]),
    );
    globalThis.fetch = fetchMock;

    render(<Announcements />);

    expect(screen.getByText("Loading announcements...")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getAllByText("US Region Now Available").length).toBeGreaterThan(0);
    });

    expect(screen.getAllByText("Featured")[0]).toHaveClass("console-inverted-label");
    expect(screen.getAllByText("Lower latency across North America.")[0].closest(".console-inverted-copy")).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Maintenance window" }).closest(".console-announcement-copy")).not.toBeNull();
    expect(screen.getByText("maintenance").closest(".console-announcement-copy")).not.toBeNull();
    expect(screen.getByText("api").closest(".console-announcement-copy")).not.toBeNull();
    expect(screen.getAllByText("Lower latency across North America.").length).toBeGreaterThan(0);
    expect(screen.getByText("Scheduled Maintenance")).toBeInTheDocument();
    expect(screen.getAllByText("Read").length).toBeGreaterThan(0);
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/announcements", expect.any(Object));
  });

  it("marks an unread announcement as read", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse([
          {
            id: 1,
            title: "Unread release",
            content: "Release content.",
            notify_mode: "silent",
            created_at: "2026-06-18T08:00:00Z",
            updated_at: "2026-06-18T08:00:00Z",
          },
        ]),
      )
      .mockResolvedValueOnce(jsonResponse({ message: "ok" }));
    globalThis.fetch = fetchMock;

    render(<Announcements />);

    await waitFor(() => {
      expect(screen.getAllByText("Unread release").length).toBeGreaterThan(0);
    });

    fireEvent.click(screen.getAllByRole("button", { name: /mark unread release as read/i })[0]);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/v1/announcements/1/read",
        expect.objectContaining({ method: "POST" }),
      );
    });

    expect(screen.getAllByText("Read").length).toBeGreaterThan(0);
  });

  it("renders announcement markdown content", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse([
        {
          id: 1,
          title: "Markdown release",
          content: "## Highlights\n\n- **Fast routing**\n- Region failover",
          notify_mode: "silent",
          created_at: "2026-06-18T08:00:00Z",
          updated_at: "2026-06-18T08:00:00Z",
        },
      ]),
    );
    globalThis.fetch = fetchMock;

    render(<Announcements />);

    await waitFor(() => {
      expect(screen.getAllByRole("heading", { name: "Highlights" }).length).toBeGreaterThan(0);
    });
    expect(screen.getAllByText("Fast routing").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Region failover").length).toBeGreaterThan(0);
  });

  it("renders Traditional Chinese controls and switches locale without refetching announcements", async () => {
    vi.stubEnv("TZ", "Asia/Shanghai");
    await act(async () => {
      await i18n.changeLanguage("zh-TW");
    });
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse([
        {
          id: 1,
          title: "Tokyo model release",
          content: "Dynamic announcement body.",
          notify_mode: "silent",
          created_at: "2026-06-18T18:00:00Z",
          updated_at: "2026-06-18T08:00:00Z",
        },
        {
          id: 2,
          title: "Scheduled maintenance",
          content: "Configured maintenance notice.",
          notify_mode: "popup",
          read_at: "2026-06-18T09:00:00Z",
          created_at: "2026-06-17T08:00:00Z",
          updated_at: "2026-06-17T08:00:00Z",
        },
      ]),
    );
    globalThis.fetch = fetchMock;

    render(<Announcements />);

    expect(screen.getByText("正在載入公告...")).toBeInTheDocument();
    await screen.findByRole("heading", { name: "公告" });

    expect(screen.getByPlaceholderText("搜尋公告...")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "公告篩選" })).toHaveValue("all");
    expect(screen.getAllByText("精選")[0]).toHaveClass("console-inverted-label");
    expect(screen.getAllByText("Tokyo model release").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Dynamic announcement body.").length).toBeGreaterThan(0);
    expect(screen.getAllByText("2026年6月19日").length).toBeGreaterThan(0);
    expect(screen.getAllByText("模型").length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: "將 Tokyo model release 標示為已讀" }).length).toBeGreaterThan(0);

    fireEvent.change(screen.getByRole("combobox", { name: "公告篩選" }), { target: { value: "unread" } });
    expect(screen.queryByText("Scheduled maintenance")).not.toBeInTheDocument();

    await act(async () => {
      await i18n.changeLanguage("ja");
    });

    expect(screen.getByRole("heading", { name: "お知らせ" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "お知らせフィルター" })).toHaveValue("unread");
    expect(screen.getAllByText("Tokyo model release").length).toBeGreaterThan(0);

    fireEvent.change(screen.getByPlaceholderText("お知らせを検索..."), { target: { value: "missing" } });
    expect(screen.getByText("お知らせが見つかりません。")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("localizes an announcement mark-read failure", async () => {
    await act(async () => {
      await i18n.changeLanguage("zh-TW");
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse([
          {
            id: 7,
            title: "Configured title",
            content: "Configured body.",
            notify_mode: "silent",
            created_at: "2026-06-18T08:00:00Z",
            updated_at: "2026-06-18T08:00:00Z",
          },
        ]),
      )
      .mockRejectedValueOnce(new Error("private upstream detail"));
    globalThis.fetch = fetchMock;

    render(<Announcements />);
    const markReadButtons = await screen.findAllByRole("button", { name: "將 Configured title 標示為已讀" });
    fireEvent.click(markReadButtons[0]);

    expect(await screen.findByRole("alert")).toHaveTextContent("無法將公告標示為已讀。");
    expect(screen.getAllByText("Configured title").length).toBeGreaterThan(0);
  });
});
