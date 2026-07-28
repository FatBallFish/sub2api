import { afterEach, describe, expect, it, vi } from "vitest";
import { listAnnouncements, markAnnouncementRead } from "./announcements";

describe("announcements api", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("lists announcements and supports unread filtering", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true, data: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    globalThis.fetch = fetchMock;

    await listAnnouncements(true);

    expect(fetchMock).toHaveBeenCalledWith("/api/v1/announcements?unread_only=1", expect.any(Object));
  });

  it("marks an announcement as read", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true, data: { message: "ok" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    globalThis.fetch = fetchMock;

    await markAnnouncementRead(10);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/announcements/10/read",
      expect.objectContaining({ method: "POST" }),
    );
  });
});
