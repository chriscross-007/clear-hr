"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Users, Building2, CreditCard, ClipboardList, BarChart2, ChevronDown, Star, BookOpen, FolderOpen, Calendar, CalendarDays, Clock, Palmtree, ClipboardCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { capitalize, pluralize } from "@/lib/label-utils";
import { hasPlanFeature } from "@/lib/plan-config";
import { OrganisationEditDialog } from "./organisation-edit-dialog";
import { REPORT_GROUPS, ALL_STANDARD_REPORTS } from "./reports/definitions";

interface SidebarProps {
  role: string;
  accessMembers: string | null;
  memberLabel: string;
  orgName: string;
  plan: string;
  requireMfa: boolean;
  canDefineCustomFields: boolean;
  currencySymbol: string;
  tsMaxShiftHours: number;
  tsMaxBreakMinutes: number;
  tsShiftStartVarianceMinutes: number;
  tsRoundFirstInMins: number | null;
  tsRoundFirstInGraceMins: number | null;
  tsRoundBreakOutMins: number | null;
  tsRoundBreakOutGraceMins: number | null;
  tsRoundBreakInMins: number | null;
  tsRoundBreakInGraceMins: number | null;
  tsRoundLastOutMins: number | null;
  tsRoundLastOutGraceMins: number | null;
  holidayYearStartType: string;
  holidayYearStartDay: number;
  holidayYearStartMonth: number;
  bankHolidayHandling: string;
  bankHolidayColour: string;
  defaultWorkProfileId: string | null;
  initialFavouriteIds?: string[];
  initialCustomReports?: { id: string; name: string }[];
  initialShiftDefs?: { id: string; name: string }[];
}

export function Sidebar({
  role,
  accessMembers,
  memberLabel,
  orgName,
  plan,
  requireMfa,
  canDefineCustomFields,
  currencySymbol,
  tsMaxShiftHours,
  tsMaxBreakMinutes,
  tsShiftStartVarianceMinutes,
  tsRoundFirstInMins,
  tsRoundFirstInGraceMins,
  tsRoundBreakOutMins,
  tsRoundBreakOutGraceMins,
  tsRoundBreakInMins,
  tsRoundBreakInGraceMins,
  tsRoundLastOutMins,
  tsRoundLastOutGraceMins,
  holidayYearStartType,
  holidayYearStartDay,
  holidayYearStartMonth,
  bankHolidayHandling,
  bankHolidayColour,
  defaultWorkProfileId,
  initialFavouriteIds = [],
  initialCustomReports = [],
  initialShiftDefs = [],
}: SidebarProps) {
  const pathname = usePathname();
  const [showOrgEdit, setShowOrgEdit] = useState(false);
  const [shiftsOpen, setShiftsOpen] = useState(false);
  const [reportsOpen, setReportsOpen] = useState(false);
  const [standardOpen, setStandardOpen] = useState(false);
  const [reportGroupsOpen, setReportGroupsOpen] = useState<Record<string, boolean>>({});
  const [favouritesOpen, setFavouritesOpen] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);

  const showEmployees = role !== "admin" || accessMembers === "read" || accessMembers === "write";
  const showShifts = role === "owner" || role === "admin";
  const showOrg = role === "owner" || canDefineCustomFields;
  const showBilling = role === "owner";
  const showAudit = role === "owner" || role === "admin";
  const showReports = hasPlanFeature(plan, "reports");
  const showCustomReports = hasPlanFeature(plan, "custom_reports");

  // Resolve favourite IDs to name + href
  const favouriteItems = initialFavouriteIds
    .map((id) => {
      const standard = ALL_STANDARD_REPORTS.find((r) => r.id === id);
      if (standard) return { id, name: standard.name, href: `/reports/${id}` };
      const custom = initialCustomReports.find((r) => r.id === id);
      if (custom) return { id, name: custom.name, href: `/reports/custom/${id}` };
      return null;
    })
    .filter(Boolean) as { id: string; name: string; href: string }[];

  const linkClass = (href: string) =>
    cn(
      "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors hover:bg-accent",
      pathname === href && "bg-accent font-medium"
    );

  const subNodeBtn = (label: string, icon: React.ReactNode, open: boolean, onClick: () => void) => (
    <button
      onClick={onClick}
      className="flex items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors hover:bg-accent text-left w-full text-muted-foreground"
    >
      {icon}
      {label}
      <ChevronDown className={cn("ml-auto h-3 w-3 transition-transform", open && "rotate-180")} />
    </button>
  );

  const subItemClass = (href: string) =>
    cn(
      "block rounded-md px-3 py-1.5 text-sm transition-colors hover:bg-accent",
      pathname === href && "bg-accent font-medium"
    );

  return (
    <>
      <nav className="w-48 shrink-0 border-r bg-background sticky top-16 h-[calc(100vh-4rem)] overflow-y-auto">
        <div className="flex flex-col gap-0.5 p-2 pt-4">
          <Link href="/holiday" className={linkClass("/holiday")}>
            <Palmtree className="h-4 w-4 shrink-0" />
            My Holiday
          </Link>
          {showEmployees && (
            <Link href="/employees" className={linkClass("/employees")}>
              <Users className="h-4 w-4 shrink-0" />
              {capitalize(pluralize(memberLabel))}
            </Link>
          )}
          {(role === "owner" || role === "admin") && (
            <Link href="/absence-types" className={linkClass("/absence-types")}>
              <CalendarDays className="h-4 w-4 shrink-0" />
              Absence Types
            </Link>
          )}
          {(role === "owner" || role === "admin") && (
            <Link href="/holiday-profiles" className={linkClass("/holiday-profiles")}>
              <CalendarDays className="h-4 w-4 shrink-0" />
              Holiday Profiles
            </Link>
          )}
          {(role === "owner" || role === "admin") && (
            <Link href="/work-profiles" className={linkClass("/work-profiles")}>
              <Clock className="h-4 w-4 shrink-0" />
              Work Profiles
            </Link>
          )}
          {(role === "owner" || role === "admin") && (
            <Link href="/availability" className={linkClass("/availability")}>
              <Calendar className="h-4 w-4 shrink-0" />
              Availability
            </Link>
          )}
          {(role === "owner" || role === "admin") && (
            <Link href="/approvals" className={linkClass("/approvals")}>
              <ClipboardCheck className="h-4 w-4 shrink-0" />
              Approvals
            </Link>
          )}
          {showShifts && (
            <>
              <button
                onClick={() => setShiftsOpen((v) => !v)}
                className="flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors hover:bg-accent text-left w-full"
              >
                <Clock className="h-4 w-4 shrink-0" />
                Shifts
                <ChevronDown className={cn("ml-auto h-3.5 w-3.5 transition-transform", shiftsOpen && "rotate-180")} />
              </button>
              {shiftsOpen && (
                <div className="flex flex-col gap-0.5 pl-4">
                  <Link href="/shifts" className={subItemClass("/shifts")}>
                    All Shifts
                  </Link>
                  {initialShiftDefs.map((s) => (
                    <Link key={s.id} href={`/shifts/${s.id}`} className={subItemClass(`/shifts/${s.id}`)}>
                      {s.name}
                    </Link>
                  ))}
                  <Link href="/shifts/new" className={subItemClass("/shifts/new")}>
                    <span className="text-muted-foreground">+ New Shift</span>
                  </Link>
                </div>
              )}
            </>
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

                  {/* Standard */}
                  {subNodeBtn("Standard", <BookOpen className="h-3.5 w-3.5 shrink-0" />, standardOpen, () => setStandardOpen((v) => !v))}
                  {standardOpen && (
                    <div className="flex flex-col gap-0.5 pl-3">
                      {Object.entries(REPORT_GROUPS).map(([groupKey, reports]) => {
                        const groupLabel = reports[0]?.groupLabel ?? groupKey;
                        const isGroupOpen = reportGroupsOpen[groupKey] ?? false;
                        return (
                          <div key={groupKey}>
                            <button
                              onClick={() => setReportGroupsOpen((prev) => ({ ...prev, [groupKey]: !isGroupOpen }))}
                              className="flex items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors hover:bg-accent text-left w-full text-muted-foreground"
                            >
                              {groupLabel}
                              <ChevronDown className={cn("ml-auto h-3 w-3 transition-transform", isGroupOpen && "rotate-180")} />
                            </button>
                            {isGroupOpen && (
                              <div className="flex flex-col gap-0.5 pl-3">
                                {reports.map((report) => (
                                  <Link key={report.id} href={`/reports/${report.id}`} className={subItemClass(`/reports/${report.id}`)}>
                                    {report.name}
                                  </Link>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Favourites */}
                  {subNodeBtn("Favourites", <Star className="h-3.5 w-3.5 shrink-0 text-amber-500" />, favouritesOpen, () => setFavouritesOpen((v) => !v))}
                  {favouritesOpen && (
                    <div className="flex flex-col gap-0.5 pl-3">
                      {favouriteItems.length === 0 ? (
                        <p className="px-3 py-1.5 text-xs text-muted-foreground">No favourites yet</p>
                      ) : (
                        favouriteItems.map((item) => (
                          <Link key={item.id} href={item.href} className={subItemClass(item.href)}>
                            {item.name}
                          </Link>
                        ))
                      )}
                    </div>
                  )}

                  {/* Custom */}
                  {showCustomReports && (
                    <>
                      {subNodeBtn("Custom", <FolderOpen className="h-3.5 w-3.5 shrink-0" />, customOpen, () => setCustomOpen((v) => !v))}
                      {customOpen && (
                        <div className="flex flex-col gap-0.5 pl-3">
                          {initialCustomReports.length === 0 ? (
                            <p className="px-3 py-1.5 text-xs text-muted-foreground">No custom reports</p>
                          ) : (
                            initialCustomReports.map((report) => (
                              <Link key={report.id} href={`/reports/custom/${report.id}`} className={subItemClass(`/reports/custom/${report.id}`)}>
                                {report.name}
                              </Link>
                            ))
                          )}
                        </div>
                      )}
                    </>
                  )}

                  {/* Scheduled */}
                  <button
                    disabled
                    className="flex items-center gap-2 rounded-md px-3 py-1.5 text-sm text-left w-full text-muted-foreground opacity-40 cursor-not-allowed"
                  >
                    <Calendar className="h-3.5 w-3.5 shrink-0" />
                    Scheduled
                    <span className="ml-auto text-xs">soon</span>
                  </button>

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
          role={role}
          canDefineCustomFields={canDefineCustomFields}
          currencySymbol={currencySymbol}
          tsMaxShiftHours={tsMaxShiftHours}
          tsMaxBreakMinutes={tsMaxBreakMinutes}
          tsShiftStartVarianceMinutes={tsShiftStartVarianceMinutes}
          tsRoundFirstInMins={tsRoundFirstInMins}
          tsRoundFirstInGraceMins={tsRoundFirstInGraceMins}
          tsRoundBreakOutMins={tsRoundBreakOutMins}
          tsRoundBreakOutGraceMins={tsRoundBreakOutGraceMins}
          tsRoundBreakInMins={tsRoundBreakInMins}
          tsRoundBreakInGraceMins={tsRoundBreakInGraceMins}
          tsRoundLastOutMins={tsRoundLastOutMins}
          tsRoundLastOutGraceMins={tsRoundLastOutGraceMins}
          holidayYearStartType={holidayYearStartType}
          holidayYearStartDay={holidayYearStartDay}
          holidayYearStartMonth={holidayYearStartMonth}
          bankHolidayHandling={bankHolidayHandling}
          bankHolidayColour={bankHolidayColour}
          defaultWorkProfileId={defaultWorkProfileId}
        />
      )}
    </>
  );
}
