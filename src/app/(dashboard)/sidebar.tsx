"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Users, Building2, CreditCard, ClipboardList, BarChart2, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { capitalize, pluralize } from "@/lib/label-utils";
import { hasPlanFeature } from "@/lib/plan-config";
import { OrganisationEditDialog } from "./organisation-edit-dialog";

interface SidebarProps {
  role: string;
  accessMembers: string | null;
  memberLabel: string;
  orgName: string;
  plan: string;
  requireMfa: boolean;
}

export function Sidebar({ role, accessMembers, memberLabel, orgName, plan, requireMfa }: SidebarProps) {
  const pathname = usePathname();
  const [showOrgEdit, setShowOrgEdit] = useState(false);
  const [reportsOpen, setReportsOpen] = useState(false);

  const showEmployees = role !== "admin" || accessMembers === "read" || accessMembers === "write";
  const showOrg = role === "owner";
  const showBilling = role === "owner";
  const showAudit = role === "owner" || role === "admin";
  const showReports = hasPlanFeature(plan, "reports");
  const showCustomReports = hasPlanFeature(plan, "custom_reports");
  const showScheduledReports = hasPlanFeature(plan, "scheduled_reports");

  const linkClass = (href: string) =>
    cn(
      "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors hover:bg-accent",
      pathname === href && "bg-accent font-medium"
    );

  return (
    <>
      <nav className="w-48 shrink-0 border-r bg-background">
        <div className="flex flex-col gap-0.5 p-2 pt-4">
          {showEmployees && (
            <Link href="/employees" className={linkClass("/employees")}>
              <Users className="h-4 w-4 shrink-0" />
              {capitalize(pluralize(memberLabel))}
            </Link>
          )}
          {showOrg && (
            <button
              onClick={() => setShowOrgEdit(true)}
              className="flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors hover:bg-accent text-left w-full"
            >
              <Building2 className="h-4 w-4 shrink-0" />
              Organisation
            </button>
          )}
          {showBilling && (
            <Link href="/billing" className={linkClass("/billing")}>
              <CreditCard className="h-4 w-4 shrink-0" />
              Billing
            </Link>
          )}
          {showAudit && (
            <Link href="/audit" className={linkClass("/audit")}>
              <ClipboardList className="h-4 w-4 shrink-0" />
              Audit
            </Link>
          )}
          {showReports && (
            <>
              <button
                onClick={() => setReportsOpen((v) => !v)}
                className="flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors hover:bg-accent text-left w-full"
              >
                <BarChart2 className="h-4 w-4 shrink-0" />
                Reports
                <ChevronDown className={cn("ml-auto h-3.5 w-3.5 transition-transform", reportsOpen && "rotate-180")} />
              </button>
              {reportsOpen && (
                <div className="flex flex-col gap-0.5 pl-4">
                  {showCustomReports && (
                    <Link href="/reports/custom" className={linkClass("/reports/custom")}>
                      Custom Reports
                    </Link>
                  )}
                  {showScheduledReports && (
                    <Link href="/reports/scheduled" className={linkClass("/reports/scheduled")}>
                      Scheduled Reports
                    </Link>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </nav>

      {showOrg && (
        <OrganisationEditDialog
          open={showOrgEdit}
          onOpenChange={setShowOrgEdit}
          orgName={orgName}
          memberLabel={memberLabel}
          plan={plan}
          requireMfa={requireMfa}
        />
      )}
    </>
  );
}
