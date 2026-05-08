export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { type CalendarBooking, type CalendarBankHoliday } from "@/components/holiday-calendar";
import {
  patternForDate,
  type WorkPatternHours,
  type WorkPatternAssignment,
} from "@/lib/day-counting";
import {
  getMemberWorkPatternHistory,
  getBankHolidaysForOrg,
} from "@/lib/work-pattern-data";
import {
  bookingWorkingDaysInPeriod,
  computeAllHolidayPeriodValues,
  type ComputeBookingInput,
  type ComputeContext,
} from "@/app/(dashboard)/holiday-period-compute";
import { getHolidayPeriodsForMember } from "@/app/(dashboard)/holiday-period-actions";
import { getMemberWorkedHoursInRange } from "@/lib/timesheet-totals";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { AdminCalendarClient, type AbsenceReasonOption, type AbsenceTypeOption } from "./admin-calendar-client";
import { PlannerDashboard, type HolidayStats, type SickPlotStats, type SickStats } from "./planner-dashboard";

export default async function EmployeeCalendarPage({
  params,
  searchParams,
}: {
  params: Promise<{ memberId: string }>;
  searchParams: Promise<{ bookingId?: string; periodId?: string }>;
}) {
  const { memberId } = await params;
  const { bookingId: initialBookingId, periodId: requestedPeriodId } = await searchParams;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: caller } = await supabase
    .from("members")
    .select("id, role, organisation_id")
    .eq("user_id", user.id)
    .limit(1)
    .single();

  if (!caller || caller.role === "employee") redirect("/dashboard");

  const { data: member } = await supabase
    .from("members")
    .select("id, first_name, last_name, start_date")
    .eq("id", memberId)
    .eq("organisation_id", caller.organisation_id)
    .single();

  if (!member) redirect("/employees");

  const fullName = [member.first_name, member.last_name].filter(Boolean).join(" ");
  const today = new Date().toISOString().slice(0, 10);

  // CLE-174 — fetch every Holiday Period for the member so the planner can
  // step prev/next/Current. Pick the selected period from ?periodId,
  // falling back to the period covering today, then to the earliest period.
  const periodsResult = await getHolidayPeriodsForMember(memberId);
  const allPeriods = periodsResult.success ? periodsResult.periods : [];
  const periodsAsc = [...allPeriods].sort((a, b) =>
    a.startDate.localeCompare(b.startDate),
  );

  if (periodsAsc.length === 0) {
    return (
      <div className="w-full px-4 py-8 sm:px-6 lg:px-8">
        <Link href="/employees" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4">
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to directory
        </Link>
        <p className="text-muted-foreground">No Holiday Periods set up for this employee yet.</p>
      </div>
    );
  }

  const periodCoveringToday = periodsAsc.find(
    (p) => p.startDate <= today && p.endDate >= today,
  );
  const requestedPeriod = requestedPeriodId
    ? periodsAsc.find((p) => p.id === requestedPeriodId)
    : undefined;
  const selectedPeriod = requestedPeriod ?? periodCoveringToday ?? periodsAsc[0];

  const yearRec = {
    year_start: selectedPeriod.startDate,
    year_end: selectedPeriod.endDate,
    base_amount: Number(selectedPeriod.allowance ?? 0),
    pro_rata_amount: null,
    adjustment: Number(selectedPeriod.adjust ?? 0),
    carried_over: 0,
  };

  // Calendar range: month containing the period's startDate through month
  // containing its endDate (inclusive). Short periods → short calendar.
  const startDateObj = new Date(selectedPeriod.startDate + "T00:00:00Z");
  const endDateObj = new Date(selectedPeriod.endDate + "T00:00:00Z");
  const rangeStart = `${startDateObj.getUTCFullYear()}-${String(startDateObj.getUTCMonth() + 1).padStart(2, "0")}-01`;
  const lastMonthEnd = new Date(Date.UTC(endDateObj.getUTCFullYear(), endDateObj.getUTCMonth() + 1, 0));
  const rangeEndStr = lastMonthEnd.toISOString().slice(0, 10);
  const monthCount =
    (endDateObj.getUTCFullYear() - startDateObj.getUTCFullYear()) * 12
    + (endDateObj.getUTCMonth() - startDateObj.getUTCMonth())
    + 1;

  // Fetch bookings in range. Open-ended bookings (end_date = null) are
  // included when they start within or before the range — they'll be
  // projected forward to today on the calendar.
  const { data: bookingsData } = await supabase
    .from("holiday_bookings")
    .select("id, start_date, end_date, start_half, end_half, status, days_deducted, leave_reason_id, absence_reasons(name, colour, absence_type_id, absence_types(colour, requires_approval)), sick_booking_details(completion_status)")
    .eq("member_id", memberId)
    .lte("start_date", rangeEndStr)
    .or(`end_date.gte.${rangeStart},end_date.is.null`)
    .in("status", ["pending", "approved"]);

  // Reasons whose absence_type deducts from holiday entitlement — these are
  // the only bookings that should count toward the Holidays card stats.
  const { data: deductingReasons } = await supabase
    .from("absence_reasons")
    .select("id, absence_types!inner(deducts_from_entitlement)")
    .eq("organisation_id", caller.organisation_id)
    .eq("absence_types.deducts_from_entitlement", true);
  const deductingReasonIds = new Set<string>((deductingReasons ?? []).map((r) => r.id as string));

  // Pick the primary "holiday" absence type's colour for the donut — the
  // default one if flagged, else the first alphabetically. Falls back to
  // indigo if no deducting type exists.
  const { data: primaryHolidayType } = await supabase
    .from("absence_types")
    .select("colour")
    .eq("organisation_id", caller.organisation_id)
    .eq("deducts_from_entitlement", true)
    .order("is_default", { ascending: false })
    .order("name")
    .limit(1)
    .maybeSingle();
  const holidayBaseColour = primaryHolidayType?.colour ?? "#6366f1";

  // All absence types in the org — used to populate the filter panel.
  const { data: absenceTypeRows } = await supabase
    .from("absence_types")
    .select("id, name, colour")
    .eq("organisation_id", caller.organisation_id)
    .order("name");
  const absenceTypes: AbsenceTypeOption[] = (absenceTypeRows ?? []).map((t) => ({
    id: t.id as string,
    name: t.name as string,
    colour: (t.colour as string | null) ?? "#6366f1",
  }));

  const bookings: CalendarBooking[] = (bookingsData ?? []).map((b) => {
    const reason = b.absence_reasons as unknown as
      | {
          name: string;
          colour: string;
          absence_type_id: string | null;
          absence_types: { colour: string; requires_approval: boolean } | null;
        }
      | null;
    // Prefer the absence type's colour; fall back to the reason's own colour,
    // then to the default indigo if neither is set.
    const colour = reason?.absence_types?.colour ?? reason?.colour ?? "#6366f1";
    const sickDetails = (b as Record<string, unknown>).sick_booking_details as { completion_status: string } | null;
    return {
      id: b.id,
      start_date: b.start_date,
      end_date: b.end_date,
      status: b.status,
      days_deducted: b.days_deducted,
      reason_name: reason?.name ?? "—",
      reason_colour: colour,
      requires_approval: reason?.absence_types?.requires_approval ?? false,
      absence_type_id: reason?.absence_type_id ?? null,
      completion_status: sickDetails?.completion_status ?? null,
    };
  });

  // Note: holidayStats is built later — needs the work pattern history and
  // bank-holiday set so each booking's in-period working days are counted
  // correctly (CLE-173 follow-up).

  // Fetch org bank holiday colour, handling, default work profile, and the
  // self-cert template path (used by the sick details panel).
  const { data: orgRow } = await supabase
    .from("organisations")
    .select("bank_holiday_colour, bank_holiday_handling, default_work_profile_id, self_cert_template_path")
    .eq("id", caller.organisation_id)
    .single();
  const bankHolidayColour = (orgRow as { bank_holiday_colour?: string } | null)?.bank_holiday_colour ?? "#EF4444";
  const bankHolidayHandling = (orgRow as { bank_holiday_handling?: string } | null)?.bank_holiday_handling ?? "additional";
  const orgDefaultWorkProfileId = (orgRow as { default_work_profile_id?: string | null } | null)?.default_work_profile_id ?? null;
  const hasSelfCertTemplate = !!(orgRow as { self_cert_template_path?: string | null } | null)?.self_cert_template_path;

  // Resolve the target member's full Work Profile history so per-date
  // patterns can be applied (CLE-173 follow-up). The calendar grid, the
  // live booking-day-count preview, and the sick stats below all walk
  // dates that may span Work Profile boundaries.
  const workPatternHistory: WorkPatternAssignment[] = await getMemberWorkPatternHistory(
    supabase,
    memberId,
    caller.organisation_id,
  );
  // Pre-resolved as-of-today snapshot for code paths that still want a
  // single pattern (e.g. the live booking-day-count, which walks one
  // contiguous range starting from the selected start date).
  const workPattern: WorkPatternHours | null = patternForDate(workPatternHistory, today);
  void orgDefaultWorkProfileId; // org default folded into history above

  // -------------------------------------------------------------------------
  // Holidays Dashboard widget stats — uses the same compute helper that
  // drives the Holiday Periods table so allowance is correct for both Fixed
  // (period.allowance ?? 0) and Earned (worked × factor%) periods. The
  // taken/booked/pending split below is calculated separately because the
  // compute helper combines pending with approved (the widget shows them
  // distinctly).
  // -------------------------------------------------------------------------
  const widgetBankHolidays = await getBankHolidaysForOrg(
    supabase,
    caller.organisation_id,
    // Span all periods so the compute chain has accurate bank-holiday data
    // for any period the chain walks.
    periodsAsc[0].startDate,
    periodsAsc[periodsAsc.length - 1].endDate,
  );

  // Worked hours per Earned period — needed for the compute helper to
  // produce a non-zero allowance for Earned-type periods (CLE-175).
  const widgetEarnedPeriods = periodsAsc.filter((p) => p.type === "earned");
  const widgetWorkedHoursByPeriodId = new Map<string, number>();
  if (widgetEarnedPeriods.length > 0) {
    const totals = await Promise.all(
      widgetEarnedPeriods.map((p) =>
        getMemberWorkedHoursInRange(
          supabase,
          memberId,
          caller.organisation_id,
          p.startDate,
          p.endDate,
        ),
      ),
    );
    widgetEarnedPeriods.forEach((p, i) => {
      widgetWorkedHoursByPeriodId.set(p.id, totals[i]);
    });
  }

  const widgetCtx: ComputeContext = {
    workPatternHistory,
    bankHolidays: widgetBankHolidays,
    bankHolidayHandling,
    workedHoursByPeriodId: widgetWorkedHoursByPeriodId,
  };

  // Bookings in ComputeBookingInput shape, filtered to absence types that
  // deduct from holiday entitlement only (sick, compassionate etc. are
  // excluded from the donut by design).
  const widgetBookings: ComputeBookingInput[] = (bookingsData ?? [])
    .filter((b) => deductingReasonIds.has(b.leave_reason_id as string))
    .map((b) => ({
      startDate: b.start_date as string,
      endDate: (b.end_date as string | null) ?? null,
      startHalf: ((b as Record<string, unknown>).start_half as string | null) ?? null,
      endHalf: ((b as Record<string, unknown>).end_half as string | null) ?? null,
      status: b.status as string,
    }));

  const widgetComputed = computeAllHolidayPeriodValues(
    periodsAsc,
    widgetBookings,
    widgetCtx,
    today,
  );
  const selectedComputed = widgetComputed.get(selectedPeriod.id);

  // Total available for this period: brought forward + allowance + adjust + toil.
  // (Equivalent to balance + taken + booked, but written as the inputs so it
  // reads naturally.)
  const widgetEffectiveEntitlement = selectedComputed
    ? selectedComputed.broughtForward
      + selectedComputed.allowance
      + selectedPeriod.adjust
      + selectedComputed.toil
    : 0;

  // Pending vs approved split for the donut — done per booking because the
  // compute helper combines pending+approved into taken/booked.
  let widgetTaken = 0;
  let widgetBooked = 0;
  let widgetPending = 0;
  for (const b of bookingsData ?? []) {
    if (!deductingReasonIds.has(b.leave_reason_id as string)) continue;
    const startDate = b.start_date as string;
    const endDate = (b.end_date as string | null) ?? null;
    if (!endDate) continue;
    if (endDate < selectedPeriod.startDate) continue;
    if (startDate > selectedPeriod.endDate) continue;
    const ci: ComputeBookingInput = {
      startDate,
      endDate,
      startHalf: ((b as Record<string, unknown>).start_half as string | null) ?? null,
      endHalf: ((b as Record<string, unknown>).end_half as string | null) ?? null,
      status: b.status as string,
    };
    const amount = bookingWorkingDaysInPeriod(
      ci,
      selectedPeriod.startDate,
      selectedPeriod.endDate,
      selectedPeriod.units,
      widgetCtx,
    );
    if (b.status === "pending") {
      widgetPending += amount;
    } else if (b.status === "approved" && endDate < today) {
      widgetTaken += amount;
    } else {
      widgetBooked += amount;
    }
  }
  const holidayStats: HolidayStats = {
    allowance: widgetEffectiveEntitlement,
    taken: widgetTaken,
    booked: widgetBooked,
    pending: widgetPending,
  };

  // -------------------------------------------------------------------------
  // Sick plot — sick days by day of week over the trailing 365 days.
  // Heuristic for "sickness": absence types that don't require approval.
  // -------------------------------------------------------------------------
  const sickWindowStart = new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10);

  // Reasons whose absence type doesn't require approval — treated as sickness-ish.
  const { data: sickReasonRows } = await supabase
    .from("absence_reasons")
    .select("id, absence_types!inner(requires_approval)")
    .eq("organisation_id", caller.organisation_id)
    .eq("absence_types.requires_approval", false);
  const sickReasonIds = (sickReasonRows ?? []).map((r) => r.id as string);

  // Pick the colour for the bars: a type containing "sick" if one exists,
  // else the first non-approval type's colour, else default red.
  const { data: sickType } = await supabase
    .from("absence_types")
    .select("colour")
    .eq("organisation_id", caller.organisation_id)
    .eq("requires_approval", false)
    .ilike("name", "%sick%")
    .limit(1)
    .maybeSingle();
  const sickColour = sickType?.colour ?? "#ef4444";

  const PATTERN_KEYS: (keyof WorkPatternHours)[] = [
    "hours_monday", "hours_tuesday", "hours_wednesday", "hours_thursday",
    "hours_friday", "hours_saturday", "hours_sunday",
  ];
  const sickByDow = [0, 0, 0, 0, 0, 0, 0]; // Mon..Sun
  let sickSpells = 0; // number of separate sick bookings — the "S" in Bradford
  if (sickReasonIds.length > 0) {
    // Include open-ended bookings (end_date is null) — they're still running.
    const { data: sickBookings } = await supabase
      .from("holiday_bookings")
      .select("start_date, end_date, start_half, end_half")
      .eq("member_id", memberId)
      .or(`end_date.gte.${sickWindowStart},end_date.is.null`)
      .lte("start_date", today)
      .in("status", ["pending", "approved"])
      .in("leave_reason_id", sickReasonIds);

    sickSpells = (sickBookings ?? []).length;

    const winStartMs = new Date(sickWindowStart + "T00:00:00Z").getTime();
    const winEndMs = new Date(today + "T00:00:00Z").getTime();
    for (const b of sickBookings ?? []) {
      const startMs = new Date((b.start_date as string) + "T00:00:00Z").getTime();
      // Open-ended bookings extend to today for counting purposes
      const endMs = b.end_date
        ? new Date((b.end_date as string) + "T00:00:00Z").getTime()
        : winEndMs;
      const startHalf = !!b.start_half;
      const endHalf = b.end_date ? !!b.end_half : false; // no end-half on open bookings
      const cursor = new Date(Math.max(startMs, winStartMs));
      const stop = Math.min(endMs, winEndMs);
      while (cursor.getTime() <= stop) {
        // 0=Mon .. 6=Sun
        const js = cursor.getUTCDay();
        const dow = js === 0 ? 6 : js - 1;
        // Resolve the work pattern that applied on THIS specific date,
        // not as-of-today — Work Profiles can change over the trailing
        // 365-day window.
        const dayIso = cursor.toISOString().slice(0, 10);
        const dayPattern = patternForDate(workPatternHistory, dayIso);
        const hours = dayPattern
          ? Number(dayPattern[PATTERN_KEYS[dow]])
          : (dow < 5 ? 8 : 0); // Mon–Fri 8h fallback
        if (hours > 0) {
          let value = 1;
          if (cursor.getTime() === startMs && startHalf) value = 0.5;
          if (cursor.getTime() === endMs && endHalf) value = 0.5;
          sickByDow[dow] += value;
        }
        cursor.setUTCDate(cursor.getUTCDate() + 1);
      }
    }
  }
  const sickPlot: SickPlotStats = { byDow: sickByDow, colour: sickColour };
  const sickDaysTotal = sickByDow.reduce((a, b) => a + b, 0);
  // Bradford Factor: B = S² × D where S = number of sickness spells,
  // D = total sick days (both over the trailing 365-day window).
  const bradfordFactor = Math.round(sickSpells * sickSpells * sickDaysTotal);

  // Admins + owners for the sick details "Back to Work interviewer" dropdown
  const { data: adminRows } = await supabase
    .from("members")
    .select("id, first_name, last_name")
    .eq("organisation_id", caller.organisation_id)
    .in("role", ["admin", "owner"])
    .order("first_name");
  const orgAdmins = (adminRows ?? []).map((r) => ({
    id: r.id as string,
    firstName: (r.first_name as string) ?? "",
    lastName: (r.last_name as string) ?? "",
  }));

  // Fetch bank holidays in range
  const { data: bhData } = await supabase
    .from("bank_holidays")
    .select("date, name, is_excluded, organisation_id")
    .gte("date", rangeStart)
    .lte("date", rangeEndStr)
    .or(`organisation_id.is.null,organisation_id.eq.${caller.organisation_id}`);

  const excluded = new Set<string>();
  const bhList: CalendarBankHoliday[] = [];
  for (const bh of bhData ?? []) {
    if (bh.organisation_id && bh.is_excluded) {
      excluded.add(bh.date);
    } else if (!excluded.has(bh.date)) {
      bhList.push({ date: bh.date, name: bh.name });
    }
  }

  // Active (non-deprecated) absence reasons for this org — used in the
  // admin booking sheet's reason dropdown.
  const { data: reasonRows } = await supabase
    .from("absence_reasons")
    .select("id, name, colour, is_deprecated, absence_type_id, absence_types(name, colour)")
    .eq("organisation_id", caller.organisation_id)
    .eq("is_deprecated", false)
    .order("name");
  const absenceReasons: AbsenceReasonOption[] = (reasonRows ?? []).map((r) => {
    const aType = r.absence_types as unknown as { name: string; colour: string } | null;
    return {
      id: r.id,
      name: r.name,
      colour: aType?.colour ?? r.colour,
      absence_type_id: r.absence_type_id,
      absence_type_name: aType?.name ?? "Other",
    };
  });

  // Sick donut: count working days in the same trailing 365-day window using
  // the resolved work pattern (Mon–Fri default if none). Combined with the
  // sickDaysTotal accumulated above this gives the % sick rate.
  let workingDaysInWindow = 0;
  {
    const cursor = new Date(sickWindowStart + "T00:00:00Z");
    const stopMs = new Date(today + "T00:00:00Z").getTime();
    while (cursor.getTime() <= stopMs) {
      const js = cursor.getUTCDay();
      const dow = js === 0 ? 6 : js - 1; // 0=Mon..6=Sun
      const dayIso = cursor.toISOString().slice(0, 10);
      const dayPattern = patternForDate(workPatternHistory, dayIso);
      const hours = dayPattern
        ? Number(dayPattern[PATTERN_KEYS[dow]])
        : (dow < 5 ? 8 : 0); // Mon–Fri 8h fallback
      if (hours > 0) workingDaysInWindow++;
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
  }
  const sick: SickStats = {
    sickDays: sickDaysTotal,
    workingDays: workingDaysInWindow,
    colour: sickColour,
  };

  return (
    <div className="w-full px-4 py-8 sm:px-6 lg:px-8">
      <Link href="/employees" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4">
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to directory
      </Link>
      <PlannerDashboard
        holidayStats={holidayStats}
        holidayBaseColour={holidayBaseColour}
        holidayPeriodStart={yearRec.year_start}
        holidayPeriodEnd={yearRec.year_end}
        holidayUnits={selectedPeriod.units}
        sick={sick}
        sickPlot={sickPlot}
        bradfordFactor={bradfordFactor}
      />
      <AdminCalendarClient
        memberId={memberId}
        memberName={fullName}
        userId={user.id}
        callerMemberId={caller.id}
        orgAdmins={orgAdmins}
        hasSelfCertTemplate={hasSelfCertTemplate}
        yearStart={rangeStart}
        monthCount={monthCount}
        periods={periodsAsc.map((p) => ({
          id: p.id,
          name: p.name,
          startDate: p.startDate,
          endDate: p.endDate,
          units: p.units,
        }))}
        selectedPeriodId={selectedPeriod.id}
        currentPeriodId={periodCoveringToday?.id ?? null}
        bookings={bookings}
        bankHolidays={bhList}
        bankHolidayColour={bankHolidayColour}
        absenceReasons={absenceReasons}
        absenceTypes={absenceTypes}
        workPattern={workPattern}
        workPatternHistory={workPatternHistory}
        bankHolidayHandling={bankHolidayHandling}
        initialBookingId={initialBookingId ?? null}
      />
    </div>
  );
}
