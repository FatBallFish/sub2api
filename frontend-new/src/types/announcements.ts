export type AnnouncementNotifyMode = "silent" | "popup";
export const ANNOUNCEMENT_CATEGORIES = ["notice", "model", "feature", "release"] as const;
export type AnnouncementCategory = (typeof ANNOUNCEMENT_CATEGORIES)[number];

export interface UserAnnouncement {
  id: number;
  title: string;
  content: string;
  notify_mode: AnnouncementNotifyMode;
  starts_at?: string;
  ends_at?: string;
  read_at?: string;
  created_at: string;
  updated_at: string;
}
