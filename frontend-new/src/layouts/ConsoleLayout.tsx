import React, { useMemo, useState } from "react";
import { Outlet, NavLink, useLocation, useNavigate } from "react-router-dom";
import {
  Layout,
  Key,
  CreditCard,
  Users,
  ChartBar,
  Clock,
  Megaphone,
  UserCircle,
  CaretRight,
  Wallet,
  SignOut,
  Flask,
  Moon,
  Sun,
} from "@phosphor-icons/react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { ConsoleBootstrap } from "../types/console";
import { clearAuthStorage } from "../utils/authStorage";
import { formatCredits } from "../utils/format";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

type ConsoleTheme = "light" | "dark";

const CONSOLE_THEME_STORAGE_KEY = "mikiko.console.theme.v1";

function readConsoleTheme(): ConsoleTheme {
  if (typeof window === "undefined") return "light";
  return window.localStorage.getItem(CONSOLE_THEME_STORAGE_KEY) === "dark" ? "dark" : "light";
}

function persistConsoleTheme(theme: ConsoleTheme) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(CONSOLE_THEME_STORAGE_KEY, theme);
}

const navItems = [
  { name: "Overview", href: "/console", icon: Layout },
  { name: "API Keys", href: "/console/api-keys", icon: Key },
  { name: "Playground", href: "/console/playground", icon: Flask },
  { name: "Subscription & Credits", href: "/console/subscription-wallet", icon: CreditCard },
  { name: "Referral", href: "/console/referral", icon: Users },
  { name: "Model Pricing", href: "/console/model-pricing", icon: ChartBar },
  { name: "Usage History", href: "/console/usage-history", icon: Clock },
  { name: "Announcements", href: "/console/announcements", icon: Megaphone },
];

const fallbackBootstrap: ConsoleBootstrap = {
  user: { id: 0, email: "user@example.com", name: "User", role: "user" },
  wallet: { available_balance: 120.5, add_on_credits: 10.5, currency: "USD" },
  global_plan: {
    active: true,
    name: "Pro Plan",
    quota_limit: 60,
    quota_used: 27,
    quota_remaining: 33,
    used_percent: 45,
  },
  unread_announcements: 0,
  affiliate_enabled: true,
};

interface ConsoleLayoutProps {
  bootstrap?: ConsoleBootstrap;
}

export default function ConsoleLayout({ bootstrap = fallbackBootstrap }: ConsoleLayoutProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [theme, setTheme] = useState<ConsoleTheme>(() => readConsoleTheme());
  const planPercent = Math.min(Math.max(bootstrap.global_plan.used_percent, 0), 100);
  const visibleNavItems = useMemo(
    () => navItems.filter((item) => item.name !== "Referral" || bootstrap.affiliate_enabled !== false),
    [bootstrap.affiliate_enabled],
  );

  const logout = () => {
    clearAuthStorage();
    navigate("/login", { replace: true });
  };

  const toggleTheme = () => {
    setTheme((current) => {
      const next = current === "dark" ? "light" : "dark";
      persistConsoleTheme(next);
      return next;
    });
  };

  const isDark = theme === "dark";

  return (
    <div
      data-testid="console-shell"
      data-theme={theme}
      className={cn("console-shell flex min-h-screen bg-zinc-50/50", isDark && "console-theme-dark")}
    >
      {/* Sidebar */}
      <aside className="fixed inset-y-0 left-0 w-64 border-r border-zinc-200 bg-white">
        <div className="flex h-16 items-center px-6 border-b border-zinc-100">
          <span className="text-xl font-bold tracking-tight">Mikiko CC</span>
        </div>

        <nav className="flex flex-col gap-1 p-4">
          {visibleNavItems.map((item) => {
            const isActive = location.pathname === item.href;
            return (
              <NavLink
                key={item.name}
                to={item.href}
                className={cn(
                  "flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200",
                  isActive
                    ? "bg-zinc-100 text-zinc-900 shadow-sm"
                    : "text-zinc-500 hover:text-zinc-900 hover:bg-zinc-50"
                )}
              >
                <item.icon size={20} weight={isActive ? "fill" : "regular"} />
                {item.name}
              </NavLink>
            );
          })}
        </nav>

        <div className="absolute bottom-0 left-0 right-0 p-4 border-t border-zinc-100 bg-white z-10">
          <div className="console-credit-card flex items-center gap-3 px-3 py-3 rounded-lg bg-zinc-900 text-white shadow-lg cursor-pointer hover:bg-zinc-800 transition-colors relative overflow-hidden group">
            <div className="absolute left-0 top-0 bottom-0 w-1 bg-emerald-500" />
            <Wallet size={24} weight="fill" className="text-zinc-400 shrink-0" />
            <div className="flex flex-col flex-1">
              <span className="console-credit-balance text-sm font-bold text-white leading-none mb-1">{formatCredits(bootstrap.wallet.available_balance)} <span className="console-credit-unit text-[10px] text-zinc-400 uppercase tracking-widest ml-0.5 font-normal">Credits</span></span>
              <span className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold">{bootstrap.global_plan.name}</span>
              <div className="w-full h-1 bg-zinc-800 rounded-full mt-1.5 overflow-hidden">
                <div className="h-full bg-emerald-500" style={{ width: `${planPercent}%` }} />
              </div>
            </div>
            <CaretRight size={16} className="text-zinc-600 group-hover:text-zinc-400 transition-colors shrink-0" />
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="console-main flex-1 ml-64">
        {/* Topbar */}
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between px-8 bg-white/80 backdrop-blur-md border-b border-zinc-200/50">
          <div className="flex items-center gap-2">
            <span className="text-sm text-zinc-400">Console</span>
            <span className="text-zinc-300">/</span>
            <span className="text-sm font-medium text-zinc-900">
              {visibleNavItems.find(i => i.href === location.pathname)?.name || "Overview"}
            </span>
          </div>

          <div className="flex items-center gap-4">
            <button
              type="button"
              aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
              onClick={toggleTheme}
              className="h-8 w-8 rounded-full border border-zinc-200 bg-white text-zinc-600 flex items-center justify-center hover:bg-zinc-50 transition-colors"
            >
              {isDark ? <Sun size={17} weight="bold" /> : <Moon size={17} weight="bold" />}
            </button>
            <div className="flex flex-col items-end mr-2">
              <span className="text-xs font-medium text-zinc-900">{bootstrap.user.email}</span>
              <span className="text-[10px] text-zinc-400">{bootstrap.global_plan.name}</span>
            </div>
            <button
              type="button"
              aria-label="Open account menu"
              onClick={() => setAccountMenuOpen((open) => !open)}
              className="h-8 w-8 rounded-full bg-zinc-100 border border-zinc-200 flex items-center justify-center text-zinc-600 hover:bg-zinc-200 transition-colors"
            >
              <UserCircle size={20} />
            </button>
            {accountMenuOpen ? (
              <div className="absolute right-8 top-14 w-56 rounded-xl border border-zinc-200 bg-white p-2 shadow-xl">
                <div className="border-b border-zinc-100 px-3 py-2">
                  <div className="text-xs font-bold text-zinc-900">{bootstrap.user.email}</div>
                  <div className="mt-0.5 text-[10px] uppercase tracking-widest text-zinc-400">{bootstrap.user.role}</div>
                </div>
                <button
                  type="button"
                  onClick={logout}
                  className="mt-2 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-50 hover:text-zinc-900"
                >
                  <SignOut size={16} />
                  Log out
                </button>
              </div>
            ) : null}
          </div>
        </header>

        {/* Page Area */}
        <div className="console-page p-8 max-w-7xl mx-auto">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
