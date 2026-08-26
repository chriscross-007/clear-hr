"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Building2,
  PoundSterling,
  Clock,
  ListChecks,
  IdCard,
  ShieldCheck,
  LayoutGrid,
  Database,
} from "lucide-react";
import { cn } from "@/lib/utils";

// CLE-196b-1 — Secondary sidebar for the Settings shell. Item
// visibility gated by the Rights Profiles v2 resolver flags passed in
// as props. Custom Fields lives under can_edit_org_settings (see
// CLE-195 sensitive-field notes); Backups + Profiles under their own
// dedicated flags. Legacy `role === "owner"` and permissions.can_*
// paths are gone.

interface NavItem {
  href: string;
  label: string;
  icon: typeof Building2;
  visible: boolean;
}

interface SettingsSidebarProps {
  canEditOrgSettings: boolean;
  canManageTeams: boolean;
  canEditRightsProfiles: boolean;
  canManageBilling: boolean;
}

export function SettingsSidebar({
  canEditOrgSettings,
  canManageTeams,
  canEditRightsProfiles,
  canManageBilling,
}: SettingsSidebarProps) {
  const pathname = usePathname();

  const items: NavItem[] = [
    {
      href: "/settings/organisation",
      label: "Organisation",
      icon: Building2,
      visible: canEditOrgSettings,
    },
    {
      href: "/settings/rates",
      label: "Rates",
      icon: PoundSterling,
      visible: canEditOrgSettings,
    },
    {
      href: "/settings/timesheet",
      label: "Timesheet",
      icon: Clock,
      visible: canEditOrgSettings,
    },
    {
      href: "/settings/custom-fields",
      label: "Custom Fields",
      icon: ListChecks,
      visible: canEditOrgSettings,
    },
    {
      href: "/settings/rights-profiles",
      label: "User Rights",
      icon: ShieldCheck,
      // CLE-197 — Rights Profiles v2 editor.
      visible: canEditRightsProfiles,
    },
    {
      href: "/settings/profiles",
      label: "Profiles",
      icon: IdCard,
      // Legacy profile-types index (approver / notice / holiday /
      // working-pattern). Rights Profiles v2 has its own top-level
      // item above; this remains for the other profile types.
      visible: canEditOrgSettings,
    },
    {
      href: "/settings/groups",
      label: "Groups",
      icon: LayoutGrid,
      visible: canManageTeams,
    },
    {
      href: "/settings/backups",
      label: "Backups",
      icon: Database,
      // Backups touch the whole tenant; gate on top-level org settings.
      visible: canEditOrgSettings || canManageBilling,
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
