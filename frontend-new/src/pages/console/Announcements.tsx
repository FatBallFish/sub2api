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
import { listAnnouncements, markAnnouncementRead } from "../../api/announcements";
import type { UserAnnouncement } from "../../types/announcements";
import { MarkdownContent } from "../../utils/markdown";

function formatDate(value: string) {
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) return "Recently";
  return new Intl.DateTimeFormat("en-US", { month: "long", day: "2-digit", year: "numeric" }).format(timestamp);
}

function categoryFor(item: UserAnnouncement) {
  if (item.notify_mode === "popup") return "Notice";
  const content = `${item.title} ${item.content}`.toLowerCase();
  if (content.includes("model")) return "Model";
  if (content.includes("feature") || content.includes("wallet")) return "Feature";
  return "Release";
}

function categoryIcon(category: string) {
  if (category === "Release") return <Lightning size={20} weight="fill" />;
  if (category === "Model") return <Cpu size={20} weight="fill" />;
  if (category === "Feature") return <Tag size={20} weight="fill" />;
  return <Megaphone size={20} weight="fill" />;
}

function categoryClass(category: string) {
  if (category === "Release") return "bg-emerald-50 border-emerald-100 text-emerald-600";
  if (category === "Model") return "bg-purple-50 border-purple-100 text-purple-600";
  if (category === "Feature") return "bg-blue-50 border-blue-100 text-blue-600";
  return "bg-amber-50 border-amber-100 text-amber-600";
}

export default function Announcements() {
  const [announcements, setAnnouncements] = useState<UserAnnouncement[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
          setError(reason instanceof Error ? reason.message : "Unable to load announcements.");
        }
      });

    return () => {
      active = false;
    };
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return announcements;
    return announcements.filter((item) => `${item.title} ${item.content}`.toLowerCase().includes(q));
  }, [announcements, search]);

  const featured = filtered[0];

  const markRead = async (item: UserAnnouncement) => {
    if (item.read_at) return;
    await markAnnouncementRead(item.id);
    setAnnouncements((current) =>
      current.map((ann) => (ann.id === item.id ? { ...ann, read_at: new Date().toISOString() } : ann)),
    );
  };

  if (error) {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-700">
        <h1 className="text-lg font-semibold text-rose-900">Announcements unavailable</h1>
        <p className="mt-2">{error}</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex min-h-[360px] items-center justify-center rounded-2xl border border-zinc-200 bg-white text-sm font-medium text-zinc-500">
        Loading announcements...
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900">Announcements</h1>
          <p className="text-zinc-500 text-sm">Stay updated with the latest product releases, maintenance notices, and model integrations.</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <MagnifyingGlass size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
            <input
              type="text"
              placeholder="Search..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="pl-10 pr-4 py-2 bg-white border border-zinc-200 rounded-xl text-sm outline-none focus:border-zinc-900 transition-colors w-48"
            />
          </div>
        </div>
      </div>

      {featured && (
        <div className="console-inverted-panel p-8 bg-zinc-900 rounded-[2.5rem] text-white flex flex-col md:flex-row items-center gap-8 relative overflow-hidden group">
          <div className="absolute top-0 right-0 h-full w-1/2 bg-gradient-to-l from-white/5 to-transparent" />
          <Megaphone size={120} weight="thin" className="absolute -right-8 -bottom-8 text-white/5 group-hover:text-white/10 transition-colors duration-700" />

          <div className="relative z-10 flex-1 space-y-4">
            <div className="flex items-center gap-2">
              <span className="console-inverted-label px-2 py-0.5 rounded-full bg-white/10 text-white text-[10px] font-bold uppercase tracking-widest border border-white/20">Featured</span>
              <span className="text-xs text-zinc-500 font-medium">{formatDate(featured.created_at)}</span>
              {featured.read_at && <span className="text-xs text-emerald-300 font-medium">Read</span>}
            </div>
            <h2 className="text-3xl font-bold tracking-tight">{featured.title}</h2>
            <MarkdownContent content={featured.content} className="console-inverted-copy text-zinc-400 leading-relaxed max-w-xl" />
            <button
              onClick={() => void markRead(featured)}
              className="flex items-center gap-2 text-sm font-bold text-white group"
              aria-label={`Mark ${featured.title} as read`}
            >
              {featured.read_at ? "Read" : "Mark as read"}
              {featured.read_at ? <CheckCircle size={16} weight="fill" /> : <ArrowRight size={16} weight="bold" className="group-hover:translate-x-1 transition-transform" />}
            </button>
          </div>
        </div>
      )}

      <div className="space-y-4">
        {filtered.length === 0 && (
          <div className="rounded-2xl border border-zinc-200 bg-white p-12 text-center text-sm text-zinc-500">
            No announcements found.
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
                    {item.read_at && <span className="text-xs text-emerald-600 font-bold">Read</span>}
                    <span className="text-xs text-zinc-400 font-medium whitespace-nowrap">{formatDate(item.created_at)}</span>
                  </div>
                </div>
                <MarkdownContent content={item.content} className="console-announcement-copy text-sm text-zinc-500 leading-relaxed max-w-3xl" />
                <div className="pt-2 flex items-center gap-3">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">{category}</span>
                  {!item.read_at && (
                    <button
                      onClick={() => void markRead(item)}
                      aria-label={`Mark ${item.title} as read`}
                      className="text-[10px] font-bold uppercase tracking-widest text-zinc-900 hover:text-zinc-500 transition-colors"
                    >
                      Mark read
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
