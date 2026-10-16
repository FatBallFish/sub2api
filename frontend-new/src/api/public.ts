import { getJSON } from "./client";
import type { PublicPricing } from "../types/public";

export function getPublicPricing() {
  return getJSON<PublicPricing>("/public/pricing");
}
