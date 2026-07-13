import { useEffect, useState } from "react";
import {
  Users,
  Gift,
  Copy,
  Check,
  HandHeart,
  CurrencyCircleDollar
} from "@phosphor-icons/react";
import { getConsoleReferral } from "../../api/console";
import type { ConsoleReferral } from "../../types/console";
import { formatCredits } from "../../utils/format";

function formatPercent(value: number) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(value * 100);
}

function rewardCapRule(value: number) {
  if (value > 0) {
    return `Inviter signup rewards are capped at ${formatCredits(value)} credits.`;
  }
  return "Inviter signup rewards currently have no cap.";
}

function relativeTime(value: string) {
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) return "Recently";
  const diffMinutes = Math.max(Math.round((Date.now() - timestamp) / 60000), 0);
  if (diffMinutes < 60) return `${Math.max(diffMinutes, 1)}m ago`;
  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${Math.round(diffHours / 24)}d ago`;
}

export default function Referral() {
  const [referral, setReferral] = useState<ConsoleReferral | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    getConsoleReferral()
      .then((data) => {
        if (active) {
          setReferral(data);
          setError(null);
        }
      })
      .catch((reason: unknown) => {
        if (active) {
          setError(reason instanceof Error ? reason.message : "Unable to load referral.");
        }
      });

    return () => {
      active = false;
    };
  }, []);

  const copyLink = async () => {
    if (!referral) return;
    await navigator.clipboard.writeText(referral.invite_link);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  if (error) {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-700">
        <h1 className="text-lg font-semibold text-rose-900">Referral unavailable</h1>
        <p className="mt-2">{error}</p>
      </div>
    );
  }

  if (!referral) {
    return (
      <div className="flex min-h-[360px] items-center justify-center rounded-2xl border border-zinc-200 bg-white text-sm font-medium text-zinc-500">
        Loading referral...
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-zinc-900">Referral Program</h1>
        <p className="text-zinc-500 text-sm">Invite friends and earn credits for every successful referral.</p>
      </div>

      {/* Hero Card */}
      <div className="console-inverted-panel p-12 bg-zinc-900 rounded-[2.5rem] text-white relative overflow-hidden group">
        <div className="absolute top-0 right-0 h-full w-1/3 bg-gradient-to-l from-white/5 to-transparent" />
        <HandHeart size={200} weight="thin" className="absolute -right-16 -bottom-16 text-white/5 group-hover:text-white/10 transition-colors duration-700" />

        <div className="relative z-10 max-w-xl space-y-6">
          <div className="console-inverted-label inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 border border-white/20 text-[10px] font-bold uppercase tracking-widest text-zinc-300">
            <Gift size={12} weight="fill" className="text-rose-400" />
            Limited Time Reward
          </div>
          <h2 className="text-4xl font-bold tracking-tight">
            Give {formatCredits(referral.rules.signup_bonus)}, Get {formatCredits(referral.rules.inviter_signup_reward)}.
          </h2>
          <p className="text-zinc-400 leading-relaxed">
            Your friends get {formatCredits(referral.rules.signup_bonus)} in bonus credits when they sign up.
            You get {formatCredits(referral.rules.inviter_signup_reward)} for each successful signup and earn {formatPercent(referral.rules.rebate_rate)}% in credits on every qualifying purchase they make.
          </p>

          <div className="pt-4 flex flex-col sm:flex-row gap-4">
            <div className="console-inverted-subtle flex-1 bg-white/5 border border-white/10 rounded-2xl px-6 py-4 flex items-center justify-between backdrop-blur-sm group-hover:border-white/20 transition-colors">
              <code className="console-inverted-code text-sm font-mono text-zinc-300 truncate mr-4">{referral.invite_link}</code>
              <button
                onClick={() => void copyLink()}
                aria-label="Copy invite link"
                className="p-2 hover:bg-white/10 rounded-lg transition-colors shrink-0"
              >
                {copied ? <Check size={20} className="text-emerald-400" /> : <Copy size={20} />}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {[
          { icon: Users, label: "Total Invited", value: `${referral.stats.total_invited} Users` },
          { icon: CurrencyCircleDollar, label: "Credits Earned", value: formatCredits(referral.stats.credits_earned) },
          { icon: Gift, label: "Pending Rewards", value: formatCredits(referral.stats.pending_rewards) },
        ].map(item => (
          <div key={item.label} className="p-6 bg-white border border-zinc-200 rounded-2xl shadow-sm flex items-center gap-4">
            <div className="p-3 bg-zinc-50 rounded-xl border border-zinc-100 text-zinc-400">
              <item.icon size={24} weight="duotone" />
            </div>
            <div>
              <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">{item.label}</span>
              <div className="text-xl font-bold text-zinc-900">{item.value}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Table & Rules */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 bg-white border border-zinc-200 rounded-2xl shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-zinc-100 font-bold text-zinc-900">Recently Joined</div>
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-zinc-50/50 border-b border-zinc-200">
                <th className="px-6 py-3 text-[10px] font-bold text-zinc-400 uppercase tracking-[0.2em]">Invitee</th>
                <th className="px-6 py-3 text-[10px] font-bold text-zinc-400 uppercase tracking-[0.2em]">Joined</th>
                <th className="px-6 py-3 text-[10px] font-bold text-zinc-400 uppercase tracking-[0.2em]">Status</th>
                <th className="px-6 py-3 text-[10px] font-bold text-zinc-400 uppercase tracking-[0.2em] text-right">Earnings</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {referral.recent_invitees.map((row) => (
                <tr key={row.id} className="hover:bg-zinc-50/50 transition-colors">
                  <td className="px-6 py-4 text-sm font-medium text-zinc-900">{row.email}</td>
                  <td className="px-6 py-4 text-sm text-zinc-500">{relativeTime(row.joined_at)}</td>
                  <td className="px-6 py-4">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-100">
                      {row.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm font-bold text-zinc-900 text-right">{formatCredits(row.earnings)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="space-y-6">
          <div className="p-8 bg-zinc-50 border border-zinc-200 rounded-[2rem] space-y-4">
            <h3 className="font-bold text-zinc-900">Program Rules</h3>
            <ul className="space-y-4">
              {[
                "Invitees must use your unique link.",
                `Invitees receive ${formatCredits(referral.rules.signup_bonus)} credits after registration.`,
                `You receive ${formatCredits(referral.rules.inviter_signup_reward)} credits for each successful signup.`,
                rewardCapRule(referral.rules.inviter_signup_reward_cap),
                `${formatPercent(referral.rules.rebate_rate)}% reward applies to subscription plans.`,
                referral.rules.add_on_excluded ? "Add-on credits are currently excluded." : "Add-on credits are included.",
                "Earnings are credited instantly.",
              ].map(rule => (
                <li key={rule} className="flex gap-3 text-sm text-zinc-500 leading-relaxed">
                  <div className="h-1.5 w-1.5 rounded-full bg-zinc-300 mt-2 shrink-0" />
                  {rule}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
