export const dynamic = "force-dynamic";

import { createClient } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";
import { TimesheetClient } from "./timesheet-client";

function getWeekBounds(dateStr?: string): { weekStart: string; weekEnd: string } {
  const base = dateStr ? new Date(`${dateStr}T00:00:00Z`) : new Date();
  // Clamp to UTC midnight
  base.setUTCHours(0, 0, 0, 0);
  const day = base.getUTCDay(); // 0=Sun
  const daysFromMonday = day === 0 ? 6 : day - 1;
  const monday = new Date(base);
  monday.setUTCDate(base.getUTCDate() - daysFromMonday);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  return {
    weekStart: monday.toISOString().slice(0, 10),
    weekEnd:   sunday.toISOString().slice(0, 10),
  };
}

export default async function TimesheetPage({
  params,
  searchParams,
}: {
  params: Promise<{ memberId: string }>;
  searchParams: Promise<{ week?: string }>;
}) {
  const { memberId } = await params;
  const { week } = await searchParams;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: caller } = await supabase
    .from("members")
    .select("id, organisation_id, role, permissions")
    .eq("user_id", user.id)
    .limit(1)
    .single();

  if (!caller) redirect("/login");
  if (caller.role !== "owner" && caller.role !== "admin") notFound();

  // Verify target member belongs to same org
  const { data: member } = await supabase
    .from("members")
    .select("id, first_name, last_name, known_as")
    .eq("id", memberId)
    .eq("organisation_id", caller.organisation_id)
    .maybeSingle();

  if (!member) notFound();

  const { weekStart, weekEnd } = getWeekBounds(week);

  // Fetch work periods for the week
  const { data: rawPeriods } = await supabase
    .from("work_periods")
    .select("id, period_start, period_end, timesheet_date, has_conflicts, inference_run_at, scheduled_shift_id")
    .eq("member_id", memberId)
    .eq("organisation_id", caller.organisation_id)
    .gte("timesheet_date", weekStart)
    .lte("timesheet_date", weekEnd)
    .order("period_start");

  const periods = rawPeriods ?? [];

  // Fetch clockings for those periods
  const periodIds = periods.map((p) => p.id);
  const { data: rawClockings } = periodIds.length > 0
    ? await supabase
        .from("clockings")
        .select("id, work_period_id, clocked_at, raw_type, inferred_type, is_bstart, type_locked, cost_centre_id")
        .in("work_period_id", periodIds)
        .eq("is_deleted", false)
        .order("clocked_at")
    : { data: [] };

  const allClockings = rawClockings ?? [];

  // Fetch scheduled shift names for the periods that have one
  const shiftIds = periods
    .filter((p) => p.scheduled_shift_id)
    .map((p) => p.scheduled_shift_id as string);

  const { data: rawScheduledShifts } = shiftIds.length > 0
    ? await supabase
        .from("scheduled_shifts")
        .select("id, shift_definitions(name, planned_start, planned_end)")
        .in("id", shiftIds)
    : { data: [] };

  type RawScheduledShift = {
    id: string;
    shift_definitions: { name: string; planned_start: string | null; planned_end: string | null } | null;
  };
  const shiftMap = Object.fromEntries(
    (rawScheduledShifts as unknown as RawScheduledShift[] ?? []).map((ss) => [
      ss.id,
      ss.shift_definitions
        ? { name: ss.shift_definitions.name, plannedStart: ss.shift_definitions.planned_start, plannedEnd: ss.shift_definitions.planned_end }
        : null,
    ])
  );

  // Attach clockings and shift info to each period
  const workPeriods = periods.map((p) => ({
    id: p.id,
    periodStart:    p.period_start,
    periodEnd:      p.period_end,
    timesheetDate:  p.timesheet_date,
    hasConflicts:   p.has_conflicts,
    inferenceRunAt: p.inference_run_at,
    scheduledShift: p.scheduled_shift_id ? (shiftMap[p.scheduled_shift_id] ?? null) : null,
    clockings: allClockings
      .filter((c) => c.work_period_id === p.id)
      .map((c) => ({
        id:            c.id,
        clockedAt:     c.clocked_at,
        rawType:       c.raw_type,
        inferredType:  c.inferred_type,
        isBstart:      c.is_bstart,
        typeLocked:    c.type_locked,
        costCentreId:  c.cost_centre_id,
      })),
  }));

  const memberName = member.known_as ?? member.first_name;

  return (
    <TimesheetClient
      memberId={memberId}
      memberName={`${memberName} ${member.last_name}`}
      weekStart={weekStart}
      weekEnd={weekEnd}
      workPeriods={workPeriods}
      callerRole={caller.role}
    />
  );
}
