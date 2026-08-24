import { type ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Sticky band that pins below the dashboard header (which sits at top-0 with
 * h-16) at the top of any dashboard list page. Wrap whatever the page wants
 * displayed at the top — typically an `<h1>` plus optional right-aligned
 * controls — and the band stays anchored as the body scrolls.
 *
 * Pair with `<DataGrid stickyHeader />` on grid-driven pages so the toolbar,
 * column header row and filter row form one cohesive sticky stack:
 *
 * - top-0  (z-50): dashboard header + trial banner (in `(dashboard)/layout.tsx`)
 * - top-16 (z-30): this component — offset by `--top-chrome-extra` when
 *                  a trial / past-due banner is showing above the header
 * - DataGrid toolbar (z-30): stickyHeaderTop + --top-chrome-extra
 * - DataGrid column header (z-20): stickyHeaderTop + 56 + --top-chrome-extra
 * - DataGrid filter row (z-20): stickyHeaderTop + 96 + --top-chrome-extra
 *
 * `--top-chrome-extra` is a CSS variable set on the dashboard layout root —
 * 36px per active banner, 0px otherwise. Downstream sticky offsets add it in
 * a calc() so they shift as a unit when the banner appears/disappears without
 * consumers needing to know about it.
 *
 * The negative horizontal margins assume the consuming page uses the standard
 * `px-4 sm:px-6 lg:px-8` outer padding so the band can extend full-bleed and
 * its bottom border crosses the entire viewport width.
 *
 * Server-component safe — no hooks, no event handlers.
 */
export function StickyPageHeader({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "sticky z-30 -mx-4 sm:-mx-6 lg:-mx-8 bg-background px-4 sm:px-6 lg:px-8 pt-8 pb-3 border-b",
        className,
      )}
      // Base is 4rem (h-16 of dashboard header); trial/past-due banners
      // above push this down by --top-chrome-extra.
      style={{ top: "calc(var(--top-chrome-extra, 0px) + 4rem)" }}
    >
      {children}
    </div>
  );
}
