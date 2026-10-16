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

