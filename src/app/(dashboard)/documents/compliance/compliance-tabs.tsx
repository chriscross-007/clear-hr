"use client";

// CLE-219 Ticket D — tab strip shared by the Compliance dashboard's
// two client components (Management + Acknowledgements). Rendered
// inside each client's <StickyPageHeader> so the tabs stay visible
// while the row table scrolls beneath.
//
// URL-driven per Chris's preference for shareable/bookmarkable pages:
// each tab is a plain <Link> that mutates `?tab=…`. No client state,
// no history games — a bookmark of the Acknowledgements tab loads
// straight into it.

import Link from "next/link";

type Tab = "management" | "acknowledgements";

export function ComplianceTabs({ active }: { active: Tab }) {
  const tabs: Array<{ id: Tab; label: string; href: string }> = [
    { id: "management", label: "Management", href: "/documents/compliance" },
    { id: "acknowledgements", label: "Acknowledgements", href: "/documents/compliance?tab=acknowledgements" },
  ];
  return (
    <div className="mt-3 flex items-center gap-1 border-b -mb-3">
      {tabs.map((t) => {
        const on = t.id === active;
        return (
          <Link
            key={t.id}
            href={t.href}
            className={
              on
                ? "inline-flex items-center border-b-2 border-primary px-3 py-2 text-sm font-medium text-foreground"
                : "inline-flex items-center border-b-2 border-transparent px-3 py-2 text-sm text-muted-foreground hover:text-foreground"
            }
          >
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}
