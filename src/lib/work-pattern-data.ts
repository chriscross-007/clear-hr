/**
 * Shared data fetchers for working-day calculations:
 * - The employee's Work Profile (per-day-of-week hours).
 * - The org's bank holidays in a date range.
 * - The org's bank-holiday handling setting.
 *
 * Used by:
 * - `holiday-booking-actions.ts` for live booking validation / `days_deducted`
 *   calculation.
 * - `holiday-period-compute.ts` (via the calling page / action) for per-period
 *   deduction splitting under CLE-173.
 *
 * Each helper accepts any Supabase client (caller's session client or the
 * admin client) — the caller picks based on their auth context.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { WorkPatternHours, WorkPatternAssignment } from "@/lib/day-counting";

/**
 * Resolve the active Work Profile for an employee on a given date.
 * Falls back to the org's default Work Profile if no employee-specific
 * assignment exists. Returns `null` if neither resolves — the caller can
 * then fall back to a sensible default (e.g. `DEFAULT_PATTERN`).
 */
export async function getMemberWorkPattern(
  supabase: SupabaseClient,
  memberId: string,
  orgId: string,
  asOfDate: string,
): Promise<WorkPatternHours | null> {
  // 1. Employee-specific assignment effective on or before asOfDate
  const { data: assignment } = await supabase
    .from("employee_work_profiles")
    .select("work_profile_id")
    .eq("member_id", memberId)
    .lte("effective_from", asOfDate)
    .order("effective_from", { ascending: false })
    .limit(1)
    .single();

  let resolvedId: string | undefined = assignment?.work_profile_id;

  // 2. Fall back to org default
  if (!resolvedId) {
    const { data: org } = await supabase
      .from("organisations")
      .select("default_work_profile_id")
      .eq("id", orgId)
      .single();
    resolvedId = org?.default_work_profile_id ?? undefined;
  }

  if (!resolvedId) return null;

  const { data: wp } = await supabase
    .from("work_profiles")
    .select(
      "hours_monday, hours_tuesday, hours_wednesday, hours_thursday, hours_friday, hours_saturday, hours_sunday",
    )
    .eq("id", resolvedId)
    .single();

  return (wp as WorkPatternHours | null) ?? null;
}

/**
 * Fetch the set of bank-holiday ISO dates active for the org in a range.
 * Honours `bank_holidays.organisation_id IS NULL` (national) plus the
 * org's `is_excluded` overrides.
 */
export async function getBankHolidaysForOrg(
  supabase: SupabaseClient,
  orgId: string,
  startDate: string,
  endDate: string,
): Promise<Set<string>> {
  const { data: org } = await supabase
    .from("organisations")
    .select("country_code")
    .eq("id", orgId)
    .single();
  const countryCode = (org as { country_code?: string } | null)?.country_code
    ?? "england-and-wales";

  const { data } = await supabase
    .from("bank_holidays")
    .select("date, is_excluded, organisation_id")
    .eq("country_code", countryCode)
    .gte("date", startDate)
    .lte("date", endDate)
    .or(`organisation_id.is.null,organisation_id.eq.${orgId}`);

  const holidays = new Set<string>();
  const excluded = new Set<string>();

  for (const bh of (data ?? []) as Array<{ date: string; is_excluded: boolean; organisation_id: string | null }>) {
    if (bh.organisation_id && bh.is_excluded) {
      excluded.add(bh.date);
    } else {
      holidays.add(bh.date);
    }
  }
  for (const d of excluded) holidays.delete(d);

  return holidays;
}

/**
 * Fetch the full Work Profile history for an employee (CLE-173 follow-up).
 * Returns every employee_work_profiles assignment plus a pre-history entry
 * for the org's default profile so that `patternForDate` can always resolve
 * (or return null if no default exists either).
 *
 * Sorted by `effectiveFrom` ascending. Caller pairs this with
 * `patternForDate(history, iso)` to look up the pattern that applies on
 * any given date — including future-dated assignments.
 */
export async function getMemberWorkPatternHistory(
  supabase: SupabaseClient,
  memberId: string,
  orgId: string,
): Promise<WorkPatternAssignment[]> {
  const out: WorkPatternAssignment[] = [];

  // 1. Org default (pre-history fallback so any date resolves).
  const { data: org } = await supabase
    .from("organisations")
    .select("default_work_profile_id")
    .eq("id", orgId)
    .single();
  const defaultId = (org as { default_work_profile_id?: string | null } | null)?.default_work_profile_id;
  if (defaultId) {
    const { data: defWp } = await supabase
      .from("work_profiles")
      .select(
        "hours_monday, hours_tuesday, hours_wednesday, hours_thursday, hours_friday, hours_saturday, hours_sunday",
      )
      .eq("id", defaultId)
      .single();
    if (defWp) {
      out.push({ effectiveFrom: "0001-01-01", pattern: defWp as WorkPatternHours });
    }
  }

  // 2. Employee-specific assignments. Inner-join on work_profiles so we can
  //    read the hours in the same query.
  const { data: assignments } = await supabase
    .from("employee_work_profiles")
    .select(
      "effective_from, work_profile:work_profiles!inner(hours_monday, hours_tuesday, hours_wednesday, hours_thursday, hours_friday, hours_saturday, hours_sunday)",
    )
    .eq("member_id", memberId)
    .order("effective_from", { ascending: true });

  // Supabase types `work_profile` as an array because of the `!inner` join,
  // even though the FK guarantees one row. Cast through unknown to flatten.
  for (const row of (assignments ?? []) as unknown as Array<{
    effective_from: string;
    work_profile: WorkPatternHours | WorkPatternHours[] | null;
  }>) {
    const wp = Array.isArray(row.work_profile) ? row.work_profile[0] ?? null : row.work_profile;
    if (wp) {
      out.push({
        effectiveFrom: row.effective_from,
        pattern: wp,
      });
    }
  }

  return out;
}

/**
 * Get the org's bank-holiday handling setting.
 *  - `'additional'` — bank holidays are free (skipped during deduction).
 *  - `'deducted'`   — bank holidays count as normal working days.
 */
export async function getBankHolidayHandling(
  supabase: SupabaseClient,
  orgId: string,
): Promise<string> {
  const { data } = await supabase
    .from("organisations")
    .select("bank_holiday_handling")
    .eq("id", orgId)
    .single();
  return (data as { bank_holiday_handling?: string } | null)?.bank_holiday_handling
    ?? "additional";
}
