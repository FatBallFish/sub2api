import React from "react";
import { Link } from "react-router-dom";
import {
  CheckCircle,
  Tag
} from "@phosphor-icons/react";
import { motion } from "motion/react";
import { getPublicPricing } from "../../api/public";
import type { PublicPricing } from "../../types/public";
import { formatCredits } from "../../utils/format";

function formatUSD(value: number) {
  const hasCents = !Number.isInteger(value);
  return `$${value.toLocaleString("en-US", {
    minimumFractionDigits: hasCents ? 2 : 0,
    maximumFractionDigits: 2,
  })}`;
}

export default function Pricing() {
  const [pricing, setPricing] = React.useState<PublicPricing | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let active = true;

    getPublicPricing()
      .then((data) => {
        if (active) {
          setPricing(data);
          setError(null);
        }
      })
      .catch((err: unknown) => {
        if (active) {
          setError(err instanceof Error ? err.message : "Unable to load pricing.");
        }
      });

    return () => {
      active = false;
    };
  }, []);

  return (
    <>
      <section className="pt-32 pb-24 px-8 max-w-7xl mx-auto">
        <div className="text-center space-y-4 mb-20">
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight text-zinc-900">Subscription & Credits</h1>
          <p className="text-lg text-zinc-500 max-w-2xl mx-auto leading-relaxed">
            Simple, predictable pricing designed for developers and teams.
            Plan credits reset weekly and never expire if used.
          </p>
        </div>

        {error && (
          <div className="mb-10 rounded-2xl border border-red-100 bg-red-50 px-5 py-4 text-sm font-medium text-red-700">
            {error}
          </div>
        )}

        {!pricing ? (
          <div className="py-16 text-center text-sm font-bold uppercase tracking-widest text-zinc-400">
            Loading pricing...
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {pricing.plans.map((plan, i) => (
            <motion.div
              key={plan.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.1 }}
              className={`p-8 rounded-[2rem] border transition-all duration-500 hover:shadow-2xl hover:shadow-zinc-100 relative ${
                plan.recommended
                  ? "bg-zinc-900 text-white border-zinc-900 scale-[1.05] z-10 shadow-2xl shadow-zinc-200"
                  : "bg-white text-zinc-900 border-zinc-100"
              }`}
            >
              {plan.recommended && (
                <span className="absolute -top-4 left-1/2 -translate-x-1/2 bg-zinc-100 text-zinc-900 px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest border border-zinc-200">
                  {plan.badge || "Best Value"}
                </span>
              )}
              <h3 className="text-lg font-bold">{plan.name}</h3>
              <div className="mt-4 flex items-baseline gap-1">
                <span className="text-4xl font-bold">{formatUSD(plan.price)}</span>
                <span className={`text-sm ${plan.recommended ? "text-zinc-500" : "text-zinc-400"}`}>/{plan.billing_period}</span>
              </div>
              <div className="mt-8 space-y-4">
                <div className={`p-4 rounded-2xl border ${plan.recommended ? "bg-white/5 border-white/10" : "bg-zinc-50 border-zinc-100"}`}>
                  <div className="flex items-center justify-between text-xs font-bold uppercase tracking-widest mb-1">
                    <span className={plan.recommended ? "text-zinc-400" : "text-zinc-500"}>Weekly Credits</span>
                    <span className={plan.recommended ? "text-white" : "text-zinc-900"}>{formatCredits(plan.weekly_credits)}</span>
                  </div>
                  <div className="flex items-center justify-between text-xs font-bold uppercase tracking-widest">
                    <span className={plan.recommended ? "text-zinc-400" : "text-zinc-500"}>Monthly Max</span>
                    <span className={plan.recommended ? "text-white" : "text-zinc-900"}>{formatCredits(plan.monthly_max_credits)}</span>
                  </div>
                </div>
              </div>
              <ul className="mt-8 space-y-4">
                {plan.features.map(feature => (
                  <li key={feature} className="flex items-center gap-3 text-sm">
                    <CheckCircle size={18} weight="fill" className={plan.recommended ? "text-white/20" : "text-zinc-200"} />
                    <span className={plan.recommended ? "text-zinc-300" : "text-zinc-500"}>{feature}</span>
                  </li>
                ))}
              </ul>
              <Link
                to={`/login?plan=${plan.id}`}
                className={`mt-10 block w-full py-4 rounded-2xl text-center font-bold transition-all ${
                  plan.recommended
                    ? "bg-white text-zinc-900 hover:bg-zinc-100"
                    : "bg-zinc-900 text-white hover:bg-zinc-800"
                }`}
              >
                Choose {plan.name}
              </Link>
            </motion.div>
            ))}
          </div>
        )}

        {/* Add-ons */}
        <div className="mt-32 p-12 bg-zinc-50 rounded-[3rem] border border-zinc-100 relative overflow-hidden group">
          <Tag size={120} weight="thin" className="absolute -right-8 -bottom-8 text-zinc-100 group-hover:text-zinc-200 transition-colors duration-700" />
          <div className="relative z-10 max-w-3xl">
            <h2 className="text-3xl font-bold tracking-tight text-zinc-900">Add-on Top-ups</h2>
            <p className="mt-4 text-zinc-500 leading-relaxed">
              Need more credits for a high-intensity week? Purchase add-on credits that never reset.
              Add-ons are applied automatically after your weekly subscription quota is exhausted.
            </p>
            <div className="mt-8 grid grid-cols-2 md:grid-cols-4 gap-4">
              {(pricing?.topups || []).map(item => (
                <Link
                  key={item.amount}
                  to={`/login?topup=${item.amount}`}
                  aria-label={`Buy ${formatUSD(item.amount)} top-up, get ${formatCredits(item.credits)} credits`}
                  className="p-6 bg-white border border-zinc-200 rounded-3xl text-center hover:border-zinc-900 transition-all shadow-sm hover:shadow-md"
                >
                  <span className="block text-2xl font-bold text-zinc-900">{formatUSD(item.amount)}</span>
                  <span className="block text-[10px] font-bold uppercase tracking-widest text-zinc-400 mt-1">Get {formatCredits(item.credits)}</span>
                </Link>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="py-24 px-8 border-t border-zinc-100 bg-zinc-50/30">
        <div className="max-w-3xl mx-auto space-y-12">
          <h2 className="text-3xl font-bold tracking-tight text-center">Frequently Asked Questions</h2>
          <div className="space-y-8">
            {(pricing?.faq || []).map(faq => (
              <div key={faq.question} className="space-y-2">
                <h4 className="font-bold text-zinc-900">{faq.question}</h4>
                <p className="text-sm text-zinc-500 leading-relaxed">{faq.answer}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
