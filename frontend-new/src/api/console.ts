import { getJSON } from "./client";
import type { ConsoleBilling, ConsoleBootstrap, ConsoleOverview, ConsoleReferral } from "../types/console";

export function getConsoleBootstrap() {
  return getJSON<ConsoleBootstrap>("/console/bootstrap");
}

export function getConsoleOverview(range = "7d") {
  return getJSON<ConsoleOverview>(`/console/overview?range=${encodeURIComponent(range)}`);
}

export function getConsoleBilling() {
  return getJSON<ConsoleBilling>("/console/billing");
}

export function getConsoleReferral() {
  return getJSON<ConsoleReferral>("/console/referral");
}
