// CLE-176/CLE-177 — My Holiday page (server). The Overview balance and the
// Calendar tab widget both derive from `computeAllHolidayPeriodValues`, so
// they always agree and pick up Holiday Period edits without staleness.

export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
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
  computeAllHolidayPeriodValues,
  type ComputeBookingInput,
  type ComputeContext,
  type ComputedPeriodValues,
} from "@/app/(dashboard)/holiday-period-compute";
import {
  getHolidayPeriodsForMember,
  type HolidayPeriod,
} from "@/app/(dashboard)/holiday-period-actions";
import { getMemberWorkedHoursInRange } from "@/lib/timesheet-totals";
import type { CalendarBooking, CalendarBankHoliday } from "@/components/holiday-calendar";
import type { AbsenceTypeOption } from "@/components/calendar/calendar-filter-panel";
import { MyHolidayClient } from "./my-holiday-client";
import type {
  HolidayBookingRow,
  BalanceSummary,
  AbsenceReasonOption,
} from "../holiday-booking-actions";
import type { HolidayStats, SickPlotStats, SickStats } from "../members/[memberId]/calendar/planner-dashboard";
import type { PeriodNavOption } from "../members/[memberId]/calendar/admin-calendar-client";

/**
 * Compose a balance summary for a single Holiday Period directly from the
 * compute helper's output. The helper already splits taken / booked /
 * pending per CLE-177, so this is a pure mapping with a clamped
 * carry-over projection.
 */
function summarisePeriod(
  period: HolidayPeriod,
  computed: ComputedPeriodValues,
): { taken: number; booked: number; pending: number; entitlement: number; remaining: number; carryOverProjected: number } {
  const entitlement = computed.broughtForward + computed.allowance + period.adjust + computed.toil;
  const remaining = computed.balance;
  const carryOverProjected = Math.min(Math.max(remaining, 0), period.maxCarryForward);
  return {
    taken: computed.taken,
    booked: computed.booked,
    pending: computed.pending,
    entitlement,
    remaining,
    carryOverProjected,
  };
}

export default async function MyHolidayPage({
  searchParams,
}: {
  searchParams: Promise<{ periodId?: string }>;
}) {
  const { periodId: requestedPeriodId } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: member } = await supabase
    .from("members")
    .select("id, organisation_id, role, team_id, start_date")
    .eq("user_id", user.id)
    .limit(1)
    .single();

  if (!member) redirect("/login");

  // Org bank holiday handling/colour and country code
  const { data: orgRow } = await supabase
    .from("organisations")
    .select("country_code, bank_holiday_colour, bank_holiday_handling")
    .eq("id", member.organisation_id)
    .single();
  const orgCountryCode = (orgRow as { country_code?: string } | null)?.country_code ?? "england-and-wales";
  const bankHolidayColour = (orgRow as { bank_holiday_colour?: string } | null)?.bank_holiday_colour ?? "#EF4444";
  const bankHolidayHandling = (orgRow as { bank_holiday_handling?: string } | null)?.bank_holiday_handling ?? "additional";

  const today = new Date().toISOString().slice(0, 10);

  // -------------------------------------------------------------------------
  // Holiday Periods + selected period (CLE-174)
  // -------------------------------------------------------------------------
  const periodsResult = await getHolidayPeriodsForMember(member.id);
  const periodsAsc = periodsResult.success
    ? [...periodsResult.periods].sort((a, b) => a.startDate.localeCompare(b.startDate))
    : [];
  const periodCoveringToday = periodsAsc.find(
    (p) => p.startDate <= today && p.endDate >= today,
  );
  const todayPeriodIndex = periodCoveringToday
    ? periodsAsc.findIndex((p) => p.id === periodCoveringToday.id)
    : -1;
  const periodAfterToday = todayPeriodIndex >= 0 && todayPeriodIndex < periodsAsc.length - 1
    ? periodsAsc[todayPeriodIndex + 1]
    : null;
  const requestedPeriod = requestedPeriodId
    ? periodsAsc.find((p) => p.id === requestedPeriodId)
    : undefined;
  const selectedPeriod = requestedPeriod ?? periodCoveringToday ?? periodsAsc[0] ?? null;

  // -------------------------------------------------------------------------
  // Bookings table (for Overview tab) — full row shape with reason names.
  // -------------------------------------------------------------------------
  const { data: bookingsData } = await supabase
    .from("holiday_bookings")
    .select("id, leave_reason_id, start_date, end_date, start_half, end_half, days_deducted, hours_deducted, status, approver1_id, approver_note, employee_note, created_at, absence_reasons(name, colour)")
    .eq("member_id", member.id)
    .order("start_date", { ascending: true });

  const approverIds = [...new Set((bookingsData ?? []).map((b) => b.approver1_id).filter(Boolean))] as string[];
  const approverMap = new Map<string, string>();
  if (approverIds.length > 0) {
    const { data: approvers } = await supabase
      .from("members")
      .select("id, first_name, last_name")
      .in("id", approverIds);
    for (const a of approvers ?? []) {
      approverMap.set(a.id, `${a.first_name} ${a.last_name}`);
    }
  }

  const bookings: HolidayBookingRow[] = (bookingsData ?? []).map((b) => {
    const reason = b.absence_reasons as unknown as { name: string; colour: string } | null;
    return {
      id: b.id,
      leave_reason_id: b.leave_reason_id,
      start_date: b.start_date,
      end_date: b.end_date,
      start_half: b.start_half,
      end_half: b.end_half,
      days_deducted: b.days_deducted,
      hours_deducted: b.hours_deducted,
      status: b.status,
      approver_note: b.approver_note,
      approver_name: b.approver1_id ? approverMap.get(b.approver1_id) ?? null : null,
      employee_note: b.employee_note,
      created_at: b.created_at,
      reason_name: reason?.name ?? "—",
      reason_colour: reason?.colour ?? "#6366f1",
    };
  });

  // Absence reasons for the booking form
  const { data: reasonsData } = await supabase
    .from("absence_reasons")
    .select("id, name, colour, is_deprecated, absence_type_id, absence_types(name, requires_approval)")
    .eq("organisation_id", member.organisation_id)
    .order("name");
  const reasons: AbsenceReasonOption[] = (reasonsData ?? []).map((r) => {
    const aType = r.absence_types as unknown as { name: string; requires_approval: boolean } | null;
    return {
      id: r.id,
      name: r.name,
      colour: r.colour,
      is_deprecated: r.is_deprecated,
      absence_type_id: r.absence_type_id,
      absence_type_name: aType?.name ?? "—",
      requires_approval: aType?.requires_approval ?? false,
    };
  });

  const measurementMode = periodCoveringToday?.units ?? "days";

  // -------------------------------------------------------------------------
  // Compute helper run — drives BOTH Overview balance summaries and the
  // Calendar tab dashboard widget.
  // -------------------------------------------------------------------------
  let balance: BalanceSummary | null = null;
  let nextBalance: BalanceSummary | null = null;
  let calendarYearStart: string | null = null;
  let calendarMonthCount: number = 13;
  let calendarBookings: CalendarBooking[] = [];
  const calendarBankHolidays: CalendarBankHoliday[] = [];
  let workPattern: WorkPatternHours | null = null;
  let workPatternHistory: WorkPatternAssignment[] = [];
  let absenceTypes: AbsenceTypeOption[] = [];
  let holidayStats: HolidayStats | null = null;
  let sickPlot: SickPlotStats | null = null;
  let sick: SickStats | null = null;
  let bradfordFactor: number | undefined = undefined;
  let holidayBaseColour = "#6366f1";

  const periodsForNav: PeriodNavOption[] = periodsAsc.map((p) => ({
    id: p.id,
    name: p.name,
    startDate: p.startDate,
    endDate: p.endDate,
    units: p.units,
  }));
  const selectedPeriodId = selectedPeriod?.id ?? null;
  const currentPeriodId = periodCoveringToday?.id ?? null;
  const selectedUnits: "days" | "hours" = selectedPeriod?.units ?? "days";

  if (periodsAsc.length > 0) {
    // Work Profile history
    workPatternHistory = await getMemberWorkPatternHistory(supabase, member.id, member.organisation_id);
    workPattern = patternForDate(workPatternHistory, today);

    // Bank holidays spanning all periods
    const computeBankHolidays = await getBankHolidaysForOrg(
      supabase,
      member.organisation_id,
      periodsAsc[0].startDate,
      periodsAsc[periodsAsc.length - 1].endDate,
    );

    // Worked hours per Earned period
    const earnedPeriods = periodsAsc.filter((p) => p.type === "earned");
    const workedHoursByPeriodId = new Map<string, number>();
    if (earnedPeriods.length > 0) {
      const totals = await Promise.all(
        earnedPeriods.map((p) =>
          getMemberWorkedHoursInRange(supabase, member.id, member.organisation_id, p.startDate, p.endDate),
        ),
      );
      earnedPeriods.forEach((p, i) => workedHoursByPeriodId.set(p.id, totals[i]));
    }

    // Reasons that deduct from holiday entitlement
    const { data: deductingReasons } = await supabase
      .from("absence_reasons")
      .select("id, absence_types!inner(deducts_from_entitlement)")
      .eq("organisation_id", member.organisation_id)
      .eq("absence_types.deducts_from_entitlement", true);
    const deductingReasonIds = new Set<string>((deductingReasons ?? []).map((r) => r.id as string));

    // All approved/pending bookings (for chain + summaries). Single fetch
    // covers Overview balance, Calendar widget, and the calendar grid.
    const { data: allBookingsRaw } = await supabase
      .from("holiday_bookings")
      .select("id, start_date, end_date, start_half, end_half, status, days_deducted, leave_reason_id, absence_reasons(name, colour, absence_type_id, absence_types(colour, requires_approval, deducts_from_entitlement)), sick_booking_details(completion_status)")
      .eq("member_id", member.id)
      .in("status", ["pending", "approved"]);

    // Bookings shaped for the compute helper, filtered to deducting reasons.
    const deductingBookingsForChain: ComputeBookingInput[] = (allBookingsRaw ?? [])
      .filter((b) => deductingReasonIds.has(b.leave_reason_id as string))
      .map((b) => ({
        startDate: b.start_date as string,
        endDate: (b.end_date as string | null) ?? null,
        startHalf: ((b as Record<string, unknown>).start_half as string | null) ?? null,
        endHalf: ((b as Record<string, unknown>).end_half as string | null) ?? null,
        status: b.status as string,
      }));

    const ctx: ComputeContext = {
      workPatternHistory,
      bankHolidays: computeBankHolidays,
      bankHolidayHandling,
      workedHoursByPeriodId,
    };

    const computedMap = computeAllHolidayPeriodValues(
      periodsAsc,
      deductingBookingsForChain,
      ctx,
      today,
    );

    // ---- Overview balance summaries ---------------------------------------
    if (periodCoveringToday) {
      const c = computedMap.get(periodCoveringToday.id);
      if (c) {
        const s = summarisePeriod(periodCoveringToday, c);
        balance = {
          entitlement: s.entitlement,
          carriedOver: c.broughtForward,
          pending: s.pending,
          booked: s.booked,
          taken: s.taken,
          remaining: s.remaining,
          carryOverProjected: s.carryOverProjected,
          unit: periodCoveringToday.units,
          yearStart: periodCoveringToday.startDate,
          yearEnd: periodCoveringToday.endDate,
        };
      }
    }
    if (periodAfterToday) {
      const c = computedMap.get(periodAfterToday.id);
      if (c) {
        const s = summarisePeriod(periodAfterToday, c);
        nextBalance = {
          entitlement: s.entitlement,
          carriedOver: c.broughtForward,
          pending: s.pending,
          booked: s.booked,
          taken: s.taken,
          remaining: s.remaining,
          carryOverProjected: s.carryOverProjected,
          unit: periodAfterToday.units,
          yearStart: periodAfterToday.startDate,
          yearEnd: periodAfterToday.endDate,
        };
      }
    }

    // ---- Calendar tab data -------------------------------------------------
    if (selectedPeriod) {
      // Range = month containing startDate → month containing endDate
      const startDateObj = new Date(selectedPeriod.startDate + "T00:00:00Z");
      const endDateObj = new Date(selectedPeriod.endDate + "T00:00:00Z");
      const rangeStart = `${startDateObj.getUTCFullYear()}-${String(startDateObj.getUTCMonth() + 1).padStart(2, "0")}-01`;
      const lastMonthEnd = new Date(Date.UTC(endDateObj.getUTCFullYear(), endDateObj.getUTCMonth() + 1, 0));
      const rangeEndStr = lastMonthEnd.toISOString().slice(0, 10);
      calendarYearStart = rangeStart;
      calendarMonthCount =
        (endDateObj.getUTCFullYear() - startDateObj.getUTCFullYear()) * 12
        + (endDateObj.getUTCMonth() - startDateObj.getUTCMonth())
        + 1;

      // Calendar grid bookings — all approved/pending bookings overlapping
      // the visible range. Built from the same allBookingsRaw fetch.
      calendarBookings = (allBookingsRaw ?? [])
        .filter((b) => {
          const sd = b.start_date as string;
          const ed = (b.end_date as string | null) ?? null;
          if (sd > rangeEndStr) return false;
          if (ed !== null && ed < rangeStart) return false;
          return true;
        })
        .map((b) => {
          const reason = b.absence_reasons as unknown as
            | { name: string; colour: string; absence_type_id: string | null; absence_types: { colour: string; requires_approval: boolean } | null }
            | null;
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

      // Bank holidays in calendar window for the grid
      const { data: bhData } = await supabase
        .from("bank_holidays")
        .select("date, name, is_excluded, organisation_id")
        .eq("country_code", orgCountryCode)
        .gte("date", rangeStart)
        .lte("date", rangeEndStr)
        .or(`organisation_id.is.null,organisation_id.eq.${member.organisation_id}`);
      const excluded = new Set<string>();
      for (const bh of bhData ?? []) {
        if (bh.organisation_id && bh.is_excluded) {
          excluded.add(bh.date);
        } else if (!excluded.has(bh.date)) {
          calendarBankHolidays.push({ date: bh.date, name: bh.name });
        }
      }

      // Absence types — for the right-rail filter panel
      const { data: absenceTypeRows } = await supabase
        .from("absence_types")
        .select("id, name, colour")
        .eq("organisation_id", member.organisation_id)
        .order("name");
      absenceTypes = (absenceTypeRows ?? []).map((t) => ({
        id: t.id as string,
        name: t.name as string,
        colour: (t.colour as string | null) ?? "#6366f1",
      }));

      // Primary holiday colour for the donut
      const { data: primaryHolidayType } = await supabase
        .from("absence_types")
        .select("colour")
        .eq("organisation_id", member.organisation_id)
        .eq("deducts_from_entitlement", true)
        .order("is_default", { ascending: false })
        .order("name")
        .limit(1)
        .maybeSingle();
      holidayBaseColour = primaryHolidayType?.colour ?? "#6366f1";

      // Holidays Dashboard widget for the SELECTED period
      const c = computedMap.get(selectedPeriod.id);
      if (c) {
        const s = summarisePeriod(selectedPeriod, c);
        holidayStats = {
          allowance: s.entitlement,
          taken: s.taken,
          booked: s.booked,
          pending: s.pending,
        };
      }

      // ---- Sick stats — trailing 365 days, mirror the admin planner.
      const sickWindowStart = new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10);
      const { data: sickReasonRows } = await supabase
        .from("absence_reasons")
        .select("id, absence_types!inner(requires_approval)")
        .eq("organisation_id", member.organisation_id)
        .eq("absence_types.requires_approval", false);
      const sickReasonIds = (sickReasonRows ?? []).map((r) => r.id as string);

      const { data: sickType } = await supabase
        .from("absence_types")
        .select("colour")
        .eq("organisation_id", member.organisation_id)
        .eq("requires_approval", false)
        .ilike("name", "%sick%")
        .limit(1)
        .maybeSingle();
      const sickColour = sickType?.colour ?? "#ef4444";

      const PATTERN_KEYS: (keyof WorkPatternHours)[] = [
        "hours_monday", "hours_tuesday", "hours_wednesday", "hours_thursday",
        "hours_friday", "hours_saturday", "hours_sunday",
      ];
      const sickByDow = [0, 0, 0, 0, 0, 0, 0];
      let sickSpells = 0;
      if (sickReasonIds.length > 0) {
        const { data: sickBookings } = await supabase
          .from("holiday_bookings")
          .select("start_date, end_date, start_half, end_half")
          .eq("member_id", member.id)
          .or(`end_date.gte.${sickWindowStart},end_date.is.null`)
          .lte("start_date", today)
          .in("status", ["pending", "approved"])
          .in("leave_reason_id", sickReasonIds);
        sickSpells = (sickBookings ?? []).length;

        const winStartMs = new Date(sickWindowStart + "T00:00:00Z").getTime();
        const winEndMs = new Date(today + "T00:00:00Z").getTime();
        for (const b of sickBookings ?? []) {
          const startMs = new Date((b.start_date as string) + "T00:00:00Z").getTime();
          const endMs = b.end_date
            ? new Date((b.end_date as string) + "T00:00:00Z").getTime()
            : winEndMs;
          const startHalf = !!b.start_half;
          const endHalf = b.end_date ? !!b.end_half : false;
          const cursor = new Date(Math.max(startMs, winStartMs));
          const stop = Math.min(endMs, winEndMs);
          while (cursor.getTime() <= stop) {
            const js = cursor.getUTCDay();
            const dow = js === 0 ? 6 : js - 1;
            const dayIso = cursor.toISOString().slice(0, 10);
            const dayPattern = patternForDate(workPatternHistory, dayIso);
            const hours = dayPattern
              ? Number(dayPattern[PATTERN_KEYS[dow]])
              : (dow < 5 ? 8 : 0);
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
      sickPlot = { byDow: sickByDow, colour: sickColour };
      const sickDaysTotal = sickByDow.reduce((a, b) => a + b, 0);
      bradfordFactor = Math.round(sickSpells * sickSpells * sickDaysTotal);

      let workingDaysInWindow = 0;
      {
        const cursor = new Date(sickWindowStart + "T00:00:00Z");
        const stopMs = new Date(today + "T00:00:00Z").getTime();
        while (cursor.getTime() <= stopMs) {
          const js = cursor.getUTCDay();
          const dow = js === 0 ? 6 : js - 1;
          const dayIso = cursor.toISOString().slice(0, 10);
          const dayPattern = patternForDate(workPatternHistory, dayIso);
          const hours = dayPattern
            ? Number(dayPattern[PATTERN_KEYS[dow]])
            : (dow < 5 ? 8 : 0);
          if (hours > 0) workingDaysInWindow++;
          cursor.setUTCDate(cursor.getUTCDate() + 1);
        }
      }
      sick = { sickDays: sickDaysTotal, workingDays: workingDaysInWindow, colour: sickColour };
    }
  }

  return (
    <div className="w-full px-4 py-8 sm:px-6 lg:px-8">
      <MyHolidayClient
        memberId={member.id}
        role={member.role}
        balance={balance}
        nextBalance={nextBalance}
        bookings={bookings}
        reasons={reasons}
        measurementMode={measurementMode}
        calendarYearStart={calendarYearStart}
        calendarMonthCount={calendarMonthCount}
        calendarBookings={calendarBookings}
        calendarBankHolidays={calendarBankHolidays}
        bankHolidayColour={bankHolidayColour}
        workPattern={workPattern}
        workPatternHistory={workPatternHistory}
        absenceTypes={absenceTypes}
        periods={periodsForNav}
        selectedPeriodId={selectedPeriodId}
        currentPeriodId={currentPeriodId}
        holidayStats={holidayStats}
        holidayUnits={selectedUnits}
        holidayBaseColour={holidayBaseColour}
        holidayPeriodStart={selectedPeriod?.startDate ?? null}
        holidayPeriodEnd={selectedPeriod?.endDate ?? null}
        sick={sick}
        sickPlot={sickPlot}
        bradfordFactor={bradfordFactor}
      />
    </div>
  );
}
