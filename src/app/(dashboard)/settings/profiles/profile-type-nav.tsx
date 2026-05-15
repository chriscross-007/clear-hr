"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

// CLE-191 — Inner tab nav for Profiles. Five profile types share a
// single section. Stays inside `/settings/profiles/*` so the Settings
// secondary menu's "Profiles" entry remains the parent crumb.

// CLE-191 — Tab labels are plurals (these tabs each show a list of
// profiles of that type). URLs stay singular for readability.
const TABS = [
  { href: "/settings/profiles/rights", label: "Rights" },
  { href: "/settings/profiles/working-pattern", label: "Working Patterns" },
  { href: "/settings/profiles/notice-period", label: "Notice Periods" },
  { href: "/settings/profiles/approver", label: "Approvers" },
  { href: "/settings/profiles/holiday", label: "Holidays" },
];

export function ProfileTypeNav() {
  const pathname = usePathname();
  return (
    <div className="border-b">
      <nav className="-mb-px flex gap-1 overflow-x-auto">
        {TABS.map((tab) => {
          const active = pathname === tab.href || pathname.startsWith(tab.href + "/");
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={cn(
                "border-b-2 border-transparent px-3 py-2 text-sm whitespace-nowrap",
                active
                  ? "border-primary font-semibold text-foreground"
                  : "text-muted-foreground hover:text-foreground hover:border-muted",
              )}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
