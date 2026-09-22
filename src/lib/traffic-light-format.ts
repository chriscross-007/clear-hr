// CLE-216 follow-up — Pure formatters for the documents traffic
// light. Lives outside the "use client" component file so server
// components (Employee Self Dashboard etc.) can import
// `trafficLightTooltipText` without Next.js turning it into a
// client-boundary reference that fails on the server.
//
// The client component (`documents-traffic-light.tsx`) re-exports
// from here so existing import sites keep working — nothing else
// had to move.

import type { TrafficLight, TrafficLightCounts } from "@/lib/documents-traffic-light";

// Only attention-worthy buckets appear in the tooltip. "Verified"
// and any other clean-state counts are intentionally omitted — the
// icon colour already signals "all good" and listing the healthy
// count adds noise to a surface whose job is to flag what needs
// doing.
const COUNT_LABELS: Array<[keyof TrafficLightCounts, string, string]> = [
  ["missing", "missing", "missing"],
  ["expired", "expired", "expired"],
  ["pendingVerification", "pending verification", "pending verification"],
  ["overdueReview", "overdue for review", "overdue for review"],
  ["expiringSoon", "expiring soon", "expiring soon"],
  ["reviewDueSoon", "review due soon", "review due soon"],
];

/** Human-readable list of every non-zero attention-worthy count,
 *  used inside the tooltip and dashboard summary text on multiple
 *  surfaces. Healthy counts (verified etc.) are deliberately excluded. */
export function trafficLightTooltipText(light: TrafficLight): string {
  const parts: string[] = [];
  for (const [key, single, plural] of COUNT_LABELS) {
    const n = light.counts[key];
    if (n > 0) parts.push(`${n} ${n === 1 ? single : plural}`);
  }
  if (parts.length === 0) return "Nothing needs attention";
  return parts.join(" · ");
}

/** Numeric rank for sorting — red first, then amber, then green,
 *  then null. Consumed by the Employees Directory column's sort. */
export function trafficLightSortRank(light: TrafficLight | null | undefined): number {
  if (!light || !light.colour) return 4;
  if (light.colour === "red") return 1;
  if (light.colour === "amber") return 2;
  return 3; // green
}
