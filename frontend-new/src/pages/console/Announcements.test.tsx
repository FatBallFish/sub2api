import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import Announcements from "./Announcements";

function jsonResponse(data: unknown) {
  return new Response(JSON.stringify({ success: true, data }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("Announcements", () => {
  afterEach(() => {
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
});
