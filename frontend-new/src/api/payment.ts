import { getJSON, postJSON } from "./client";
import type { CheckoutInfo, CreateOrderRequest, CreateOrderResult, GlobalPlanUpgradeQuote, PaymentOrderResult } from "../types/payment";

export function createPaymentOrder(request: CreateOrderRequest) {
  return postJSON<CreateOrderResult>("/payment/orders", request);
}

export function getGlobalPlanUpgradeQuote(targetPlanId: number) {
  return postJSON<GlobalPlanUpgradeQuote>("/payment/global-plans/upgrade-quote", {
    target_plan_id: targetPlanId,
  });
}

export function getPaymentCheckoutInfo() {
  return getJSON<CheckoutInfo>("/payment/checkout-info");
}

export function cancelPaymentOrder(orderId: number) {
  return postJSON<{ message: string }>(`/payment/orders/${orderId}/cancel`);
}

export function verifyPaymentOrder(outTradeNo: string) {
  return postJSON<PaymentOrderResult>("/payment/orders/verify", { out_trade_no: outTradeNo });
}

export function verifyPaymentOrderPublic(outTradeNo: string) {
  return postJSON<PaymentOrderResult>("/payment/public/orders/verify", { out_trade_no: outTradeNo });
}

export function resolvePaymentOrderByResumeToken(resumeToken: string) {
  return postJSON<PaymentOrderResult>("/payment/public/orders/resolve", { resume_token: resumeToken });
}
