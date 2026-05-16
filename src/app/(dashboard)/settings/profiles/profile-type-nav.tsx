"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { PROFILE_TYPES, PROFILE_TYPE_ORDER } from "./profile-types";

// CLE-191 — Inner tab nav for Profiles. Five profile types share a
// single section. Stays inside `/settings/profiles/*` so the Settings
// secondary menu's "Profiles" entry remains the parent crumb.
//
// Tab labels + hrefs live in `./profile-types.ts`. Each list's Card
// title imports from the same source so a label edit propagates to
// both the tab and the list heading.

export function ProfileTypeNav() {
  const pathname = usePathname();
  return (
    <div className="border-b">
      <nav className="-mb-px flex gap-1 overflow-x-auto">
        {PROFILE_TYPE_ORDER.map((key) => {
          const tab = PROFILE_TYPES[key];
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
