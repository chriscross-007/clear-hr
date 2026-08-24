"use client";

import { useLayoutEffect, useRef, type ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Sticky band that pins below the dashboard header (which sits at top-0 with
 * h-16) at the top of any dashboard list page. Wrap whatever the page wants
 * displayed at the top — typically an `<h1>` plus optional right-aligned
 * controls — and the band stays anchored as the body scrolls.
 *
 * The component measures its own rendered height and publishes it on the root
 * element as the `--page-header-height` CSS variable. `<DataGrid stickyHeader />`
 * reads that var to pin its toolbar directly below this band, with no gap and
 * no overlap regardless of how much content the caller stuffs in here.
 *
 * Sticky-offset stack at the top of a dashboard list page:
 * - top-0 (z-50):  dashboard header + trial banner (in (dashboard)/layout.tsx)
 *                  → sets `--top-chrome-extra` (36px per banner, 0 otherwise)
 * - top-16 (z-30): this component; shifts down by `--top-chrome-extra`
 *                  → sets `--page-header-height` for the band's actual height
 * - DataGrid toolbar (z-30):       auto-pins just below via CSS var
 *                                  (height = pt-2 + h-8 + pb-4 = 56)
 * - DataGrid column header (z-20): +56 (toolbar bottom)
 * - DataGrid filter row (z-20):    +95 (column header h-10 = 40 more, -1
 *                                  to overlap the tr border-b hairline)
 *
 * Pages that don't use `<StickyPageHeader>` can still position `<DataGrid
 * stickyHeader />` by passing an explicit `stickyHeaderTop` prop — that
 * overrides the CSS-var computation.
 *
 * The negative horizontal margins assume the consuming page uses the standard
 * `px-4 sm:px-6 lg:px-8` outer padding so the band can extend full-bleed and
 * its bottom border crosses the entire viewport width.
 */
export function StickyPageHeader({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    const update = () => {
      const h = el.getBoundingClientRect().height;
      document.documentElement.style.setProperty(
        "--page-header-height",
        `${h}px`,
      );
    };
    update();

    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      ro.disconnect();
      document.documentElement.style.removeProperty("--page-header-height");
    };
  }, []);

  return (
    <div
      ref={ref}
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
