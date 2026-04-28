"use server";

import { createClient } from "@/lib/supabase/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { BookingHistoryEvent } from "./booking-history-types";

function getAdminClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } },
  );
}

// ---------------------------------------------------------------------------
// Action labels — used to build the timeline description
// ---------------------------------------------------------------------------

const ACTION_DESCRIPTIONS: Record<string, string> = {
  "booking.submitted": "Booking submitted",
  "booking.created": "Booking created",
  "booking.updated": "Booking updated",
  "booking.resubmitted": "Booking resubmitted",
  "booking.approved": "Booking approved",
  "booking.rejected": "Booking rejected",
  "booking.cancelled": "Booking cancelled",
  "booking.deleted": "Booking deleted",
  "sick_details.created": "Sick details recorded",
  "sick_details.updated": "Sick details updated",
};

// ---------------------------------------------------------------------------
// Human-readable labels for changed fields
// ---------------------------------------------------------------------------

const FIELD_LABELS: Record<string, string> = {
  start_date: "Start date",
  end_date: "End date",
  start_half: "Start half-day",
  end_half: "End half-day",
  days_deducted: "Days deducted",
  leave_reason: "Leave reason",
  status: "Status",
  note: "Note",
  approver_note: "Approver note",
  self_cert_required: "Self-cert required",
  self_cert_received_date: "Self-cert received",
  btw_required: "Back-to-work required",
  btw_date: "Back-to-work date",
  btw_completed: "Back-to-work completed",
  med_cert_required: "Medical cert required",
  med_cert_received_date: "Medical cert received",
  is_paid: "Paid",
  hr_approved: "HR approved",
  completion_status: "Completion status",
};

/** Format a value for display in the detail lines */
function fmtVal(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (v === true) return "Yes";
  if (v === false) return "No";
  // Date strings
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
    const d = new Date(v + "T00:00:00Z");
    return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
  }
  // Status values with underscores
  if (typeof v === "string" && v.includes("_")) {
    return v.replace(/_/g, " ");
  }
  return String(v);
}

/**
 * Build human-readable detail lines from a changes object.
 * For "created" actions we show "Field: value".
 * For "updated" actions we show "Field: old → new".
 * For boolean toggles we use more natural language.
 */
function buildDetails(
  action: string,
  changes: Record<string, { old: unknown; new: unknown }> | null,
): string[] {
  if (!changes) return [];
  const lines: string[] = [];

  for (const [key, { old: oldVal, new: newVal }] of Object.entries(changes)) {
    const label = FIELD_LABELS[key] ?? key.replace(/_/g, " ");

    // Skip internal fields
    if (key === "member_id") continue;

    const isCreate = action.endsWith(".created") || action === "booking.submitted";

    if (isCreate) {
      // For creations, only show non-null new values
      if (newVal !== null && newVal !== undefined) {
        lines.push(`${label}: ${fmtVal(newVal)}`);
      }
    } else {
      // For updates, show old → new
      lines.push(`${label}: ${fmtVal(oldVal)} → ${fmtVal(newVal)}`);
    }
  }
  return lines;
}

// ---------------------------------------------------------------------------
// getBookingHistory — fetch audit trail entries for a single booking,
// processed into a human-readable timeline.
// ---------------------------------------------------------------------------

export async function getBookingHistory(
  bookingId: string,
): Promise<{ success: boolean; error?: string; events: BookingHistoryEvent[] }> {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: "Not authenticated", events: [] };

    const { data: member } = await supabase
      .from("members")
      .select("id, organisation_id, role")
      .eq("user_id", user.id)
      .single();
    if (!member) return { success: false, error: "No membership found", events: [] };
    if (member.role !== "admin" && member.role !== "owner") {
      return { success: false, error: "Not authorised", events: [] };
    }

    // Verify the booking belongs to this org
    const admin = getAdminClient();
    const { data: booking } = await admin
      .from("holiday_bookings")
      .select("id")
      .eq("id", bookingId)
      .eq("organisation_id", member.organisation_id)
      .single();
    if (!booking) return { success: false, error: "Booking not found", events: [] };

    // Fetch all audit entries for this booking, oldest first
    const { data: entries, error: fetchErr } = await admin
      .from("audit_log")
      .select("id, actor_name, action, changes, created_at")
      .eq("target_type", "booking")
      .eq("target_id", bookingId)
      .eq("organisation_id", member.organisation_id)
      .order("created_at", { ascending: true });

    if (fetchErr) return { success: false, error: fetchErr.message, events: [] };

    const events: BookingHistoryEvent[] = (entries ?? []).map((e) => ({
      id: e.id as string,
      timestamp: e.created_at as string,
      actorName: (e.actor_name as string) ?? "System",
      action: e.action as string,
      description: ACTION_DESCRIPTIONS[e.action as string] ?? (e.action as string).replace(/[_.]/g, " "),
      details: buildDetails(
        e.action as string,
        e.changes as Record<string, { old: unknown; new: unknown }> | null,
      ),
    }));

    return { success: true, events };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "An error occurred", events: [] };
  }
}
