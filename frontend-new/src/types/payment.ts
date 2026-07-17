export interface PaymentMethodSummary {
  type: string;
  available?: boolean;
}

export interface CreateOrderRequest {
  amount: number;
  amount_currency?: string;
  payment_type: string;
  order_type: "balance" | "subscription" | "global_plan" | "global_plan_upgrade";
  plan_id?: number;
  offer_id?: number;
  return_url?: string;
  payment_source?: string;
  is_mobile?: boolean;
}

export interface GlobalPlanUpgradeQuote {
  current_subscription_id: number;
  from_plan_id: number;
  to_plan_id: number;
  remaining_seconds: number;
  cycle_seconds: number;
  current_plan_price: number;
  target_plan_price: number;
  upgrade_price: number;
  currency: string;
  expires_at: string;
}

export interface CreateOrderResult {
  order_id: number;
  out_trade_no?: string;
  status?: string;
  result_type?: string;
  payment_mode?: string;
  resume_token?: string;
  amount: number;
  pay_amount: number;
  currency?: string;
  amount_currency?: string;
  payment_currency?: string;
  fee_rate: number;
  payment_type?: string;
  pay_url?: string;
  qr_code?: string;
  client_secret?: string;
  intent_id?: string;
  expires_at?: string;
}

export interface PaymentOrderResult {
  id: number;
  amount: number;
  pay_amount: number;
  fee_rate: number;
  currency: string;
  amount_currency?: string;
  payment_currency?: string;
  payment_type: string;
  out_trade_no: string;
  status: string;
  order_type: string;
  created_at: string;
  expires_at: string;
  paid_at?: string;
  completed_at?: string;
  refund_amount: number;
  plan_id?: number;
}

export interface PaymentMethodLimits {
  payment_type: string;
  currency?: string;
  fee_rate?: number;
  daily_limit?: number;
  single_min?: number;
  single_max?: number;
}

export interface CheckoutInfo {
  methods: Record<string, PaymentMethodLimits>;
  global_min: number;
  global_max: number;
  billing_currency?: string;
  currency_exchange_rates?: string;
  balance_disabled?: boolean;
  balance_recharge_multiplier?: number;
  recharge_fee_rate?: number;
  stripe_publishable_key?: string;
  fixed_offers?: FixedPaymentOffer[];
}

export interface FixedPaymentOffer {
  offer_id: number;
  payment_type: "creem";
  target_type: "balance" | "group_plan" | "global_plan";
  plan_id?: number;
  title: string;
  pay_amount: number;
  payment_currency: string;
  credited_amount?: number;
  tax_mode: "inclusive" | "exclusive";
  sort_order: number;
}
