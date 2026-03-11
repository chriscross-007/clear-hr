"use server";

import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient } from "@supabase/supabase-js";
import { runInference } from "@/lib/timesheet/inference-engine";

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

/** Derive the caller's membership from the active session. */
async function getCallerMembership() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: membership } = await supabase
    .from("members")
    .select("id, organisation_id, role")
    .eq("user_id", user.id)
    .limit(1)
    .single();

  return membership ?? null;
}

/**
 * Run (or re-run) the inference engine for a single member over a date range.
 * Only owners and admins may trigger this.
 *
 * @param memberId   The member whose clockings to process.
 * @param rangeStart ISO date string "YYYY-MM-DD" (start of period, inclusive).
 * @param rangeEnd   ISO date string "YYYY-MM-DD" (end of period, inclusive).
 */
export async function triggerInference(
  memberId: string,
  rangeStart: string,
  rangeEnd: string
): Promise<{ success: true; periodsCreated: number; periodsUpdated: number; conflicts: number } | { success: false; error: string }> {
  const caller = await getCallerMembership();
  if (!caller) return { success: false, error: "Not authenticated" };
  if (caller.role !== "owner" && caller.role !== "admin") {
    return { success: false, error: "Insufficient permissions" };
  }

  // Verify the target member belongs to the same org
  const admin = getAdminClient();
  const { data: target } = await admin
    .from("members")
    .select("id, organisation_id")
    .eq("id", memberId)
    .eq("organisation_id", caller.organisation_id)
    .maybeSingle();

  if (!target) return { success: false, error: "Member not found" };

  try {
    const result = await runInference({
      supabase: admin,
      organisationId: caller.organisation_id,
      memberId,
      rangeStart: new Date(`${rangeStart}T00:00:00Z`),
      rangeEnd: new Date(`${rangeEnd}T23:59:59Z`),
    });

    return { success: true, ...result };
  } catch (err) {
    console.error("Inference engine error:", err);
    return { success: false, error: "Inference failed — see server logs" };
  }
}

/**
 * Apply (or clear) a manager override on a clocking's type.
 * Sets override_type; the inference engine will not overwrite this.
 * Pass newType=null to clear the override and revert to engine inference.
 * Writes a clocking_adjustments audit record.
 */
export async function overrideClockingType(
  clockingId: string,
  newType: string | null,
  reason: string
): Promise<{ success: boolean; error?: string }> {
  const caller = await getCallerMembership();
  if (!caller) return { success: false, error: "Not authenticated" };
  if (caller.role !== "owner" && caller.role !== "admin") {
    return { success: false, error: "Insufficient permissions" };
  }

  const admin = getAdminClient();

  // Fetch current clocking to verify org scope and get old value
  const { data: clocking } = await admin
    .from("clockings")
    .select("id, organisation_id, inferred_type, override_type")
    .eq("id", clockingId)
    .eq("organisation_id", caller.organisation_id)
    .maybeSingle();

  if (!clocking) return { success: false, error: "Clocking not found" };

  // Write audit record first
  const { error: auditErr } = await admin.from("clocking_adjustments").insert({
    clocking_id: clockingId,
    adjusted_by: caller.id,
    action: newType ? "set_override" : "clear_override",
    old_value: { override_type: clocking.override_type },
    new_value: { override_type: newType },
    reason,
  });

  if (auditErr) return { success: false, error: auditErr.message };

  // Set or clear override_type — inference engine respects this on next run
  const { error: updateErr } = await admin
    .from("clockings")
    .update({ override_type: newType })
    .eq("id", clockingId);

  if (updateErr) return { success: false, error: updateErr.message };

  return { success: true };
}

/**
 * Assign (or clear) a shift for a member on a specific date.
 * Replaces any existing scheduled_shifts row for that member+date,
 * and updates all work_periods on that date to point to the new row.
 */
export async function setDayShift(
  memberId: string,
  date: string, // "YYYY-MM-DD"
  shiftDefinitionId: string | null
): Promise<{ success: boolean; error?: string }> {
  const caller = await getCallerMembership();
  if (!caller) return { success: false, error: "Not authenticated" };
  if (caller.role !== "owner" && caller.role !== "admin") {
    return { success: false, error: "Insufficient permissions" };
  }

  const admin = getAdminClient();

  // Verify target member is in same org
  const { data: target } = await admin
    .from("members")
    .select("id")
    .eq("id", memberId)
    .eq("organisation_id", caller.organisation_id)
    .maybeSingle();
  if (!target) return { success: false, error: "Member not found" };

  // Delete any existing scheduled_shifts for this member+date
  await admin
    .from("scheduled_shifts")
    .delete()
    .eq("member_id", memberId)
    .eq("organisation_id", caller.organisation_id)
    .eq("schedule_date", date);

  // "__off__" sentinel = employee not scheduled to work (day off)
  const isOffDay = shiftDefinitionId === "__off__";

  if (shiftDefinitionId === null) {
    // Clear: no scheduled shift at all (open/flexible)
    await admin
      .from("work_periods")
      .update({ scheduled_shift_id: null })
      .eq("member_id", memberId)
      .eq("organisation_id", caller.organisation_id)
      .eq("timesheet_date", date);
    return { success: true };
  }

  if (!isOffDay) {
    // Verify the specific shift belongs to same org
    const { data: shiftDef } = await admin
      .from("shift_definitions")
      .select("id")
      .eq("id", shiftDefinitionId)
      .eq("organisation_id", caller.organisation_id)
      .maybeSingle();
    if (!shiftDef) return { success: false, error: "Shift not found" };
  }

  // Insert new scheduled_shifts row
  const { data: ss, error: ssErr } = await admin
    .from("scheduled_shifts")
    .insert({
      organisation_id: caller.organisation_id,
      member_id: memberId,
      shift_definition_id: isOffDay ? null : shiftDefinitionId,
      is_off_day: isOffDay,
      schedule_date: date,
    })
    .select("id")
    .single();
  if (ssErr) return { success: false, error: ssErr.message };

  // Update any work_periods on this date to reference the new scheduled_shifts row
  await admin
    .from("work_periods")
    .update({ scheduled_shift_id: ss.id })
    .eq("member_id", memberId)
    .eq("organisation_id", caller.organisation_id)
    .eq("timesheet_date", date);

  return { success: true };
}

// ── Debug actions (testing only) ─────────────────────────────────────────────

export async function debugCreateClocking(
  memberId: string,
  clockedAt: string,      // ISO string — treated as UTC
  rawType: string | null  // null | 'IN' | 'OUT'
): Promise<{ success: boolean; error?: string; id?: string }> {
  const caller = await getCallerMembership();
  if (!caller) return { success: false, error: "Not authenticated" };
  if (caller.role !== "owner" && caller.role !== "admin") {
    return { success: false, error: "Insufficient permissions" };
  }

  const admin = getAdminClient();

  const { data: target } = await admin
    .from("members").select("id")
    .eq("id", memberId).eq("organisation_id", caller.organisation_id).maybeSingle();
  if (!target) return { success: false, error: "Member not found" };

  const { data, error } = await admin
    .from("clockings")
    .insert({
      organisation_id: caller.organisation_id,
      member_id: memberId,
      clocked_at: clockedAt,
      raw_type: rawType,
      source: "debug",
    })
    .select("id").single();

  if (error) return { success: false, error: error.message };
  return { success: true, id: data.id };
}

export async function debugUpdateClocking(
  clockingId: string,
  clockedAt: string,
  rawType: string | null
): Promise<{ success: boolean; error?: string; newId?: string }> {
  const caller = await getCallerMembership();
  if (!caller) return { success: false, error: "Not authenticated" };
  if (caller.role !== "owner" && caller.role !== "admin") {
    return { success: false, error: "Insufficient permissions" };
  }

  const admin = getAdminClient();

  // Fetch original to copy member/org info (clocked_at is immutable via trigger)
  const { data: orig } = await admin
    .from("clockings")
    .select("id, organisation_id, member_id")
    .eq("id", clockingId).eq("organisation_id", caller.organisation_id).maybeSingle();
  if (!orig) return { success: false, error: "Clocking not found" };

  // Hard-delete old row, insert new
  await admin.from("clockings").delete().eq("id", clockingId);

  const { data, error } = await admin
    .from("clockings")
    .insert({
      organisation_id: orig.organisation_id,
      member_id: orig.member_id,
      clocked_at: clockedAt,
      raw_type: rawType,
      source: "debug",
    })
    .select("id").single();

  if (error) return { success: false, error: error.message };
  return { success: true, newId: data.id };
}

export async function debugDeleteClocking(
  clockingId: string
): Promise<{ success: boolean; error?: string }> {
  const caller = await getCallerMembership();
  if (!caller) return { success: false, error: "Not authenticated" };
  if (caller.role !== "owner" && caller.role !== "admin") {
    return { success: false, error: "Insufficient permissions" };
  }

  const admin = getAdminClient();

  const { error } = await admin
    .from("clockings")
    .delete()
    .eq("id", clockingId)
    .eq("organisation_id", caller.organisation_id);

  return error ? { success: false, error: error.message } : { success: true };
}

/**
 * Soft-delete a clocking and write an audit record.
 * The clocking remains in the DB for audit purposes.
 */
export async function deleteClocking(
  clockingId: string,
  reason: string
): Promise<{ success: boolean; error?: string }> {
  const caller = await getCallerMembership();
  if (!caller) return { success: false, error: "Not authenticated" };
  if (caller.role !== "owner" && caller.role !== "admin") {
    return { success: false, error: "Insufficient permissions" };
  }

  const admin = getAdminClient();

  const { data: clocking } = await admin
    .from("clockings")
    .select("id, organisation_id, inferred_type, clocked_at")
    .eq("id", clockingId)
    .eq("organisation_id", caller.organisation_id)
    .maybeSingle();

  if (!clocking) return { success: false, error: "Clocking not found" };

  const { error: auditErr } = await admin.from("clocking_adjustments").insert({
    clocking_id: clockingId,
    adjusted_by: caller.id,
    action: "delete",
    old_value: { inferred_type: clocking.inferred_type, clocked_at: clocking.clocked_at },
    new_value: null,
    reason,
  });

  if (auditErr) return { success: false, error: auditErr.message };

  const { error: deleteErr } = await admin
    .from("clockings")
    .update({ is_deleted: true })
    .eq("id", clockingId);

  if (deleteErr) return { success: false, error: deleteErr.message };

  return { success: true };
}
