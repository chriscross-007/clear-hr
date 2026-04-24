export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { calculateEntitlement } from "@/lib/entitlement";
import type { CalendarBooking, CalendarBankHoliday } from "@/components/holiday-calendar";
import { MyHolidayClient } from "./my-holiday-client";
import type {
  HolidayBookingRow,
  BalanceSummary,
  AbsenceReasonOption,
} from "../holiday-booking-actions";

export default async function MyHolidayPage() {
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

  // Fetch org country code for bank holiday filtering
  const { data: orgRow } = await supabase
    .from("organisations")
    .select("country_code, bank_holiday_colour")
    .eq("id", member.organisation_id)
    .single();
  const orgCountryCode = (orgRow as { country_code?: string; bank_holiday_colour?: string } | null)?.country_code ?? "england-and-wales";
  const bankHolidayColour = (orgRow as { country_code?: string; bank_holiday_colour?: string } | null)?.bank_holiday_colour ?? "#EF4444";

  const today = new Date().toISOString().slice(0, 10);

  // Fetch current year record
  const { data: yearRec } = await supabase
    .from("holiday_year_records")
    .select("id, absence_type_id, year_start, year_end, pro_rata_amount, base_amount, adjustment, carried_over")
    .eq("member_id", member.id)
    .lte("year_start", today)
    .gte("year_end", today)
    .limit(1)
    .single();

  // Determine measurement mode and carry-over cap from current year record's profile
  let measurementMode = "days";
  let carryOverMax: number | null = null;
  if (yearRec) {
    const { data: profile } = await supabase
      .from("absence_profiles")
      .select("measurement_mode, carry_over_max")
      .eq("absence_type_id", yearRec.absence_type_id)
      .eq("organisation_id", member.organisation_id)
      .limit(1)
      .single();
    if (profile) {
      measurementMode = profile.measurement_mode;
      carryOverMax = profile.carry_over_max !== null ? Number(profile.carry_over_max) : null;
    }
  }

  // Compute balance using centralised entitlement calculation
  let balance: BalanceSummary | null = null;
  let currentPeriodProjectedCO = 0;
  if (yearRec) {
    const { data: bookings } = await supabase
      .from("holiday_bookings")
      .select("days_deducted, hours_deducted, status, end_date")
      .eq("member_id", member.id)
      .gte("start_date", yearRec.year_start)
      .lte("start_date", yearRec.year_end)
      .in("status", ["pending", "approved"]);

    const result = calculateEntitlement(
      yearRec,
      (bookings ?? []) as { days_deducted: number | null; hours_deducted: number | null; status: string; end_date: string }[],
      member.start_date,
      measurementMode,
      today
    );

    // Projected carry-over: min(remaining, cap)
    const projectedCO = (carryOverMax === null || carryOverMax === undefined)
      ? Math.max(result.remaining, 0)
      : Math.min(Math.max(result.remaining, 0), carryOverMax);

    currentPeriodProjectedCO = projectedCO;

    balance = {
      entitlement: result.effective_entitlement,
      carriedOver: Number(yearRec.carried_over) || 0,
      pending: result.pending,
      booked: result.booked,
      taken: result.taken,
      remaining: result.remaining,
      carryOverProjected: projectedCO,
      unit: measurementMode,
      yearStart: yearRec.year_start,
      yearEnd: yearRec.year_end,
    };
  }

  // Fetch next year record and compute its balance
  let nextBalance: BalanceSummary | null = null;
  if (yearRec) {
    const nextStart = new Date(yearRec.year_end + "T00:00:00Z");
    nextStart.setUTCDate(nextStart.getUTCDate() + 1);
    const nextStartStr = nextStart.toISOString().slice(0, 10);

    const { data: nextYearRec } = await supabase
      .from("holiday_year_records")
      .select("id, absence_type_id, year_start, year_end, pro_rata_amount, base_amount, adjustment, carried_over")
      .eq("member_id", member.id)
      .eq("year_start", nextStartStr)
      .limit(1)
      .single();

    if (nextYearRec) {
      const { data: nextBookings } = await supabase
        .from("holiday_bookings")
        .select("days_deducted, hours_deducted, status, end_date")
        .eq("member_id", member.id)
        .gte("start_date", nextYearRec.year_start)
        .lte("start_date", nextYearRec.year_end)
        .in("status", ["pending", "approved"]);

      const nextResult = calculateEntitlement(
        nextYearRec,
        (nextBookings ?? []) as { days_deducted: number | null; hours_deducted: number | null; status: string; end_date: string }[],
        member.start_date,
        measurementMode,
        today
      );

      // Use the DB value if populated, otherwise project from the current period
      const nextCarriedOver = Number(nextYearRec.carried_over) || 0;
      const effectiveNextCO = nextCarriedOver > 0 ? nextCarriedOver : currentPeriodProjectedCO;
      // If projecting carry-over (DB was 0), add the projected amount to entitlement and remaining
      const coAdjustment = nextCarriedOver > 0 ? 0 : effectiveNextCO;

      const nextRemainingWithCO = nextResult.remaining + coAdjustment;
      const nextCO = (carryOverMax === null || carryOverMax === undefined)
        ? Math.max(nextRemainingWithCO, 0)
        : Math.min(Math.max(nextRemainingWithCO, 0), carryOverMax);

      nextBalance = {
        entitlement: nextResult.effective_entitlement + coAdjustment,
        carriedOver: effectiveNextCO,
        pending: nextResult.pending,
        booked: nextResult.booked,
        taken: nextResult.taken,
        remaining: nextResult.remaining + coAdjustment,
        carryOverProjected: nextCO,
        unit: measurementMode,
        yearStart: nextYearRec.year_start,
        yearEnd: nextYearRec.year_end,
      };
    }
  }

  // Fetch bookings
  const { data: bookingsData } = await supabase
    .from("holiday_bookings")
    .select("id, leave_reason_id, start_date, end_date, start_half, end_half, days_deducted, hours_deducted, status, approver1_id, approver_note, employee_note, created_at, absence_reasons(name, colour)")
    .eq("member_id", member.id)
    .order("start_date", { ascending: true });

  // Resolve approver names
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

  // Fetch absence reasons for booking form
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

  // Calendar data — 13-month range from current year record
  let calendarYearStart: string | null = null;
  let calendarBookings: CalendarBooking[] = [];
  let calendarBankHolidays: CalendarBankHoliday[] = [];

  if (yearRec) {
    calendarYearStart = yearRec.year_start;
    const calStart = new Date(yearRec.year_start + "T00:00:00Z");
    const calEnd = new Date(Date.UTC(calStart.getUTCFullYear(), calStart.getUTCMonth() + 13, 0));
    const calEndStr = calEnd.toISOString().slice(0, 10);

    const { data: calBookingsData } = await supabase
      .from("holiday_bookings")
      .select("id, start_date, end_date, status, days_deducted, absence_reasons(name, colour, absence_type_id, absence_types(requires_approval))")
      .eq("member_id", member.id)
      .lte("start_date", calEndStr)
      .gte("end_date", yearRec.year_start)
      .in("status", ["pending", "approved"]);

    calendarBookings = (calBookingsData ?? []).map((b) => {
      const reason = b.absence_reasons as unknown as
        | { name: string; colour: string; absence_type_id: string | null; absence_types: { requires_approval: boolean } | null }
        | null;
      return {
        id: b.id,
        start_date: b.start_date,
        end_date: b.end_date,
        status: b.status,
        days_deducted: b.days_deducted,
        reason_name: reason?.name ?? "—",
        reason_colour: reason?.colour ?? "#6366f1",
        requires_approval: reason?.absence_types?.requires_approval ?? false,
        absence_type_id: reason?.absence_type_id ?? null,
      };
    });

    const { data: bhData } = await supabase
      .from("bank_holidays")
      .select("date, name, is_excluded, organisation_id")
      .eq("country_code", orgCountryCode)
      .gte("date", yearRec.year_start)
      .lte("date", calEndStr)
      .or(`organisation_id.is.null,organisation_id.eq.${member.organisation_id}`);

    const excluded = new Set<string>();
    for (const bh of bhData ?? []) {
      if (bh.organisation_id && bh.is_excluded) excluded.add(bh.date);
      else if (!excluded.has(bh.date)) calendarBankHolidays.push({ date: bh.date, name: bh.name });
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
        calendarBookings={calendarBookings}
        calendarBankHolidays={calendarBankHolidays}
        bankHolidayColour={bankHolidayColour}
      />
    </div>
  );
}
