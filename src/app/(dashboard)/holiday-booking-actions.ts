"use server";

import { createClient } from "@/lib/supabase/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { headers } from "next/headers";
import { countWorkingDays, type WorkPatternHours } from "@/lib/day-counting";
import { calculateEntitlement } from "@/lib/entitlement";
import { sendRequestPendingEmail, sendBookingConfirmedEmail } from "@/lib/email";

function getAdminClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }
  );
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type HolidayBookingRow = {
  id: string;
  leave_reason_id: string;
  start_date: string;
  end_date: string;
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
    .select("id, organisation_id, role, team_id, start_date")
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
  // Get system-wide bank holidays + org-specific overrides
  const { data } = await supabase
    .from("bank_holidays")
    .select("date, is_excluded, organisation_id")
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

// ---------------------------------------------------------------------------
// Get my balance for the current holiday year
// ---------------------------------------------------------------------------

export async function getMyBalance(): Promise<BalanceSummary | null> {
  const { supabase, member } = await getCallerMember();
  const today = new Date().toISOString().slice(0, 10);

  // Get current year record
  const { data: yearRec } = await supabase
    .from("holiday_year_records")
    .select("id, absence_type_id, year_start, year_end, pro_rata_amount, base_amount, adjustment, carried_over")
    .eq("member_id", member.id)
    .lte("year_start", today)
    .gte("year_end", today)
    .limit(1)
    .single();

  if (!yearRec) return null;

  // Get bookings in this year
  const { data: bookings } = await supabase
    .from("holiday_bookings")
    .select("days_deducted, hours_deducted, status, end_date")
    .eq("member_id", member.id)
    .gte("start_date", yearRec.year_start)
    .lte("start_date", yearRec.year_end)
    .in("status", ["pending", "approved"]);

  // Determine measurement mode and carry-over cap from the absence profile
  let unit = "days";
  let carryOverMax: number | null = null;
  if (yearRec) {
    const { data: profile } = await supabase
      .from("absence_profiles")
      .select("measurement_mode, carry_over_max")
      .eq("absence_type_id", yearRec.absence_type_id)
      .eq("organisation_id", member.organisation_id)
      .limit(1)
      .single();
    if (profile) {
      unit = profile.measurement_mode;
      carryOverMax = profile.carry_over_max !== null ? Number(profile.carry_over_max) : null;
    }
  }

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
  // Notice period validation
  const { data: noticePeriodRules } = await supabase
    .from("notice_period_rules")
    .select("min_booking_days, notice_days")
    .eq("organisation_id", orgId)
    .order("min_booking_days", { ascending: false });

  if (noticePeriodRules && noticePeriodRules.length > 0) {
    const bookingDays = daysDeducted ?? 1;
    const matchingRule = noticePeriodRules.find((r) => bookingDays >= r.min_booking_days);
    if (matchingRule) {
      const today = new Date();
      today.setUTCHours(0, 0, 0, 0);
      const start = new Date(startDate + "T00:00:00Z");
      const diffMs = start.getTime() - today.getTime();
      const diffDays = Math.floor(diffMs / 86_400_000);
      if (diffDays < matchingRule.notice_days) {
        return {
          error: `This booking requires at least ${matchingRule.notice_days} days' notice (applies to bookings of ${matchingRule.min_booking_days}+ days).`,
        };
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
              .gte("end_date", dateStr);

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
    .gte("end_date", startDate);

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

    // Check for same-employee overlap
    const { count: selfOverlap } = await supabase
      .from("holiday_bookings")
      .select("id", { count: "exact", head: true })
      .eq("member_id", member.id)
      .in("status", ["pending", "approved"])
      .lte("start_date", input.endDate)
      .gte("end_date", input.startDate);

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
    const { error: insertError } = await supabase
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
      });

    if (insertError) return { success: false, error: insertError.message };

    // Fire-and-forget email notification
    const headersList = await headers();
    const host = headersList.get("host") ?? "localhost:3000";
    const baseUrl = `${host.includes("localhost") ? "http" : "https"}://${host}`;
    const emailData = {
      bookingId: "",
      memberId: member.id,
      startDate: input.startDate,
      endDate: input.endDate,
      days: daysDeducted,
      leaveType: leaveTypeName,
      approverId: teamApproverId,
      employeeNote: input.note || null,
      baseUrl,
    };
    if (status === "pending") {
      await sendRequestPendingEmail(emailData);
    } else {
      await sendBookingConfirmedEmail(emailData);
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

    // Verify booking belongs to current user and is pending or cancelled
    const { data: existing } = await supabase
      .from("holiday_bookings")
      .select("id, status")
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
      .gte("end_date", input.startDate);

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
    return { success: true, resubmitted: wasCancelled };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "An error occurred" };
  }
}
