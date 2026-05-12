"use server";

import { createClient } from "@/lib/supabase/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { headers } from "next/headers";
import { sendRequestApprovedEmail, sendRequestRejectedEmail, sendRequestPendingEmail } from "@/lib/email";
import { logAudit, bookingAuditLabel } from "@/lib/audit";
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
  /** CLE-183 — the active approval level for pending bookings. NULL for
   *  legacy bookings (any admin can approve) or non-pending bookings. */
  current_approval_level: number | null;
  /** CLE-183 — decision history per level, for the small ladder display
   *  on the approvals page. Includes only levels that have been activated;
   *  un-cascaded higher levels are not listed. */
  level_history: {
    level: number;
    status: "pending" | "approved" | "rejected" | "withdrawn";
    decided_at: string | null;
    decided_by_name: string | null;
    routed_to: "main" | "delegate" | null;
  }[];
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

/** CLE-183 — local copy of the level-applies predicate. The original lives in
 *  holiday-booking-actions.ts where it's used at submit time; we duplicate
 *  here so the cascade logic doesn't need a cross-file dependency on a
 *  non-"use server" helper. Days and hours thresholds are independent and
 *  apply by the booking's unit. NULL = always required. */
function levelAppliesToBooking(
  level: ApprovalProfileLevel,
  daysDeducted: number | null,
  hoursDeducted: number | null,
): boolean {
  const useDays = daysDeducted !== null;
  const value = useDays ? (daysDeducted ?? 0) : (hoursDeducted ?? 0);
  if (useDays) {
    return level.lengthThresholdDays === null || value >= level.lengthThresholdDays;
  }
  return level.lengthThresholdHours === null || value >= level.lengthThresholdHours;
}

/** CLE-183 — after an approval at `justApprovedLevel`, find the lowest
 *  applicable level above it. Returns null when there's no next level
 *  (booking can be marked fully approved). When non-null, the caller writes
 *  a new booking_approvals row at the returned level and updates
 *  current_approval_level. */
async function getCascadeAfterApproval(
  bookingId: string,
  justApprovedLevel: number,
  todayISO: string,
): Promise<{
  nextLevel: ApprovalProfileLevel;
  routedTo: "main" | "delegate";
  notifyIds: string[];
} | null> {
  const admin = getAdminClient();
  const { data: booking } = await admin
    .from("holiday_bookings")
    .select("member_id, days_deducted, hours_deducted, absence_reasons(absence_type_id)")
    .eq("id", bookingId)
    .single();
  if (!booking) return null;
  const absenceTypeId = (booking.absence_reasons as unknown as { absence_type_id: string } | null)?.absence_type_id;
  if (!absenceTypeId) return null;

  const resolved = await resolveProfileForBooking(
    booking.member_id as string,
    absenceTypeId,
  );
  if (!resolved) return null;

  const daysDeducted =
    booking.days_deducted === null ? null : Number(booking.days_deducted);
  const hoursDeducted =
    booking.hours_deducted === null ? null : Number(booking.hours_deducted);

  const next = resolved.levels
    .filter(
      (l) =>
        l.level > justApprovedLevel &&
        l.mainApproverIds.length > 0 &&
        levelAppliesToBooking(l, daysDeducted, hoursDeducted),
    )
    .sort((a, b) => a.level - b.level)[0];
  if (!next) return null;

  const unavailable = await getUnavailableMemberIds(next.mainApproverIds, todayISO);
  const allMainsOut = next.mainApproverIds.every((id) => unavailable.has(id));
  const routedTo: "main" | "delegate" =
    allMainsOut && next.delegateApproverIds.length > 0 ? "delegate" : "main";
  const notifyIds =
    routedTo === "main" ? next.mainApproverIds : next.delegateApproverIds;
  return { nextLevel: next, routedTo, notifyIds };
}

/** CLE-181 — verify the caller is allowed to decide a specific pending
 *  booking. Returns the booking_approvals row id (when one exists) so the
 *  approve/reject flow can update it. Legacy bookings (no
 *  current_approval_level) are decidable by any admin/owner. */
async function checkApprovalAccess(
  bookingId: string,
  orgId: string,
  callerMemberId: string,
): Promise<{
  allowed: boolean;
  error?: string;
  activeApprovalRowId: string | null;
  currentApprovalLevel: number | null;
}> {
  const admin = getAdminClient();
  const { data: booking } = await admin
    .from("holiday_bookings")
    .select("id, organisation_id, status, current_approval_level")
    .eq("id", bookingId)
    .single();
  if (!booking) return { allowed: false, error: "Booking not found", activeApprovalRowId: null, currentApprovalLevel: null };
  if (booking.organisation_id !== orgId) return { allowed: false, error: "Booking not found", activeApprovalRowId: null, currentApprovalLevel: null };
  if (booking.status !== "pending") return { allowed: false, error: "Booking is no longer pending", activeApprovalRowId: null, currentApprovalLevel: null };

  // Legacy fallback — current_approval_level NULL = any admin/owner.
  if (booking.current_approval_level === null) {
    return { allowed: true, activeApprovalRowId: null, currentApprovalLevel: null };
  }

  const { data: rows } = await admin
    .from("booking_approvals")
    .select("id, level, routed_to, main_approver_ids, delegate_approver_ids, status")
    .eq("booking_id", bookingId)
    .eq("level", booking.current_approval_level);
  const active = (rows ?? []).find((r) => r.status === "pending") as
    | {
        id: string;
        routed_to: "main" | "delegate";
        main_approver_ids: string[];
        delegate_approver_ids: string[];
      }
    | undefined;
  if (!active) {
    return { allowed: false, error: "Active approval level row missing", activeApprovalRowId: null, currentApprovalLevel: booking.current_approval_level };
  }
  const list = active.routed_to === "main" ? active.main_approver_ids : active.delegate_approver_ids;
  if (!Array.isArray(list) || !list.includes(callerMemberId)) {
    return { allowed: false, error: "You are not an approver for this request", activeApprovalRowId: null, currentApprovalLevel: booking.current_approval_level };
  }
  return { allowed: true, activeApprovalRowId: active.id, currentApprovalLevel: booking.current_approval_level };
}

// ---------------------------------------------------------------------------
// Get pending approvals
// ---------------------------------------------------------------------------
//
// CLE-181 — Holiday Approvals Phase A. Returns the union of:
//   1. Profile-routed bookings where the caller is in the active level's
//      routed list (mains when routed_to='main', delegates when 'delegate').
//   2. Legacy bookings with current_approval_level = NULL (submitted before
//      Phase A rollout, or via an absence type with no profile assigned).
//      These continue to surface for any admin/owner — current behaviour.

export async function getPendingApprovals(): Promise<ApprovalRow[]> {
  const { supabase, member } = await getCallerAdmin();
  const ids = await getPendingApprovalBookingIds(member.organisation_id, member.id);
  return fetchAndMapBookings(supabase, member.organisation_id, "pending", ids);
}

/** Count of pending holiday bookings the caller can decide. */
export async function getPendingApprovalsCount(): Promise<{ success: boolean; error?: string; count: number }> {
  try {
    const { member } = await getCallerAdmin();
    const ids = await getPendingApprovalBookingIds(member.organisation_id, member.id);
    return { success: true, count: ids.length };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : "An error occurred",
      count: 0,
    };
  }
}

/** Resolve the set of pending holiday_bookings IDs visible to the given
 *  caller-member as an approver. */
async function getPendingApprovalBookingIds(
  orgId: string,
  callerMemberId: string,
): Promise<string[]> {
  const admin = getAdminClient();

  // Fetch all pending bookings in the org along with the active level's
  // booking_approvals row (when one exists).
  const { data: rows } = await admin
    .from("holiday_bookings")
    .select("id, current_approval_level, booking_approvals(level, routed_to, main_approver_ids, delegate_approver_ids, status)")
    .eq("organisation_id", orgId)
    .eq("status", "pending");

  const visible: string[] = [];
  for (const r of (rows ?? []) as Array<{
    id: string;
    current_approval_level: number | null;
    booking_approvals: Array<{
      level: number;
      routed_to: "main" | "delegate";
      main_approver_ids: string[];
      delegate_approver_ids: string[];
      status: string;
    }> | null;
  }>) {
    // Legacy: any admin/owner can decide.
    if (r.current_approval_level === null) {
      visible.push(r.id);
      continue;
    }
    const activeRow = (r.booking_approvals ?? []).find(
      (ba) => ba.level === r.current_approval_level && ba.status === "pending",
    );
    if (!activeRow) continue;
    const list =
      activeRow.routed_to === "main" ? activeRow.main_approver_ids : activeRow.delegate_approver_ids;
    if (Array.isArray(list) && list.includes(callerMemberId)) {
      visible.push(r.id);
    }
  }
  return visible;
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
  statusFilter?: string,
  /** When provided, restricts the result to these IDs. Used by
   *  getPendingApprovals to show only bookings the caller can decide. */
  restrictToBookingIds?: string[],
): Promise<ApprovalRow[]> {
  if (restrictToBookingIds && restrictToBookingIds.length === 0) return [];

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
    .select("id, member_id, start_date, end_date, start_half, end_half, days_deducted, hours_deducted, status, approver1_id, approver_note, employee_note, created_at, current_approval_level, absence_reasons(name, colour), sick_booking_details(completion_status)")
    .eq("organisation_id", orgId)
    .order(statusFilter === "pending" ? "created_at" : "start_date", { ascending: true });

  if (statusFilter && statusFilter !== "all") {
    query = query.eq("status", statusFilter);
  }

  if (restrictToBookingIds) {
    query = query.in("id", restrictToBookingIds);
  }

  const { data } = await query;
  // Cast through unknown: Supabase types nested-object joins as arrays
  // even when the FK guarantees a single row.
  const bookingRows = (data ?? []) as unknown as Array<{
    id: string;
    member_id: string;
    start_date: string;
    end_date: string | null;
    start_half: string | null;
    end_half: string | null;
    days_deducted: number | null;
    hours_deducted: number | null;
    status: string;
    approver1_id: string | null;
    approver_note: string | null;
    employee_note: string | null;
    created_at: string;
    current_approval_level: number | null;
    absence_reasons: { name: string; colour: string } | null;
    sick_booking_details: { completion_status: string } | null;
  }>;

  // CLE-183 — fetch the per-level decision history for these bookings so
  // the approvals page can show a small ladder ("L1 ✓ — L2 ● — L3 ○").
  const ids = bookingRows.map((b) => b.id);
  const levelHistoryByBooking = new Map<string, ApprovalRow["level_history"]>();
  if (ids.length > 0) {
    const admin = getAdminClient();
    const { data: levelRows } = await admin
      .from("booking_approvals")
      .select("booking_id, level, status, decided_by_member_id, decided_at, routed_to")
      .in("booking_id", ids);
    for (const row of (levelRows ?? []) as Array<{
      booking_id: string;
      level: number;
      status: "pending" | "approved" | "rejected" | "withdrawn";
      decided_by_member_id: string | null;
      decided_at: string | null;
      routed_to: "main" | "delegate";
    }>) {
      const list = levelHistoryByBooking.get(row.booking_id) ?? [];
      list.push({
        level: row.level,
        status: row.status,
        decided_at: row.decided_at,
        decided_by_name: row.decided_by_member_id
          ? memberMap.get(row.decided_by_member_id)?.name ?? null
          : null,
        routed_to: row.routed_to ?? null,
      });
      levelHistoryByBooking.set(row.booking_id, list);
    }
    // Sort each list by level so the ladder renders L1 → L2 → L3.
    for (const list of levelHistoryByBooking.values()) {
      list.sort((a, b) => a.level - b.level);
    }
  }

  return bookingRows.map((b) => {
    const reason = b.absence_reasons;
    const sickDetails = b.sick_booking_details;
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
      current_approval_level: b.current_approval_level,
      level_history: levelHistoryByBooking.get(b.id) ?? [],
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

    // CLE-181 — verify caller is allowed to decide this booking. Legacy
    // bookings (current_approval_level NULL) fall through to "any admin can
    // approve" behaviour. Profile-routed bookings require the caller to be
    // in the active level's routed list.
    const access = await checkApprovalAccess(bookingId, member.organisation_id, member.id);
    if (!access.allowed) return { success: false, error: access.error ?? "Insufficient permissions" };

    // Mark the active booking_approvals row approved first (atomic-ish — we
    // do this before deciding cascade vs final so the level-N row reflects
    // the just-made decision regardless of what happens next).
    const adm = getAdminClient();
    const nowISO = new Date().toISOString();
    if (access.activeApprovalRowId) {
      await adm
        .from("booking_approvals")
        .update({
          status: "approved",
          decided_by_member_id: member.id,
          decided_at: nowISO,
          comment: note?.trim() || null,
        })
        .eq("id", access.activeApprovalRowId);
    }

    // CLE-183 — decide cascade. If there's a higher applicable level, the
    // booking stays pending and advances. Otherwise, mark fully approved.
    const justApprovedLevel = access.activeApprovalRowId ? access.currentApprovalLevel ?? 0 : 0;
    const cascade =
      justApprovedLevel > 0
        ? await getCascadeAfterApproval(bookingId, justApprovedLevel, nowISO.slice(0, 10))
        : null;

    if (cascade) {
      // Write the next level's booking_approvals row, advance the pointer,
      // notify the routed approvers. Leave booking status='pending'.
      await adm.from("booking_approvals").insert({
        booking_id: bookingId,
        level: cascade.nextLevel.level,
        main_approver_ids: cascade.nextLevel.mainApproverIds,
        delegate_approver_ids: cascade.nextLevel.delegateApproverIds,
        routed_to: cascade.routedTo,
        status: "pending",
      });
      const { error: levelErr } = await supabase
        .from("holiday_bookings")
        .update({ current_approval_level: cascade.nextLevel.level })
        .eq("id", bookingId)
        .eq("organisation_id", member.organisation_id)
        .eq("status", "pending");
      if (levelErr) return { success: false, error: levelErr.message };
    } else {
      // No further levels — booking is fully approved.
      const { error } = await supabase
        .from("holiday_bookings")
        .update({
          status: "approved",
          approver1_id: member.id,
          approver_note: note?.trim() || null,
          current_approval_level: null,
        })
        .eq("id", bookingId)
        .eq("organisation_id", member.organisation_id)
        .eq("status", "pending");
      if (error) return { success: false, error: error.message };
    }

    // Fire-and-forget email + audit log. Cascade → notify next level's
    // routed approvers (request pending). Terminal → notify the employee
    // their request was approved.
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
        action: cascade ? "booking.level_approved" : "booking.approved",
        targetType: "booking",
        targetId: bookingId,
        targetLabel: bookingAuditLabel({
          memberName,
          reasonName,
          startDate: booking.start_date,
          endDate: booking.end_date,
        }),
        changes: cascade
          ? {
              level: { old: justApprovedLevel, new: cascade.nextLevel.level },
              approver_note: { old: null, new: note?.trim() || null },
            }
          : {
              status: { old: "pending", new: "approved" },
              approver_note: { old: null, new: note?.trim() || null },
            },
        metadata: { member_id: booking.member_id, member_name: memberName },
      });

      const headersList = await headers();
      const host = headersList.get("host") ?? "localhost:3000";
      const baseUrl = `${host.includes("localhost") ? "http" : "https"}://${host}`;

      if (cascade) {
        // Notify the next-level routed approvers.
        const baseEmailData = {
          bookingId,
          memberId: booking.member_id,
          startDate: booking.start_date,
          endDate: booking.end_date,
          days: booking.days_deducted ? Number(booking.days_deducted) : null,
          leaveType: reasonName,
          employeeNote: booking.employee_note,
          baseUrl,
        };
        for (const approverId of [...new Set(cascade.notifyIds)]) {
          await sendRequestPendingEmail({ ...baseEmailData, approverId });
        }
      } else {
        const emailData = {
          bookingId,
          memberId: booking.member_id,
          startDate: booking.start_date,
          endDate: booking.end_date,
          days: booking.days_deducted ? Number(booking.days_deducted) : null,
          leaveType: reasonName,
          approverId: member.id,
          employeeNote: booking.employee_note,
          approverNote: note?.trim() || null,
          baseUrl,
        };
        await sendRequestApprovedEmail(emailData);
      }
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

    // CLE-181 — verify caller is allowed to decide this booking.
    const access = await checkApprovalAccess(bookingId, member.organisation_id, member.id);
    if (!access.allowed) return { success: false, error: access.error ?? "Insufficient permissions" };

    const { error } = await supabase
      .from("holiday_bookings")
      .update({
        status: "rejected",
        approver1_id: member.id,
        approver_note: note?.trim() || null,
        current_approval_level: null,
      })
      .eq("id", bookingId)
      .eq("organisation_id", member.organisation_id)
      .eq("status", "pending");

    if (error) return { success: false, error: error.message };

    // Reject is terminal at any level — mark the active row rejected.
    if (access.activeApprovalRowId) {
      const adm = getAdminClient();
      await adm
        .from("booking_approvals")
        .update({
          status: "rejected",
          decided_by_member_id: member.id,
          decided_at: new Date().toISOString(),
          comment: note?.trim() || null,
        })
        .eq("id", access.activeApprovalRowId);
    }

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
        targetLabel: bookingAuditLabel({
          memberName,
          reasonName,
          startDate: booking.start_date,
          endDate: booking.end_date,
        }),
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

    // CLE-181 — restrict the bulk operation to bookings the caller is
    // authorised to decide. Skip silently rather than failing the batch.
    const accessChecks = await Promise.all(
      bookingIds.map((id) => checkApprovalAccess(id, member.organisation_id, member.id)),
    );
    const allowedIds: string[] = [];
    const allowedRowIds: string[] = [];
    // CLE-183 — per-booking cascade context for the approve path.
    const allowedContexts: { id: string; rowId: string | null; currentLevel: number | null }[] = [];
    bookingIds.forEach((id, i) => {
      if (accessChecks[i].allowed) {
        allowedIds.push(id);
        if (accessChecks[i].activeApprovalRowId) {
          allowedRowIds.push(accessChecks[i].activeApprovalRowId as string);
        }
        allowedContexts.push({
          id,
          rowId: accessChecks[i].activeApprovalRowId,
          currentLevel: accessChecks[i].currentApprovalLevel,
        });
      }
    });
    if (allowedIds.length === 0) return { success: true, processed: 0 };

    const nowISO = new Date().toISOString();
    const adm = getAdminClient();

    // Update the active booking_approvals rows for both approve and reject.
    if (allowedRowIds.length > 0) {
      await adm
        .from("booking_approvals")
        .update({
          status,
          decided_by_member_id: member.id,
          decided_at: nowISO,
          comment: trimmedNote,
        })
        .in("id", allowedRowIds);
    }

    // CLE-183 — approve path runs per-booking so each can independently
    // either cascade to the next level or terminate as approved.
    // cascadeNotifyByBookingId[id] = list of next-level approvers to
    // notify when a cascade happened; missing key = terminal approval.
    const cascadeNotifyByBookingId: Map<string, string[]> = new Map();
    if (status === "rejected") {
      // Reject is terminal at every level — single batch UPDATE.
      const { error } = await supabase
        .from("holiday_bookings")
        .update({
          status,
          approver1_id: member.id,
          approver_note: trimmedNote,
          current_approval_level: null,
        })
        .in("id", allowedIds)
        .eq("organisation_id", member.organisation_id)
        .eq("status", "pending");
      if (error) return { success: false, error: error.message };
    } else {
      for (const ctx of allowedContexts) {
        const justApprovedLevel = ctx.currentLevel ?? 0;
        const cascade =
          justApprovedLevel > 0
            ? await getCascadeAfterApproval(ctx.id, justApprovedLevel, nowISO.slice(0, 10))
            : null;
        if (cascade) {
          await adm.from("booking_approvals").insert({
            booking_id: ctx.id,
            level: cascade.nextLevel.level,
            main_approver_ids: cascade.nextLevel.mainApproverIds,
            delegate_approver_ids: cascade.nextLevel.delegateApproverIds,
            routed_to: cascade.routedTo,
            status: "pending",
          });
          await supabase
            .from("holiday_bookings")
            .update({ current_approval_level: cascade.nextLevel.level })
            .eq("id", ctx.id)
            .eq("organisation_id", member.organisation_id)
            .eq("status", "pending");
          cascadeNotifyByBookingId.set(ctx.id, cascade.notifyIds);
        } else {
          await supabase
            .from("holiday_bookings")
            .update({
              status: "approved",
              approver1_id: member.id,
              approver_note: trimmedNote,
              current_approval_level: null,
            })
            .eq("id", ctx.id)
            .eq("organisation_id", member.organisation_id)
            .eq("status", "pending");
        }
      }
    }

    // Fetch booking details for emails (after update; note the status column now reflects new status)
    const admin = getAdminClient();
    const { data: bookings } = await admin
      .from("holiday_bookings")
      .select("id, member_id, start_date, end_date, days_deducted, employee_note, absence_reasons(name)")
      .in("id", allowedIds)
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
        const cascadeNotify = cascadeNotifyByBookingId.get(b.id);
        const cascaded = cascadeNotify !== undefined;

        logAudit({
          organisationId: member.organisation_id,
          actorId: member.id,
          actorName,
          action:
            status === "approved"
              ? cascaded
                ? "booking.level_approved"
                : "booking.approved"
              : "booking.rejected",
          targetType: "booking",
          targetId: b.id,
          targetLabel: bookingAuditLabel({
            memberName,
            reasonName,
            startDate: b.start_date,
            endDate: b.end_date,
          }),
          changes: cascaded
            ? { approver_note: { old: null, new: trimmedNote } }
            : {
                status: { old: "pending", new: status },
                approver_note: { old: null, new: trimmedNote },
              },
          metadata: { member_id: b.member_id, member_name: memberName, bulk: true },
        });

        const basePayload = {
          bookingId: b.id,
          memberId: b.member_id,
          startDate: b.start_date,
          endDate: b.end_date,
          days: b.days_deducted ? Number(b.days_deducted) : null,
          leaveType: reasonName,
          employeeNote: b.employee_note,
          approverNote: trimmedNote,
          baseUrl,
        };
        if (cascaded) {
          // Cascade — notify the next-level routed approvers.
          for (const approverId of [...new Set(cascadeNotify)]) {
            await sendRequestPendingEmail({ ...basePayload, approverId });
          }
        } else if (status === "approved") {
          await sendRequestApprovedEmail({ ...basePayload, approverId: member.id });
        } else {
          await sendRequestRejectedEmail({ ...basePayload, approverId: member.id });
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
      .update({ status: "cancelled", current_approval_level: null })
      .eq("id", bookingId)
      .eq("member_id", member.id)
      .eq("status", "pending");

    if (error) return { success: false, error: error.message };

    // CLE-183 — mark any open booking_approvals rows for this booking as
    // withdrawn. Phase A bookings have at most one such row at L1; Phase B
    // bookings may have rows for L1 + L2 + L3 if the cascade made it that
    // far. We only touch 'pending' rows so historical 'approved'/'rejected'
    // decisions stay accurate.
    const adm = getAdminClient();
    await adm
      .from("booking_approvals")
      .update({
        status: "withdrawn",
        decided_by_member_id: member.id,
        decided_at: new Date().toISOString(),
      })
      .eq("booking_id", bookingId)
      .eq("status", "pending");

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
      targetLabel: bookingAuditLabel({
        memberName,
        reasonName,
        startDate: (existing?.start_date as string | null | undefined) ?? null,
        endDate: (existing?.end_date as string | null | undefined) ?? null,
      }),
      changes: { status: { old: "pending", new: "cancelled" } },
      metadata: { member_id: member.id, member_name: memberName },
    });

    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "An error occurred" };
  }
}
