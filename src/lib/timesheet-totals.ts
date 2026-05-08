/**
 * Server-side helper for totalling clocked hours over a date range (CLE-175).
 *
 * Used by the Holiday Period compute chain so Earned periods derive their
 * allowance from actual worked hours rather than the previous stub of 0.
 *
 * Works by replicating the same path the per-week timesheet UI uses: fetch
 * work_periods in the range, fetch their clockings, build IN/OUT pairs via
 * `computePairs`, then sum `computeGrossHours` with the org's rounding
 * config applied. This deliberately matches what the admin sees on the
 * timesheet page so balances and the Worked column never disagree.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  computePairs,
  computeGrossHours,
  type ClockingData,
  type RoundingConfig,
} from "@/components/timesheet/timesheet-types";

type RawClocking = {
  id: string;
  work_period_id: string;
  clocked_at: string;
  raw_type: string | null;
  inferred_type: string | null;
  override_type: string | null;
  is_bstart: boolean;
  cost_centre_id: string | null;
  source: string | null;
  edited_clocked_at: string | null;
  edited_raw_type: string | null;
  edited_at: string | null;
};

/**
 * Sum total clocked hours for a member in [fromDate, toDate] inclusive,
 * applying the org's rounding config.
 */
export async function getMemberWorkedHoursInRange(
  supabase: SupabaseClient,
  memberId: string,
  orgId: string,
  fromDate: string,
  toDate: string,
): Promise<number> {
  // 1. Org rounding config
  const { data: org } = await supabase
    .from("organisations")
    .select(
      "ts_round_first_in_mins, ts_round_first_in_grace_mins, ts_round_break_out_mins, ts_round_break_out_grace_mins, ts_round_break_in_mins, ts_round_break_in_grace_mins, ts_round_last_out_mins, ts_round_last_out_grace_mins",
    )
    .eq("id", orgId)
    .single();

  const rounding: RoundingConfig = {
    firstInMins:        (org as { ts_round_first_in_mins?: number | null } | null)?.ts_round_first_in_mins        ?? null,
    firstInGraceMins:   (org as { ts_round_first_in_grace_mins?: number | null } | null)?.ts_round_first_in_grace_mins  ?? null,
    breakOutMins:       (org as { ts_round_break_out_mins?: number | null } | null)?.ts_round_break_out_mins       ?? null,
    breakOutGraceMins:  (org as { ts_round_break_out_grace_mins?: number | null } | null)?.ts_round_break_out_grace_mins ?? null,
    breakInMins:        (org as { ts_round_break_in_mins?: number | null } | null)?.ts_round_break_in_mins        ?? null,
    breakInGraceMins:   (org as { ts_round_break_in_grace_mins?: number | null } | null)?.ts_round_break_in_grace_mins  ?? null,
    lastOutMins:        (org as { ts_round_last_out_mins?: number | null } | null)?.ts_round_last_out_mins        ?? null,
    lastOutGraceMins:   (org as { ts_round_last_out_grace_mins?: number | null } | null)?.ts_round_last_out_grace_mins  ?? null,
  };

  // 2. Work periods in range
  const { data: rawPeriods } = await supabase
    .from("work_periods")
    .select("id")
    .eq("member_id", memberId)
    .eq("organisation_id", orgId)
    .gte("timesheet_date", fromDate)
    .lte("timesheet_date", toDate);

  const periodIds = (rawPeriods ?? []).map((p) => (p as { id: string }).id);
  if (periodIds.length === 0) return 0;

  // 3. Clockings for those periods
  const { data: rawClockings } = await supabase
    .from("clockings")
    .select(
      "id, work_period_id, clocked_at, raw_type, inferred_type, override_type, is_bstart, cost_centre_id, source, edited_clocked_at, edited_raw_type, edited_at",
    )
    .in("work_period_id", periodIds)
    .eq("is_deleted", false)
    .order("clocked_at");

  // 4. Group by work period, build pairs, sum hours
  const byPeriod = new Map<string, ClockingData[]>();
  for (const c of (rawClockings ?? []) as RawClocking[]) {
    const arr = byPeriod.get(c.work_period_id) ?? [];
    arr.push({
      id:              c.id,
      clockedAt:       c.clocked_at,
      rawType:         c.raw_type,
      inferredType:    c.inferred_type,
      overrideType:    c.override_type,
      isBstart:        c.is_bstart,
      costCentreId:    c.cost_centre_id,
      source:          c.source,
      editedClockedAt: c.edited_clocked_at,
      editedRawType:   c.edited_raw_type,
      editedByName:    null,
      editedAt:        c.edited_at,
    });
    byPeriod.set(c.work_period_id, arr);
  }

  let total = 0;
  for (const clockings of byPeriod.values()) {
    const pairs = computePairs(clockings);
    total += computeGrossHours(pairs, rounding);
  }
  return total;
}
