"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Calendar,
  Clock,
  Palmtree,
  Briefcase,
  User,
  Phone,
  FileText,
  Receipt,
  History,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { recordRecentEmployee } from "@/lib/recent-employees";
import type { TabKey } from "@/lib/rights-types";

export type EmployeeSidebarMember = {
  id: string;
  first_name: string;
  last_name: string;
  avatar_url: string | null;
  // CLE-201c-9 — legacy `role` field dropped; sidebar chip shows the
  // assigned User Rights profile name (or "Unassigned" if null).
  rights_profile_name: string | null;
};

interface NavItem {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  tabKey: TabKey;
}

export function EmployeeSidebar({
  member,
  userId,
  visibleTabs,
}: {
  member: EmployeeSidebarMember;
  userId: string;
  /** CLE-201c-11 — tab-matrix view flags for the current Caller, keyed
   *  by TAB_KEYS. Sidebar shows only the tabs whose `view` is true. */
  visibleTabs: Record<TabKey, boolean>;
}) {
  const pathname = usePathname();
  const base = `/members/${member.id}`;

  // Record this visit to the per-user "recent employees" list (browser-only).
  // Re-records on every pathname change too, so the recent-employees sidebar
  // entry deep-links back to whichever sub-page the admin was last viewing
  // (Holiday, Timesheet, Audit, etc.) rather than always Calendar.
  useEffect(() => {
    // Strip the `/members/{memberId}` prefix to get the sub-path. e.g.
    //   "/members/abc-123/holiday" -> "/holiday"
    //   "/members/abc-123"         -> "" (treated as no specific page)
    const prefix = `/members/${member.id}`;
    const rest = pathname.startsWith(prefix) ? pathname.slice(prefix.length) : "";
    const subPath = rest.startsWith("/") ? rest : "";

    recordRecentEmployee(userId, {
      memberId: member.id,
      name: `${member.first_name} ${member.last_name}`.trim(),
      avatarUrl: member.avatar_url,
      path: subPath || undefined,
    });
  }, [userId, member.id, member.first_name, member.last_name, member.avatar_url, pathname]);
  const allItems: NavItem[] = [
    { href: `${base}/calendar`, label: "Planner", icon: Calendar, tabKey: "planner" },
    { href: `${base}/timesheet`, label: "Timesheet", icon: Clock, tabKey: "timesheet" },
    { href: `${base}/dashboard`, label: "Dashboard", icon: LayoutDashboard, tabKey: "dashboard" },
    { href: `${base}/holiday`, label: "Holiday Periods", icon: Palmtree, tabKey: "holiday" },
    { href: `${base}/employment`, label: "Employment", icon: Briefcase, tabKey: "employment" },
    { href: `${base}/personal`, label: "Personal", icon: User, tabKey: "personal" },
    { href: `${base}/contacts`, label: "Contacts", icon: Phone, tabKey: "contacts" },
    { href: `${base}/docs`, label: "Documents", icon: FileText, tabKey: "documents" },
    { href: `${base}/expenses`, label: "Expenses", icon: Receipt, tabKey: "expenses" },
    { href: `${base}/history`, label: "History", icon: History, tabKey: "history" },
  ];
  // CLE-201c-11 — filter by tab-matrix view flags. A tab with `view=false`
  // is hidden from the sidebar entirely. Direct-URL access still needs
  // gating at each page.tsx (follow-up).
  const items = allItems.filter((i) => visibleTabs[i.tabKey]);

  const initials = [member.first_name, member.last_name]
    .map((n) => n?.charAt(0).toUpperCase() ?? "")
    .join("");
  const roleLabel = member.rights_profile_name ?? "Unassigned";

  return (
    <aside className="sticky top-16 h-[calc(100vh-4rem)] w-56 shrink-0 overflow-y-auto border-r bg-muted/30">
      <div className="flex flex-col items-center gap-2 border-b px-4 py-6">
        {member.avatar_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={member.avatar_url}
            alt={`${member.first_name} ${member.last_name}`}
            className="h-20 w-20 rounded-full object-cover"
          />
        ) : (
          <div className="flex h-20 w-20 items-center justify-center rounded-full bg-muted">
            <span className="text-xl font-medium text-muted-foreground">{initials}</span>
          </div>
        )}
        <div className="text-center">
          <div className="text-xl font-bold leading-tight">
            {member.first_name} {member.last_name}
          </div>
          <div className="text-xs text-muted-foreground">{roleLabel}</div>
        </div>
      </div>

      <nav className="flex flex-col gap-0.5 p-2">
        {items.map((item) => {
          const active = pathname === item.href || pathname.startsWith(item.href + "/");
          const Icon = item.icon;
          // CLE-194 Phase 2 — the per-employee Holiday cog and its
          // sidebar button are gone. The 7-value bundle now lives on the
          // member's Holiday Profile, assigned from the Employment page.

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors hover:bg-accent",
                active && "bg-accent font-medium",
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
