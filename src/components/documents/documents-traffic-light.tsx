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
import type { TrafficLight } from "@/lib/documents-traffic-light";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
// Pure formatters live outside this "use client" module so server
// components can import them too. Re-exported here so existing
// call-sites don't have to move.
import {
  trafficLightTooltipText,
  trafficLightSortRank,
} from "@/lib/traffic-light-format";
export { trafficLightTooltipText, trafficLightSortRank };

// Icon fill tints keep the shape identical across states — only
// the colour changes, so the surface still reads as one thing.
const ICON_CLASS: Record<Exclude<TrafficLight["colour"], null>, string> = {
  red: "text-red-500",
  amber: "text-amber-500",
  green: "text-green-500",
};

const STATUS_SYMBOL: Record<Exclude<TrafficLight["colour"], null>, string> = {
  red: "✕",
  amber: "!",
  green: "✓",
};

const COLOUR_LABEL: Record<Exclude<TrafficLight["colour"], null>, string> = {
  red: "Attention required",
  amber: "Attention soon",
  green: "All good",
};

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

  // CLE-232 — in the Accessible themes a symbol rides on the icon so
  // the state doesn't depend on colour alone (✕ red, ! amber, ✓ green).
  const inner = (
    <span className="relative inline-flex shrink-0">
      <FileText className={`${dim} ${iconClass} shrink-0`} aria-label={tooltipTitle} />
      <span
        aria-hidden
        className="absolute -bottom-1 -right-1.5 hidden h-3.5 min-w-3.5 items-center justify-center rounded-sm bg-background px-0.5 text-[10px] font-bold leading-none text-foreground ring-1 ring-current a11y:inline-flex"
      >
        {STATUS_SYMBOL[light.colour]}
      </span>
    </span>
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

// `trafficLightSortRank` + `trafficLightTooltipText` are re-exported
// from the pure formatter module at the top of this file.
