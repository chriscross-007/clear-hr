"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Building2,
  PoundSterling,
  Clock,
  ListChecks,
  IdCard,
  LayoutGrid,
  Database,
} from "lucide-react";
import { cn } from "@/lib/utils";

// CLE-191 — Secondary sidebar for the Settings shell. Mirrors the
// per-employee EmployeeSidebar pattern. Each item is gated by the same
// permission rules its page enforces server-side; we hide items the
// caller can't reach so the menu doesn't lie.

interface NavItem {
  href: string;
  label: string;
  icon: typeof Building2;
  visible: boolean;
}

interface SettingsSidebarProps {
  role: string;
  canEditOrganisation: boolean;
  canDefineCustomFields: boolean;
  canAddMembers: boolean;
}

export function SettingsSidebar({
  role,
  canEditOrganisation,
  canDefineCustomFields,
  canAddMembers,
}: SettingsSidebarProps) {
  const pathname = usePathname();
  const isOwner = role === "owner";

  const items: NavItem[] = [
    {
      href: "/settings/organisation",
      label: "Organisation",
      icon: Building2,
      visible: isOwner || canEditOrganisation,
    },
    {
      href: "/settings/rates",
      label: "Rates",
      icon: PoundSterling,
      visible: isOwner || canEditOrganisation,
    },
    {
      href: "/settings/timesheet",
      label: "Timesheet",
      icon: Clock,
      visible: isOwner || canEditOrganisation,
    },
    {
      href: "/settings/custom-fields",
      label: "Custom Fields",
      icon: ListChecks,
      visible: isOwner || canDefineCustomFields,
    },
    {
      href: "/settings/profiles",
      label: "Profiles",
      icon: IdCard,
      // Owner only — every profile type touches member-treatment rules.
      visible: isOwner,
    },
    {
      href: "/settings/groups",
      label: "Groups",
      icon: LayoutGrid,
      visible: isOwner || canAddMembers,
    },
    {
      href: "/settings/backups",
      label: "Backups",
      icon: Database,
      visible: isOwner,
    },
  ];

  const visibleItems = items.filter((i) => i.visible);

  return (
    <aside className="sticky top-16 h-[calc(100vh-4rem)] w-56 shrink-0 overflow-y-auto border-r bg-muted/30">
      <div className="border-b px-4 py-5">
        <h2 className="text-lg font-bold">Settings</h2>
        <p className="text-xs text-muted-foreground mt-0.5">Organisation-wide configuration</p>
      </div>

      <nav className="flex flex-col gap-0.5 p-2">
        {visibleItems.map((item) => {
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
