import type { ComponentType, ReactNode } from "react";
import { useCallback, useEffect, useState } from "react";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import PublicLayout from "./layouts/PublicLayout";
import Home from "./pages/public/Home";
import Pricing from "./pages/public/Pricing";
import ModelPricing from "./pages/public/ModelPricing";
import Auth from "./pages/public/Auth";
import OAuthCallback from "./pages/public/OAuthCallback";
import Blog from "./pages/public/Blog";
import Team from "./pages/public/Team";
import Privacy from "./pages/public/legal/Privacy";
import Terms from "./pages/public/legal/Terms";
import PaymentResult from "./pages/public/PaymentResult";
import StripePayment from "./pages/public/StripePayment";
import ConsoleLayout from "./layouts/ConsoleLayout";
import Overview from "./pages/console/Overview";
import ApiKeys from "./pages/console/ApiKeys";
import Billing from "./pages/console/Billing";
import UsageHistory from "./pages/console/UsageHistory";
import Announcements from "./pages/console/Announcements";
import Referral from "./pages/console/Referral";
import InstallGuide from "./pages/console/InstallGuide";
import Playground from "./pages/console/Playground";
import { getConsoleBootstrap } from "./api/console";
import { getPublicSettings, type PublicSettings } from "./api/settings";
import type { ConsoleBootstrap } from "./types/console";

const CONSOLE_BOOTSTRAP_REFRESH_INTERVAL_MS = 60_000;

interface RouterProps {
  children?: ReactNode;
  [key: string]: unknown;
}

interface AppProps {
  RouterComponent?: ComponentType<RouterProps>;
  routerProps?: Omit<RouterProps, "children">;
}

function ConsoleGuard() {
  const [bootstrap, setBootstrap] = useState<ConsoleBootstrap | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refreshBootstrap = useCallback((initial = false) => {
    return getConsoleBootstrap()
      .then((data) => {
        setBootstrap(data);
        setError(null);
      })
      .catch((reason: unknown) => {
        if (initial) {
          setError(reason instanceof Error ? reason.message : "Unable to load console.");
        }
      });
  }, []);

  useEffect(() => {
    let active = true;

    getConsoleBootstrap()
      .then((data) => {
        if (!active) return;
        setBootstrap(data);
        setError(null);
      })
      .catch((reason: unknown) => {
        if (!active) return;
        setError(reason instanceof Error ? reason.message : "Unable to load console.");
      });

    return () => {
      active = false;
    };
  }, []);

  const bootstrapReady = bootstrap !== null;
  useEffect(() => {
    if (!bootstrapReady) return undefined;

    const intervalId = window.setInterval(() => {
      void refreshBootstrap(false);
    }, CONSOLE_BOOTSTRAP_REFRESH_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [bootstrapReady, refreshBootstrap]);

  if (error) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-zinc-50 px-6 text-center">
        <h1 className="text-2xl font-semibold text-zinc-950">Console unavailable</h1>
        <p className="mt-3 max-w-md text-sm text-zinc-500">{error}</p>
      </div>
    );
  }

  if (!bootstrap) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-50 text-sm font-medium text-zinc-500">
        Loading console...
      </div>
    );
  }

  return <ConsoleLayout bootstrap={bootstrap} />;
}

function RegionBlockPage({ settings }: { settings: PublicSettings }) {
  const region = settings.region_block_current_region?.trim();
  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-950 px-6 text-center text-white">
      <main className="max-w-lg">
        <p className="text-xs font-bold uppercase tracking-[0.28em] text-zinc-500">{settings.site_name || "Service"}</p>
        <h1 className="mt-5 text-3xl font-bold tracking-tight">Service unavailable in your region</h1>
        <p className="mt-4 text-sm leading-6 text-zinc-400">
          Access from your current region{region ? ` (${region})` : ""} is not supported at this time.
        </p>
      </main>
    </div>
  );
}

function shouldBlockFrontendRoute(pathname: string): boolean {
  return pathname === "/login" || pathname === "/register" || pathname.startsWith("/console");
}

function AppRoutes({ settings }: { settings: PublicSettings | null }) {
  const location = useLocation();
  const shouldBlock =
    settings?.region_block_frontend_enabled === true &&
    settings.region_block_frontend_blocked === true &&
    shouldBlockFrontendRoute(location.pathname);

  if (shouldBlock) {
    return <RegionBlockPage settings={settings} />;
  }

  return (
    <Routes>
      {/* Public Routes inside unified layout */}
      <Route element={<PublicLayout />}>
        <Route path="/" element={<Home />} />
        <Route path="/pricing" element={<Pricing />} />
        <Route path="/model-pricing" element={<ModelPricing />} />
        <Route path="/blog" element={<Blog />} />
        <Route path="/team" element={<Team />} />
        <Route path="/privacy" element={<Privacy />} />
        <Route path="/terms" element={<Terms />} />
      </Route>

      {/* Auth Route (standalone layout) */}
      <Route path="/login" element={<Auth />} />
      <Route path="/register" element={<Auth />} />
      <Route path="/auth/callback" element={<OAuthCallback />} />
      <Route path="/auth/oauth/callback" element={<OAuthCallback />} />
      <Route path="/payment/result" element={<PaymentResult />} />
	  <Route path="/payment/stripe" element={<StripePayment />} />

      {/* Console Routes */}
      <Route path="/console" element={<ConsoleGuard />}>
        <Route index element={<Overview />} />
        <Route path="api-keys" element={<ApiKeys />} />
        <Route path="playground" element={<Playground />} />
        <Route path="subscription-wallet" element={<Billing />} />
        <Route path="referral" element={<Referral />} />
        <Route path="model-pricing" element={<ModelPricing isConsole />} />
        <Route path="usage-history" element={<UsageHistory />} />
        <Route path="announcements" element={<Announcements />} />
        <Route path="install-guide" element={<InstallGuide />} />
      </Route>

      {/* Fallback */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function App({ RouterComponent = BrowserRouter, routerProps = {} }: AppProps) {
  const [settings, setSettings] = useState<PublicSettings | null>(null);
  const [settingsLoaded, setSettingsLoaded] = useState(false);

  useEffect(() => {
    let active = true;
    getPublicSettings()
      .then((data) => {
        if (active) {
          setSettings(data);
        }
      })
      .catch(() => {
        if (active) {
          setSettings(null);
        }
      })
      .finally(() => {
        if (active) {
          setSettingsLoaded(true);
        }
      });

    return () => {
      active = false;
    };
  }, []);

  if (!settingsLoaded) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-50 text-sm font-medium text-zinc-500">
        Loading...
      </div>
    );
  }

  return (
    <RouterComponent {...routerProps}>
      <AppRoutes settings={settings} />
    </RouterComponent>
  );
}

export default App;
