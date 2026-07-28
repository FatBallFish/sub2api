import React from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  Globe,
  ShieldCheck,
  Lightning,
  Terminal,
  TrendUp
} from "@phosphor-icons/react";
import { motion } from "motion/react";
import { isAuthenticated } from "../../utils/authStorage";

export default function Home() {
  const gatewayEndpoint = typeof window === "undefined" ? "https://console.example.com/v1" : `${window.location.origin}/v1`;
  const ctaHref = isAuthenticated() ? "/console" : "/login";

  return (
    <>
      {/* Hero Section */}
      <section className="pt-32 pb-20 px-8 max-w-7xl mx-auto">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.8, ease: "easeOut" }}
            className="space-y-8"
          >
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-zinc-100 border border-zinc-200 text-[10px] font-bold uppercase tracking-widest text-zinc-500">
              <Lightning size={12} weight="fill" className="text-amber-500" />
              Now supporting Claude 3.5 & Gemini 1.5
            </div>
            <h1 className="text-5xl md:text-7xl font-bold tracking-tight leading-[1.1]">
              One endpoint for every <span className="text-zinc-400">AI coding service.</span>
            </h1>
            <p className="text-lg text-zinc-500 leading-relaxed max-w-md">
              The professional gateway for Codex, Claude, and Gemini. Transparent pricing, weekly resets, and enterprise-grade observability.
            </p>
            <div className="flex flex-col sm:flex-row items-center gap-4">
              <Link to={ctaHref} className="w-full sm:w-auto flex items-center justify-center gap-2 bg-zinc-900 text-white px-8 py-4 rounded-full font-bold hover:scale-[1.02] active:scale-[0.98] transition-all shadow-xl shadow-zinc-200 group">
                Get API Key
                <ArrowRight size={18} weight="bold" className="group-hover:translate-x-1 transition-transform" />
              </Link>
              <Link to="/pricing" className="w-full sm:w-auto text-sm font-bold text-zinc-500 hover:text-zinc-900 transition-colors">
                View Pricing
              </Link>
            </div>
            <div className="flex items-center gap-4 text-xs font-medium text-zinc-400">
              <div className="flex -space-x-2">
                {[1, 2, 3, 4].map(i => (
                  <div key={i} className="h-6 w-6 rounded-full border-2 border-white bg-zinc-100" />
                ))}
              </div>
              New users get $10.50 credits on signup
            </div>
          </motion.div>

          {/* Visual Placeholder */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 1, ease: "easeOut", delay: 0.2 }}
            className="relative aspect-square lg:aspect-video rounded-3xl bg-zinc-50 border border-zinc-200 overflow-hidden shadow-2xl group"
          >
            <div className="absolute inset-0 bg-gradient-to-br from-zinc-100/50 to-transparent" />
            <div className="absolute top-8 left-8 right-8 bg-zinc-900 rounded-xl border border-zinc-800 shadow-2xl overflow-hidden transform group-hover:-translate-y-2 transition-transform duration-700">
              <div className="flex items-center gap-1.5 px-4 py-3 bg-zinc-800/50 border-b border-zinc-800">
                <div className="h-2 w-2 rounded-full bg-rose-500/50" />
                <div className="h-2 w-2 rounded-full bg-amber-500/50" />
                <div className="h-2 w-2 rounded-full bg-emerald-500/50" />
                <span className="ml-2 text-[10px] font-mono text-zinc-500 tracking-wider">config.toml</span>
              </div>
              <pre className="p-6 text-[11px] md:text-xs font-mono text-zinc-400 leading-relaxed overflow-x-auto">
                <code>{`[model_providers.mikiko]
name = "Mikiko CC"
base_url = "${gatewayEndpoint}"
api_key = "sk-....9p3m"

[routing]
model = "claude-3-5-sonnet"
priority = 1
fallback = "codex-turbo"`}</code>
              </pre>
            </div>
            <Terminal size={120} weight="thin" className="absolute -right-8 -bottom-8 text-zinc-200 group-hover:text-zinc-300 transition-colors duration-700" />
          </motion.div>
        </div>
      </section>

      {/* Trust Bar */}
      <section className="py-12 border-y border-zinc-100 bg-zinc-50/50">
        <div className="max-w-7xl mx-auto px-8 flex flex-col items-center gap-8">
          <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-400">Supported Clients & Tools</span>
          <div className="flex flex-wrap justify-center gap-x-12 gap-y-8 opacity-40 hover:opacity-100 transition-opacity duration-500">
            {["Codex CLI", "Claude Code", "Gemini CLI", "OpenCode", "CC Switch"].map(name => (
              <span key={name} className="text-sm font-bold tracking-tight grayscale">{name}</span>
            ))}
          </div>
        </div>
      </section>

      {/* Value Prop */}
      <section className="py-24 px-8 max-w-7xl mx-auto">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-12">
          {[
            { icon: Globe, title: "One Endpoint", desc: "Access every major AI coding model through a single, stable API endpoint." },
            { icon: ShieldCheck, title: "Key Management", desc: "Create, rotate, and audit keys with granular usage limits and expiration." },
            { icon: TrendUp, title: "Usage Tracking", desc: "Real-time observability into token consumption, costs, and performance." },
          ].map((item, i) => (
            <motion.div
              key={i}
              whileHover={{ y: -5 }}
              className="space-y-4"
            >
              <div className="h-12 w-12 rounded-2xl bg-zinc-50 border border-zinc-200 flex items-center justify-center text-zinc-900 shadow-sm">
                <item.icon size={24} weight="duotone" />
              </div>
              <h3 className="text-xl font-bold tracking-tight">{item.title}</h3>
              <p className="text-sm text-zinc-500 leading-relaxed">{item.desc}</p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* CTA Footer */}
      <section className="py-32 px-8">
        <div className="max-w-4xl mx-auto p-12 rounded-[2.5rem] bg-zinc-900 text-white text-center space-y-8 relative overflow-hidden shadow-2xl">
          <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 h-64 w-64 bg-white/5 rounded-full blur-3xl" />
          <h2 className="text-4xl md:text-5xl font-bold tracking-tight">Ready to build?</h2>
          <p className="text-zinc-400 max-w-lg mx-auto leading-relaxed">
            Join thousands of developers using our gateway to power their AI coding workflows.
            No credit card required to start.
          </p>
          <div className="pt-4">
            <Link to={ctaHref} className="inline-flex items-center gap-2 bg-white text-zinc-900 px-8 py-4 rounded-full font-bold hover:scale-105 transition-all active:scale-95">
              Get Started for Free
              <ArrowRight size={18} weight="bold" />
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
