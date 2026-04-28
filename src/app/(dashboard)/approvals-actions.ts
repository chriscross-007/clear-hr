"use server";

import { createClient } from "@/lib/supabase/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { headers } from "next/headers";
import { sendRequestApprovedEmail, sendRequestRejectedEmail } from "@/lib/email";
import { logAudit } from "@/lib/audit";

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

export type ApprovalRow = {
  id: string;
  member_id: string;
  member_name: string;
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
  measurement_mode: string;
  completion_status: string | null;
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
    .select("id, organisation_id, role, first_name, last_name")
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
    .select("id, member_id, start_date, end_date, start_half, end_half, days_deducted, hours_deducted, status, approver1_id, approver_note, employee_note, created_at, absence_reasons(name, colour), sick_booking_details(completion_status)")
    .eq("organisation_id", orgId)
    .order(statusFilter === "pending" ? "created_at" : "start_date", { ascending: true });

  if (statusFilter && statusFilter !== "all") {
    query = query.eq("status", statusFilter);
  }

  const { data } = await query;

  return (data ?? []).map((b) => {
    const reason = b.absence_reasons as unknown as { name: string; colour: string } | null;
    const sickDetails = b.sick_booking_details as unknown as { completion_status: string } | null;
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
      completion_status: sickDetails?.completion_status ?? null,
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

    // Fire-and-forget email to employee + audit log
    const admin = getAdminClient();
    const { data: booking } = await admin
      .from("holiday_bookings")
      .select("member_id, start_date, end_date, days_deducted, employee_note, absence_reasons(name)")
      .eq("id", bookingId)
      .single();
    if (booking) {
      const reasonName = (booking.absence_reasons as unknown as { name: string } | null)?.name ?? "Holiday";

      // Resolve employee name for audit label
      const { data: targetRow } = await admin
        .from("members")
        .select("first_name, last_name")
        .eq("id", booking.member_id)
        .single();
      const memberName = `${targetRow?.first_name ?? ""} ${targetRow?.last_name ?? ""}`.trim();

      logAudit({
        organisationId: member.organisation_id,
        actorId: member.id,
        actorName: `${member.first_name ?? ""} ${member.last_name ?? ""}`.trim(),
        action: "booking.approved",
        targetType: "booking",
        targetId: bookingId,
        targetLabel: `${memberName} — ${reasonName}`,
        changes: {
          status: { old: "pending", new: "approved" },
          approver_note: { old: null, new: note?.trim() || null },
        },
        metadata: { member_id: booking.member_id, member_name: memberName },
      });

      const headersList = await headers();
      const host = headersList.get("host") ?? "localhost:3000";
      const baseUrl = `${host.includes("localhost") ? "http" : "https"}://${host}`;
      const emailData = {
        bookingId, memberId: booking.member_id,
        startDate: booking.start_date, endDate: booking.end_date,
        days: booking.days_deducted ? Number(booking.days_deducted) : null,
        leaveType: reasonName, approverId: member.id,
        employeeNote: booking.employee_note,
        approverNote: note?.trim() || null, baseUrl,
      };
      await sendRequestApprovedEmail(emailData);
    }

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

    // Fire-and-forget email to employee + audit log
    const admin = getAdminClient();
    const { data: booking } = await admin
      .from("holiday_bookings")
      .select("member_id, start_date, end_date, days_deducted, employee_note, absence_reasons(name)")
      .eq("id", bookingId)
      .single();
    if (booking) {
      const reasonName = (booking.absence_reasons as unknown as { name: string } | null)?.name ?? "Holiday";

      // Resolve employee name for audit label
      const { data: targetRow } = await admin
        .from("members")
        .select("first_name, last_name")
        .eq("id", booking.member_id)
        .single();
      const memberName = `${targetRow?.first_name ?? ""} ${targetRow?.last_name ?? ""}`.trim();

      logAudit({
        organisationId: member.organisation_id,
        actorId: member.id,
        actorName: `${member.first_name ?? ""} ${member.last_name ?? ""}`.trim(),
        action: "booking.rejected",
        targetType: "booking",
        targetId: bookingId,
        targetLabel: `${memberName} — ${reasonName}`,
        changes: {
          status: { old: "pending", new: "rejected" },
          approver_note: { old: null, new: note?.trim() || null },
        },
        metadata: { member_id: booking.member_id, member_name: memberName },
      });

      const headersList = await headers();
      const host = headersList.get("host") ?? "localhost:3000";
      const baseUrl = `${host.includes("localhost") ? "http" : "https"}://${host}`;
      await sendRequestRejectedEmail({
        bookingId, memberId: booking.member_id,
        startDate: booking.start_date, endDate: booking.end_date,
        days: booking.days_deducted ? Number(booking.days_deducted) : null,
        leaveType: reasonName, approverId: member.id,
        employeeNote: booking.employee_note,
        approverNote: note?.trim() || null, baseUrl,
      });
    }

    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "An error occurred" };
  }
}

// ---------------------------------------------------------------------------
// Bulk approve / reject
// ---------------------------------------------------------------------------

async function bulkDecision(
  bookingIds: string[],
  status: "approved" | "rejected",
  note?: string
): Promise<{ success: boolean; error?: string; processed?: number }> {
  try {
    if (!bookingIds || bookingIds.length === 0) return { success: true, processed: 0 };
    const { supabase, member } = await getCallerAdmin();

    const trimmedNote = note?.trim() || null;

    const { error } = await supabase
      .from("holiday_bookings")
      .update({
        status,
        approver1_id: member.id,
        approver_note: trimmedNote,
      })
      .in("id", bookingIds)
      .eq("organisation_id", member.organisation_id)
      .eq("status", "pending");

    if (error) return { success: false, error: error.message };

    // Fetch booking details for emails (after update; note the status column now reflects new status)
    const admin = getAdminClient();
    const { data: bookings } = await admin
      .from("holiday_bookings")
      .select("id, member_id, start_date, end_date, days_deducted, employee_note, absence_reasons(name)")
      .in("id", bookingIds)
      .eq("organisation_id", member.organisation_id);

    if (bookings && bookings.length > 0) {
      // Resolve employee names for audit labels
      const memberIds = [...new Set(bookings.map((b) => b.member_id))] as string[];
      const { data: memberRows } = await admin
        .from("members")
        .select("id, first_name, last_name")
        .in("id", memberIds);
      const nameMap = new Map<string, string>(
        (memberRows ?? []).map((m) => [m.id as string, `${m.first_name ?? ""} ${m.last_name ?? ""}`.trim()]),
      );
      const actorName = `${member.first_name ?? ""} ${member.last_name ?? ""}`.trim();

      const headersList = await headers();
      const host = headersList.get("host") ?? "localhost:3000";
      const baseUrl = `${host.includes("localhost") ? "http" : "https"}://${host}`;

      for (const b of bookings) {
        const reasonName = (b.absence_reasons as unknown as { name: string } | null)?.name ?? "Holiday";
        const memberName = nameMap.get(b.member_id) ?? "";

        logAudit({
          organisationId: member.organisation_id,
          actorId: member.id,
          actorName,
          action: status === "approved" ? "booking.approved" : "booking.rejected",
          targetType: "booking",
          targetId: b.id,
          targetLabel: `${memberName} — ${reasonName}`,
          changes: {
            status: { old: "pending", new: status },
            approver_note: { old: null, new: trimmedNote },
          },
          metadata: { member_id: b.member_id, member_name: memberName, bulk: true },
        });

        const payload = {
          bookingId: b.id,
          memberId: b.member_id,
          startDate: b.start_date,
          endDate: b.end_date,
          days: b.days_deducted ? Number(b.days_deducted) : null,
          leaveType: reasonName,
          approverId: member.id,
          employeeNote: b.employee_note,
          approverNote: trimmedNote,
          baseUrl,
        };
        if (status === "approved") {
          await sendRequestApprovedEmail(payload);
        } else {
          await sendRequestRejectedEmail(payload);
        }
      }
    }

    return { success: true, processed: bookings?.length ?? 0 };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "An error occurred" };
  }
}

export async function bulkApproveBookings(
  bookingIds: string[],
  note?: string
): Promise<{ success: boolean; error?: string; processed?: number }> {
  return bulkDecision(bookingIds, "approved", note);
}

export async function bulkRejectBookings(
  bookingIds: string[],
  note?: string
): Promise<{ success: boolean; error?: string; processed?: number }> {
  return bulkDecision(bookingIds, "rejected", note);
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
      .select("id, organisation_id, first_name, last_name")
      .eq("user_id", user.id)
      .limit(1)
      .single();

    if (!member) return { success: false, error: "No organisation" };

    // Snapshot the booking before updating so we can log the reason name
    const { data: existing } = await supabase
      .from("holiday_bookings")
      .select("start_date, end_date, days_deducted, absence_reasons(name)")
      .eq("id", bookingId)
      .eq("member_id", member.id)
      .eq("status", "pending")
      .single();

    // Only allow cancelling own pending bookings
    const { error } = await supabase
      .from("holiday_bookings")
      .update({ status: "cancelled" })
      .eq("id", bookingId)
      .eq("member_id", member.id)
      .eq("status", "pending");

    if (error) return { success: false, error: error.message };

    const memberName = `${member.first_name ?? ""} ${member.last_name ?? ""}`.trim();
    const reasonName = existing
      ? ((existing.absence_reasons as unknown as { name: string } | null)?.name ?? "Booking")
      : "Booking";
    logAudit({
      organisationId: member.organisation_id,
      actorId: member.id,
      actorName: memberName,
      action: "booking.cancelled",
      targetType: "booking",
      targetId: bookingId,
      targetLabel: `${memberName} — ${reasonName}`,
      changes: { status: { old: "pending", new: "cancelled" } },
      metadata: { member_id: member.id, member_name: memberName },
    });

    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "An error occurred" };
  }
}
