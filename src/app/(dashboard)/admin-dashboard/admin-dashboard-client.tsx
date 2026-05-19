"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AlertTriangle,
  CalendarPlus,
  ChevronDown,
  ChevronUp,
  ClipboardCheck,
  Stethoscope,
  UserX,
  Palmtree,
  Cake,
} from "lucide-react";
import { CompletionStatusBadge } from "@/components/completion-status-badge";
import { getIncompleteSickBookings } from "@/app/(dashboard)/sick-booking-actions";
import { getDashboardSummary } from "@/app/(dashboard)/dashboard-actions";
import {
  getEmployeesWithoutHolidayPeriod,
  type EmployeeMissingHolidayPeriod,
} from "@/app/(dashboard)/holiday-period-actions";
import { getPendingApprovalsCount } from "@/app/(dashboard)/approvals-actions";
import type { IncompleteSickBooking } from "@/app/(dashboard)/sick-booking-types";
import type { AbsentMember, BirthdayMember } from "@/app/(dashboard)/dashboard-types";

function fmtDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00Z");
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
}

// ---------------------------------------------------------------------------
// Expandable card wrapper — reused by all summary cards
// ---------------------------------------------------------------------------

function SummaryCard({
  icon,
  title,
  count,
  subtitle,
  loading,
  error,
  emptyText,
  expanded,
  onToggle,
  href,
  borderColour,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  count: number;
  subtitle?: React.ReactNode;
  loading: boolean;
  error: string | null;
  emptyText: string;
  expanded?: boolean;
  onToggle?: () => void;
  /** When set, the card is a link instead of an expand-toggle (no chevron). */
  href?: string;
  borderColour?: string;
  children?: React.ReactNode;
}) {
  const interactive = count > 0 && (href !== undefined || onToggle !== undefined);
  const cardClassName = `transition-colors ${interactive ? "cursor-pointer hover:bg-muted/50" : ""} ${count > 0 && borderColour ? borderColour : ""}`;

  const cardBody = (
    <>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <div className="flex items-center gap-2">
          {icon}
          <CardTitle className="text-sm font-medium">{title}</CardTitle>
        </div>
        {count > 0 && href === undefined && onToggle !== undefined && (
          <div className="text-muted-foreground">
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </div>
        )}
      </CardHeader>
      <CardContent>
        {loading && <p className="text-sm text-muted-foreground">Loading...</p>}
        {error && <p className="text-sm text-destructive">{error}</p>}
        {!loading && !error && count === 0 && (
          <p className="text-sm text-muted-foreground">{emptyText}</p>
        )}
        {!loading && !error && count > 0 && (
          <div className="flex items-center gap-1.5">
            <span className="text-2xl font-bold">{count}</span>
            {subtitle}
          </div>
        )}
      </CardContent>
    </>
  );

  return (
    <>
      {href !== undefined ? (
        <Link href={count > 0 ? href : "#"} className="block">
          <Card className={cardClassName}>{cardBody}</Card>
        </Link>
      ) : (
        <Card
          className={cardClassName}
          onClick={() => interactive && onToggle?.()}
        >
          {cardBody}
        </Card>
      )}
      {children}
    </>
  );
}

// ---------------------------------------------------------------------------
// Main dashboard component
// ---------------------------------------------------------------------------

export function AdminDashboardClient() {
  // Sick bookings needing attention
  const [sickBookings, setSickBookings] = useState<IncompleteSickBooking[]>([]);
  const [sickLoading, setSickLoading] = useState(true);
  const [sickError, setSickError] = useState<string | null>(null);
  const [sickExpanded, setSickExpanded] = useState(false);

  // Today's absences, holidays, birthdays
  const [absentToday, setAbsentToday] = useState<AbsentMember[]>([]);
  const [onHolidayToday, setOnHolidayToday] = useState<AbsentMember[]>([]);
  const [birthdaysToday, setBirthdaysToday] = useState<BirthdayMember[]>([]);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [absentExpanded, setAbsentExpanded] = useState(false);
  const [holidayExpanded, setHolidayExpanded] = useState(false);
  const [birthdayExpanded, setBirthdayExpanded] = useState(false);

  // Employees missing a Holiday Period (CLE-171)
  const [missingHolidayPeriod, setMissingHolidayPeriod] = useState<EmployeeMissingHolidayPeriod[]>([]);
  const [missingHolidayLoading, setMissingHolidayLoading] = useState(true);
  const [missingHolidayError, setMissingHolidayError] = useState<string | null>(null);
  const [missingHolidayExpanded, setMissingHolidayExpanded] = useState(false);

  // Pending approvals — split into two cards mirroring the Absent
  // Today / On Holiday Today dichotomy. Holiday Approvals = Annual
  // Leave bookings only; Absence Approvals = everything else
  // (Compassionate, etc.). Both cards link to the same /approvals page.
  const [holidayApprovalsCount, setHolidayApprovalsCount] = useState(0);
  const [absenceApprovalsCount, setAbsenceApprovalsCount] = useState(0);
  const [approvalsLoading, setApprovalsLoading] = useState(true);
  const [approvalsError, setApprovalsError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    // Fetch sick bookings
    (async () => {
      const res = await getIncompleteSickBookings();
      if (cancelled) return;
      if (!res.success) {
        setSickError(res.error ?? "Could not load sick bookings");
      } else {
        setSickBookings(res.bookings);
      }
      setSickLoading(false);
    })();

    // Fetch today summary
    (async () => {
      const res = await getDashboardSummary();
      if (cancelled) return;
      if (!res.success) {
        setSummaryError(res.error ?? "Could not load summary");
      } else if (res.data) {
        setAbsentToday(res.data.absentToday);
        setOnHolidayToday(res.data.onHolidayToday);
        setBirthdaysToday(res.data.birthdaysToday);
      }
      setSummaryLoading(false);
    })();

    // Fetch employees with no Holiday Period (CLE-171)
    (async () => {
      const res = await getEmployeesWithoutHolidayPeriod();
      if (cancelled) return;
      if (!res.success) {
        setMissingHolidayError(res.error ?? "Could not load Holiday Period status");
      } else {
        setMissingHolidayPeriod(res.employees);
      }
      setMissingHolidayLoading(false);
    })();

    // Pending approvals counts — fetched as a single call that returns
    // both Holiday and Absence buckets.
    (async () => {
      const res = await getPendingApprovalsCount();
      if (cancelled) return;
      if (!res.success) {
        setApprovalsError(res.error ?? "Could not load approvals");
      } else {
        setHolidayApprovalsCount(res.holidayCount);
        setAbsenceApprovalsCount(res.absenceCount);
      }
      setApprovalsLoading(false);
    })();

    return () => { cancelled = true; };
  }, []);

  const sickOpenCount = sickBookings.filter((b) => b.completion_status === "open").length;
  const sickAttentionCount = sickBookings.filter((b) => b.completion_status !== "open").length;

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <h1 className="text-2xl font-bold">Dashboard</h1>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">

        {/* ---- Sick Bookings Needing Attention ---- */}
        <SummaryCard
          icon={<Stethoscope className="h-4 w-4 text-amber-500" />}
          title="Sick Bookings"
          count={sickBookings.length}
          loading={sickLoading}
          error={sickError}
          emptyText="All up to date"
          expanded={sickExpanded}
          onToggle={() => setSickExpanded((e) => !e)}
          borderColour="border-amber-300"
          subtitle={
            <span className="text-sm text-muted-foreground">
              {sickOpenCount > 0 && <>{sickOpenCount} Open</>}
              {sickOpenCount > 0 && sickAttentionCount > 0 && " · "}
              {sickAttentionCount > 0 && <>{sickAttentionCount} Needing Attention</>}
            </span>
          }
        />

        {/* ---- Absent Today (non-holiday) ---- */}
        <SummaryCard
          icon={<UserX className="h-4 w-4 text-red-500" />}
          title="Absent Today"
          count={absentToday.length}
          loading={summaryLoading}
          error={summaryError}
          emptyText="Nobody absent"
          expanded={absentExpanded}
          onToggle={() => setAbsentExpanded((e) => !e)}
          borderColour="border-red-300"
        />

        {/* ---- On Holiday Today ---- */}
        <SummaryCard
          icon={<Palmtree className="h-4 w-4 text-green-500" />}
          title="On Holiday Today"
          count={onHolidayToday.length}
          loading={summaryLoading}
          error={null}
          emptyText="Nobody on holiday"
          expanded={holidayExpanded}
          onToggle={() => setHolidayExpanded((e) => !e)}
          borderColour="border-green-300"
        />

        {/* ---- Birthdays Today ---- */}
        {(birthdaysToday.length > 0 || (!summaryLoading && birthdaysToday.length === 0)) && birthdaysToday.length > 0 && (
          <SummaryCard
            icon={<Cake className="h-4 w-4 text-pink-500" />}
            title="Birthdays Today"
            count={birthdaysToday.length}
            loading={summaryLoading}
            error={null}
            emptyText=""
            expanded={birthdayExpanded}
            onToggle={() => setBirthdayExpanded((e) => !e)}
            borderColour="border-pink-300"
          />
        )}

        {/* ---- Holiday Approvals — Annual Leave bookings only ---- */}
        <SummaryCard
          icon={<ClipboardCheck className="h-4 w-4 text-green-500" />}
          title="Holiday Approvals"
          count={holidayApprovalsCount}
          loading={approvalsLoading}
          error={approvalsError}
          emptyText="Nothing waiting"
          href="/approvals"
          borderColour="border-green-300"
          subtitle={
            holidayApprovalsCount > 0 ? (
              <span className="text-sm text-muted-foreground">
                {holidayApprovalsCount === 1 ? "request" : "requests"} awaiting your decision
              </span>
            ) : undefined
          }
        />

        {/* ---- Absence Approvals — every other absence type ---- */}
        <SummaryCard
          icon={<ClipboardCheck className="h-4 w-4 text-blue-500" />}
          title="Absence Approvals"
          count={absenceApprovalsCount}
          loading={approvalsLoading}
          error={approvalsError}
          emptyText="Nothing waiting"
          href="/approvals"
          borderColour="border-blue-300"
          subtitle={
            absenceApprovalsCount > 0 ? (
              <span className="text-sm text-muted-foreground">
                {absenceApprovalsCount === 1 ? "request" : "requests"} awaiting your decision
              </span>
            ) : undefined
          }
        />

        {/* ---- Employees missing a Holiday Period (CLE-171) ---- */}
        <SummaryCard
          icon={<CalendarPlus className="h-4 w-4 text-amber-500" />}
          title="Holiday Periods needed"
          count={missingHolidayPeriod.length}
          loading={missingHolidayLoading}
          error={missingHolidayError}
          emptyText="All set up"
          expanded={missingHolidayExpanded}
          onToggle={() => setMissingHolidayExpanded((e) => !e)}
          borderColour="border-amber-300"
          subtitle={
            missingHolidayPeriod.length > 0 ? (
              <span className="text-sm text-muted-foreground">
                {missingHolidayPeriod.length === 1 ? "employee" : "employees"} need their first period
              </span>
            ) : undefined
          }
        />
      </div>

      {/* ---- Expanded: Sick bookings list ---- */}
      {sickExpanded && sickBookings.length > 0 && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              <CardTitle className="text-sm font-medium">
                Sick Bookings Needing Attention
                <span className="ml-1.5 text-muted-foreground">({sickBookings.length})</span>
              </CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {sickBookings.map((b) => (
                <Link
                  key={b.booking_id}
                  href={`/members/${b.member_id}/calendar?bookingId=${b.booking_id}`}
                  className="flex items-center justify-between rounded-md border px-3 py-2 text-sm hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span
                      aria-hidden
                      className="inline-block h-2.5 w-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: b.reason_colour }}
                    />
                    <div className="min-w-0">
                      <p className="font-medium truncate">{b.member_name} — {b.reason_name}</p>
                      <p className="text-xs text-muted-foreground">
                        {fmtDate(b.start_date)}
                        {b.end_date ? ` – ${fmtDate(b.end_date)}` : " – Open"}
                      </p>
                    </div>
                  </div>
                  <CompletionStatusBadge status={b.completion_status} />
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ---- Expanded: Absent today list ---- */}
      {absentExpanded && absentToday.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <UserX className="h-4 w-4 text-red-500" />
              <CardTitle className="text-sm font-medium">
                Absent Today
                <span className="ml-1.5 text-muted-foreground">({absentToday.length})</span>
              </CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {absentToday.map((m) => (
                <Link
                  key={m.memberId}
                  href={`/members/${m.memberId}/calendar`}
                  className="flex items-center justify-between rounded-md border px-3 py-2 text-sm hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span
                      aria-hidden
                      className="inline-block h-2.5 w-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: m.reasonColour }}
                    />
                    <p className="font-medium truncate">{m.memberName}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-xs text-muted-foreground">{m.reasonName}</span>
                    {m.isHalfDay && (
                      <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                        {m.halfDayPeriod === "am" ? "AM" : "PM"} only
                      </span>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ---- Expanded: On holiday today list ---- */}
      {holidayExpanded && onHolidayToday.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <Palmtree className="h-4 w-4 text-green-500" />
              <CardTitle className="text-sm font-medium">
                On Holiday Today
                <span className="ml-1.5 text-muted-foreground">({onHolidayToday.length})</span>
              </CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {onHolidayToday.map((m) => (
                <Link
                  key={m.memberId}
                  href={`/members/${m.memberId}/calendar`}
                  className="flex items-center justify-between rounded-md border px-3 py-2 text-sm hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span
                      aria-hidden
                      className="inline-block h-2.5 w-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: m.reasonColour }}
                    />
                    <p className="font-medium truncate">{m.memberName}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-xs text-muted-foreground">{m.reasonName}</span>
                    {m.isHalfDay && (
                      <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                        {m.halfDayPeriod === "am" ? "AM" : "PM"} only
                      </span>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ---- Expanded: Employees missing a Holiday Period ---- */}
      {missingHolidayExpanded && missingHolidayPeriod.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <CalendarPlus className="h-4 w-4 text-amber-500" />
              <CardTitle className="text-sm font-medium">
                Holiday Periods needed
                <span className="ml-1.5 text-muted-foreground">({missingHolidayPeriod.length})</span>
              </CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {missingHolidayPeriod.map((m) => (
                <Link
                  key={m.memberId}
                  href={`/members/${m.memberId}/holiday`}
                  className="flex items-center justify-between rounded-md border px-3 py-2 text-sm hover:bg-muted/50 transition-colors"
                >
                  <p className="font-medium truncate">{m.memberName}</p>
                  <span className="text-xs text-muted-foreground shrink-0">
                    {m.startDate ? `Started ${fmtDate(m.startDate)}` : "No Start Date set"}
                  </span>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ---- Expanded: Birthdays today list ---- */}
      {birthdayExpanded && birthdaysToday.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <Cake className="h-4 w-4 text-pink-500" />
              <CardTitle className="text-sm font-medium">
                Birthdays Today
                <span className="ml-1.5 text-muted-foreground">({birthdaysToday.length})</span>
              </CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {birthdaysToday.map((m) => (
                <Link
                  key={m.memberId}
                  href={`/members/${m.memberId}/calendar`}
                  className="flex items-center rounded-md border px-3 py-2 text-sm hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <Cake className="h-3.5 w-3.5 text-pink-400 shrink-0" />
                    <p className="font-medium truncate">{m.memberName}</p>
                  </div>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
