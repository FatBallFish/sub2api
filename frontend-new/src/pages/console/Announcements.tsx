import { useEffect, useMemo, useState } from "react";
import {
  Megaphone,
  Tag,
  MagnifyingGlass,
  ArrowRight,
  Lightning,
  Cpu,
  CheckCircle,
} from "@phosphor-icons/react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import { listAnnouncements, markAnnouncementRead } from "../../api/announcements";
import { usePageTitle } from "../../hooks/usePageTitle";
import type { UserAnnouncement } from "../../types/announcements";
import {
  errorMessage,
  resolveLocalizedMessage,
  type LocalizedMessage,
} from "../../utils/localizedMessage";
import { MarkdownContent } from "../../utils/markdown";

type AnnouncementCategory = "notice" | "model" | "feature" | "release";
type AnnouncementFilter = "all" | "unread";

function formatDate(value: string, locale: string, recently: string) {
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) return recently;
  return new Intl.DateTimeFormat(locale, {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(timestamp);
}

function categoryFor(item: UserAnnouncement): AnnouncementCategory {
  if (item.notify_mode === "popup") return "notice";
  const content = `${item.title} ${item.content}`.toLowerCase();
  if (content.includes("model")) return "model";
  if (content.includes("feature") || content.includes("wallet")) return "feature";
  return "release";
}

function categoryIcon(category: AnnouncementCategory) {
  if (category === "release") return <Lightning size={20} weight="fill" />;
  if (category === "model") return <Cpu size={20} weight="fill" />;
  if (category === "feature") return <Tag size={20} weight="fill" />;
  return <Megaphone size={20} weight="fill" />;
}

function categoryClass(category: AnnouncementCategory) {
  if (category === "release") return "bg-emerald-50 border-emerald-100 text-emerald-600";
  if (category === "model") return "bg-purple-50 border-purple-100 text-purple-600";
  if (category === "feature") return "bg-blue-50 border-blue-100 text-blue-600";
  return "bg-amber-50 border-amber-100 text-amber-600";
}

export default function Announcements() {
  const { t, i18n } = useTranslation("console");
  const locale = i18n.resolvedLanguage || i18n.language || "en";
  const [announcements, setAnnouncements] = useState<UserAnnouncement[]>([]);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<AnnouncementFilter>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<LocalizedMessage | null>(null);
  const [actionError, setActionError] = useState<LocalizedMessage | null>(null);
  usePageTitle(t("announcements.title"));

  useEffect(() => {
    let active = true;

    listAnnouncements()
      .then((data) => {
        if (active) {
          setLoading(false);
          setAnnouncements(data);
          setError(null);
        }
      })
      .catch((reason: unknown) => {
        if (active) {
          setLoading(false);
          setError(errorMessage(reason, "announcementsLoadFailed"));
        }
      });

    return () => {
      active = false;
    };
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return announcements.filter((item) => {
      if (filter === "unread" && item.read_at) return false;
      return !q || `${item.title} ${item.content}`.toLowerCase().includes(q);
    });
  }, [announcements, filter, search]);

  const featured = filtered[0];

  const markRead = async (item: UserAnnouncement) => {
    if (item.read_at) return;
    try {
      await markAnnouncementRead(item.id);
      setAnnouncements((current) =>
        current.map((ann) => (ann.id === item.id ? { ...ann, read_at: new Date().toISOString() } : ann)),
      );
      setActionError(null);
    } catch (reason: unknown) {
      setActionError(errorMessage(reason, "announcementMarkReadFailed"));
    }
  };

  if (error) {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-700">
        <h1 className="text-lg font-semibold text-rose-900">{t("announcements.unavailable")}</h1>
        <p className="mt-2">{resolveLocalizedMessage(error)}</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex min-h-[360px] items-center justify-center rounded-2xl border border-zinc-200 bg-white text-sm font-medium text-zinc-500">
        {t("announcements.loading")}
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900">{t("announcements.title")}</h1>
          <p className="text-zinc-500 text-sm">{t("announcements.description")}</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <MagnifyingGlass size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
            <input
              type="text"
              placeholder={t("announcements.searchPlaceholder")}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="pl-10 pr-4 py-2 bg-white border border-zinc-200 rounded-xl text-sm outline-none focus:border-zinc-900 transition-colors w-48"
            />
          </div>
          <select
            value={filter}
            onChange={(event) => setFilter(event.target.value as AnnouncementFilter)}
            aria-label={t("announcements.filterLabel")}
            className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm outline-none transition-colors focus:border-zinc-900"
          >
            <option value="all">{t("announcements.filterAll")}</option>
            <option value="unread">{t("announcements.filterUnread")}</option>
          </select>
        </div>
      </div>

      {actionError && (
        <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {resolveLocalizedMessage(actionError)}
        </div>
      )}

      {featured && (
        <div className="console-inverted-panel p-8 bg-zinc-900 rounded-[2.5rem] text-white flex flex-col md:flex-row items-center gap-8 relative overflow-hidden group">
          <div className="absolute top-0 right-0 h-full w-1/2 bg-gradient-to-l from-white/5 to-transparent" />
          <Megaphone size={120} weight="thin" className="absolute -right-8 -bottom-8 text-white/5 group-hover:text-white/10 transition-colors duration-700" />

          <div className="relative z-10 flex-1 space-y-4">
            <div className="flex items-center gap-2">
              <span className="console-inverted-label px-2 py-0.5 rounded-full bg-white/10 text-white text-[10px] font-bold uppercase tracking-widest border border-white/20">{t("announcements.featured")}</span>
              <span className="text-xs text-zinc-500 font-medium">{formatDate(featured.created_at, locale, t("announcements.recently"))}</span>
              {featured.read_at && <span className="text-xs text-emerald-300 font-medium">{t("announcements.read")}</span>}
            </div>
            <h2 className="text-3xl font-bold tracking-tight">{featured.title}</h2>
            <MarkdownContent content={featured.content} className="console-inverted-copy text-zinc-400 leading-relaxed max-w-xl" />
            <button
              onClick={() => void markRead(featured)}
              disabled={Boolean(featured.read_at)}
              className="flex items-center gap-2 text-sm font-bold text-white group"
              aria-label={featured.read_at ? t("announcements.read") : t("announcements.markAsReadLabel", { title: featured.title })}
            >
              {featured.read_at ? t("announcements.read") : t("announcements.markAsRead")}
              {featured.read_at ? <CheckCircle size={16} weight="fill" /> : <ArrowRight size={16} weight="bold" className="group-hover:translate-x-1 transition-transform" />}
            </button>
          </div>
        </div>
      )}

      <div className="space-y-4">
        {filtered.length === 0 && (
          <div className="rounded-2xl border border-zinc-200 bg-white p-12 text-center text-sm text-zinc-500">
            {t("announcements.empty")}
          </div>
        )}
        {filtered.map((item, i) => {
          const category = categoryFor(item);
          return (
            <motion.div
              key={item.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
              className="p-6 bg-white border border-zinc-200 rounded-2xl hover:shadow-md transition-shadow group flex items-start gap-6"
            >
              <div className={`p-3 rounded-xl border shrink-0 ${categoryClass(category)}`}>
                {categoryIcon(category)}
              </div>
              <div className="flex-1 space-y-1">
                <div className="flex items-center justify-between gap-4">
                  <h3 className="font-bold text-zinc-900 group-hover:text-zinc-600 transition-colors">{item.title}</h3>
                  <div className="flex items-center gap-3">
                    {item.read_at && <span className="text-xs text-emerald-600 font-bold">{t("announcements.read")}</span>}
                    <span className="text-xs text-zinc-400 font-medium whitespace-nowrap">{formatDate(item.created_at, locale, t("announcements.recently"))}</span>
                  </div>
                </div>
                <MarkdownContent content={item.content} className="console-announcement-copy text-sm text-zinc-500 leading-relaxed max-w-3xl" />
                <div className="pt-2 flex items-center gap-3">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">{t(`announcements.categories.${category}`)}</span>
                  {!item.read_at && (
                    <button
                      onClick={() => void markRead(item)}
                      aria-label={t("announcements.markAsReadLabel", { title: item.title })}
                      className="text-[10px] font-bold uppercase tracking-widest text-zinc-900 hover:text-zinc-500 transition-colors"
                    >
                      {t("announcements.markRead")}
                    </button>
                  )}
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
