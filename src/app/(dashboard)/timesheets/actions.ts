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
 * Apply a manager override to a clocking's inferred_type.
 * Writes a clocking_adjustments audit record and locks the clocking.
 */
export async function overrideClockingType(
  clockingId: string,
  newType: string,
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
    .select("id, organisation_id, inferred_type, type_locked")
    .eq("id", clockingId)
    .eq("organisation_id", caller.organisation_id)
    .maybeSingle();

  if (!clocking) return { success: false, error: "Clocking not found" };

  const now = new Date().toISOString();

  // Write audit record first
  const { error: auditErr } = await admin.from("clocking_adjustments").insert({
    clocking_id: clockingId,
    adjusted_by: caller.id,
    action: "set_type",
    old_value: { inferred_type: clocking.inferred_type },
    new_value: { inferred_type: newType },
    reason,
  });

  if (auditErr) return { success: false, error: auditErr.message };

  // Update clocking — lock it so re-inference won't overwrite
  const { error: updateErr } = await admin
    .from("clockings")
    .update({
      inferred_type: newType,
      type_locked: true,
      type_locked_by: caller.id,
      type_locked_at: now,
    })
    .eq("id", clockingId);

  if (updateErr) return { success: false, error: updateErr.message };

  return { success: true };
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
