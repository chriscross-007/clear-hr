"use server";

import { createClient } from "@/lib/supabase/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { BookingHistoryAudit, BookingHistoryChat, BookingHistoryEntry } from "./booking-history-types";

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
): Promise<{ success: boolean; error?: string; entries: BookingHistoryEntry[] }> {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: "Not authenticated", entries: [] };

    const { data: member } = await supabase
      .from("members")
      .select("id, organisation_id, role")
      .eq("user_id", user.id)
      .single();
    if (!member) return { success: false, error: "No membership found", entries: [] };
    if (member.role !== "admin" && member.role !== "owner") {
      return { success: false, error: "Not authorised", entries: [] };
    }

    // Verify the booking belongs to this org
    const admin = getAdminClient();
    const { data: booking } = await admin
      .from("holiday_bookings")
      .select("id")
      .eq("id", bookingId)
      .eq("organisation_id", member.organisation_id)
      .single();
    if (!booking) return { success: false, error: "Booking not found", entries: [] };

    // 1. Fetch all audit entries for this booking
    const { data: auditRows, error: auditErr } = await admin
      .from("audit_log")
      .select("id, actor_name, action, changes, created_at")
      .eq("target_type", "booking")
      .eq("target_id", bookingId)
      .eq("organisation_id", member.organisation_id)
      .order("created_at", { ascending: true });

    if (auditErr) return { success: false, error: auditErr.message, entries: [] };

    const auditEntries: BookingHistoryAudit[] = (auditRows ?? []).map((e) => ({
      type: "audit" as const,
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

    // 2. Fetch conversation messages for this booking
    const chatEntries: BookingHistoryChat[] = [];

    const { data: conversation } = await admin
      .from("conversations")
      .select("id")
      .eq("entity_type", "absence_booking")
      .eq("entity_id", bookingId)
      .eq("organisation_id", member.organisation_id)
      .maybeSingle();

    if (conversation) {
      const { data: messages } = await admin
        .from("conversation_messages")
        .select(`
          id,
          body,
          created_at,
          members!conversation_messages_author_member_id_fkey(
            first_name,
            last_name,
            role
          )
        `)
        .eq("conversation_id", conversation.id)
        .order("created_at", { ascending: true });

      // Fetch any attached documents for these messages
      const messageIds = (messages ?? []).map((m) => m.id as string);
      let docsByMessage: Record<string, { id: string; fileName: string }[]> = {};

      if (messageIds.length > 0) {
        const { data: docs } = await admin
          .from("member_documents")
          .select("id, file_name, conversation_message_id")
          .in("conversation_message_id", messageIds);

        for (const d of docs ?? []) {
          const msgId = d.conversation_message_id as string;
          if (!docsByMessage[msgId]) docsByMessage[msgId] = [];
          docsByMessage[msgId].push({ id: d.id as string, fileName: d.file_name as string });
        }
      }

      for (const m of messages ?? []) {
        const author = m.members as unknown as {
          first_name: string;
          last_name: string;
          role: string;
        };
        const authorName = `${author?.first_name ?? ""} ${author?.last_name ?? ""}`.trim() || "Unknown";
        const role = (author?.role ?? "employee") as "admin" | "owner" | "employee";

        chatEntries.push({
          type: "chat" as const,
          id: m.id as string,
          timestamp: m.created_at as string,
          authorName,
          authorRole: role,
          body: m.body as string,
          documents: docsByMessage[m.id as string] ?? [],
        });
      }
    }

    // 3. Merge and sort by timestamp
    const entries: BookingHistoryEntry[] = [...auditEntries, ...chatEntries].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
    );

    return { success: true, entries };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "An error occurred", entries: [] };
  }
}
