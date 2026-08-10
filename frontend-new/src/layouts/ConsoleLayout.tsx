import React, { useMemo, useRef, useState } from "react";
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
  List,
  X,
} from "@phosphor-icons/react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { ConsoleBootstrap } from "../types/console";
import { clearAuthStorage } from "../utils/authStorage";
import { formatCredits } from "../utils/format";
import LanguageSwitcher from "../components/LanguageSwitcher";
import { useTranslation } from "react-i18next";
import { usePageTitle } from "../hooks/usePageTitle";
import { useFocusTrap } from "../hooks/useFocusTrap";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

type ConsoleTheme = "light" | "dark";

const CONSOLE_THEME_STORAGE_KEY = "mikiko.console.theme.v1";
const MOBILE_NAVIGATION_ID = "console-mobile-navigation";

function readConsoleTheme(): ConsoleTheme {
  if (typeof window === "undefined") return "light";
  return window.localStorage.getItem(CONSOLE_THEME_STORAGE_KEY) === "dark" ? "dark" : "light";
}

function persistConsoleTheme(theme: ConsoleTheme) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(CONSOLE_THEME_STORAGE_KEY, theme);
}

const navItems = [
  { id: "overview", labelKey: "nav.overview", href: "/console", icon: Layout },
  { id: "apiKeys", labelKey: "nav.apiKeys", href: "/console/api-keys", icon: Key },
  { id: "playground", labelKey: "nav.playground", href: "/console/playground", icon: Flask },
  { id: "subscriptionCredits", labelKey: "nav.subscriptionCredits", href: "/console/subscription-wallet", icon: CreditCard },
  { id: "referral", labelKey: "nav.referral", href: "/console/referral", icon: Users },
  { id: "modelPricing", labelKey: "nav.modelPricing", href: "/console/model-pricing", icon: ChartBar },
  { id: "usageHistory", labelKey: "nav.usageHistory", href: "/console/usage-history", icon: Clock },
  { id: "announcements", labelKey: "nav.announcements", href: "/console/announcements", icon: Megaphone },
] as const;

const routeMetadata = [
  ...navItems.map(({ id, labelKey, href }) => ({ id, labelKey, href })),
  { id: "installGuide", labelKey: "nav.installGuide", href: "/console/install-guide" },
] as const;

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
  const { t } = useTranslation("console");
  const location = useLocation();
  const navigate = useNavigate();
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [theme, setTheme] = useState<ConsoleTheme>(() => readConsoleTheme());
  const mobileNavTriggerRef = useRef<HTMLButtonElement>(null);
  const mobileNavCloseRef = useRef<HTMLButtonElement>(null);
  const mobileNavRef = useRef<HTMLElement>(null);
  const planPercent = Math.min(Math.max(bootstrap.global_plan.used_percent, 0), 100);
  const visibleNavItems = useMemo(
    () => navItems.filter((item) => item.id !== "referral" || bootstrap.affiliate_enabled !== false),
    [bootstrap.affiliate_enabled],
  );
  const activeRoute = routeMetadata.find((item) => item.href === location.pathname) ?? routeMetadata[0];
  usePageTitle(t(activeRoute.labelKey));

  useFocusTrap({
    active: mobileNavOpen,
    containerRef: mobileNavRef,
    initialFocusRef: mobileNavCloseRef,
    restoreFocusRef: mobileNavTriggerRef,
    onEscape: () => setMobileNavOpen(false),
  });

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

  const closeMobileNavigation = () => setMobileNavOpen(false);

  const closeMobileNavigationOnSelection = () => setMobileNavOpen(false);

  const renderSidebarContent = (onNavigate?: () => void, mobile = false) => (
    <>
      <div className="flex h-16 items-center justify-between border-b border-zinc-100 px-6">
        <span className="text-xl font-bold tracking-tight">Mikiko CC</span>
        {mobile ? (
          <button
            ref={mobileNavCloseRef}
            type="button"
            aria-label={t("shell.closeNavigation")}
            onClick={closeMobileNavigation}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900"
          >
            <X size={20} weight="bold" />
          </button>
        ) : null}
      </div>

      <nav className="flex flex-col gap-1 p-4">
        {visibleNavItems.map((item) => {
          const isActive = location.pathname === item.href;
          return (
            <NavLink
              key={item.id}
              to={item.href}
              end={item.href === "/console"}
              onClick={onNavigate}
              className={cn(
                "flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200",
                isActive
                  ? "bg-zinc-100 text-zinc-900 shadow-sm"
                  : "text-zinc-500 hover:text-zinc-900 hover:bg-zinc-50"
              )}
            >
              <item.icon size={20} weight={isActive ? "fill" : "regular"} />
              <span>{t(item.labelKey)}</span>
              {item.id === "announcements" && bootstrap.unread_announcements > 0 ? (
                <span
                  aria-label={t("shell.unreadAnnouncements", { count: bootstrap.unread_announcements })}
                  className="ml-auto rounded-full bg-rose-100 px-1.5 py-0.5 text-[10px] font-bold text-rose-700"
                >
                  {bootstrap.unread_announcements}
                </span>
              ) : null}
            </NavLink>
          );
        })}
      </nav>

      <div className="absolute bottom-0 left-0 right-0 z-10 border-t border-zinc-100 bg-white p-4">
        <div className="console-credit-card group relative flex items-center gap-3 overflow-hidden rounded-lg bg-zinc-900 px-3 py-3 text-white shadow-lg transition-colors hover:bg-zinc-800">
          <div className="absolute bottom-0 left-0 top-0 w-1 bg-emerald-500" />
          <Wallet size={24} weight="fill" className="shrink-0 text-zinc-400" />
          <div className="flex flex-1 flex-col">
            <span className="console-credit-balance mb-1 text-sm font-bold leading-none text-white">{formatCredits(bootstrap.wallet.available_balance)} <span className="console-credit-unit ml-0.5 text-[10px] font-normal uppercase tracking-widest text-zinc-400">{t("shell.credits")}</span></span>
            <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">{bootstrap.global_plan.name}</span>
            <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-zinc-800">
              <div className="h-full bg-emerald-500" style={{ width: `${planPercent}%` }} />
            </div>
          </div>
          <CaretRight size={16} className="shrink-0 text-zinc-600 transition-colors group-hover:text-zinc-400" />
        </div>
      </div>
    </>
  );

  return (
    <div
      data-testid="console-shell"
      data-theme={theme}
      className={cn("console-shell flex min-h-screen bg-zinc-50/50", isDark && "console-theme-dark")}
    >
      {/* Sidebar */}
      <aside aria-label={t("shell.navigationLabel")} className="fixed inset-y-0 left-0 hidden w-64 border-r border-zinc-200 bg-white lg:block">
        {renderSidebarContent()}
      </aside>

      {mobileNavOpen ? (
        <>
          <button
            type="button"
            aria-label={t("shell.closeNavigation")}
            onClick={closeMobileNavigation}
            className="fixed inset-0 z-40 bg-zinc-950/40 lg:hidden"
          />
          <aside
            ref={mobileNavRef}
            id={MOBILE_NAVIGATION_ID}
            role="dialog"
            aria-modal="true"
            aria-label={t("shell.navigationLabel")}
            className="fixed inset-y-0 left-0 z-50 w-[min(18rem,85vw)] border-r border-zinc-200 bg-white shadow-2xl lg:hidden"
          >
            {renderSidebarContent(closeMobileNavigationOnSelection, true)}
          </aside>
        </>
      ) : null}

      {/* Main Content */}
      <main className="console-main min-w-0 flex-1 ml-0 lg:ml-64">
        {/* Topbar */}
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-2 border-b border-zinc-200/50 bg-white/80 px-4 backdrop-blur-md sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-2">
            <button
              ref={mobileNavTriggerRef}
              type="button"
              aria-label={t("shell.openNavigation")}
              aria-expanded={mobileNavOpen}
              aria-controls={MOBILE_NAVIGATION_ID}
              onClick={() => setMobileNavOpen(true)}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50 lg:hidden"
            >
              <List size={20} weight="bold" />
            </button>
            <span className="hidden text-sm text-zinc-400 sm:inline">{t("shell.console")}</span>
            <span className="hidden text-zinc-300 sm:inline">/</span>
            <span className="truncate text-sm font-medium text-zinc-900">
              {t(activeRoute.labelKey)}
            </span>
          </div>

          <div className="flex shrink-0 items-center gap-2 sm:gap-3">
            <LanguageSwitcher />
            <button
              type="button"
              aria-label={t(isDark ? "shell.switchToLightTheme" : "shell.switchToDarkTheme")}
              onClick={toggleTheme}
              className="h-8 w-8 rounded-full border border-zinc-200 bg-white text-zinc-600 flex items-center justify-center hover:bg-zinc-50 transition-colors"
            >
              {isDark ? <Sun size={17} weight="bold" /> : <Moon size={17} weight="bold" />}
            </button>
            <div className="mr-1 hidden flex-col items-end xl:flex">
              <span className="text-xs font-medium text-zinc-900">{bootstrap.user.email}</span>
              <span className="text-[10px] text-zinc-400">{bootstrap.global_plan.name}</span>
            </div>
            <button
              type="button"
              aria-label={t("shell.openAccountMenu")}
              onClick={() => setAccountMenuOpen((open) => !open)}
              className="h-8 w-8 rounded-full bg-zinc-100 border border-zinc-200 flex items-center justify-center text-zinc-600 hover:bg-zinc-200 transition-colors"
            >
              <UserCircle size={20} />
            </button>
            {accountMenuOpen ? (
              <div className="absolute right-4 top-14 w-56 rounded-xl border border-zinc-200 bg-white p-2 shadow-xl sm:right-6 lg:right-8">
                <div className="border-b border-zinc-100 px-3 py-2">
                  <div className="text-xs font-bold text-zinc-900">{bootstrap.user.email}</div>
                  <div className="mt-0.5 text-[10px] uppercase tracking-widest text-zinc-400">
                    {bootstrap.user.role === "admin"
                      ? t("shell.roleAdmin")
                      : bootstrap.user.role === "user"
                        ? t("shell.roleUser")
                        : bootstrap.user.role}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={logout}
                  className="mt-2 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-50 hover:text-zinc-900"
                >
                  <SignOut size={16} />
                  {t("shell.logout")}
                </button>
              </div>
            ) : null}
          </div>
        </header>

        {/* Page Area */}
        <div className="console-page mx-auto max-w-7xl p-4 sm:p-6 lg:p-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
