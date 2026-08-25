import { getJSON, postJSON } from "./client";
import type { RedeemHistoryItem, RedeemResult } from "../types/redeem";

export function redeemCode(code: string) {
  return postJSON<RedeemResult>("/redeem", { code });
}

export function getRedeemHistory() {
  return getJSON<RedeemHistoryItem[]>("/redeem/history");
}
