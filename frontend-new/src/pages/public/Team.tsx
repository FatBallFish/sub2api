import React from "react";
import PublicMarkdownPage from "./PublicMarkdownPage";

export default function Team() {
  return (
    <PublicMarkdownPage slug="team" fallbackTitle="Our Team">
      <div className="pt-32 pb-24 px-8 max-w-4xl mx-auto space-y-12">
        <h1 className="text-4xl font-bold tracking-tight text-zinc-900">Our Team</h1>
        <p className="text-zinc-500 leading-relaxed text-lg">
          We are a team of developers, researchers, and designers passionate about building the next generation of AI infrastructure.
          Our mission is to make AI models accessible, reliable, and transparent for everyone.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <div className="p-8 bg-zinc-50 rounded-2xl">
            <h3 className="font-bold text-xl">Operator Focus</h3>
            <p className="text-sm text-zinc-500 mt-2">Dedicated to high-availability routing and stability.</p>
          </div>
          <div className="p-8 bg-zinc-50 rounded-2xl">
            <h3 className="font-bold text-xl">Control Plane Mindset</h3>
            <p className="text-sm text-zinc-500 mt-2">Building tools that empower developers to manage their own AI stack.</p>
          </div>
        </div>
      </div>
    </PublicMarkdownPage>
  );
}
