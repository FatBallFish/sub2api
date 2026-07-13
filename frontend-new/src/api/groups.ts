import { getJSON } from "./client";

export interface AvailableGroup {
  id: number;
  name: string;
  description?: string;
  platform?: string;
  rate_multiplier?: number;
  supported_model_scopes?: string[];
}

export function listAvailableGroups() {
  return getJSON<AvailableGroup[]>("/groups/available");
}
