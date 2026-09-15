"use client";

// CLE-216 — Traffic light indicator for a member's required-docs
// health. Two surfaces consume it (Employees Directory column + the
// per-member sidebar avatar area), so the visual + tooltip live here.
//
// The visual is a document-shaped icon coloured in Red / Amber /
// Green so it reads as "documents" at a glance rather than a plain
// coloured circle.
//
// Colour semantics + count buckets are defined by the server (see
// spec §7b.16 and compliance-actions.ts / computeTrafficLightsForMembers).

import { FileText } from "lucide-react";
import type { TrafficLight, TrafficLightCounts } from "@/app/(dashboard)/documents/compliance-actions";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

// Icon fill tints keep the shape identical across states — only
// the colour changes, so the surface still reads as one thing.
const ICON_CLASS: Record<Exclude<TrafficLight["colour"], null>, string> = {
  red: "text-red-500",
  amber: "text-amber-500",
  green: "text-green-500",
};

const COLOUR_LABEL: Record<Exclude<TrafficLight["colour"], null>, string> = {
  red: "Attention required",
  amber: "Attention soon",
  green: "All good",
};

// Only attention-worthy buckets appear in the tooltip. "Verified" and
// any other clean-state counts are intentionally omitted — the icon
// colour already signals "all good" and listing the healthy count
// adds noise to a surface whose job is to flag what needs doing.
const COUNT_LABELS: Array<[keyof TrafficLightCounts, string, string]> = [
  ["missing", "missing", "missing"],
  ["expired", "expired", "expired"],
  ["pendingVerification", "pending verification", "pending verification"],
  ["overdueReview", "overdue for review", "overdue for review"],
  ["expiringSoon", "expiring soon", "expiring soon"],
  ["reviewDueSoon", "review due soon", "review due soon"],
];

/** Human-readable list of every non-zero attention-worthy count,
 *  used inside the tooltip on either surface. Healthy counts
 *  (verified etc.) are deliberately excluded. */
export function trafficLightTooltipText(light: TrafficLight): string {
  const parts: string[] = [];
  for (const [key, single, plural] of COUNT_LABELS) {
    const n = light.counts[key];
    if (n > 0) parts.push(`${n} ${n === 1 ? single : plural}`);
  }
  if (parts.length === 0) return "Nothing needs attention";
  return parts.join(" · ");
}

export function DocumentsTrafficLight({
  light,
  size = "sm",
  onClick,
}: {
  light: TrafficLight;
  size?: "sm" | "md" | "lg";
  /** Optional click handler — used on the member sidebar to route
   *  into the Employment tab's Required Documents card. */
  onClick?: () => void;
}) {
  if (!light.colour) return null;
  const iconClass = ICON_CLASS[light.colour];
  const dim = size === "lg" ? "h-6 w-6" : size === "md" ? "h-5 w-5" : "h-4 w-4";
  const tooltipTitle = `${COLOUR_LABEL[light.colour]} — ${trafficLightTooltipText(light)}`;

  const inner = (
    <FileText className={`${dim} ${iconClass} shrink-0`} aria-label={tooltipTitle} />
  );

  const el = onClick ? (
    <button
      type="button"
      onClick={(e) => {
        // Stop the surrounding row/card click (which routes to
        // /calendar by default) from swallowing this navigation.
        e.stopPropagation();
        onClick();
      }}
      className="inline-flex rounded p-0.5 hover:bg-muted/60"
      aria-label={tooltipTitle}
    >
      {inner}
    </button>
  ) : (
    inner
  );

  return (
    <Tooltip>
      <TooltipTrigger asChild>{el}</TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs text-white">
        <p className="font-medium text-white">{COLOUR_LABEL[light.colour]}</p>
        <p className="text-xs text-white/90">{trafficLightTooltipText(light)}</p>
      </TooltipContent>
    </Tooltip>
  );
}

/** Numeric rank for sorting — red first, then amber, then green,
 *  then null. Consumed by the Employees Directory column's sort. */
export function trafficLightSortRank(light: TrafficLight | null | undefined): number {
  if (!light || !light.colour) return 4;
  if (light.colour === "red") return 1;
  if (light.colour === "amber") return 2;
  return 3; // green
}
