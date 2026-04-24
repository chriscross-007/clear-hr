"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Calendar,
  Palmtree,
  Briefcase,
  User,
  Phone,
  FileText,
  History,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { recordRecentEmployee } from "@/lib/recent-employees";

export type EmployeeSidebarMember = {
  id: string;
  first_name: string;
  last_name: string;
  avatar_url: string | null;
  role: string;
};

interface NavItem {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
}

export function EmployeeSidebar({ member, userId }: { member: EmployeeSidebarMember; userId: string }) {
  const pathname = usePathname();
  const base = `/employees/${member.id}`;

  // Record this visit to the per-user "recent employees" list (browser-only).
  useEffect(() => {
    recordRecentEmployee(userId, {
      memberId: member.id,
      name: `${member.first_name} ${member.last_name}`.trim(),
      avatarUrl: member.avatar_url,
    });
  }, [userId, member.id, member.first_name, member.last_name, member.avatar_url]);
  const items: NavItem[] = [
    { href: `${base}/calendar`, label: "Planner", icon: Calendar },
    { href: `${base}/dashboard`, label: "Dashboard", icon: LayoutDashboard },
    { href: `${base}/holiday`, label: "Holiday", icon: Palmtree },
    { href: `${base}/employment`, label: "Employment", icon: Briefcase },
    { href: `${base}/personal`, label: "Personal", icon: User },
    { href: `${base}/contacts`, label: "Contacts", icon: Phone },
    { href: `${base}/docs`, label: "Docs", icon: FileText },
    { href: `${base}/history`, label: "History", icon: History },
  ];

  const initials = [member.first_name, member.last_name]
    .map((n) => n?.charAt(0).toUpperCase() ?? "")
    .join("");
  const roleLabel = member.role.charAt(0).toUpperCase() + member.role.slice(1);

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
