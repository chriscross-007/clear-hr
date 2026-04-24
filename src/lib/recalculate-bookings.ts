import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import { countWorkingDays, type WorkPatternHours } from "@/lib/day-counting";

// All helpers accept any Supabase client variant (SSR session or admin).
type AnyClient = SupabaseClient;

function getAdminClient(): AnyClient {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } },
  );
}

// ---------------------------------------------------------------------------
// Helpers — mirrors the resolution logic in holiday-booking-actions.ts.
// Kept local so this module has no circular dependency on the server actions
// file (which is "use server"). Same semantics, same data sources.
// ---------------------------------------------------------------------------

async function resolveWorkPattern(
  client: AnyClient,
  memberId: string,
  orgId: string,
  bookingStartDate: string,
): Promise<WorkPatternHours | null> {
  const { data: assignment } = await client
    .from("employee_work_profiles")
    .select("work_profile_id")
    .eq("member_id", memberId)
    .lte("effective_from", bookingStartDate)
    .order("effective_from", { ascending: false })
    .limit(1)
    .maybeSingle();

  let resolvedId: string | null = assignment?.work_profile_id ?? null;
  if (!resolvedId) {
    const { data: org } = await client
      .from("organisations")
      .select("default_work_profile_id")
      .eq("id", orgId)
      .single();
    resolvedId = org?.default_work_profile_id ?? null;
  }
  if (!resolvedId) return null;

  const { data: wp } = await client
    .from("work_profiles")
    .select("hours_monday, hours_tuesday, hours_wednesday, hours_thursday, hours_friday, hours_saturday, hours_sunday")
    .eq("id", resolvedId)
    .single();

  return wp as WorkPatternHours | null;
}

async function fetchBankHolidays(
  client: AnyClient,
  orgId: string,
  startDate: string,
  endDate: string,
): Promise<Set<string>> {
  const { data: org } = await client
    .from("organisations")
    .select("country_code")
    .eq("id", orgId)
    .single();
  const countryCode = org?.country_code ?? "england-and-wales";

  const { data } = await client
    .from("bank_holidays")
    .select("date, is_excluded, organisation_id")
    .eq("country_code", countryCode)
    .gte("date", startDate)
    .lte("date", endDate)
    .or(`organisation_id.is.null,organisation_id.eq.${orgId}`);

  const holidays = new Set<string>();
  const excluded = new Set<string>();
  for (const bh of data ?? []) {
    if (bh.organisation_id && bh.is_excluded) excluded.add(bh.date);
    else holidays.add(bh.date);
  }
  for (const d of excluded) holidays.delete(d);
  return holidays;
}

async function getOrgBankHolidayHandling(client: AnyClient, orgId: string): Promise<string> {
  const { data } = await client
    .from("organisations")
    .select("bank_holiday_handling")
    .eq("id", orgId)
    .single();
  return data?.bank_holiday_handling ?? "additional";
}

// ---------------------------------------------------------------------------
// Booking discovery — used by the trigger callers to gather IDs to recalc.
// ---------------------------------------------------------------------------

/** Active bookings for a single member ending on/after `fromDate`. */
export async function findBookingIdsForMemberFromDate(
  memberId: string,
  fromDate: string,
): Promise<string[]> {
  const admin = getAdminClient();
  const { data } = await admin
    .from("holiday_bookings")
    .select("id")
    .eq("member_id", memberId)
    .in("status", ["pending", "approved"])
    .gte("end_date", fromDate);
  return (data ?? []).map((r) => r.id as string);
}

/**
 * Active bookings for org members who have NO employee_work_profiles row
 * (i.e. they fall back to the org default work profile).
 * Limited to bookings ending today or later — historical bookings aren't
 * worth touching for an org-default change.
 */
export async function findBookingIdsForOrgFallback(orgId: string): Promise<string[]> {
  const admin = getAdminClient();

  const { data: assigned } = await admin
    .from("employee_work_profiles")
    .select("member_id");
  const assignedSet = new Set<string>((assigned ?? []).map((r) => r.member_id as string));

  const { data: orgMembers } = await admin
    .from("members")
    .select("id")
    .eq("organisation_id", orgId);
  const fallbackMembers = (orgMembers ?? [])
    .map((m) => m.id as string)
    .filter((id) => !assignedSet.has(id));
  if (fallbackMembers.length === 0) return [];

  const today = new Date().toISOString().slice(0, 10);
  const { data: bookings } = await admin
    .from("holiday_bookings")
    .select("id")
    .eq("organisation_id", orgId)
    .in("member_id", fallbackMembers)
    .in("status", ["pending", "approved"])
    .gte("end_date", today);
  return (bookings ?? []).map((r) => r.id as string);
}

/**
 * Active bookings in the given orgs whose date range covers any of the supplied dates.
 * Used after bank holidays are inserted/changed.
 */
export async function findBookingIdsOverlappingDates(
  orgIds: string[],
  dates: string[],
): Promise<string[]> {
  if (orgIds.length === 0 || dates.length === 0) return [];
  const minDate = dates.reduce((a, b) => (a < b ? a : b));
  const maxDate = dates.reduce((a, b) => (a > b ? a : b));

  const admin = getAdminClient();
  const { data } = await admin
    .from("holiday_bookings")
    .select("id, start_date, end_date")
    .in("organisation_id", orgIds)
    .in("status", ["pending", "approved"])
    .lte("start_date", maxDate)
    .gte("end_date", minDate);

  const dateSet = new Set(dates);
  const ids: string[] = [];
  for (const b of data ?? []) {
    const start = new Date((b.start_date as string) + "T00:00:00Z");
    const end = new Date((b.end_date as string) + "T00:00:00Z");
    const d = new Date(start);
    while (d <= end) {
      if (dateSet.has(d.toISOString().slice(0, 10))) {
        ids.push(b.id as string);
        break;
      }
      d.setUTCDate(d.getUTCDate() + 1);
    }
  }
  return ids;
}

/** Org IDs that share a country_code (used after a global bank-holiday seed). */
export async function findOrgIdsByCountryCode(countryCode: string): Promise<string[]> {
  const admin = getAdminClient();
  const { data } = await admin
    .from("organisations")
    .select("id")
    .eq("country_code", countryCode);
  return (data ?? []).map((r) => r.id as string);
}

// ---------------------------------------------------------------------------
// Public entry point — recalculate days_deducted for a list of bookings.
// ---------------------------------------------------------------------------

export type RecalcResult = {
  updated: number;
  unchanged: number;
  skipped: number;
  errors: number;
};

/**
 * Recalculate days_deducted for the given bookings using current work pattern
 * and bank holiday data. Only writes when the value actually changes.
 *
 * Skips:
 *  - Bookings with status other than 'pending' or 'approved'
 *  - Bookings in hours mode (days_deducted is null)
 *
 * Never throws — errors are logged and counted. Always uses the admin client
 * so cross-user reads/writes succeed regardless of the original caller's RLS.
 */
export async function recalculateBookingDays(bookingIds: string[]): Promise<RecalcResult> {
  const result: RecalcResult = { updated: 0, unchanged: 0, skipped: 0, errors: 0 };
  if (bookingIds.length === 0) return result;

  const admin = getAdminClient();

  for (const bookingId of bookingIds) {
    try {
      const { data: booking } = await admin
        .from("holiday_bookings")
        .select("id, member_id, organisation_id, start_date, end_date, start_half, end_half, days_deducted, status")
        .eq("id", bookingId)
        .single();

      if (!booking) {
        result.errors++;
        continue;
      }
      if (booking.status !== "pending" && booking.status !== "approved") {
        result.skipped++;
        continue;
      }
      if (booking.days_deducted === null) {
        result.skipped++; // hours mode — leave alone
        continue;
      }

      const [pattern, bankHolidays, handling] = await Promise.all([
        resolveWorkPattern(admin, booking.member_id, booking.organisation_id, booking.start_date),
        fetchBankHolidays(admin, booking.organisation_id, booking.start_date, booking.end_date),
        getOrgBankHolidayHandling(admin, booking.organisation_id),
      ]);

      const newValue = countWorkingDays(
        booking.start_date,
        booking.end_date,
        !!booking.start_half,
        !!booking.end_half,
        pattern,
        bankHolidays,
        handling,
      );

      const oldValue = Number(booking.days_deducted);
      if (newValue === oldValue) {
        result.unchanged++;
        continue;
      }

      const { error: updateError } = await admin
        .from("holiday_bookings")
        .update({ days_deducted: newValue })
        .eq("id", bookingId);

      if (updateError) {
        console.error(`[recalc] update failed for booking ${bookingId}: ${updateError.message}`);
        result.errors++;
      } else {
        console.log(`[recalc] booking ${bookingId}: days_deducted ${oldValue} -> ${newValue}`);
        result.updated++;
      }
    } catch (e) {
      console.error(`[recalc] exception for booking ${bookingId}:`, e instanceof Error ? e.message : e);
      result.errors++;
    }
  }

  return result;
}
