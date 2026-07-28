export interface ConsoleUser {
  id: number;
  email: string;
  name?: string;
  avatar_url?: string;
  role: string;
}

export interface ConsoleWallet {
  available_balance: number;
  add_on_credits: number;
  currency: string;
}

export interface ConsoleGlobalPlan {
  active: boolean;
  name: string;
  quota_limit: number;
  quota_used: number;
  quota_remaining: number;
  used_percent: number;
  current_period_end?: string;
  expires_at?: string;
}

export interface ConsoleBootstrap {
  user: ConsoleUser;
  wallet: ConsoleWallet;
  global_plan: ConsoleGlobalPlan;
  unread_announcements: number;
  affiliate_enabled?: boolean;
}

export interface ConsoleOverviewStats {
  available_credits: number;
  total_requests: number;
  active_api_keys: number;
  usage_today: number;
  changes: {
    available_credits: number;
    total_requests: number;
    usage_today: number;
  };
}

export interface ConsoleUsageTrendPoint {
  date: string;
  requests: number;
  credits: number;
  tokens: number;
}

export interface ConsolePrimaryKey {
  id: number;
  name: string;
  masked_key: string;
  last_used_at?: string;
  environments: number;
}

export interface ConsoleReferralSummary {
  earnings: number;
  invited: number;
  orders: number;
}

export interface ConsoleAnnouncementSummary {
  id: number;
  title: string;
  type: string;
  published_at: string;
}

export interface ConsoleOverview {
  stats: ConsoleOverviewStats;
  global_plan: ConsoleGlobalPlan;
  usage_trend: ConsoleUsageTrendPoint[];
  primary_key?: ConsolePrimaryKey;
  referral_summary: ConsoleReferralSummary;
  affiliate_enabled?: boolean;
  latest_announcements: ConsoleAnnouncementSummary[];
}

export interface ConsoleBillingGlobalPlan {
  id: number;
  plan_id: number;
  name: string;
  plan_category?: string;
  status: string;
  tier_rank?: number;
  quota_limit: number;
  quota_used: number;
  quota_remaining: number;
  period_start: string;
  period_end: string;
  expires_at: string;
}

export interface ConsolePlanApplicableGroup {
  id: number;
  name?: string;
  platform?: string;
}

export interface ConsoleBillingPlan {
  id: number;
  name: string;
  price: number;
  currency: string;
  billing_period: string;
  plan_scope?: "group" | "global";
  plan_category?: string;
  applicable_group_mode?: "all" | "whitelist" | "blacklist" | string;
  applicable_groups?: ConsolePlanApplicableGroup[];
  group_id?: number;
  group_platform?: string;
  group_name?: string;
  tier_rank?: number;
  quota_period?: "week" | "month" | string;
  quota_period_label?: string;
  quota_per_period_usd?: number;
  weekly_credits: number;
  monthly_max_credits: number;
  features: string[];
}

export interface ConsoleBillingAddOn {
  amount: number;
  credits: number;
  currency: string;
  preset: boolean;
}

export interface ConsoleBillingActivity {
  id: number;
  date: string;
  reference: string;
  type: string;
  label: string;
  amount: number;
  currency: string;
  pay_amount?: number;
  payment_currency?: string;
  status: string;
  pay_url?: string;
  receipt_url?: string;
}

export interface ConsolePaymentMethod {
  type: string;
  available?: boolean;
}

export interface ConsoleBilling {
  wallet: ConsoleWallet;
  active_global_plan?: ConsoleBillingGlobalPlan;
  active_global_plans?: ConsoleBillingGlobalPlan[];
  plans: ConsoleBillingPlan[];
  add_ons: ConsoleBillingAddOn[];
  payment_methods: ConsolePaymentMethod[];
  activity: ConsoleBillingActivity[];
}

export interface ConsoleReferralRules {
  signup_bonus: number;
  inviter_signup_reward: number;
  inviter_signup_reward_cap: number;
  first_order_bonus: number;
  rebate_rate: number;
  add_on_excluded: boolean;
}

export interface ConsoleReferralStats {
  total_invited: number;
  credits_earned: number;
  pending_rewards: number;
}

export interface ConsoleReferralInvitee {
  id: number;
  email: string;
  joined_at: string;
  status: string;
  earnings: number;
}

export interface ConsoleReferral {
  invite_link: string;
  rules: ConsoleReferralRules;
  stats: ConsoleReferralStats;
  recent_invitees: ConsoleReferralInvitee[];
}
