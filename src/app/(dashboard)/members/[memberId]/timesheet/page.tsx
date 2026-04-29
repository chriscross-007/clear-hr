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
    .select("id, organisation_id, role, permissions, organisations(ts_round_first_in_mins, ts_round_first_in_grace_mins, ts_round_break_out_mins, ts_round_break_out_grace_mins, ts_round_break_in_mins, ts_round_break_in_grace_mins, ts_round_last_out_mins, ts_round_last_out_grace_mins)")
    .eq("user_id", user.id)
    .limit(1)
    .single();

  if (!caller) redirect("/login");
  if (caller.role !== "owner" && caller.role !== "admin") notFound();

  const orgSettings = caller.organisations as unknown as {
    ts_round_first_in_mins:        number | null;
    ts_round_first_in_grace_mins:  number | null;
    ts_round_break_out_mins:       number | null;
    ts_round_break_out_grace_mins: number | null;
    ts_round_break_in_mins:        number | null;
    ts_round_break_in_grace_mins:  number | null;
    ts_round_last_out_mins:        number | null;
    ts_round_last_out_grace_mins:  number | null;
  } | null;
  const roundingConfig = {
    firstInMins:        orgSettings?.ts_round_first_in_mins        ?? null,
    firstInGraceMins:   orgSettings?.ts_round_first_in_grace_mins  ?? null,
    breakOutMins:       orgSettings?.ts_round_break_out_mins       ?? null,
    breakOutGraceMins:  orgSettings?.ts_round_break_out_grace_mins ?? null,
    breakInMins:        orgSettings?.ts_round_break_in_mins        ?? null,
    breakInGraceMins:   orgSettings?.ts_round_break_in_grace_mins  ?? null,
    lastOutMins:        orgSettings?.ts_round_last_out_mins        ?? null,
    lastOutGraceMins:   orgSettings?.ts_round_last_out_grace_mins  ?? null,
  };

  // Verify target member belongs to same org
  const { data: member } = await supabase
    .from("members")
    .select("id, first_name, last_name, known_as")
    .eq("id", memberId)
    .eq("organisation_id", caller.organisation_id)
    .maybeSingle();

  if (!member) notFound();

  const { weekStart, weekEnd } = getWeekBounds(week);

  // Fetch org rates (for timesheet column headers)
  const { data: rawRates } = await supabase
    .from("rates")
    .select("id, name, rate_multiplier")
    .eq("organisation_id", caller.organisation_id)
    .order("sort_order");

  const rates = (rawRates ?? []) as { id: string; name: string; rate_multiplier: number }[];

  // Fetch active shift definitions for the org (for the shift picker)
  const { data: rawShiftDefs } = await supabase
    .from("shift_definitions")
    .select("id, name")
    .eq("organisation_id", caller.organisation_id)
    .eq("active", true)
    .order("sort_order")
    .order("name");

  const shiftDefs = (rawShiftDefs ?? []) as { id: string; name: string }[];

  // Fetch work periods for the week
  const { data: rawPeriods } = await supabase
    .from("work_periods")
    .select("id, period_start, period_end, timesheet_date, has_conflicts, inference_run_at")
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
        .select("id, work_period_id, clocked_at, raw_type, inferred_type, override_type, is_bstart, cost_centre_id, source, edited_clocked_at, edited_raw_type, edited_by_member_id, edited_at")
        .in("work_period_id", periodIds)
        .eq("is_deleted", false)
        .order("clocked_at")
    : { data: [] };

  const allClockings = rawClockings ?? [];

  // Resolve editor names for any edited clockings
  const editorIds = [...new Set(
    allClockings
      .map((c) => c.edited_by_member_id as string | null)
      .filter((id): id is string => id != null)
  )];
  const editorNameById: Record<string, string> = {};
  if (editorIds.length > 0) {
    const { data: editors } = await supabase
      .from("members")
      .select("id, first_name, last_name, known_as")
      .in("id", editorIds);
    for (const e of editors ?? []) {
      editorNameById[e.id] = `${e.known_as ?? e.first_name} ${e.last_name}`;
    }
  }

  // Fetch all scheduled_shifts for this member for the week (keyed by date)
  const { data: rawScheduledShifts } = await supabase
    .from("scheduled_shifts")
    .select("id, shift_definition_id, is_off_day, schedule_date, shift_definitions(name, planned_start, planned_end)")
    .eq("member_id", memberId)
    .eq("organisation_id", caller.organisation_id)
    .gte("schedule_date", weekStart)
    .lte("schedule_date", weekEnd);

  type RawScheduledShift = {
    id: string;
    shift_definition_id: string | null;
    is_off_day: boolean;
    schedule_date: string;
    shift_definitions: { name: string; planned_start: string | null; planned_end: string | null } | null;
  };
  // Map by date (YYYY-MM-DD) — one shift per day
  const shiftByDate: Record<string, { scheduledShiftId: string; shiftDefinitionId: string | null; name: string | null; plannedStart: string | null; plannedEnd: string | null; isOffDay: boolean }> = {};
  for (const ss of (rawScheduledShifts as unknown as RawScheduledShift[] ?? [])) {
    shiftByDate[ss.schedule_date] = {
      scheduledShiftId:  ss.id,
      shiftDefinitionId: ss.shift_definition_id,
      name:              ss.shift_definitions?.name ?? null,
      plannedStart:      ss.shift_definitions?.planned_start ?? null,
      plannedEnd:        ss.shift_definitions?.planned_end ?? null,
      isOffDay:          ss.is_off_day,
    };
  }

  // Fetch overtime bands and break rules for each shift definition used this week
  const shiftDefIds = [...new Set(
    Object.values(shiftByDate)
      .map((s) => s.shiftDefinitionId)
      .filter((id): id is string => id !== null),
  )];
  const shiftBands: Record<string, { rate_id: string | null; from_time: string; to_time: string | null; min_time: string | null }[]> = {};
  const shiftBreakRules: Record<string, { band_start: string; band_end: string; allowed_break: string; penalty_break: string | null; paid: boolean; rate_id: string | null }[]> = {};
  if (shiftDefIds.length > 0) {
    const [{ data: rawBands }, { data: rawShiftDefs }] = await Promise.all([
      supabase
        .from("overtime_bands")
        .select("shift_definition_id, rate_id, from_time, to_time, min_time")
        .in("shift_definition_id", shiftDefIds)
        .order("sort_order"),
      supabase
        .from("shift_definitions")
        .select("id, break_rules")
        .in("id", shiftDefIds),
    ]);
    for (const b of rawBands ?? []) {
      const defId = b.shift_definition_id as string;
      if (!shiftBands[defId]) shiftBands[defId] = [];
      shiftBands[defId].push({
        rate_id:   (b.rate_id as string | null) ?? null,
        from_time: ((b.from_time as string) ?? "00:00").slice(0, 5),
        to_time:   b.to_time ? (b.to_time as string).slice(0, 5) : null,
        min_time:  b.min_time ? (b.min_time as string).slice(0, 5) : null,
      });
    }
    for (const sd of rawShiftDefs ?? []) {
      shiftBreakRules[sd.id as string] = (sd.break_rules as { band_start: string; band_end: string; allowed_break: string; penalty_break: string | null; paid: boolean; rate_id: string | null }[]) ?? [];
    }
  }

  // Attach clockings and shift info to each period
  const workPeriods = periods.map((p) => ({
    id: p.id,
    periodStart:    p.period_start,
    periodEnd:      p.period_end,
    timesheetDate:  p.timesheet_date,
    hasConflicts:   p.has_conflicts,
    inferenceRunAt: p.inference_run_at,
    scheduledShift: shiftByDate[p.timesheet_date] ?? null,
    clockings: allClockings
      .filter((c) => c.work_period_id === p.id)
      .map((c) => ({
        id:              c.id,
        clockedAt:       c.clocked_at,
        rawType:         c.raw_type,
        inferredType:    c.inferred_type,
        overrideType:    c.override_type,
        isBstart:        c.is_bstart,
        costCentreId:    c.cost_centre_id,
        source:          (c.source as string | null) ?? null,
        editedClockedAt: (c.edited_clocked_at as string | null) ?? null,
        editedRawType:   (c.edited_raw_type as string | null) ?? null,
        editedByName:    c.edited_by_member_id ? (editorNameById[c.edited_by_member_id as string] ?? null) : null,
        editedAt:        (c.edited_at as string | null) ?? null,
      })),
  }));

  const memberName = member.known_as ?? member.first_name;

  // Debug: all clockings for this member for the week (regardless of work period)
  const { data: rawDebugClockings } = await supabase
    .from("clockings")
    .select("id, clocked_at, raw_type, inferred_type, override_type, work_period_id, is_deleted")
    .eq("member_id", memberId)
    .eq("organisation_id", caller.organisation_id)
    .gte("clocked_at", `${weekStart}T00:00:00Z`)
    .lte("clocked_at", `${weekEnd}T23:59:59Z`)
    .order("clocked_at");

  const debugClockings = (rawDebugClockings ?? []).map((c) => ({
    id:           c.id,
    clockedAt:    c.clocked_at,
    rawType:      c.raw_type as string | null,
    inferredType: c.inferred_type as string | null,
    overrideType: c.override_type as string | null,
    workPeriodId: c.work_period_id as string | null,
    isDeleted:    c.is_deleted as boolean,
  }));

  return (
    <TimesheetClient
      memberId={memberId}
      memberName={`${memberName} ${member.last_name}`}
      weekStart={weekStart}
      weekEnd={weekEnd}
      workPeriods={workPeriods}
      callerRole={caller.role}
      shiftDefs={shiftDefs}
      shiftByDate={shiftByDate}
      shiftBands={shiftBands}
      shiftBreakRules={shiftBreakRules}
      debugClockings={debugClockings}
      roundingConfig={roundingConfig}
      rates={rates}
    />
  );
}
