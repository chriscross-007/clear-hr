/**
 * Timesheet Inference Engine
 *
 * Groups raw clockings into work periods and infers each clocking's type
 * (IN / OUT / CC / bStart / AMBIGUOUS).
 *
 * Rules:
 *  - Clockings are grouped by time gap (> ts_gap_threshold_hours = new period).
 *  - The first clocking of a period is always the bStart.
 *      · If its raw_type is 'CC', inferred_type = 'bStart' (CC that opens the period).
 *      · Otherwise, inferred_type = 'IN'.
 *  - If a scheduled shift is matched, break and shift-end clockings are assigned
 *    to the nearest candidate by time proximity.
 *  - Open shifts / no schedule: bare swipes alternate IN/OUT after bStart.
 *  - Clockings with type_locked = true are never overwritten; the engine treats
 *    their current inferred_type as ground truth when inferring neighbours.
 *  - clocked_at is IMMUTABLE — this engine never modifies it.
 *
 * Timezone note: all time comparisons are done in UTC. Add an org-level
 * timezone field when local-time rules are needed.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

// ── Internal types ────────────────────────────────────────────────────────────

interface OrgConfig {
  ts_gap_threshold_hours: number;
  ts_max_shift_hours: number;
  ts_allocate_to: "start" | "end";
}

interface Clocking {
  id: string;
  clocked_at: string;        // ISO timestamptz — NEVER modified
  raw_type: string | null;   // supplied by terminal: 'IN' | 'OUT' | 'CC' | null
  inferred_type: string | null;
  is_bstart: boolean;
  type_locked: boolean;      // if true, engine skips inferred_type update
  cost_centre_id: string | null;
  work_period_id: string | null;
}

interface BreakDef {
  start: string;        // "HH:MM"
  end: string;          // "HH:MM"
  duration_mins: number;
}

interface ShiftDef {
  id: string;
  is_open_shift: boolean;
  planned_start: string | null;  // "HH:MM:SS"
  planned_end: string | null;
  crosses_midnight: boolean;
  break_type: "none" | "clocked" | "auto_deduct";
  breaks: BreakDef[];
}

interface ScheduledShift {
  id: string;
  schedule_date: string;          // "YYYY-MM-DD"
  shift_definition: ShiftDef;
}

// Inference result per clocking
interface ClockingResult {
  id: string;
  inferred_type: string;
  is_bstart: boolean;
  has_conflict: boolean;
}

// ── Exported result type ──────────────────────────────────────────────────────

export interface InferenceResult {
  periodsCreated: number;
  periodsUpdated: number;
  /** Number of work periods that contain at least one AMBIGUOUS or conflict clocking */
  conflicts: number;
}

// ── Date/time helpers ─────────────────────────────────────────────────────────

function toDate(iso: string): Date {
  return new Date(iso);
}

function hoursApart(a: Date, b: Date): number {
  return Math.abs(a.getTime() - b.getTime()) / 3_600_000;
}

/** Parse "HH:MM" or "HH:MM:SS" shift time onto a given UTC base date */
function timeOnDate(baseDate: Date, timeStr: string): Date {
  const [h, m, s] = timeStr.split(":").map(Number);
  const d = new Date(baseDate);
  d.setUTCHours(h, m, s ?? 0, 0);
  return d;
}

/** Date → "YYYY-MM-DD" (UTC) */
function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// ── Work period grouping ──────────────────────────────────────────────────────

/**
 * Split a sorted list of clockings into contiguous groups.
 * A gap of >= gapThresholdHours between consecutive clockings starts a new group.
 */
function groupByGap(clockings: Clocking[], gapThresholdHours: number): Clocking[][] {
  if (clockings.length === 0) return [];

  const groups: Clocking[][] = [];
  let current: Clocking[] = [clockings[0]];

  for (let i = 1; i < clockings.length; i++) {
    const prev = toDate(clockings[i - 1].clocked_at);
    const curr = toDate(clockings[i].clocked_at);
    if (hoursApart(prev, curr) >= gapThresholdHours) {
      groups.push(current);
      current = [];
    }
    current.push(clockings[i]);
  }
  groups.push(current);

  return groups;
}

// ── Scheduled shift matching ──────────────────────────────────────────────────

/**
 * Find the best-matching scheduled shift for a work period whose bStart is `bStart`.
 * Matches on proximity of planned_start to actual bStart, within maxShiftHours / 2.
 * Handles midnight-crossing shifts (checks schedule_date - 1 day as well).
 */
function matchScheduledShift(
  bStart: Date,
  scheduledShifts: ScheduledShift[],
  maxShiftHours: number
): ScheduledShift | null {
  const bDate = toDateStr(bStart);
  let best: ScheduledShift | null = null;
  let bestDiff = Infinity;

  for (const ss of scheduledShifts) {
    const def = ss.shift_definition;
    if (!def.planned_start || def.is_open_shift) continue;

    // Candidate planned_start datetimes to compare against bStart
    const candidates: Date[] = [];

    // Same calendar day
    if (ss.schedule_date === bDate) {
      candidates.push(timeOnDate(bStart, def.planned_start));
    }

    // Shift started the previous day and crosses midnight
    if (def.crosses_midnight) {
      const prevDay = new Date(bStart);
      prevDay.setUTCDate(prevDay.getUTCDate() - 1);
      if (toDateStr(prevDay) === ss.schedule_date) {
        candidates.push(timeOnDate(prevDay, def.planned_start));
      }
    }

    for (const planned of candidates) {
      const diff = hoursApart(planned, bStart);
      if (diff < bestDiff && diff <= maxShiftHours / 2) {
        bestDiff = diff;
        best = ss;
      }
    }
  }

  return best;
}

// ── Type inference within one work period ─────────────────────────────────────

/**
 * Given a group of clockings belonging to one work period, assign inferred_type
 * and is_bstart to each. Returns one result object per clocking.
 *
 * Locked clockings (type_locked = true) are not reassigned but are included in
 * the result so the caller can still update work_period_id / is_bstart.
 */
function inferTypesForPeriod(
  clockings: Clocking[],
  scheduledShift: ScheduledShift | null,
  bStartDate: Date,
  maxShiftHours: number
): ClockingResult[] {
  const result: ClockingResult[] = [];
  const remaining = new Set<string>(clockings.map((c) => c.id));
  const conflictIds = new Set<string>();

  /** Assign a type to a clocking, respecting type_locked. */
  function assign(c: Clocking, type: string, isBstart = false): void {
    remaining.delete(c.id);
    if (c.type_locked) {
      // Preserve the manager's type; only update is_bstart if relevant
      result.push({ id: c.id, inferred_type: c.inferred_type!, is_bstart: isBstart, has_conflict: false });
    } else {
      result.push({ id: c.id, inferred_type: type, is_bstart: isBstart, has_conflict: false });
    }
  }

  /** Find the clocking in `pool` nearest to `target` within `maxH` hours. */
  function nearest(pool: Clocking[], target: Date, maxH: number): Clocking | null {
    let best: Clocking | null = null;
    let bestDiff = Infinity;
    for (const c of pool) {
      const diff = hoursApart(toDate(c.clocked_at), target);
      if (diff < bestDiff && diff <= maxH) {
        bestDiff = diff;
        best = c;
      }
    }
    return best;
  }

  // ── Step 1: bStart — always the first clocking ──────────────────────────────
  const first = clockings[0];
  // bStart type: 'bStart' if it's a CC clocking, 'IN' otherwise
  const bStartType = first.raw_type === "CC" ? "bStart" : "IN";
  assign(first, bStartType, true);

  const def = scheduledShift?.shift_definition ?? null;

  if (def && !def.is_open_shift && def.planned_start && def.planned_end) {
    // ── Scheduled shift path ─────────────────────────────────────────────────

    // Resolve planned_end as a datetime (may be next day if crosses_midnight)
    let plannedEnd = timeOnDate(bStartDate, def.planned_end);
    if (def.crosses_midnight && plannedEnd <= bStartDate) {
      plannedEnd = new Date(plannedEnd.getTime() + 86_400_000);
    }

    if (def.break_type === "clocked" && def.breaks.length > 0) {
      // Assign break OUT / break IN pairs by proximity
      for (const br of def.breaks) {
        const breakOutTarget = timeOnDate(bStartDate, br.start);
        const breakInTarget = timeOnDate(bStartDate, br.end);

        const pool = clockings.filter((c) => remaining.has(c.id));

        const breakOut = nearest(pool, breakOutTarget, maxShiftHours);
        if (breakOut) assign(breakOut, "OUT");

        const pool2 = clockings.filter((c) => remaining.has(c.id));
        const breakIn = nearest(pool2, breakInTarget, maxShiftHours);
        if (breakIn) assign(breakIn, "IN");
      }
    }
    // break_type 'none' or 'auto_deduct': no clocking pairs needed for breaks

    // Shift-end OUT: nearest remaining clocking to planned_end
    const endPool = clockings.filter((c) => remaining.has(c.id));
    const shiftEnd = nearest(endPool, plannedEnd, maxShiftHours);
    if (shiftEnd) assign(shiftEnd, "OUT");

    // Remaining clockings: CC if they have a cost_centre_id, otherwise AMBIGUOUS
    for (const c of clockings) {
      if (!remaining.has(c.id)) continue;
      const type = c.raw_type === "CC" || c.cost_centre_id ? "CC" : "AMBIGUOUS";
      if (type === "AMBIGUOUS") conflictIds.add(c.id);
      assign(c, type);
    }
  } else {
    // ── Open shift / no scheduled shift: alternating IN/OUT after bStart ─────

    // After bStart (which is IN or bStart), we next expect an OUT
    let expectingOut = true;

    for (const c of clockings) {
      if (!remaining.has(c.id)) continue;

      if (c.type_locked) {
        // Respect manager's assignment; update expectation accordingly
        remaining.delete(c.id);
        result.push({ id: c.id, inferred_type: c.inferred_type!, is_bstart: false, has_conflict: false });
        if (c.inferred_type === "IN" || c.inferred_type === "bStart") expectingOut = true;
        if (c.inferred_type === "OUT") expectingOut = false;
        continue;
      }

      // Terminal supplied an explicit type
      if (c.raw_type === "IN" || c.raw_type === "OUT") {
        assign(c, c.raw_type);
        expectingOut = c.raw_type === "IN";
        continue;
      }

      // Cost centre clocking — keep as CC, doesn't affect IN/OUT alternation
      if (c.raw_type === "CC" || c.cost_centre_id) {
        assign(c, "CC");
        continue;
      }

      // Bare swipe — alternate
      const type = expectingOut ? "OUT" : "IN";
      assign(c, type);
      expectingOut = !expectingOut;
    }

    // Trailing IN with no OUT = employee may still be clocked in → flag conflict
    const lastResult = result[result.length - 1];
    if (
      lastResult &&
      (lastResult.inferred_type === "IN" || lastResult.inferred_type === "bStart")
    ) {
      conflictIds.add(lastResult.id);
    }
  }

  // Stamp conflict flag onto results
  for (const r of result) {
    if (conflictIds.has(r.id)) r.has_conflict = true;
  }

  return result;
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Run the inference engine for one member over a date range.
 *
 * @param supabase  Should be an admin/service-role client so RLS doesn't block
 *                  cross-table reads/writes during processing.
 */
export async function runInference(params: {
  supabase: SupabaseClient;
  organisationId: string;
  memberId: string;
  /** Start of the period to process (inclusive) */
  rangeStart: Date;
  /** End of the period to process (inclusive) */
  rangeEnd: Date;
}): Promise<InferenceResult> {
  const { supabase, organisationId, memberId, rangeStart, rangeEnd } = params;

  // ── 1. Fetch org config ────────────────────────────────────────────────────
  const { data: org, error: orgErr } = await supabase
    .from("organisations")
    .select("ts_gap_threshold_hours, ts_max_shift_hours, ts_allocate_to")
    .eq("id", organisationId)
    .single();

  if (orgErr || !org) throw new Error(`Organisation ${organisationId} not found`);

  const config: OrgConfig = {
    ts_gap_threshold_hours: Number(org.ts_gap_threshold_hours),
    ts_max_shift_hours: Number(org.ts_max_shift_hours),
    ts_allocate_to: org.ts_allocate_to as "start" | "end",
  };

  // ── 2. Fetch clockings with buffer to catch midnight crossings ─────────────
  const bufferMs = config.ts_max_shift_hours * 3_600_000;
  const fetchStart = new Date(rangeStart.getTime() - bufferMs).toISOString();
  const fetchEnd = new Date(rangeEnd.getTime() + bufferMs).toISOString();

  const { data: rawClockings, error: clockErr } = await supabase
    .from("clockings")
    .select(
      "id, clocked_at, raw_type, inferred_type, is_bstart, type_locked, cost_centre_id, work_period_id"
    )
    .eq("organisation_id", organisationId)
    .eq("member_id", memberId)
    .eq("is_deleted", false)
    .gte("clocked_at", fetchStart)
    .lte("clocked_at", fetchEnd)
    .order("clocked_at");

  if (clockErr) throw clockErr;
  const clockings = (rawClockings ?? []) as Clocking[];
  if (clockings.length === 0) return { periodsCreated: 0, periodsUpdated: 0, conflicts: 0 };

  // ── 3. Fetch scheduled shifts in buffered date range ──────────────────────
  const bufferDays = Math.ceil(config.ts_max_shift_hours / 24) + 1;
  const shiftDateStart = new Date(rangeStart);
  shiftDateStart.setUTCDate(shiftDateStart.getUTCDate() - bufferDays);
  const shiftDateEnd = new Date(rangeEnd);
  shiftDateEnd.setUTCDate(shiftDateEnd.getUTCDate() + bufferDays);

  const { data: rawShifts } = await supabase
    .from("scheduled_shifts")
    .select(
      `id, schedule_date,
       shift_definition:shift_definitions(
         id, is_open_shift, planned_start, planned_end,
         crosses_midnight, break_type, breaks
       )`
    )
    .eq("organisation_id", organisationId)
    .eq("member_id", memberId)
    .gte("schedule_date", toDateStr(shiftDateStart))
    .lte("schedule_date", toDateStr(shiftDateEnd));

  const scheduledShifts = (rawShifts ?? []) as unknown as ScheduledShift[];

  // ── 4. Group clockings into work periods by gap ────────────────────────────
  const groups = groupByGap(clockings, config.ts_gap_threshold_hours);

  // ── 5. Process each group ─────────────────────────────────────────────────
  let periodsCreated = 0;
  let periodsUpdated = 0;
  let conflicts = 0;
  const now = new Date().toISOString();

  for (const group of groups) {
    const bStart = toDate(group[0].clocked_at);

    // Skip buffer-only groups entirely outside the requested range
    const lastClocking = toDate(group[group.length - 1].clocked_at);
    if (lastClocking < rangeStart || bStart > rangeEnd) continue;

    // Match to a scheduled shift (null = open/unscheduled)
    const matchedShift = matchScheduledShift(bStart, scheduledShifts, config.ts_max_shift_hours);

    // Infer types
    const inferred = inferTypesForPeriod(group, matchedShift, bStart, config.ts_max_shift_hours);

    // Find period_end = clocked_at of the last OUT result
    const outResults = inferred.filter((r) => r.inferred_type === "OUT");
    const lastOutId = outResults.length > 0 ? outResults[outResults.length - 1].id : null;
    const lastOut = lastOutId
      ? toDate(group.find((c) => c.id === lastOutId)!.clocked_at)
      : null;

    // Determine timesheet_date
    const allocateSource = config.ts_allocate_to === "end" && lastOut ? lastOut : bStart;
    const timesheetDate = toDateStr(allocateSource);

    const hasConflicts = inferred.some((r) => r.has_conflict);
    if (hasConflicts) conflicts++;

    // ── Upsert work_period (keyed on member_id + period_start) ──────────────
    const { data: existing } = await supabase
      .from("work_periods")
      .select("id")
      .eq("member_id", memberId)
      .eq("period_start", bStart.toISOString())
      .maybeSingle();

    let workPeriodId: string;

    if (existing) {
      await supabase
        .from("work_periods")
        .update({
          scheduled_shift_id: matchedShift?.id ?? null,
          period_end: lastOut?.toISOString() ?? null,
          timesheet_date: timesheetDate,
          has_conflicts: hasConflicts,
          inference_run_at: now,
        })
        .eq("id", existing.id);
      workPeriodId = existing.id;
      periodsUpdated++;
    } else {
      const { data: created, error: createErr } = await supabase
        .from("work_periods")
        .insert({
          organisation_id: organisationId,
          member_id: memberId,
          scheduled_shift_id: matchedShift?.id ?? null,
          period_start: bStart.toISOString(),
          period_end: lastOut?.toISOString() ?? null,
          timesheet_date: timesheetDate,
          has_conflicts: hasConflicts,
          inference_run_at: now,
        })
        .select("id")
        .single();
      if (createErr) throw createErr;
      workPeriodId = created!.id;
      periodsCreated++;
    }

    // ── Update each clocking ─────────────────────────────────────────────────
    for (const r of inferred) {
      const original = group.find((c) => c.id === r.id)!;

      if (original.type_locked) {
        // Only update work_period_id and is_bstart — never touch inferred_type
        if (original.work_period_id !== workPeriodId || original.is_bstart !== r.is_bstart) {
          await supabase
            .from("clockings")
            .update({ work_period_id: workPeriodId, is_bstart: r.is_bstart })
            .eq("id", r.id);
        }
        continue;
      }

      await supabase
        .from("clockings")
        .update({
          inferred_type: r.inferred_type,
          is_bstart: r.is_bstart,
          work_period_id: workPeriodId,
        })
        .eq("id", r.id);
    }
  }

  return { periodsCreated, periodsUpdated, conflicts };
}
