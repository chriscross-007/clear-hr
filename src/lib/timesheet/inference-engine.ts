/**
 * Timesheet Inference Engine (v2)
 *
 * Processes raw clockings for one member over a date range using a single
 * forward pass. Each clocking's inferred type is determined by a rule table
 * (see inference-rules.md) based on:
 *
 *   D — open bStart within MaxShiftLength hours
 *   B — inside ShiftStartVariance band around planned shift start
 *   C — next clocking within MaxBreakLength minutes
 *   E — previous clocking within MaxBreakLength minutes
 *
 * Rules are applied top-to-bottom; the first match wins.
 *
 * If a clocking has override_type set by a manager, it is used as-is and
 * inference is skipped for that clocking (but it still influences D/prev for
 * subsequent clockings).
 *
 * Work periods are derived from bStart/bEnd pairs after the forward pass.
 * clocked_at is IMMUTABLE — this engine never modifies it.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

// ── Internal types ────────────────────────────────────────────────────────────

interface OrgConfig {
  ts_max_shift_hours:              number;
  ts_max_break_minutes:            number;
  ts_shift_start_variance_minutes: number;
  ts_allocate_to:                  "start" | "end";
}

interface Clocking {
  id:             string;
  clocked_at:     string;        // ISO timestamptz — NEVER modified
  raw_type:       string | null; // 'IN' | 'OUT' | 'BreakIN' | 'BreakOUT' | 'CC' | null
  inferred_type:  string | null;
  override_type:  string | null; // manager override; when set, skips inference
  is_bstart:      boolean;
  cost_centre_id: string | null;
  work_period_id: string | null;
}

interface ShiftInfo {
  scheduledShiftId:    string;
  plannedStartDatetime: Date | null;
}

interface ForwardPassResult {
  id:            string;
  inferredType:  string;  // engine-computed (written to inferred_type in DB)
  effectiveType: string;  // override_type ?? inferredType (used for period logic)
  isBstart:      boolean;
  hasConflict:   boolean;
}

// ── Exported result type ──────────────────────────────────────────────────────

export interface InferenceResult {
  periodsCreated: number;
  periodsUpdated: number;
  conflicts:      number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function toDate(iso: string): Date { return new Date(iso); }

function minutesApart(a: Date, b: Date): number {
  return Math.abs(a.getTime() - b.getTime()) / 60_000;
}

function hoursApart(a: Date, b: Date): number {
  return Math.abs(a.getTime() - b.getTime()) / 3_600_000;
}

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Parse "HH:MM" or "HH:MM:SS" onto a UTC base date */
function timeOnDate(baseDate: Date, timeStr: string): Date {
  const [h, m, s] = timeStr.split(":").map(Number);
  const d = new Date(baseDate);
  d.setUTCHours(h, m, s ?? 0, 0);
  return d;
}

// ── Rule application ──────────────────────────────────────────────────────────

/**
 * Apply inference rules to a single clocking.
 * Rules are applied top-to-bottom; first match wins.
 * See inference-rules.md for the full rule table.
 *
 * @param rawType   Terminal type: 'IN' | 'OUT' | 'BreakIN' | 'BreakOUT' | null
 * @param prev      Effective type of the most recent non-CC clocking, or null
 * @param D         Open bStart exists within MaxShiftLength hours
 * @param B         Inside ShiftStartVariance band around planned shift start
 * @param C         Next clocking is within MaxBreakLength minutes
 * @param E         Previous clocking is within MaxBreakLength minutes
 */
function applyRules(
  rawType: string | null,
  prev:    string | null,
  D: boolean,
  B: boolean,
  C: boolean,
  E: boolean,
): string {
  switch (rawType) {
    // ── Raw = IN ──────────────────────────────────────────────────────────────
    case "IN":
      if (prev !== "bStart" && B) return "bStart";      // IN-1
      if (!D)                     return "bStart";      // IN-2
      if (prev === "BreakOut")    return "BreakIn";     // IN-3
      /* prev !== "BreakOut" && D */
      return "INambiguous";                             // IN-4

    // ── Raw = OUT ─────────────────────────────────────────────────────────────
    case "OUT":
      if (!D)                                              return "OUTambiguous"; // OUT-1
      if ((prev === "bStart" || prev === "BreakIn") && C)  return "BreakOut";    // OUT-2
      if ((prev === "bStart" || prev === "BreakIn") && !C) return "bEnd";        // OUT-3
      // OUT-4: prev=BreakOut && !D → OUTambiguous  (subsumed by OUT-1 above)
      if (prev === "BreakOut" && !C)                       return "bEnd";        // OUT-5
      if (prev === "BreakOut" &&  C)                       return "BreakOut";    // OUT-6
      if (prev === "INambiguous")                          return "INambiguous"; // OUT-7
      if (prev === "OUTambiguous")                         return "OUTambiguous";// OUT-8
      return "OUTambiguous"; // fallback

    // ── Raw = BreakIN ─────────────────────────────────────────────────────────
    case "BreakIN":
      return D ? "BreakIn" : "bStart"; // BreakIN-1 / BreakIN-2

    // ── Raw = BreakOUT ────────────────────────────────────────────────────────
    case "BreakOUT":
      return D ? "BreakOut" : "OUTambiguous"; // BreakOUT-1 / BreakOUT-2

    // ── Raw = null (bare swipe) ───────────────────────────────────────────────
    default:
      if (!D)                                      return "bStart";       // null-1
      if (prev === "BreakOut" && !E)               return "bStart";       // null-2
      if (prev !== "bStart" && B)                  return "bStart";       // null-3
      if (prev === "BreakOut" && E)                return "BreakIn";      // null-4
      if ((prev === "bStart" || prev === "BreakIn") && C) return "BreakOut"; // null-5
      if (prev === "bStart" && !C)                 return "bEnd";         // null-6
      if (prev === "BreakIn" && !B && !C)          return "bEnd";         // null-7
      if (prev === "BreakIn" && !B && C)           return "BreakOut";     // null-8 (redundant with null-5)
      if (prev === "INambiguous" && !B)            return "OUTambiguous"; // null-9
      if (prev === "OUTambiguous" && !B)           return "INambiguous";  // null-10
      return "INambiguous"; // fallback
  }
}

// ── Forward pass ──────────────────────────────────────────────────────────────

function runForwardPass(
  clockings:   Clocking[],       // sorted by clocked_at ascending
  shiftByDate: Map<string, ShiftInfo>,
  config:      OrgConfig,
): ForwardPassResult[] {
  const results: ForwardPassResult[] = [];
  let openBStart: Clocking | null = null;

  for (let i = 0; i < clockings.length; i++) {
    const c = clockings[i];
    const clockedAt = toDate(c.clocked_at);

    // ── Manager override: use as-is, skip inference ──────────────────────────
    if (c.override_type) {
      const effective = c.override_type;
      results.push({
        id:            c.id,
        inferredType:  c.inferred_type ?? effective, // keep last engine value
        effectiveType: effective,
        isBstart:      effective === "bStart",
        hasConflict:   effective === "INambiguous" || effective === "OUTambiguous",
      });
      if (effective === "bStart") openBStart = c;
      else if (effective === "bEnd") openBStart = null;
      continue;
    }

    // ── CC clockings: always CC, don't affect shift state ────────────────────
    if (c.raw_type === "CC" || c.cost_centre_id) {
      results.push({ id: c.id, inferredType: "CC", effectiveType: "CC", isBstart: false, hasConflict: false });
      continue;
    }

    // ── Compute conditions ────────────────────────────────────────────────────

    // D: open shift within MaxShiftLength
    const D = openBStart != null &&
      (clockedAt.getTime() - toDate(openBStart.clocked_at).getTime()) / 3_600_000
        < config.ts_max_shift_hours;

    // B: inside ShiftStartVariance band
    const dateStr  = toDateStr(clockedAt);
    const shiftInfo = shiftByDate.get(dateStr);
    const B = shiftInfo?.plannedStartDatetime != null &&
      minutesApart(clockedAt, shiftInfo.plannedStartDatetime) <= config.ts_shift_start_variance_minutes;

    // C: next clocking within MaxBreakLength minutes
    const nextClocking = clockings[i + 1];
    const C = nextClocking != null &&
      (toDate(nextClocking.clocked_at).getTime() - clockedAt.getTime()) / 60_000
        <= config.ts_max_break_minutes;

    // E: previous clocking within MaxBreakLength minutes
    const prevClocking = clockings[i - 1];
    const E = prevClocking != null &&
      (clockedAt.getTime() - toDate(prevClocking.clocked_at).getTime()) / 60_000
        <= config.ts_max_break_minutes;

    // prev: effective type of the most recent non-CC result
    let prev: string | null = null;
    for (let j = results.length - 1; j >= 0; j--) {
      if (results[j].effectiveType !== "CC") {
        prev = results[j].effectiveType;
        break;
      }
    }

    // ── Apply rules ───────────────────────────────────────────────────────────
    const inferredType = applyRules(c.raw_type, prev, D, B, C, E);
    const hasConflict  = inferredType === "INambiguous" || inferredType === "OUTambiguous";

    results.push({ id: c.id, inferredType, effectiveType: inferredType, isBstart: inferredType === "bStart", hasConflict });

    if (inferredType === "bStart") openBStart = c;
    else if (inferredType === "bEnd") openBStart = null;
  }

  return results;
}

// ── Work period grouping ──────────────────────────────────────────────────────

interface PeriodAcc {
  bStartClocking:  Clocking;
  bEndClocking:    Clocking | null;
  clockingIds:     string[];
  hasConflicts:    boolean;
  lastClockingAt:  Date;
}

function groupIntoPeriods(
  clockings:  Clocking[],
  results:    ForwardPassResult[],
): PeriodAcc[] {
  const resultById = new Map(results.map((r) => [r.id, r]));
  const periods: PeriodAcc[] = [];
  let current: PeriodAcc | null = null;

  for (const c of clockings) {
    const r = resultById.get(c.id)!;
    const t = r.effectiveType;

    if (t === "bStart") {
      if (current) periods.push(current); // close unclosed period
      current = {
        bStartClocking: c,
        bEndClocking:   null,
        clockingIds:    [c.id],
        hasConflicts:   r.hasConflict,
        lastClockingAt: toDate(c.clocked_at),
      };
    } else if (t === "bEnd" && current) {
      current.bEndClocking  = c;
      current.clockingIds.push(c.id);
      current.hasConflicts   = current.hasConflicts || r.hasConflict;
      current.lastClockingAt = toDate(c.clocked_at);
      periods.push(current);
      current = null;
    } else if (current) {
      current.clockingIds.push(c.id);
      current.hasConflicts   = current.hasConflicts || r.hasConflict;
      current.lastClockingAt = toDate(c.clocked_at);
    }
    // else: orphan clocking (no open period) — work_period_id cleared below
  }

  if (current) periods.push(current); // unclosed period (employee still clocked in)
  return periods;
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Run the inference engine for one member over a date range.
 * @param supabase Should be a service-role client (bypasses RLS).
 */
export async function runInference(params: {
  supabase:       SupabaseClient;
  organisationId: string;
  memberId:       string;
  rangeStart:     Date;
  rangeEnd:       Date;
}): Promise<InferenceResult> {
  const { supabase, organisationId, memberId, rangeStart, rangeEnd } = params;

  // ── 1. Fetch org config ────────────────────────────────────────────────────
  const { data: org, error: orgErr } = await supabase
    .from("organisations")
    .select("ts_max_shift_hours, ts_max_break_minutes, ts_shift_start_variance_minutes, ts_allocate_to")
    .eq("id", organisationId)
    .single();

  if (orgErr || !org) throw new Error(`Organisation ${organisationId} not found`);

  const config: OrgConfig = {
    ts_max_shift_hours:              Number(org.ts_max_shift_hours),
    ts_max_break_minutes:            Number(org.ts_max_break_minutes ?? 60),
    ts_shift_start_variance_minutes: Number(org.ts_shift_start_variance_minutes ?? 30),
    ts_allocate_to:                  (org.ts_allocate_to ?? "start") as "start" | "end",
  };

  // ── 2. Fetch clockings with buffer ─────────────────────────────────────────
  const bufferMs   = config.ts_max_shift_hours * 3_600_000;
  const fetchStart = new Date(rangeStart.getTime() - bufferMs).toISOString();
  const fetchEnd   = new Date(rangeEnd.getTime()   + bufferMs).toISOString();

  const { data: rawClockings, error: clockErr } = await supabase
    .from("clockings")
    .select("id, clocked_at, raw_type, inferred_type, override_type, is_bstart, cost_centre_id, work_period_id")
    .eq("organisation_id", organisationId)
    .eq("member_id", memberId)
    .eq("is_deleted", false)
    .gte("clocked_at", fetchStart)
    .lte("clocked_at", fetchEnd)
    .order("clocked_at");

  if (clockErr) throw clockErr;
  const clockings = (rawClockings ?? []) as Clocking[];

  if (clockings.length === 0) {
    await supabase
      .from("work_periods")
      .delete()
      .eq("member_id", memberId)
      .eq("organisation_id", organisationId)
      .gte("period_start", rangeStart.toISOString())
      .lte("period_start", rangeEnd.toISOString());
    return { periodsCreated: 0, periodsUpdated: 0, conflicts: 0 };
  }

  // ── 3. Fetch scheduled shifts → build shiftByDate map ─────────────────────
  const bufferDays    = Math.ceil(config.ts_max_shift_hours / 24) + 1;
  const shiftFetchStart = new Date(rangeStart);
  shiftFetchStart.setUTCDate(shiftFetchStart.getUTCDate() - bufferDays);
  const shiftFetchEnd = new Date(rangeEnd);
  shiftFetchEnd.setUTCDate(shiftFetchEnd.getUTCDate() + bufferDays);

  const { data: rawShifts } = await supabase
    .from("scheduled_shifts")
    .select(
      `id, schedule_date, is_off_day,
       shift_definition:shift_definitions(id, planned_start, is_open_shift)`
    )
    .eq("organisation_id", organisationId)
    .eq("member_id", memberId)
    .eq("is_off_day", false)
    .gte("schedule_date", toDateStr(shiftFetchStart))
    .lte("schedule_date", toDateStr(shiftFetchEnd));

  // Build Map<dateStr, ShiftInfo>
  const shiftByDate = new Map<string, ShiftInfo>();
  for (const ss of (rawShifts ?? []) as unknown as Array<{
    id: string;
    schedule_date: string;
    shift_definition: { planned_start: string | null; is_open_shift: boolean } | null;
  }>) {
    const def = ss.shift_definition;
    if (!def || def.is_open_shift || !def.planned_start) {
      shiftByDate.set(ss.schedule_date, { scheduledShiftId: ss.id, plannedStartDatetime: null });
      continue;
    }
    // Compute planned start as a UTC datetime on the schedule date
    const baseDate = toDate(`${ss.schedule_date}T00:00:00Z`);
    const plannedStartDatetime = timeOnDate(baseDate, def.planned_start);
    shiftByDate.set(ss.schedule_date, { scheduledShiftId: ss.id, plannedStartDatetime });
  }

  // ── 4. Forward pass: assign inferred types ─────────────────────────────────
  const results = runForwardPass(clockings, shiftByDate, config);
  const resultById = new Map(results.map((r) => [r.id, r]));

  // ── 5. Group into work periods from bStart/bEnd pairs ─────────────────────
  const periods = groupIntoPeriods(clockings, results);

  // ── 6. Upsert work periods and update clockings ────────────────────────────
  let periodsCreated = 0;
  let periodsUpdated = 0;
  let conflicts      = 0;
  const now = new Date().toISOString();
  const writtenPeriodIds = new Set<string>();

  // Track which clockings were assigned to a work period
  const clockingPeriodMap = new Map<string, string>(); // clocking id → work period id

  for (const period of periods) {
    const bStart = toDate(period.bStartClocking.clocked_at);

    // Skip periods entirely outside the requested range
    if (period.lastClockingAt < rangeStart || bStart > rangeEnd) continue;

    // Determine period_end and timesheet_date
    const bEnd = period.bEndClocking ? toDate(period.bEndClocking.clocked_at) : null;
    const allocateSource = config.ts_allocate_to === "end" && bEnd ? bEnd : bStart;
    const timesheetDate = toDateStr(allocateSource);

    if (period.hasConflicts) conflicts++;

    // Look up scheduled shift for this period's start date
    const scheduledShiftId = shiftByDate.get(toDateStr(bStart))?.scheduledShiftId ?? null;

    // Upsert work_period (keyed on member_id + period_start)
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
          scheduled_shift_id: scheduledShiftId,
          period_end:         bEnd?.toISOString() ?? null,
          timesheet_date:     timesheetDate,
          has_conflicts:      period.hasConflicts,
          inference_run_at:   now,
        })
        .eq("id", existing.id);
      workPeriodId = existing.id;
      periodsUpdated++;
    } else {
      const { data: created, error: createErr } = await supabase
        .from("work_periods")
        .insert({
          organisation_id:    organisationId,
          member_id:          memberId,
          scheduled_shift_id: scheduledShiftId,
          period_start:       bStart.toISOString(),
          period_end:         bEnd?.toISOString() ?? null,
          timesheet_date:     timesheetDate,
          has_conflicts:      period.hasConflicts,
          inference_run_at:   now,
        })
        .select("id")
        .single();
      if (createErr) throw createErr;
      workPeriodId = created!.id;
      periodsCreated++;
    }

    writtenPeriodIds.add(workPeriodId);

    for (const clockingId of period.clockingIds) {
      clockingPeriodMap.set(clockingId, workPeriodId);
    }
  }

  // ── 7. Update each clocking in the range ──────────────────────────────────
  // Update inferred_type, is_bstart, work_period_id for all clockings
  // in the requested range (not just those in written periods).
  const rangeClockings = clockings.filter(
    (c) => c.clocked_at >= rangeStart.toISOString() && c.clocked_at <= rangeEnd.toISOString()
  );

  for (const c of rangeClockings) {
    const r = resultById.get(c.id);
    if (!r) continue;

    const workPeriodId = clockingPeriodMap.get(c.id) ?? null;

    // Skip update if nothing changed (optimise DB writes)
    const typeChanged     = !c.override_type && r.inferredType !== c.inferred_type;
    const bstartChanged   = r.isBstart !== c.is_bstart;
    const periodChanged   = workPeriodId !== c.work_period_id;

    if (!typeChanged && !bstartChanged && !periodChanged) continue;

    const updatePayload: Record<string, unknown> = {
      is_bstart:      r.isBstart,
      work_period_id: workPeriodId,
    };

    // Never overwrite inferred_type when the clocking has a manager override
    if (!c.override_type) {
      updatePayload.inferred_type = r.inferredType;
    }

    await supabase.from("clockings").update(updatePayload).eq("id", c.id);
  }

  // ── 8. Delete orphaned work periods ───────────────────────────────────────
  const deleteQuery = supabase
    .from("work_periods")
    .delete()
    .eq("member_id", memberId)
    .eq("organisation_id", organisationId)
    .gte("period_start", rangeStart.toISOString())
    .lte("period_start", rangeEnd.toISOString());

  if (writtenPeriodIds.size > 0) {
    await deleteQuery.not("id", "in", `(${[...writtenPeriodIds].join(",")})`);
  } else {
    await deleteQuery;
  }

  return { periodsCreated, periodsUpdated, conflicts };
}
