"use server";

import { createClient } from "@/lib/supabase/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { headers } from "next/headers";
import { countWorkingDays, patternForDate, type WorkPatternHours } from "@/lib/day-counting";
import {
  getMemberWorkPatternHistory,
  getBankHolidaysForOrg,
  getBankHolidayHandling,
} from "@/lib/work-pattern-data";
import { calculateEntitlement } from "@/lib/entitlement";
import { sendRequestPendingEmail, sendBookingConfirmedEmail } from "@/lib/email";
import { logAudit, diffChanges } from "@/lib/audit";
import {
  resolveProfileForBooking,
  getUnavailableMemberIds,
  type ApprovalProfileLevel,
} from "@/app/(dashboard)/approval-profile-actions";

function getAdminClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }
  );
}

/** Filter approval profile levels to those whose length threshold matches the
 *  booking, using the booking's unit (days vs hours). NULL thresholds mean
 *  "always required". Used by submitHolidayBooking for routing. */
function pickApplicableLevels(
  levels: ApprovalProfileLevel[],
  daysDeducted: number | null,
  hoursDeducted: number | null,
): ApprovalProfileLevel[] {
  const useDays = daysDeducted !== null;
  const value = useDays ? (daysDeducted ?? 0) : (hoursDeducted ?? 0);
  return levels
    .filter((l) => {
      if (useDays) {
        return l.lengthThresholdDays === null || value >= l.lengthThresholdDays;
      }
      return l.lengthThresholdHours === null || value >= l.lengthThresholdHours;
    })
    .sort((a, b) => a.level - b.level);
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type HolidayBookingRow = {
  id: string;
  leave_reason_id: string;
  start_date: string;
  end_date: string | null;
  start_half: string | null;
  end_half: string | null;
  days_deducted: number | null;
  hours_deducted: number | null;
  status: string;
  approver_note: string | null;
  approver_name: string | null;
  employee_note: string | null;
  created_at: string;
  reason_name: string;
  reason_colour: string;
};

export type BalanceSummary = {
  entitlement: number;
  carriedOver: number;
  pending: number;
  booked: number;
  taken: number;
  remaining: number;
  carryOverProjected: number;
  unit: string;
  yearStart: string;
  yearEnd: string;
};

export type AbsenceReasonOption = {
  id: string;
  name: string;
  colour: string;
  is_deprecated: boolean;
  absence_type_id: string;
  absence_type_name: string;
  requires_approval: boolean;
};

type SubmitBookingInput = {
  leaveReasonId: string;
  startDate: string;
  endDate: string;
  startHalf: string | null;
  endHalf: string | null;
  daysDeducted: number | null;
  hoursDeducted: number | null;
  note: string | null;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getCallerMember() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const { data: member } = await supabase
    .from("members")
    .select("id, organisation_id, role, team_id, start_date, first_name, last_name")
    .eq("user_id", user.id)
    .limit(1)
    .single();

  if (!member) throw new Error("No organisation");
  return { supabase, member };
}

/** Resolve the work pattern for a member on a given date */
async function resolveWorkPattern(
  supabase: Awaited<ReturnType<typeof createClient>>,
  memberId: string,
  orgId: string,
  bookingStartDate: string
): Promise<WorkPatternHours | null> {
  // 1. Check employee-specific assignment
  const { data: assignment } = await supabase
    .from("employee_work_profiles")
    .select("work_profile_id")
    .eq("member_id", memberId)
    .lte("effective_from", bookingStartDate)
    .order("effective_from", { ascending: false })
    .limit(1)
    .single();

  const profileId = assignment?.work_profile_id;

  // 2. Fall back to org default
  let resolvedId = profileId;
  if (!resolvedId) {
    const { data: org } = await supabase
      .from("organisations")
      .select("default_work_profile_id")
      .eq("id", orgId)
      .single();
    resolvedId = org?.default_work_profile_id;
  }

  if (!resolvedId) return null; // Will use DEFAULT_PATTERN

  const { data: wp } = await supabase
    .from("work_profiles")
    .select("hours_monday, hours_tuesday, hours_wednesday, hours_thursday, hours_friday, hours_saturday, hours_sunday")
    .eq("id", resolvedId)
    .single();

  return wp as WorkPatternHours | null;
}

/** Fetch bank holidays for the org's country in a date range */
async function fetchBankHolidays(
  supabase: Awaited<ReturnType<typeof createClient>>,
  orgId: string,
  startDate: string,
  endDate: string
): Promise<Set<string>> {
  const admin = getAdminClient();

  // Get org's country_code
  const { data: org } = await admin
    .from("organisations")
    .select("country_code")
    .eq("id", orgId)
    .single();
  const countryCode = org?.country_code ?? "england-and-wales";

  // Get bank holidays for the country + org-specific overrides
  const { data } = await admin
    .from("bank_holidays")
    .select("date, is_excluded, organisation_id")
    .eq("country_code", countryCode)
    .gte("date", startDate)
    .lte("date", endDate)
    .or(`organisation_id.is.null,organisation_id.eq.${orgId}`);

  const holidays = new Set<string>();
  const excluded = new Set<string>();

  for (const bh of data ?? []) {
    if (bh.organisation_id && bh.is_excluded) {
      excluded.add(bh.date);
    } else {
      holidays.add(bh.date);
    }
  }

  // Remove org-excluded dates
  for (const d of excluded) {
    holidays.delete(d);
  }

  return holidays;
}

/** Get bank_holiday_handling setting for the org */
async function getOrgBankHolidayHandling(
  supabase: Awaited<ReturnType<typeof createClient>>,
  orgId: string
): Promise<string> {
  const { data } = await supabase
    .from("organisations")
    .select("bank_holiday_handling")
    .eq("id", orgId)
    .single();
  return data?.bank_holiday_handling ?? "additional";
}

/** Calculate days_deducted server-side for a booking */
async function calculateDaysDeducted(
  supabase: Awaited<ReturnType<typeof createClient>>,
  memberId: string,
  orgId: string,
  startDate: string,
  endDate: string,
  startHalf: string | null,
  endHalf: string | null
): Promise<number> {
  const [pattern, bankHolidays, handling] = await Promise.all([
    resolveWorkPattern(supabase, memberId, orgId, startDate),
    fetchBankHolidays(supabase, orgId, startDate, endDate),
    getOrgBankHolidayHandling(supabase, orgId),
  ]);

  return countWorkingDays(
    startDate,
    endDate,
    !!startHalf,
    !!endHalf,
    pattern,
    bankHolidays,
    handling
  );
}

// ---------------------------------------------------------------------------
// Get my work pattern (for client-side day counting estimate)
// ---------------------------------------------------------------------------

export async function getMyWorkPattern(): Promise<WorkPatternHours | null> {
  try {
    const { supabase, member } = await getCallerMember();
    const today = new Date().toISOString().slice(0, 10);
    return resolveWorkPattern(supabase, member.id, member.organisation_id, today);
  } catch {
    return null;
  }
}

export async function getMyBankHolidayContext(): Promise<{
  handling: string;
  dates: string[];
}> {
  try {
    const { supabase, member } = await getCallerMember();
    const handling = await getOrgBankHolidayHandling(supabase, member.organisation_id);
    // Fetch a wide range (current year ± 2 years) — enough for any booking preview
    const now = new Date();
    const rangeStart = `${now.getUTCFullYear() - 1}-01-01`;
    const rangeEnd = `${now.getUTCFullYear() + 2}-12-31`;
    const dates = await fetchBankHolidays(supabase, member.organisation_id, rangeStart, rangeEnd);
    return { handling, dates: Array.from(dates) };
  } catch {
    return { handling: "additional", dates: [] };
  }
}

// ---------------------------------------------------------------------------
// Get my balance for the current holiday year
// ---------------------------------------------------------------------------

export async function getMyBalance(): Promise<BalanceSummary | null> {
  const { supabase, member } = await getCallerMember();
  const today = new Date().toISOString().slice(0, 10);

  // CLE-167 — read the current holiday_period (replaces the dropped
  // holiday_year_records + absence_profiles tables). Adapt the period
  // shape into the input the existing calculateEntitlement helper expects
  // so My Holiday balance card keeps working until Phase 4 rebuilds the
  // computation chain.
  const { data: currentPeriod } = await supabase
    .from("holiday_periods")
    .select("start_date, end_date, allowance, adjust, units, max_carry_forward")
    .eq("member_id", member.id)
    .lte("start_date", today)
    .gte("end_date", today)
    .limit(1)
    .single();

  if (!currentPeriod) return null;

  const yearRec = {
    year_start: currentPeriod.start_date as string,
    year_end: currentPeriod.end_date as string,
    base_amount: Number(currentPeriod.allowance ?? 0),
    pro_rata_amount: null,
    adjustment: Number(currentPeriod.adjust ?? 0),
    carried_over: 0,
  };
  const unit = (currentPeriod.units as string) ?? "days";
  const carryOverMax = currentPeriod.max_carry_forward !== null
    ? Number(currentPeriod.max_carry_forward)
    : null;

  // Get bookings in this period
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
    unit,
    today
  );

  return {
    entitlement: result.effective_entitlement,
    carriedOver: Number(yearRec.carried_over) || 0,
    pending: result.pending,
    booked: result.booked,
    taken: result.taken,
    remaining: result.remaining,
    carryOverProjected: (() => {
      return (carryOverMax === null || carryOverMax === undefined)
        ? Math.max(result.remaining, 0)
        : Math.min(Math.max(result.remaining, 0), carryOverMax);
    })(),
    unit,
    yearStart: yearRec.year_start,
    yearEnd: yearRec.year_end,
  };
}

// ---------------------------------------------------------------------------
// Get my bookings
// ---------------------------------------------------------------------------

export async function getMyBookings(): Promise<HolidayBookingRow[]> {
  const { supabase, member } = await getCallerMember();

  const { data } = await supabase
    .from("holiday_bookings")
    .select("id, leave_reason_id, start_date, end_date, start_half, end_half, days_deducted, hours_deducted, status, approver1_id, approver_note, employee_note, created_at, absence_reasons(name, colour)")
    .eq("member_id", member.id)
    .order("start_date", { ascending: true });

  // Resolve approver names
  const approverIds = [...new Set((data ?? []).map((b) => b.approver1_id).filter(Boolean))] as string[];
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

  return (data ?? []).map((b) => {
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
}

// ---------------------------------------------------------------------------
// Get absence reasons for the booking form
// ---------------------------------------------------------------------------

export async function getAbsenceReasonOptions(): Promise<AbsenceReasonOption[]> {
  const { supabase, member } = await getCallerMember();

  const { data } = await supabase
    .from("absence_reasons")
    .select("id, name, colour, is_deprecated, absence_type_id, absence_types(name, requires_approval)")
    .eq("organisation_id", member.organisation_id)
    .order("name");

  return (data ?? []).map((r) => {
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
}

// ---------------------------------------------------------------------------
// Shared validation: notice period + team cover
// ---------------------------------------------------------------------------

async function validateBookingRules(
  supabase: Awaited<ReturnType<typeof createClient>>,
  orgId: string,
  memberId: string,
  teamId: string | null,
  startDate: string,
  endDate: string,
  daysDeducted: number | null,
  excludeBookingId?: string,
): Promise<{ error?: string }> {
  // Notice period validation — only blocks the submission when the org has
  // notice_rules_block_requests=true. When the flag is FALSE the rule is
  // informational only; the client surfaces a soft warning in the booking
  // sheet, the server lets the request through.
  //
  // CLE-179 — consecutive bookings are folded together for the rule check
  // so an employee can't dodge a notice rule by splitting one large
  // request into two adjacent small ones. We look for any pending/approved
  // holiday booking whose end_date is the day before the new start, or
  // whose start_date is the day after the new end. Their days_deducted are
  // added in, and the earliest start_date is used for the notice
  // calculation.
  const { data: orgRow } = await supabase
    .from("organisations")
    .select("notice_rules_block_requests")
    .eq("id", orgId)
    .single();
  const blockOnNotice = !!(orgRow as { notice_rules_block_requests?: boolean } | null)?.notice_rules_block_requests;

  if (blockOnNotice) {
    const { data: noticePeriodRules } = await supabase
      .from("notice_period_rules")
      .select("min_booking_days, notice_days")
      .eq("organisation_id", orgId)
      .order("min_booking_days", { ascending: false });

    if (noticePeriodRules && noticePeriodRules.length > 0) {
      // Reasons that deduct from holiday entitlement — only those count
      // for "consecutive holiday" stitching.
      const { data: deductingReasons } = await supabase
        .from("absence_reasons")
        .select("id, absence_types!inner(deducts_from_entitlement)")
        .eq("organisation_id", orgId)
        .eq("absence_types.deducts_from_entitlement", true);
      const deductingReasonIds = new Set<string>(
        (deductingReasons ?? []).map((r) => r.id as string),
      );

      // Fetch all pending/approved bookings for the member that could
      // plausibly stitch to the new request. Fetching everything is fine —
      // a single user has at most a few dozen open holiday bookings.
      const { data: rawBookings } = await supabase
        .from("holiday_bookings")
        .select("id, start_date, end_date, days_deducted, leave_reason_id")
        .eq("member_id", memberId)
        .in("status", ["pending", "approved"]);

      const candidateBookings = (rawBookings ?? []).filter((b) =>
        b.end_date !== null
        && deductingReasonIds.has(b.leave_reason_id as string)
        && (excludeBookingId ? (b.id as string) !== excludeBookingId : true),
      );

      // Stitching uses "no working days between" — Wed → Fri then Mon →
      // Tue stitches into one block because the only days in the gap are
      // a weekend. Working-day determination uses the per-date Work
      // Profile and the org's bank-holiday handling for symmetry with the
      // rest of the compute path (CLE-179).
      let combinedDays = daysDeducted ?? 1;
      let earliestStart = startDate;
      let stitched = false;

      if (candidateBookings.length > 0) {
        const workPatternHistory = await getMemberWorkPatternHistory(supabase, memberId, orgId);
        // Wide-enough bank-holiday window to cover any plausible gap.
        const candidateMinStart = candidateBookings.reduce(
          (acc, b) => ((b.start_date as string) < acc ? (b.start_date as string) : acc),
          startDate,
        );
        const candidateMaxEnd = candidateBookings.reduce(
          (acc, b) => ((b.end_date as string) > acc ? (b.end_date as string) : acc),
          endDate,
        );
        const bankHolidays = await getBankHolidaysForOrg(
          supabase,
          orgId,
          candidateMinStart,
          candidateMaxEnd,
        );
        const bankHolidayHandling = await getBankHolidayHandling(supabase, orgId);

        const PATTERN_KEYS: (keyof WorkPatternHours)[] = [
          "hours_monday", "hours_tuesday", "hours_wednesday", "hours_thursday",
          "hours_friday", "hours_saturday", "hours_sunday",
        ];
        const isWorkingDay = (iso: string): boolean => {
          const jsDay = new Date(iso + "T00:00:00Z").getUTCDay();
          if (jsDay === 0 || jsDay === 6) return false;
          const pattern = patternForDate(workPatternHistory, iso);
          if (!pattern) return false;
          const hours = Number(pattern[PATTERN_KEYS[jsDay - 1]]) || 0;
          if (hours === 0) return false;
          if (bankHolidays.has(iso) && bankHolidayHandling === "additional") return false;
          return true;
        };
        const workingDaysBetween = (after: string, before: string): number => {
          if (after >= before) return 0;
          let count = 0;
          const cursor = new Date(after + "T00:00:00Z");
          cursor.setUTCDate(cursor.getUTCDate() + 1);
          const stop = new Date(before + "T00:00:00Z");
          while (cursor < stop) {
            if (isWorkingDay(cursor.toISOString().slice(0, 10))) count++;
            cursor.setUTCDate(cursor.getUTCDate() + 1);
          }
          return count;
        };

        for (const b of candidateBookings) {
          const bs = b.start_date as string;
          const be = b.end_date as string;
          const isBefore = be < startDate && workingDaysBetween(be, startDate) === 0;
          const isAfter = bs > endDate && workingDaysBetween(endDate, bs) === 0;
          if (isBefore || isAfter) {
            combinedDays += Number(b.days_deducted ?? 0);
            if (bs < earliestStart) earliestStart = bs;
            stitched = true;
          }
        }
      }

      const matchingRule = noticePeriodRules.find((r) => combinedDays >= r.min_booking_days);
      if (matchingRule) {
        const today = new Date();
        today.setUTCHours(0, 0, 0, 0);
        const earliest = new Date(earliestStart + "T00:00:00Z");
        const diffMs = earliest.getTime() - today.getTime();
        const diffDays = Math.floor(diffMs / 86_400_000);
        if (diffDays < matchingRule.notice_days) {
          const error = stitched
            ? `This booking is consecutive with an existing booking, making ${combinedDays} days in total — that needs at least ${matchingRule.notice_days} days' notice (applies to bookings of ${matchingRule.min_booking_days}+ days).`
            : `This booking requires at least ${matchingRule.notice_days} days' notice (applies to bookings of ${matchingRule.min_booking_days}+ days).`;
          return { error };
        }
      }
    }
  }

  // Team cover validation (uses admin client to bypass RLS — employees may not
  // have permission to read teammates, but the server must count them for validation)
  if (teamId) {
    const admin = getAdminClient();

    const { data: teamRow } = await admin
      .from("teams")
      .select("min_cover")
      .eq("id", teamId)
      .single();

    const minCover = teamRow?.min_cover as number | null;
    if (minCover && minCover > 0) {
      const { count: teamMemberCount } = await admin
        .from("members")
        .select("id", { count: "exact", head: true })
        .eq("organisation_id", orgId)
        .eq("team_id", teamId);

      const teamSize = teamMemberCount ?? 0;

      const { data: teammates } = await admin
        .from("members")
        .select("id")
        .eq("organisation_id", orgId)
        .eq("team_id", teamId)
        .neq("id", memberId);

      if (teammates && teammates.length > 0) {
        const teammateIds = teammates.map((t) => t.id);
        const coverStart = new Date(startDate + "T00:00:00Z");
        const coverEnd = new Date(endDate + "T00:00:00Z");
        const cur = new Date(coverStart);
        while (cur <= coverEnd) {
          const dow = cur.getUTCDay();
          if (dow !== 0 && dow !== 6) {
            const dateStr = cur.toISOString().slice(0, 10);
            let query = admin
              .from("holiday_bookings")
              .select("id", { count: "exact", head: true })
              .in("member_id", teammateIds)
              .in("status", ["approved", "pending"])
              .lte("start_date", dateStr)
              .or(`end_date.gte.${dateStr},end_date.is.null`);

            if (excludeBookingId) {
              query = query.neq("id", excludeBookingId);
            }

            const { count: onLeaveCount } = await query;

            const present = teamSize - (onLeaveCount ?? 0) - 1; // -1 for the requesting employee
            if (present < minCover) {
              return {
                error: `Minimum team cover of ${minCover} would not be met on ${dateStr}.`,
              };
            }
          }
          cur.setUTCDate(cur.getUTCDate() + 1);
        }
      }
    }
  }

  return {};
}

// ---------------------------------------------------------------------------
// Check team overlap (warning, non-blocking)
// ---------------------------------------------------------------------------

async function checkTeamOverlap(
  supabase: Awaited<ReturnType<typeof createClient>>,
  orgId: string,
  memberId: string,
  teamId: string | null,
  startDate: string,
  endDate: string
): Promise<boolean> {
  if (!teamId) return false;

  // Find team members (excluding self)
  const { data: teammates } = await supabase
    .from("members")
    .select("id")
    .eq("organisation_id", orgId)
    .eq("team_id", teamId)
    .neq("id", memberId);

  if (!teammates?.length) return false;

  const teammateIds = teammates.map((t) => t.id);

  // Check for overlapping approved bookings
  const { count } = await supabase
    .from("holiday_bookings")
    .select("id", { count: "exact", head: true })
    .in("member_id", teammateIds)
    .eq("status", "approved")
    .lte("start_date", endDate)
    .or(`end_date.gte.${startDate},end_date.is.null`);

  return (count ?? 0) > 0;
}

// ---------------------------------------------------------------------------
// Submit a holiday booking
// ---------------------------------------------------------------------------

export async function submitHolidayBooking(
  input: SubmitBookingInput
): Promise<{ success: boolean; error?: string; warning?: string; status?: string }> {
  try {
    const { supabase, member } = await getCallerMember();

    // Block retroactive requests up-front so the user sees a clearer error
    // than the generic overlap message (an open-ended sick booking can also
    // make the overlap check fire on past dates).
    const todayISO = new Date().toISOString().slice(0, 10);
    if (input.startDate < todayISO) {
      return { success: false, error: "You can't request a holiday retrospectively." };
    }

    // Check for same-employee overlap (open-ended bookings extend indefinitely)
    const { count: selfOverlap } = await supabase
      .from("holiday_bookings")
      .select("id", { count: "exact", head: true })
      .eq("member_id", member.id)
      .in("status", ["pending", "approved"])
      .lte("start_date", input.endDate)
      .or(`end_date.gte.${input.startDate},end_date.is.null`);

    if (selfOverlap && selfOverlap > 0) {
      return { success: false, error: "You already have a booking on one or more of these dates." };
    }

    // Determine workflow from the absence reason's parent type
    const { data: reason } = await supabase
      .from("absence_reasons")
      .select("name, absence_type_id, absence_types(requires_approval)")
      .eq("id", input.leaveReasonId)
      .single();

    const requiresApproval = (reason?.absence_types as unknown as { requires_approval: boolean } | null)?.requires_approval ?? false;
    const leaveTypeName = reason?.name ?? "Holiday";
    const status = requiresApproval ? "pending" : "approved";

    // Server-side authoritative day counting (for days mode)
    let daysDeducted = input.daysDeducted;
    if (daysDeducted !== null) {
      daysDeducted = await calculateDaysDeducted(
        supabase, member.id, member.organisation_id,
        input.startDate, input.endDate, input.startHalf, input.endHalf
      );
    }

    // Notice period + team cover validation
    const ruleCheck = await validateBookingRules(
      supabase, member.organisation_id, member.id, member.team_id,
      input.startDate, input.endDate, daysDeducted
    );
    if (ruleCheck.error) return { success: false, error: ruleCheck.error };

    // Fetch team approver (cross-user query — use admin client)
    let teamApproverId: string | null = null;
    if (member.team_id) {
      const admin = getAdminClient();
      const { data: teamRow } = await admin
        .from("teams")
        .select("approver_id")
        .eq("id", member.team_id)
        .single();
      teamApproverId = teamRow?.approver_id ?? null;
    }

    // Create the booking
    const { data: insertedBooking, error: insertError } = await supabase
      .from("holiday_bookings")
      .insert({
        organisation_id: member.organisation_id,
        member_id: member.id,
        leave_reason_id: input.leaveReasonId,
        start_date: input.startDate,
        end_date: input.endDate,
        start_half: input.startHalf,
        end_half: input.endHalf,
        days_deducted: daysDeducted,
        hours_deducted: input.hoursDeducted,
        status,
        employee_note: input.note || null,
        approver1_id: teamApproverId,
      })
      .select("id")
      .single();

    if (insertError) return { success: false, error: insertError.message };
    const bookingId = insertedBooking?.id as string | undefined;

    // CLE-181 — Holiday Approvals Phase A. When the new booking requires
    // approval, resolve the employee's Approval Profile for this absence
    // type, write a booking_approvals row at level 1, and set
    // current_approval_level on the booking. If no profile is assigned for
    // this absence type the booking falls back to the legacy "any admin can
    // approve" feed (current_approval_level stays NULL).
    //
    // The notifyApproverIds list captures who should receive the "request
    // pending" email — every member in the routed list (mains-or-delegates,
    // per spec "notify all, first-to-decide wins"). Falls back to the
    // legacy team approver when no profile is assigned.
    let notifyApproverIds: string[] = teamApproverId ? [teamApproverId] : [];
    if (status === "pending" && bookingId && reason?.absence_type_id) {
      const resolved = await resolveProfileForBooking(
        member.id,
        reason.absence_type_id as string,
      );
      if (resolved) {
        const applicable = pickApplicableLevels(
          resolved.levels,
          daysDeducted,
          input.hoursDeducted,
        );
        // Phase A only writes Level 1; L2/L3 are wired in Phase B.
        const firstLevel = applicable.find((l) => l.level === 1) ?? null;
        if (firstLevel && firstLevel.mainApproverIds.length > 0) {
          const unavailable = await getUnavailableMemberIds(
            firstLevel.mainApproverIds,
            todayISO,
          );
          const allMainsOut =
            firstLevel.mainApproverIds.every((id) => unavailable.has(id));
          const routedTo: "main" | "delegate" =
            allMainsOut && firstLevel.delegateApproverIds.length > 0
              ? "delegate"
              : "main";

          const admin = getAdminClient();
          const { error: baErr } = await admin.from("booking_approvals").insert({
            booking_id: bookingId,
            level: 1,
            main_approver_ids: firstLevel.mainApproverIds,
            delegate_approver_ids: firstLevel.delegateApproverIds,
            routed_to: routedTo,
            status: "pending",
          });
          if (!baErr) {
            await admin
              .from("holiday_bookings")
              .update({ current_approval_level: 1 })
              .eq("id", bookingId);
            // Profile-routed: notify the routed approver list, not the
            // legacy team approver.
            notifyApproverIds =
              routedTo === "main"
                ? firstLevel.mainApproverIds
                : firstLevel.delegateApproverIds;
          }
        }
      }
    }

    // Audit log — employee submitted a booking
    const memberName = `${member.first_name ?? ""} ${member.last_name ?? ""}`.trim();
    logAudit({
      organisationId: member.organisation_id,
      actorId: member.id,
      actorName: memberName,
      action: "booking.submitted",
      targetType: "booking",
      targetId: bookingId ?? undefined,
      targetLabel: `${memberName} — ${leaveTypeName}`,
      changes: {
        start_date: { old: null, new: input.startDate },
        end_date: { old: null, new: input.endDate },
        leave_reason: { old: null, new: leaveTypeName },
        days_deducted: { old: null, new: daysDeducted },
        status: { old: null, new: status },
        start_half: { old: null, new: input.startHalf },
        end_half: { old: null, new: input.endHalf },
        note: { old: null, new: input.note?.trim() || null },
      },
      metadata: { member_id: member.id, member_name: memberName },
    });

    // Fire-and-forget email notification
    const headersList = await headers();
    const host = headersList.get("host") ?? "localhost:3000";
    const baseUrl = `${host.includes("localhost") ? "http" : "https"}://${host}`;
    const baseEmailData = {
      bookingId: bookingId ?? "",
      memberId: member.id,
      startDate: input.startDate,
      endDate: input.endDate,
      days: daysDeducted,
      leaveType: leaveTypeName,
      employeeNote: input.note || null,
      baseUrl,
    };
    if (status === "pending") {
      // CLE-181 — notify every routed approver. Phase A: mains OR delegates
      // (not both) per the spec; the routedTo decision was already made.
      // Legacy fallback: the team approver (preserved in notifyApproverIds
      // when no profile was matched).
      const uniqueApproverIds = [...new Set(notifyApproverIds)];
      for (const approverId of uniqueApproverIds) {
        await sendRequestPendingEmail({ ...baseEmailData, approverId });
      }
    } else {
      await sendBookingConfirmedEmail({ ...baseEmailData, approverId: teamApproverId });
    }

    // Check team overlap (warning only)
    const hasTeamOverlap = await checkTeamOverlap(
      supabase,
      member.organisation_id,
      member.id,
      member.team_id,
      input.startDate,
      input.endDate
    );

    const warning = hasTeamOverlap
      ? "Note: one or more team members are also off during this period."
      : undefined;

    return { success: true, status, warning };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "An error occurred" };
  }
}

// ---------------------------------------------------------------------------
// Update a pending or cancelled holiday booking
// ---------------------------------------------------------------------------

export async function updateHolidayBooking(
  bookingId: string,
  input: SubmitBookingInput
): Promise<{ success: boolean; error?: string; resubmitted?: boolean }> {
  try {
    const { supabase, member } = await getCallerMember();

    // Verify booking belongs to current user and is pending or cancelled.
    // Fetch full row for the audit diff.
    const { data: existing } = await supabase
      .from("holiday_bookings")
      .select("id, status, leave_reason_id, start_date, end_date, start_half, end_half, days_deducted, hours_deducted, employee_note, absence_reasons(name)")
      .eq("id", bookingId)
      .eq("member_id", member.id)
      .in("status", ["pending", "cancelled"])
      .single();

    if (!existing) {
      return { success: false, error: "Booking not found or cannot be edited." };
    }

    const wasCancelled = existing.status === "cancelled";

    // Check for same-employee overlap (excluding this booking)
    const { count: selfOverlap } = await supabase
      .from("holiday_bookings")
      .select("id", { count: "exact", head: true })
      .eq("member_id", member.id)
      .in("status", ["pending", "approved"])
      .neq("id", bookingId)
      .lte("start_date", input.endDate)
      .or(`end_date.gte.${input.startDate},end_date.is.null`);

    if (selfOverlap && selfOverlap > 0) {
      return { success: false, error: "You already have a booking on one or more of these dates." };
    }

    // Server-side authoritative day counting (for days mode)
    let daysDeducted = input.daysDeducted;
    if (daysDeducted !== null) {
      daysDeducted = await calculateDaysDeducted(
        supabase, member.id, member.organisation_id,
        input.startDate, input.endDate, input.startHalf, input.endHalf
      );
    }

    // Notice period + team cover validation (exclude this booking from cover count)
    const ruleCheck = await validateBookingRules(
      supabase, member.organisation_id, member.id, member.team_id,
      input.startDate, input.endDate, daysDeducted, bookingId
    );
    if (ruleCheck.error) return { success: false, error: ruleCheck.error };

    const updatePayload: Record<string, unknown> = {
      leave_reason_id: input.leaveReasonId,
      start_date: input.startDate,
      end_date: input.endDate,
      start_half: input.startHalf,
      end_half: input.endHalf,
      days_deducted: daysDeducted,
      hours_deducted: input.hoursDeducted,
      employee_note: input.note || null,
    };

    // If resubmitting a cancelled booking, reset to pending and clear approver fields
    if (wasCancelled) {
      updatePayload.status = "pending";
      updatePayload.approver1_id = null;
      updatePayload.approver_note = null;
    }

    const { error } = await supabase
      .from("holiday_bookings")
      .update(updatePayload)
      .eq("id", bookingId)
      .eq("member_id", member.id);

    if (error) return { success: false, error: error.message };

    // Audit log — employee updated their own booking
    const memberName = `${member.first_name ?? ""} ${member.last_name ?? ""}`.trim();
    const oldReasonName = (existing.absence_reasons as unknown as { name: string } | null)?.name ?? null;
    // Resolve new reason name if it changed
    let newReasonName = oldReasonName;
    if (input.leaveReasonId !== existing.leave_reason_id) {
      const { data: newReason } = await supabase
        .from("absence_reasons")
        .select("name")
        .eq("id", input.leaveReasonId)
        .single();
      newReasonName = newReason?.name ?? null;
    }

    const changes = diffChanges(
      {
        start_date: existing.start_date,
        end_date: existing.end_date,
        start_half: existing.start_half,
        end_half: existing.end_half,
        days_deducted: Number(existing.days_deducted),
        note: existing.employee_note,
        leave_reason: oldReasonName,
        status: existing.status,
      },
      {
        start_date: input.startDate,
        end_date: input.endDate,
        start_half: input.startHalf,
        end_half: input.endHalf,
        days_deducted: daysDeducted,
        note: input.note || null,
        leave_reason: newReasonName,
        status: wasCancelled ? "pending" : existing.status,
      },
    );

    if (changes) {
      logAudit({
        organisationId: member.organisation_id,
        actorId: member.id,
        actorName: memberName,
        action: wasCancelled ? "booking.resubmitted" : "booking.updated",
        targetType: "booking",
        targetId: bookingId,
        targetLabel: `${memberName} — ${newReasonName ?? ""}`.trim(),
        changes,
        metadata: { member_id: member.id, member_name: memberName },
      });
    }

    return { success: true, resubmitted: wasCancelled };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "An error occurred" };
  }
}

// ---------------------------------------------------------------------------
// Admin: book absence on behalf of an employee (auto-approved)
// ---------------------------------------------------------------------------

export type AdminBookAbsenceInput = {
  memberId: string;
  leaveReasonId: string;
  startDate: string;
  endDate: string | null;
  startHalf: string | null;
  endHalf: string | null;
  note: string | null;
};

/**
 * Admin-only server action to create an already-approved absence booking for
 * another employee. Skips the approval workflow and the notice-period /
 * team-cover rules (the admin is making the call), but preserves the same
 * authoritative day-counting logic as the self-service flow so the stored
 * days_deducted is consistent.
 */
export async function adminBookAbsence(
  input: AdminBookAbsenceInput,
): Promise<{ success: boolean; error?: string; bookingId?: string }> {
  try {
    const { supabase, member: caller } = await getCallerMember();

    if (caller.role !== "owner" && caller.role !== "admin") {
      return { success: false, error: "Only admins or owners can book on behalf of others." };
    }

    // Target must be in the same org. Use admin client for cross-user read.
    const admin = getAdminClient();
    const { data: target } = await admin
      .from("members")
      .select("id, organisation_id, first_name, last_name")
      .eq("id", input.memberId)
      .eq("organisation_id", caller.organisation_id)
      .single();
    if (!target) return { success: false, error: "Member not found" };
    const memberName = `${target.first_name ?? ""} ${target.last_name ?? ""}`.trim();

    // Overlap check against the target's existing non-cancelled bookings.
    // For open-ended bookings (endDate = null) we only check that the start
    // date itself is free — extending to infinity would block any future
    // booking (e.g. annual leave next month), which is too aggressive. When
    // the admin closes the sick booking with a real end date, the normal
    // update overlap check will validate the full range.
    const overlapEnd = input.endDate ?? input.startDate;
    const { count: overlap } = await admin
      .from("holiday_bookings")
      .select("id", { count: "exact", head: true })
      .eq("member_id", target.id)
      .in("status", ["pending", "approved"])
      .lte("start_date", overlapEnd)
      .or(`end_date.gte.${input.startDate},end_date.is.null`);
    if (overlap && overlap > 0) {
      return { success: false, error: "This employee already has a booking on one or more of those dates." };
    }

    // Verify the reason belongs to the org
    const { data: reason } = await supabase
      .from("absence_reasons")
      .select("id, name, organisation_id")
      .eq("id", input.leaveReasonId)
      .eq("organisation_id", caller.organisation_id)
      .single();
    if (!reason) return { success: false, error: "Invalid absence reason" };

    // Authoritative day count using the TARGET member's work pattern.
    // Open-ended bookings (no end date) use today as the effective end for the
    // initial day count — this gets recalculated each time the calendar loads.
    const effectiveEndForCalc = input.endDate ?? new Date().toISOString().slice(0, 10);
    const daysDeducted = await calculateDaysDeducted(
      supabase,
      target.id,
      target.organisation_id,
      input.startDate,
      effectiveEndForCalc,
      input.startHalf,
      input.endHalf,
    );

    const { data: inserted, error: insertError } = await admin
      .from("holiday_bookings")
      .insert({
        organisation_id: target.organisation_id,
        member_id: target.id,
        leave_reason_id: input.leaveReasonId,
        start_date: input.startDate,
        end_date: input.endDate,
        start_half: input.startHalf,
        end_half: input.endHalf,
        days_deducted: daysDeducted,
        hours_deducted: null,
        status: "approved",
        employee_note: input.note?.trim() || null,
        approver1_id: caller.id,
      })
      .select("id")
      .single();

    if (insertError) return { success: false, error: insertError.message };

    logAudit({
      organisationId: target.organisation_id,
      actorId: caller.id,
      actorName: `${caller.first_name ?? ""} ${caller.last_name ?? ""}`.trim(),
      action: "booking.created",
      targetType: "booking",
      targetId: inserted?.id as string | undefined,
      targetLabel: `${memberName} — ${reason.name}`,
      changes: {
        start_date: { old: null, new: input.startDate },
        end_date: { old: null, new: input.endDate },
        leave_reason: { old: null, new: reason.name },
        days_deducted: { old: null, new: daysDeducted },
        status: { old: null, new: "approved" },
        start_half: { old: null, new: input.startHalf },
        end_half: { old: null, new: input.endHalf },
        note: { old: null, new: input.note?.trim() || null },
      },
      metadata: { member_id: target.id, member_name: memberName },
    });

    return { success: true, bookingId: inserted?.id as string | undefined };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "An error occurred" };
  }
}

// ---------------------------------------------------------------------------
// Admin: fetch a booking's full editable fields (used by the edit flow on the
// employee planner calendar).
// ---------------------------------------------------------------------------

export type AdminBookingDetails = {
  id: string;
  member_id: string;
  leave_reason_id: string;
  start_date: string;
  end_date: string | null;
  start_half: string | null;
  end_half: string | null;
  employee_note: string | null;
  status: string;
  /** CLE-181 — true when the calling admin/owner is authorised to edit,
   *  approve, reject, or delete this booking. For pending bookings this
   *  means the caller is in the active level's routed approver list (or
   *  the booking is a legacy "any admin" booking). For non-pending
   *  bookings any admin/owner retains edit/delete access (current
   *  behaviour). The Edit Booking sheet on the planner uses this flag to
   *  disable the form + action buttons for non-routed admins so they can
   *  still see the request + history but not act on it. */
  caller_can_decide: boolean;
};

export async function getBookingDetails(
  bookingId: string,
): Promise<{ success: boolean; error?: string; booking?: AdminBookingDetails }> {
  try {
    const { member: caller } = await getCallerMember();
    if (caller.role !== "owner" && caller.role !== "admin") {
      return { success: false, error: "Forbidden" };
    }
    const admin = getAdminClient();
    const { data } = await admin
      .from("holiday_bookings")
      .select("id, member_id, leave_reason_id, start_date, end_date, start_half, end_half, employee_note, status, current_approval_level")
      .eq("id", bookingId)
      .eq("organisation_id", caller.organisation_id)
      .single();
    if (!data) return { success: false, error: "Booking not found" };

    // CLE-181 — derive caller_can_decide. Non-pending bookings: any admin
    // retains edit/delete (legacy behaviour). Pending bookings: must be in
    // the active level's routed approver list, OR the booking is legacy
    // (current_approval_level NULL).
    let callerCanDecide = true;
    if (data.status === "pending" && data.current_approval_level !== null) {
      const { data: levelRows } = await admin
        .from("booking_approvals")
        .select("level, routed_to, main_approver_ids, delegate_approver_ids, status")
        .eq("booking_id", bookingId)
        .eq("level", data.current_approval_level);
      const active = (levelRows ?? []).find((r) => r.status === "pending") as
        | {
            routed_to: "main" | "delegate";
            main_approver_ids: string[];
            delegate_approver_ids: string[];
          }
        | undefined;
      if (!active) {
        callerCanDecide = false;
      } else {
        const list =
          active.routed_to === "main"
            ? active.main_approver_ids
            : active.delegate_approver_ids;
        callerCanDecide = Array.isArray(list) && list.includes(caller.id);
      }
    }

    return {
      success: true,
      booking: {
        id: data.id as string,
        member_id: data.member_id as string,
        leave_reason_id: data.leave_reason_id as string,
        start_date: data.start_date as string,
        end_date: data.end_date as string | null,
        start_half: data.start_half as string | null,
        end_half: data.end_half as string | null,
        employee_note: data.employee_note as string | null,
        status: data.status as string,
        caller_can_decide: callerCanDecide,
      },
    };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "An error occurred" };
  }
}

// ---------------------------------------------------------------------------
// Admin: edit an existing booking in-place (auto-approved, same org check).
// ---------------------------------------------------------------------------

export type AdminUpdateBookingInput = {
  bookingId: string;
  leaveReasonId: string;
  startDate: string;
  endDate: string | null;
  startHalf: string | null;
  endHalf: string | null;
  note: string | null;
};

export async function adminUpdateBooking(
  input: AdminUpdateBookingInput,
): Promise<{ success: boolean; error?: string }> {
  try {
    const { supabase, member: caller } = await getCallerMember();
    if (caller.role !== "owner" && caller.role !== "admin") {
      return { success: false, error: "Only admins or owners can edit bookings." };
    }

    const admin = getAdminClient();
    // Fetch the full existing row — needed both for the overlap/update flow
    // and to build the audit diff after the update succeeds.
    const { data: existing } = await admin
      .from("holiday_bookings")
      .select("id, member_id, organisation_id, leave_reason_id, start_date, end_date, start_half, end_half, days_deducted, employee_note")
      .eq("id", input.bookingId)
      .eq("organisation_id", caller.organisation_id)
      .single();
    if (!existing) return { success: false, error: "Booking not found" };

    // Overlap check — exclude the booking being edited so it doesn't conflict
    // with itself. For open-ended bookings, only check the start date is free
    // (same rationale as adminBookAbsence).
    const overlapEnd = input.endDate ?? input.startDate;
    const { count: overlap } = await admin
      .from("holiday_bookings")
      .select("id", { count: "exact", head: true })
      .eq("member_id", existing.member_id)
      .in("status", ["pending", "approved"])
      .neq("id", input.bookingId)
      .lte("start_date", overlapEnd)
      .or(`end_date.gte.${input.startDate},end_date.is.null`);
    if (overlap && overlap > 0) {
      return { success: false, error: "This employee already has a booking on one or more of those dates." };
    }

    // Reason must belong to the caller's org
    const { data: reason } = await supabase
      .from("absence_reasons")
      .select("id")
      .eq("id", input.leaveReasonId)
      .eq("organisation_id", caller.organisation_id)
      .single();
    if (!reason) return { success: false, error: "Invalid absence reason" };

    // Recalculate days_deducted with the TARGET member's current work pattern.
    // Open-ended bookings use today as the effective end.
    const effectiveEndForCalc = input.endDate ?? new Date().toISOString().slice(0, 10);
    const daysDeducted = await calculateDaysDeducted(
      supabase,
      existing.member_id,
      existing.organisation_id,
      input.startDate,
      effectiveEndForCalc,
      input.startHalf,
      input.endHalf,
    );

    const { error: updateError } = await admin
      .from("holiday_bookings")
      .update({
        leave_reason_id: input.leaveReasonId,
        start_date: input.startDate,
        end_date: input.endDate,
        start_half: input.startHalf,
        end_half: input.endHalf,
        days_deducted: daysDeducted,
        employee_note: input.note?.trim() || null,
      })
      .eq("id", input.bookingId);

    if (updateError) return { success: false, error: updateError.message };

    // --- Audit log ----------------------------------------------------------
    // Resolve the old + new reason names so the log reads in human terms
    // rather than UUIDs, and grab the target member's name for context.
    const reasonIds = [existing.leave_reason_id, input.leaveReasonId].filter(
      (v, i, a) => a.indexOf(v) === i,
    ) as string[];
    const [{ data: reasonRows }, { data: targetRow }] = await Promise.all([
      admin.from("absence_reasons").select("id, name").in("id", reasonIds),
      admin.from("members").select("first_name, last_name").eq("id", existing.member_id).single(),
    ]);
    const reasonMap = new Map<string, string>((reasonRows ?? []).map((r) => [r.id as string, r.name as string]));
    const memberName = `${targetRow?.first_name ?? ""} ${targetRow?.last_name ?? ""}`.trim();
    const newReasonName = reasonMap.get(input.leaveReasonId) ?? null;
    const oldReasonName = reasonMap.get(existing.leave_reason_id as string) ?? null;

    const changes = diffChanges(
      {
        start_date: existing.start_date,
        end_date: existing.end_date,
        start_half: existing.start_half,
        end_half: existing.end_half,
        days_deducted: Number(existing.days_deducted),
        note: existing.employee_note,
        leave_reason: oldReasonName,
      },
      {
        start_date: input.startDate,
        end_date: input.endDate,
        start_half: input.startHalf,
        end_half: input.endHalf,
        days_deducted: daysDeducted,
        note: input.note?.trim() || null,
        leave_reason: newReasonName,
      },
    );

    if (changes) {
      logAudit({
        organisationId: caller.organisation_id,
        actorId: caller.id,
        actorName: `${caller.first_name ?? ""} ${caller.last_name ?? ""}`.trim(),
        action: "booking.updated",
        targetType: "booking",
        targetId: input.bookingId,
        targetLabel: `${memberName} — ${newReasonName ?? ""}`.trim(),
        changes,
        metadata: { member_id: existing.member_id, member_name: memberName },
      });
    }

    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "An error occurred" };
  }
}

// ---------------------------------------------------------------------------
// Admin: hard-delete a booking (admins are explicitly removing it, not
// cancelling; employees cancel via the self-service flow).
// ---------------------------------------------------------------------------

export async function adminDeleteBooking(
  bookingId: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const { member: caller } = await getCallerMember();
    if (caller.role !== "owner" && caller.role !== "admin") {
      return { success: false, error: "Only admins or owners can delete bookings." };
    }
    const admin = getAdminClient();

    // Snapshot the booking + related names BEFORE deleting — the audit log
    // captures what was removed, so we need this data intact.
    const { data: existing } = await admin
      .from("holiday_bookings")
      .select("id, member_id, leave_reason_id, start_date, end_date, start_half, end_half, days_deducted, status, employee_note")
      .eq("id", bookingId)
      .eq("organisation_id", caller.organisation_id)
      .single();
    if (!existing) return { success: false, error: "Booking not found" };

    const [{ data: reasonRow }, { data: targetRow }] = await Promise.all([
      admin.from("absence_reasons").select("name").eq("id", existing.leave_reason_id as string).maybeSingle(),
      admin.from("members").select("first_name, last_name").eq("id", existing.member_id as string).single(),
    ]);
    const reasonName = (reasonRow?.name as string | undefined) ?? "Booking";
    const memberName = `${targetRow?.first_name ?? ""} ${targetRow?.last_name ?? ""}`.trim();

    const { error } = await admin
      .from("holiday_bookings")
      .delete()
      .eq("id", bookingId)
      .eq("organisation_id", caller.organisation_id);
    if (error) return { success: false, error: error.message };

    logAudit({
      organisationId: caller.organisation_id,
      actorId: caller.id,
      actorName: `${caller.first_name ?? ""} ${caller.last_name ?? ""}`.trim(),
      action: "booking.deleted",
      targetType: "booking",
      targetId: bookingId,
      targetLabel: `${memberName} — ${reasonName}`,
      changes: {
        start_date: { old: existing.start_date, new: null },
        end_date: { old: existing.end_date, new: null },
        leave_reason: { old: reasonName, new: null },
        days_deducted: { old: Number(existing.days_deducted), new: null },
        status: { old: existing.status, new: null },
        start_half: { old: existing.start_half, new: null },
        end_half: { old: existing.end_half, new: null },
        note: { old: existing.employee_note, new: null },
      },
      metadata: { member_id: existing.member_id, member_name: memberName },
    });

    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "An error occurred" };
  }
}
