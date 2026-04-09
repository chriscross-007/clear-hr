"use server";

import { createClient } from "@/lib/supabase/server";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ApprovalRow = {
  id: string;
  member_id: string;
  member_name: string;
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
  measurement_mode: string;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getCallerAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const { data: member } = await supabase
    .from("members")
    .select("id, organisation_id, role")
    .eq("user_id", user.id)
    .limit(1)
    .single();

  if (!member) throw new Error("No organisation");
  if (member.role !== "owner" && member.role !== "admin") {
    throw new Error("Insufficient permissions");
  }

  return { supabase, member };
}

// ---------------------------------------------------------------------------
// Get pending approvals
// ---------------------------------------------------------------------------

export async function getPendingApprovals(): Promise<ApprovalRow[]> {
  const { supabase, member } = await getCallerAdmin();
  return fetchAndMapBookings(supabase, member.organisation_id, "pending");
}

// ---------------------------------------------------------------------------
// Get all requests (with optional status filter)
// ---------------------------------------------------------------------------

export async function getAllRequests(
  statusFilter?: string
): Promise<ApprovalRow[]> {
  const { supabase, member } = await getCallerAdmin();
  return fetchAndMapBookings(supabase, member.organisation_id, statusFilter);
}

async function fetchAndMapBookings(
  supabase: Awaited<ReturnType<typeof createClient>>,
  orgId: string,
  statusFilter?: string
): Promise<ApprovalRow[]> {
  // Fetch members separately to avoid FK ambiguity issues
  const { data: members } = await supabase
    .from("members")
    .select("id, first_name, last_name")
    .eq("organisation_id", orgId);

  const memberMap = new Map<string, { name: string }>();
  for (const m of members ?? []) {
    memberMap.set(m.id, { name: `${m.first_name} ${m.last_name}` });
  }

  let query = supabase
    .from("holiday_bookings")
    .select("id, member_id, start_date, end_date, start_half, end_half, days_deducted, hours_deducted, status, approver1_id, approver_note, employee_note, created_at, absence_reasons(name, colour)")
    .eq("organisation_id", orgId)
    .order(statusFilter === "pending" ? "created_at" : "start_date", { ascending: true });

  if (statusFilter && statusFilter !== "all") {
    query = query.eq("status", statusFilter);
  }

  const { data } = await query;

  return (data ?? []).map((b) => {
    const reason = b.absence_reasons as unknown as { name: string; colour: string } | null;
    const mem = memberMap.get(b.member_id);
    const mode = "days";
    return {
      id: b.id,
      member_id: b.member_id,
      member_name: mem?.name ?? "—",
      start_date: b.start_date,
      end_date: b.end_date,
      start_half: b.start_half,
      end_half: b.end_half,
      days_deducted: b.days_deducted,
      hours_deducted: b.hours_deducted,
      status: b.status,
      approver_note: b.approver_note,
      approver_name: b.approver1_id ? memberMap.get(b.approver1_id)?.name ?? null : null,
      employee_note: b.employee_note,
      created_at: b.created_at,
      reason_name: reason?.name ?? "—",
      reason_colour: reason?.colour ?? "#6366f1",
      measurement_mode: mode,
    };
  });
}

// ---------------------------------------------------------------------------
// Approve a booking
// ---------------------------------------------------------------------------

export async function approveBooking(
  bookingId: string,
  note?: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const { supabase, member } = await getCallerAdmin();

    const { error } = await supabase
      .from("holiday_bookings")
      .update({
        status: "approved",
        approver1_id: member.id,
        approver_note: note?.trim() || null,
      })
      .eq("id", bookingId)
      .eq("organisation_id", member.organisation_id)
      .eq("status", "pending");

    if (error) return { success: false, error: error.message };
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "An error occurred" };
  }
}

// ---------------------------------------------------------------------------
// Reject a booking
// ---------------------------------------------------------------------------

export async function rejectBooking(
  bookingId: string,
  note?: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const { supabase, member } = await getCallerAdmin();

    const { error } = await supabase
      .from("holiday_bookings")
      .update({
        status: "rejected",
        approver1_id: member.id,
        approver_note: note?.trim() || null,
      })
      .eq("id", bookingId)
      .eq("organisation_id", member.organisation_id)
      .eq("status", "pending");

    if (error) return { success: false, error: error.message };
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "An error occurred" };
  }
}

// ---------------------------------------------------------------------------
// Cancel own booking (employee action)
// ---------------------------------------------------------------------------

export async function cancelMyBooking(
  bookingId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { success: false, error: "Not authenticated" };

    const { data: member } = await supabase
      .from("members")
      .select("id")
      .eq("user_id", user.id)
      .limit(1)
      .single();

    if (!member) return { success: false, error: "No organisation" };

    // Only allow cancelling own pending bookings
    const { error } = await supabase
      .from("holiday_bookings")
      .update({ status: "cancelled" })
      .eq("id", bookingId)
      .eq("member_id", member.id)
      .eq("status", "pending");

    if (error) return { success: false, error: error.message };
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "An error occurred" };
  }
}
