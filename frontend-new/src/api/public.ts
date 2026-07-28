import { getJSON } from "./client";
import type { PublicModelPricing, PublicPricing } from "../types/public";

export function getPublicPricing() {
  return getJSON<PublicPricing>("/public/pricing");
}

export function getModelPricing() {
  return getJSON<PublicModelPricing>("/public/model-pricing");
}

export function getConsoleModelPricing(groupId?: number) {
  const query = groupId ? `?group_id=${encodeURIComponent(String(groupId))}` : "";
  return getJSON<PublicModelPricing>(`/model-pricing${query}`);
}
