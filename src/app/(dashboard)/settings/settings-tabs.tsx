"use client";

// CLE-209 follow-up — Settings navigation converted from a left-side
// sub-sidebar to a horizontal pill row. The Settings surface is
// entered via the cog icon in the top bar; a second column of nav
// duplicated screen real estate for no gain.

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
  FileText,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface NavItem {
  href: string;
  label: string;
  icon: typeof Building2;
  visible: boolean;
}

interface SettingsTabsProps {
  canEditOrgSettings: boolean;
  canManageTeams: boolean;
  canEditRightsProfiles: boolean;
  canManageBilling: boolean;
}

export function SettingsTabs({
  canEditOrgSettings,
  canManageTeams,
  canEditRightsProfiles,
  canManageBilling,
}: SettingsTabsProps) {
  const pathname = usePathname();

  const items: NavItem[] = [
    { href: "/settings/organisation",   label: "Organisation",       icon: Building2,     visible: canEditOrgSettings },
    { href: "/settings/rates",          label: "Rates",              icon: PoundSterling, visible: canEditOrgSettings },
    { href: "/settings/timesheet",      label: "Timesheet",          icon: Clock,         visible: canEditOrgSettings },
    { href: "/settings/custom-fields",  label: "Custom Fields",      icon: ListChecks,    visible: canEditOrgSettings },
    { href: "/settings/rights-profiles", label: "User Rights",       icon: ShieldCheck,   visible: canEditRightsProfiles },
    { href: "/settings/profiles",       label: "Profiles",           icon: IdCard,        visible: canEditOrgSettings },
    { href: "/settings/groups",         label: "Groups",             icon: LayoutGrid,    visible: canManageTeams },
    { href: "/settings/documents",      label: "Document Subtypes",  icon: FileText,      visible: canEditOrgSettings },
    { href: "/settings/backups",        label: "Backups",            icon: Database,      visible: canEditOrgSettings || canManageBilling },
  ];
  const visible = items.filter((i) => i.visible);

  return (
    <div className="border-b bg-background">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <h1 className="mb-3 mt-6 text-2xl font-bold">Settings</h1>
        <nav
          className="-mx-4 flex gap-1 overflow-x-auto px-4 pb-3 sm:mx-0 sm:px-0"
          aria-label="Settings sections"
        >
          {visible.map((item) => {
            const active = pathname === item.href || pathname.startsWith(item.href + "/");
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors",
                  active
                    ? "border-transparent bg-primary text-primary-foreground"
                    : "border-input bg-background text-foreground hover:bg-accent",
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
