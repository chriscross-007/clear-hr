"use client";

// Colour-keyed tab selector for the member Documents pages (admin
// `/members/[id]/docs` and the member's own `/my-documents`).
//
// Each document tab has a pastel colour; the tab trigger and the card
// header on that tab share it so the two read as one unit:
//   Certifications — green · Employment — blue · Other — orange
//   Organisation — yellow · Trash — red
//
// `DocTabTrigger` renders a coloured trigger with a tooltip. `docTabCard`
// returns the Card / CardHeader classes for the matching card.

import { TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export type DocTabKey = "certifications" | "employment" | "other" | "org" | "trash";

export const DOC_TAB_LABEL: Record<DocTabKey, string> = {
  certifications: "Certifications",
  employment: "Employment",
  other: "Other",
  org: "Organisation",
  trash: "Trash",
};

/** Classes for the TabsList that holds the coloured triggers: no grey
 *  track, a small gap between buttons. */
export const DOC_TAB_LIST_CLASS = "h-auto gap-2 bg-transparent p-0 flex-wrap";

const THEME: Record<DocTabKey, { trigger: string; card: string; header: string }> = {
  certifications: {
    trigger:
      "bg-green-50 text-green-800 border-green-200 hover:bg-green-100 hover:text-green-900 " +
      "data-[state=active]:bg-green-200 data-[state=active]:text-green-900 data-[state=active]:border-green-400 " +
      "dark:bg-green-950/40 dark:text-green-200 dark:border-green-900 dark:hover:bg-green-900/50 " +
      "dark:data-[state=active]:bg-green-800/60 dark:data-[state=active]:text-green-50 dark:data-[state=active]:border-green-600",
    card: "border-green-200 dark:border-green-900",
    header: "bg-green-50 border-green-200 dark:bg-green-950/40 dark:border-green-900",
  },
  employment: {
    trigger:
      "bg-blue-50 text-blue-800 border-blue-200 hover:bg-blue-100 hover:text-blue-900 " +
      "data-[state=active]:bg-blue-200 data-[state=active]:text-blue-900 data-[state=active]:border-blue-400 " +
      "dark:bg-blue-950/40 dark:text-blue-200 dark:border-blue-900 dark:hover:bg-blue-900/50 " +
      "dark:data-[state=active]:bg-blue-800/60 dark:data-[state=active]:text-blue-50 dark:data-[state=active]:border-blue-600",
    card: "border-blue-200 dark:border-blue-900",
    header: "bg-blue-50 border-blue-200 dark:bg-blue-950/40 dark:border-blue-900",
  },
  other: {
    trigger:
      "bg-orange-50 text-orange-800 border-orange-200 hover:bg-orange-100 hover:text-orange-900 " +
      "data-[state=active]:bg-orange-200 data-[state=active]:text-orange-900 data-[state=active]:border-orange-400 " +
      "dark:bg-orange-950/40 dark:text-orange-200 dark:border-orange-900 dark:hover:bg-orange-900/50 " +
      "dark:data-[state=active]:bg-orange-800/60 dark:data-[state=active]:text-orange-50 dark:data-[state=active]:border-orange-600",
    card: "border-orange-200 dark:border-orange-900",
    header: "bg-orange-50 border-orange-200 dark:bg-orange-950/40 dark:border-orange-900",
  },
  org: {
    trigger:
      "bg-yellow-50 text-yellow-800 border-yellow-200 hover:bg-yellow-100 hover:text-yellow-900 " +
      "data-[state=active]:bg-yellow-200 data-[state=active]:text-yellow-900 data-[state=active]:border-yellow-400 " +
      "dark:bg-yellow-950/40 dark:text-yellow-200 dark:border-yellow-900 dark:hover:bg-yellow-900/50 " +
      "dark:data-[state=active]:bg-yellow-800/60 dark:data-[state=active]:text-yellow-50 dark:data-[state=active]:border-yellow-600",
    card: "border-yellow-200 dark:border-yellow-900",
    header: "bg-yellow-50 border-yellow-200 dark:bg-yellow-950/40 dark:border-yellow-900",
  },
  trash: {
    trigger:
      "bg-red-50 text-red-800 border-red-200 hover:bg-red-100 hover:text-red-900 " +
      "data-[state=active]:bg-red-200 data-[state=active]:text-red-900 data-[state=active]:border-red-400 " +
      "dark:bg-red-950/40 dark:text-red-200 dark:border-red-900 dark:hover:bg-red-900/50 " +
      "dark:data-[state=active]:bg-red-800/60 dark:data-[state=active]:text-red-50 dark:data-[state=active]:border-red-600",
    card: "border-red-200 dark:border-red-900",
    header: "bg-red-50 border-red-200 dark:bg-red-950/40 dark:border-red-900",
  },
};

/** Card + CardHeader classes for a tab's card. The header becomes a
 *  tinted band across the top of the card (card top padding moved into
 *  the header so the tint reaches the rounded edge). Pass nothing to
 *  get no colouring. */
export function docTabCard(tone: DocTabKey | undefined): { card: string; header: string } {
  if (!tone) return { card: "", header: "" };
  const t = THEME[tone];
  return {
    card: cn("pt-0 overflow-hidden", t.card),
    header: cn("border-b pt-4 [.border-b]:pb-4", t.header),
  };
}

export function DocTabTrigger({
  tab,
  tooltip,
  children,
}: {
  tab: DocTabKey;
  tooltip: string;
  /** Overrides the default label (e.g. "Trash (3)"). */
  children?: React.ReactNode;
}) {
  return (
    <Tooltip>
      {/* Wrapper span takes the tooltip's data-state so it can't
          clobber the TabsTrigger's own data-state="active". */}
      <TooltipTrigger asChild>
        <span className="inline-flex">
          <TabsTrigger
            value={tab}
            className={cn("flex-none px-3 py-1.5 border", THEME[tab].trigger)}
          >
            {children ?? DOC_TAB_LABEL[tab]}
          </TabsTrigger>
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6} className="max-w-xs">
        {tooltip}
      </TooltipContent>
    </Tooltip>
  );
}

/** Tooltip copy. `self` = the member viewing their own documents. */
export function docTabTooltip(tab: DocTabKey, opts: { self: boolean; memberLabel: string }): string {
  const who = opts.self ? "you" : `this ${opts.memberLabel}`;
  const whose = opts.self ? "your" : `this ${opts.memberLabel}'s`;
  switch (tab) {
    case "certifications":
      return `Documents ${opts.self ? "you supply" : `this ${opts.memberLabel} supplies`}: Right to Work evidence and required certificates.`;
    case "employment":
      return `Documents the organisation has issued to ${who}: contract, reviews, disciplinary.`;
    case "other":
      return `Everything else held on ${whose} record, such as absence evidence.`;
    case "org":
      return "Organisation-wide documents such as policies and handbooks.";
    case "trash":
      return "Deleted documents, kept for 30 days before being permanently removed.";
  }
}
