import React from "react";
import PublicMarkdownPage from "../PublicMarkdownPage";

export default function Terms() {
  return (
    <PublicMarkdownPage slug="terms" fallbackTitle="Terms of Service">
      <div className="pt-32 pb-24 px-8 max-w-4xl mx-auto space-y-8">
        <h1 className="text-4xl font-bold tracking-tight text-zinc-900">Terms of Service</h1>
        <p className="text-xs text-zinc-400 font-bold uppercase tracking-widest">Last Updated: June 18, 2026</p>
        <div className="prose prose-zinc max-w-none text-zinc-500 leading-relaxed space-y-6">
          <section>
            <h3 className="text-xl font-bold text-zinc-900 mb-2">1. Service overview</h3>
            <p>Mikiko CC provides an API gateway for accessing various AI models. By using the service, you agree to these terms.</p>
          </section>
          <section>
            <h3 className="text-xl font-bold text-zinc-900 mb-2">2. Billing, credits, subscriptions</h3>
            <p>Credits are non-refundable. Subscription quotas reset weekly according to the plan terms.</p>
          </section>
        </div>
      </div>
    </PublicMarkdownPage>
  );
}
