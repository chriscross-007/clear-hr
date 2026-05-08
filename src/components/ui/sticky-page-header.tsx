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
 * - top-0  (z-50): dashboard header (in `(dashboard)/layout.tsx`)
 * - top-16 (z-30): this component
 * - top-[120px] (z-30): DataGrid toolbar (when stickyHeader)
 * - top-[176px] (z-20): DataGrid column header row
 * - top-[216px] (z-20): DataGrid filter row
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
        "sticky top-16 z-30 -mx-4 sm:-mx-6 lg:-mx-8 bg-background px-4 sm:px-6 lg:px-8 pt-8 pb-3 border-b",
        className,
      )}
    >
      {children}
    </div>
  );
}
