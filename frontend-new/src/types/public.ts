export interface PublicPricingPlan {
  id: number;
  name: string;
  price: number;
  currency: string;
  billing_period: string;
  weekly_credits: number;
  monthly_max_credits: number;
  badge?: string;
  features: string[];
  recommended?: boolean;
}

export interface PublicTopupPackage {
  amount: number;
  credits: number;
  currency: string;
}

export interface PublicFAQItem {
  question: string;
  answer: string;
}

export interface PublicPricing {
  plans: PublicPricingPlan[];
  topups: PublicTopupPackage[];
  faq: PublicFAQItem[];
}

export interface PublicPricePair {
  gateway: number;
  official: number;
}

export interface PublicModelPricingRow {
  model: string;
  label?: string;
  input: PublicPricePair;
  output: PublicPricePair;
  cache_write?: PublicPricePair;
  cache_read?: PublicPricePair;
  availability: string;
  multiplier?: number;
  multiplier_group_id?: number;
  multiplier_group_name?: string;
  pricing_source?: string;
}

export interface PublicModelPricingProduct {
  id: string;
  label: string;
  status: "live" | "coming_soon" | string;
  description: string;
  multiplier: string;
  rule_text: string;
  supported?: boolean;
  unsupported_reason?: string;
  rows: PublicModelPricingRow[];
}

export interface PublicModelPricing {
  groups?: ConsoleModelPricingGroup[];
  selected_group_id?: number;
  products: PublicModelPricingProduct[];
}

export interface ConsoleModelPricingGroup {
  id: number;
  name: string;
  platform?: string;
  rate_multiplier: number;
  image_rate_independent?: boolean;
  image_rate_multiplier?: number;
  supported_model_scopes?: string[];
}
