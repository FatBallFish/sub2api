import React from "react";
import PublicMarkdownPage from "../PublicMarkdownPage";

export default function Privacy() {
  return (
    <PublicMarkdownPage slug="privacy" fallbackTitle="Privacy Policy">
      <div className="pt-32 pb-24 px-8 max-w-4xl mx-auto space-y-8">
        <h1 className="text-4xl font-bold tracking-tight text-zinc-900">Privacy Policy</h1>
        <p className="text-xs text-zinc-400 font-bold uppercase tracking-widest">Last Updated: June 18, 2026</p>
        <div className="prose prose-zinc max-w-none text-zinc-500 leading-relaxed space-y-6">
          <section>
            <h3 className="text-xl font-bold text-zinc-900 mb-2">1. Types of data collected</h3>
            <p>We collect information you provide directly to us, such as your email address when you create an account.</p>
          </section>
          <section>
            <h3 className="text-xl font-bold text-zinc-900 mb-2">2. User content and API requests</h3>
            <p>Your API requests are processed securely. We do not store the content of your requests beyond what is necessary for routing and billing purposes.</p>
          </section>
        </div>
      </div>
    </PublicMarkdownPage>
  );
}
