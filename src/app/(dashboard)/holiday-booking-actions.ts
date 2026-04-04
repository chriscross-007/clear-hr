"use server";

import { createClient } from "@/lib/supabase/server";

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
  pending: number;
  booked: number;
  taken: number;
  remaining: number;
  unit: string;
  yearStart: string;
  yearEnd: string;
};

export type AbsenceReasonOption = {
  id: string;
  name: string;
  colour: string;
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
    .select("id, organisation_id, role, team_id, holiday_profile_id")
    .eq("user_id", user.id)
    .limit(1)
    .single();

  if (!member) throw new Error("No organisation");
  return { supabase, member };
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
    .select("id, year_start, year_end, pro_rata_amount, base_amount, adjustment, carried_over")
    .eq("member_id", member.id)
    .lte("year_start", today)
    .gte("year_end", today)
    .limit(1)
    .single();

  if (!yearRec) return null;

  const proRata = yearRec.pro_rata_amount ?? yearRec.base_amount;
  const entitlement = Number(proRata) + Number(yearRec.adjustment) + Number(yearRec.carried_over);

  // Get bookings in this year
  const { data: bookings } = await supabase
    .from("holiday_bookings")
    .select("days_deducted, hours_deducted, status, end_date")
    .eq("member_id", member.id)
    .gte("start_date", yearRec.year_start)
    .lte("start_date", yearRec.year_end)
    .in("status", ["pending", "approved"]);

  // Determine measurement mode
  let unit = "days";
  if (member.holiday_profile_id) {
    const { data: profile } = await supabase
      .from("absence_profiles")
      .select("measurement_mode")
      .eq("id", member.holiday_profile_id)
      .single();
    if (profile) unit = profile.measurement_mode;
  }

  let pending = 0;
  let booked = 0;
  let taken = 0;
  for (const b of bookings ?? []) {
    const val = unit === "hours" ? Number(b.hours_deducted ?? 0) : Number(b.days_deducted ?? 0);
    if (b.status === "pending") {
      pending += val;
    } else if (b.status === "approved" && b.end_date < today) {
      taken += val;
    } else {
      booked += val;
    }
  }

  return {
    entitlement,
    pending,
    booked,
    taken,
    remaining: entitlement - pending - booked - taken,
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
    .select("id, name, colour, absence_type_id, absence_types(name, requires_approval)")
    .eq("organisation_id", member.organisation_id)
    .order("name");

  return (data ?? []).map((r) => {
    const aType = r.absence_types as unknown as { name: string; requires_approval: boolean } | null;
    return {
      id: r.id,
      name: r.name,
      colour: r.colour,
      absence_type_id: r.absence_type_id,
      absence_type_name: aType?.name ?? "—",
      requires_approval: aType?.requires_approval ?? false,
    };
  });
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
      .select("absence_type_id, absence_types(requires_approval)")
      .eq("id", input.leaveReasonId)
      .single();

    const requiresApproval = (reason?.absence_types as unknown as { requires_approval: boolean } | null)?.requires_approval ?? false;
    const status = requiresApproval ? "pending" : "approved";

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
        days_deducted: input.daysDeducted,
        hours_deducted: input.hoursDeducted,
        status,
        employee_note: input.note || null,
      });

    if (insertError) return { success: false, error: insertError.message };

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

    const updatePayload: Record<string, unknown> = {
      leave_reason_id: input.leaveReasonId,
      start_date: input.startDate,
      end_date: input.endDate,
      start_half: input.startHalf,
      end_half: input.endHalf,
      days_deducted: input.daysDeducted,
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
