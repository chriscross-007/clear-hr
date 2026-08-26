// CLE-170 — Profileless Holiday Management: Employee Holiday page (server).
//
// Fetches the member, their Holiday Periods, the bookings used to compute
// Taken / Booked / Balance / Carry Forward, and the Default Cascade values
// that pre-fill a new period. Passes everything to the client for the full
// CRUD experience.

export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  getHolidayPeriodsForMember,
  getNewPeriodDefaults,
  type HolidayPeriod,
  type NewPeriodDefaults,
} from "@/app/(dashboard)/holiday-period-actions";
import {
  computeAllHolidayPeriodValues,
  type ComputedPeriodValues,
  type ComputeBookingInput,
  type ComputeContext,
} from "@/app/(dashboard)/holiday-period-compute";
import {
  getMemberWorkPatternHistory,
  getBankHolidaysForOrg,
  getBankHolidayHandling,
} from "@/lib/work-pattern-data";
import { getMemberWorkedHoursInRange } from "@/lib/timesheet-totals";
import { EmployeeHolidayClient } from "./employee-holiday-client";

export default async function EmployeeHolidayPage({
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
    .select("organisation_id, rights_profiles(rank)")
    .eq("user_id", user.id)
    .limit(1)
    .single();

  const callerRank = (caller?.rights_profiles as unknown as { rank?: string } | null)?.rank ?? "employee";
  if (!caller || callerRank === "employee") redirect("/dashboard");

  const { data: member } = await supabase
    .from("members")
    .select("id, first_name, last_name, start_date")
    .eq("id", memberId)
    .eq("organisation_id", caller.organisation_id)
    .single();
  if (!member) redirect("/employees");

  // Fetch periods (server action — uses caller's session client + RLS).
  const periodsResult = await getHolidayPeriodsForMember(memberId);
  const periods: HolidayPeriod[] = periodsResult.success ? periodsResult.periods : [];

  // Reasons whose absence type deducts from holiday entitlement — only
  // these contribute to Holiday Period balances. Sick / compassionate /
  // other non-deducting absences track separately and would double-count
  // if included here.
  const { data: deductingReasons } = await supabase
    .from("absence_reasons")
    .select("id, absence_types!inner(deducts_from_entitlement)")
    .eq("organisation_id", caller.organisation_id)
    .eq("absence_types.deducts_from_entitlement", true);
  const deductingReasonIds = new Set<string>((deductingReasons ?? []).map((r) => r.id as string));

  // Fetch the bookings the compute chain needs. Approved/pending bookings
  // whose absence reason deducts from holiday entitlement.
  const { data: bookingsRaw } = await supabase
    .from("holiday_bookings")
    .select("start_date, end_date, start_half, end_half, status, leave_reason_id")
    .eq("member_id", memberId)
    .in("status", ["approved", "pending"]);

  const bookings: ComputeBookingInput[] = (bookingsRaw ?? [])
    .filter((b) => deductingReasonIds.has(b.leave_reason_id as string))
    .map((b) => ({
      startDate: b.start_date as string,
      endDate: (b.end_date as string | null) ?? null,
      startHalf: (b.start_half as string | null) ?? null,
      endHalf: (b.end_half as string | null) ?? null,
      status: b.status as string,
    }));

  // CLE-173 — fetch the context the compute helper needs to split each
  // booking across periods in each period's units. The booking range needs
  // bank-holiday data covering the union of all periods (not just today).
  const todayISO = new Date().toISOString().slice(0, 10);
  const periodSpan = periods.length > 0
    ? {
      from: periods.reduce((acc, p) => p.startDate < acc ? p.startDate : acc, periods[0].startDate),
      to: periods.reduce((acc, p) => p.endDate > acc ? p.endDate : acc, periods[0].endDate),
    }
    : { from: todayISO, to: todayISO };

  const [workPatternHistory, bankHolidays, bankHolidayHandling] = await Promise.all([
    getMemberWorkPatternHistory(supabase, memberId, caller.organisation_id),
    getBankHolidaysForOrg(supabase, caller.organisation_id, periodSpan.from, periodSpan.to),
    getBankHolidayHandling(supabase, caller.organisation_id),
  ]);

  // CLE-175 — pull worked hours from the timesheet for each Earned period.
  // Skip Fixed periods to avoid wasted DB queries; the compute helper
  // ignores worked hours for them.
  const earnedPeriods = periods.filter((p) => p.type === "earned");
  const workedHoursByPeriodId = new Map<string, number>();
  if (earnedPeriods.length > 0) {
    const totals = await Promise.all(
      earnedPeriods.map((p) =>
        getMemberWorkedHoursInRange(
          supabase,
          memberId,
          caller.organisation_id,
          p.startDate,
          p.endDate,
        ),
      ),
    );
    earnedPeriods.forEach((p, i) => {
      workedHoursByPeriodId.set(p.id, totals[i]);
    });
  }

  const ctx: ComputeContext = {
    workPatternHistory,
    bankHolidays,
    bankHolidayHandling,
    workedHoursByPeriodId,
  };
  const computedMap = computeAllHolidayPeriodValues(periods, bookings, ctx, todayISO);

  // Pre-compute defaults for the "Add Period" sheet so it pops open with
  // sensible values. If the helper fails (e.g. employee has no Start Date
  // set), pass null and the client surfaces the error in the sheet.
  const defaultsResult = await getNewPeriodDefaults(memberId);
  const newPeriodDefaults: NewPeriodDefaults | null =
    defaultsResult.success && defaultsResult.defaults ? defaultsResult.defaults : null;
  const newPeriodDefaultsError =
    !defaultsResult.success ? (defaultsResult.error ?? "Could not compute defaults") : null;

  // Flatten the computed map into a serializable object keyed by period id
  // (Maps don't survive the server → client boundary).
  const computedRecord: Record<string, ComputedPeriodValues> = {};
  for (const [id, values] of computedMap) {
    computedRecord[id] = values;
  }

  const fullName = [member.first_name, member.last_name].filter(Boolean).join(" ");

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8">
      <EmployeeHolidayClient
        memberId={memberId}
        memberName={fullName}
        memberStartDate={member.start_date as string | null}
        periods={periods}
        computed={computedRecord}
        newPeriodDefaults={newPeriodDefaults}
        newPeriodDefaultsError={newPeriodDefaultsError}
      />
    </div>
  );
}
