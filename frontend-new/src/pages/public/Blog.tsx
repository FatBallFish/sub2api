import React from "react";
import { motion } from "motion/react";

const posts = [
  { slug: "introducing-mikiko-cc", title: "Introducing Mikiko CC", date: "June 18, 2026", summary: "A new era of AI coding infrastructure is here." },
  { slug: "claude-3-5-sonnet-support", title: "Claude 3.5 Sonnet Support", date: "June 10, 2026", summary: "How to use the latest Claude models with Mikiko CC." },
];

export default function Blog() {
  return (
    <>
      <div className="pt-32 pb-24 px-8 max-w-4xl mx-auto space-y-12">
        <div>
          <h1 className="text-4xl font-bold tracking-tight text-zinc-900">Blog & Updates</h1>
          <p className="mt-2 text-zinc-500">The latest news, tips, and updates from the Mikiko CC team.</p>
        </div>

        <div className="space-y-12">
          {posts.map((post) => (
            <motion.div key={post.slug} className="group cursor-pointer">
              <span className="text-xs font-bold text-zinc-400 uppercase tracking-widest">{post.date}</span>
              <h2 className="text-2xl font-bold text-zinc-900 mt-2 group-hover:text-zinc-600 transition-colors">{post.title}</h2>
              <p className="text-zinc-500 mt-2 leading-relaxed">{post.summary}</p>
              <button className="text-sm font-bold text-zinc-900 mt-4 underline underline-offset-4">Read Article</button>
            </motion.div>
          ))}
        </div>
      </div>
    </>
  );
}
