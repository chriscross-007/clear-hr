export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { type CalendarBooking, type CalendarBankHoliday } from "@/components/holiday-calendar";
import { type WorkPatternHours } from "@/lib/day-counting";
import { calculateEntitlement, type BookingUsage } from "@/lib/entitlement";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { AdminCalendarClient, type AbsenceReasonOption, type AbsenceTypeOption } from "./admin-calendar-client";
import { PlannerDashboard, type HolidayStats, type SickPlotStats, type SickStats } from "./planner-dashboard";

export default async function EmployeeCalendarPage({
  params,
}: {
  params: Promise<{ memberId: string }>;
}) {
  const { memberId } = await params;
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

  // Find current year record
  const { data: yearRec } = await supabase
    .from("holiday_year_records")
    .select("year_start, year_end, base_amount, pro_rata_amount, adjustment, carried_over")
    .eq("member_id", memberId)
    .lte("year_start", today)
    .gte("year_end", today)
    .limit(1)
    .single();

  if (!yearRec) {
    return (
      <div className="w-full px-4 py-8 sm:px-6 lg:px-8">
        <Link href="/employees" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4">
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to directory
        </Link>
        <p className="text-muted-foreground">No active holiday year record found.</p>
      </div>
    );
  }

  // Calculate 13-month range
  const rangeStart = yearRec.year_start;
  const startDate = new Date(rangeStart + "T00:00:00Z");
  const rangeEnd = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth() + 13, 0));
  const rangeEndStr = rangeEnd.toISOString().slice(0, 10);

  // Fetch bookings in range
  const { data: bookingsData } = await supabase
    .from("holiday_bookings")
    .select("id, start_date, end_date, status, days_deducted, leave_reason_id, absence_reasons(name, colour, absence_type_id, absence_types(colour, requires_approval))")
    .eq("member_id", memberId)
    .lte("start_date", rangeEndStr)
    .gte("end_date", rangeStart)
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
    };
  });

  // Build the Holidays dashboard stats from in-year bookings using the same
  // formula the My Holiday balance card uses (lib/entitlement.ts). Only count
  // bookings whose absence type deducts from holiday entitlement (e.g. Annual
  // Leave / Holiday) — sick, compassionate, etc. are excluded.
  const inYearBookings: BookingUsage[] = (bookingsData ?? [])
    .filter((b) =>
      b.start_date >= yearRec.year_start
      && b.start_date <= yearRec.year_end
      && deductingReasonIds.has(b.leave_reason_id as string),
    )
    .map((b) => ({
      days_deducted: b.days_deducted,
      hours_deducted: null,
      status: b.status,
      end_date: b.end_date,
    }));
  const ent = calculateEntitlement(yearRec, inYearBookings, member.start_date ?? null, "days", today);
  const holidayStats: HolidayStats = {
    allowance: ent.effective_entitlement,
    taken: ent.taken,
    booked: ent.booked,
    pending: ent.pending,
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

  const sickByDow = [0, 0, 0, 0, 0, 0, 0]; // Mon..Sun
  let sickSpells = 0; // number of separate sick bookings — the "S" in Bradford
  if (sickReasonIds.length > 0) {
    const { data: sickBookings } = await supabase
      .from("holiday_bookings")
      .select("start_date, end_date, start_half, end_half")
      .eq("member_id", memberId)
      .gte("end_date", sickWindowStart)
      .lte("start_date", today)
      .in("status", ["pending", "approved"])
      .in("leave_reason_id", sickReasonIds);

    sickSpells = (sickBookings ?? []).length;

    const winStartMs = new Date(sickWindowStart + "T00:00:00Z").getTime();
    const winEndMs = new Date(today + "T00:00:00Z").getTime();
    for (const b of sickBookings ?? []) {
      const startMs = new Date((b.start_date as string) + "T00:00:00Z").getTime();
      const endMs = new Date((b.end_date as string) + "T00:00:00Z").getTime();
      const startHalf = !!b.start_half;
      const endHalf = !!b.end_half;
      const cursor = new Date(Math.max(startMs, winStartMs));
      const stop = Math.min(endMs, winEndMs);
      while (cursor.getTime() <= stop) {
        // 0=Mon .. 6=Sun
        const js = cursor.getUTCDay();
        const dow = js === 0 ? 6 : js - 1;
        let value = 1;
        if (cursor.getTime() === startMs && startHalf) value = 0.5;
        if (cursor.getTime() === endMs && endHalf) value = 0.5;
        sickByDow[dow] += value;
        cursor.setUTCDate(cursor.getUTCDate() + 1);
      }
    }
  }
  const sickPlot: SickPlotStats = { byDow: sickByDow, colour: sickColour };
  const sickDaysTotal = sickByDow.reduce((a, b) => a + b, 0);
  // Bradford Factor: B = S² × D where S = number of sickness spells,
  // D = total sick days (both over the trailing 365-day window).
  const bradfordFactor = Math.round(sickSpells * sickSpells * sickDaysTotal);

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

  // Resolve the target member's work pattern as of today so the booking sheet
  // can compute days_deducted live (matches the server's authoritative calc).
  const todayStr = new Date().toISOString().slice(0, 10);
  const { data: assignment } = await supabase
    .from("employee_work_profiles")
    .select("work_profile_id")
    .eq("member_id", memberId)
    .lte("effective_from", todayStr)
    .order("effective_from", { ascending: false })
    .limit(1)
    .maybeSingle();
  const profileId = assignment?.work_profile_id ?? orgDefaultWorkProfileId;
  let workPattern: WorkPatternHours | null = null;
  if (profileId) {
    const { data: wp } = await supabase
      .from("work_profiles")
      .select("hours_monday, hours_tuesday, hours_wednesday, hours_thursday, hours_friday, hours_saturday, hours_sunday")
      .eq("id", profileId)
      .single();
    workPattern = (wp as WorkPatternHours | null) ?? null;
  }

  // Sick donut: count working days in the same trailing 365-day window using
  // the resolved work pattern (Mon–Fri default if none). Combined with the
  // sickDaysTotal accumulated above this gives the % sick rate.
  const PATTERN_KEYS: (keyof WorkPatternHours)[] = [
    "hours_monday", "hours_tuesday", "hours_wednesday", "hours_thursday",
    "hours_friday", "hours_saturday", "hours_sunday",
  ];
  let workingDaysInWindow = 0;
  {
    const cursor = new Date(sickWindowStart + "T00:00:00Z");
    const stopMs = new Date(today + "T00:00:00Z").getTime();
    while (cursor.getTime() <= stopMs) {
      const js = cursor.getUTCDay();
      const dow = js === 0 ? 6 : js - 1; // 0=Mon..6=Sun
      const hours = workPattern
        ? Number(workPattern[PATTERN_KEYS[dow]])
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
        bookings={bookings}
        bankHolidays={bhList}
        bankHolidayColour={bankHolidayColour}
        absenceReasons={absenceReasons}
        absenceTypes={absenceTypes}
        workPattern={workPattern}
        bankHolidayHandling={bankHolidayHandling}
      />
    </div>
  );
}
