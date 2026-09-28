import React from "react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import { usePageTitle } from "../../hooks/usePageTitle";
import { formatDate } from "../../utils/format";

export default function Blog() {
  const { t } = useTranslation("public");
  usePageTitle(t("pageTitles.blog"));
  const posts = [
    { slug: "introducing-mikiko-cc", title: t("blog.posts.introducingTitle"), date: "2026-06-18", summary: t("blog.posts.introducingSummary") },
    { slug: "claude-3-5-sonnet-support", title: t("blog.posts.claudeTitle"), date: "2026-06-10", summary: t("blog.posts.claudeSummary") },
  ];

  return (
    <>
      <div className="pt-32 pb-24 px-8 max-w-4xl mx-auto space-y-12">
        <div>
          <h1 className="text-4xl font-bold tracking-tight text-zinc-900">{t("blog.heading")}</h1>
          <p className="mt-2 text-zinc-500">{t("blog.description")}</p>
        </div>

        <div className="space-y-12">
          {posts.map((post) => (
            <motion.div key={post.slug} className="group cursor-pointer">
              <span className="text-xs font-bold text-zinc-400 uppercase tracking-widest">{formatDate(post.date, undefined, { timeZone: "UTC" })}</span>
              <h2 className="text-2xl font-bold text-zinc-900 mt-2 group-hover:text-zinc-600 transition-colors">{post.title}</h2>
              <p className="text-zinc-500 mt-2 leading-relaxed">{post.summary}</p>
              <button className="text-sm font-bold text-zinc-900 mt-4 underline underline-offset-4">{t("blog.readArticle")}</button>
            </motion.div>
          ))}
        </div>
      </div>
    </>
  );
}
