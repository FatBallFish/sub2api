export type AnnouncementNotifyMode = "silent" | "popup";

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
