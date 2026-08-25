import { getJSON, postJSON } from "./client";
import type { RedeemAccountProfile, RedeemHistoryItem, RedeemResult } from "../types/redeem";

export function redeemCode(code: string) {
  return postJSON<RedeemResult>("/redeem", { code });
}

export function getRedeemHistory() {
  return getJSON<RedeemHistoryItem[]>("/redeem/history");
}

export function getRedeemAccountProfile() {
  return getJSON<RedeemAccountProfile>("/user/profile");
}
