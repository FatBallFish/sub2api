export const PAYMENT_ORDER_STATUSES = [
  "PENDING",
  "PAID",
  "RECHARGING",
  "COMPLETED",
  "EXPIRED",
  "CANCELLED",
  "FAILED",
  "REFUND_REQUESTED",
  "REFUNDING",
  "REFUND_PENDING",
  "PARTIALLY_REFUNDED",
  "REFUNDED",
  "REFUND_FAILED",
] as const;

export type PaymentOrderStatus = (typeof PAYMENT_ORDER_STATUSES)[number];
export type PaymentPollingClassification = "continue" | "paid" | "terminal" | "refund";

export function normalizeOrderStatus(status?: string) {
  return (status || "").trim().toUpperCase();
}

export function isPendingOrder(status?: string) {
  return normalizeOrderStatus(status) === "PENDING";
}

function isPaidOrderStatus(status?: string) {
  const normalized = normalizeOrderStatus(status);
  return normalized === "COMPLETED" || normalized === "PAID";
}

function isTerminalOrderStatus(status?: string) {
  const normalized = normalizeOrderStatus(status);
  return normalized === "FAILED" || normalized === "CANCELLED" || normalized === "EXPIRED";
}

function isRefundOrderStatus(status?: string) {
  switch (normalizeOrderStatus(status)) {
    case "REFUND_REQUESTED":
    case "REFUNDING":
    case "REFUND_PENDING":
    case "PARTIALLY_REFUNDED":
    case "REFUNDED":
    case "REFUND_FAILED":
      return true;
    default:
      return false;
  }
}

export function classifyPaymentPollingStatus(status?: string): PaymentPollingClassification {
  if (isPaidOrderStatus(status)) return "paid";
  if (isTerminalOrderStatus(status)) return "terminal";
  if (isRefundOrderStatus(status)) return "refund";
  return "continue";
}

export function hasCheckoutActions(status?: string) {
  const normalized = normalizeOrderStatus(status);
  return normalized === "" || normalized === "PENDING";
}
