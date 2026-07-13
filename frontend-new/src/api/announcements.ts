import { getJSON, postJSON } from "./client";
import type { UserAnnouncement } from "../types/announcements";

export function listAnnouncements(unreadOnly = false) {
  return getJSON<UserAnnouncement[]>(`/announcements${unreadOnly ? "?unread_only=1" : ""}`);
}

export function markAnnouncementRead(id: number) {
  return postJSON<{ message: string }>(`/announcements/${id}/read`);
}
