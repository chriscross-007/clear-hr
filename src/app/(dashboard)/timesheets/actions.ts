"use server";

import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient } from "@supabase/supabase-js";
import { runInference } from "@/lib/timesheet/inference-engine";
import { logAudit } from "@/lib/audit";

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

// ── Timesheet edit actions ────────────────────────────────────────────────────

/** Helper: run inference for a member over a ±2-day window around a given date */
async function inferAround(memberId: string, organisationId: string, dateIso: string) {
  const admin = getAdminClient();
  const base  = new Date(`${dateIso.slice(0, 10)}T12:00:00Z`);
  const start = new Date(base); start.setUTCDate(base.getUTCDate() - 2);
  const end   = new Date(base); end.setUTCDate(base.getUTCDate() + 2);
  await runInference({ supabase: admin, organisationId, memberId, rangeStart: start, rangeEnd: end });
}

/** Helper: resolve caller's display name */
async function getCallerName(callerId: string): Promise<string> {
  const admin = getAdminClient();
  const { data } = await admin
    .from("members")
    .select("first_name, last_name, known_as")
    .eq("id", callerId)
    .maybeSingle();
  if (!data) return "Unknown";
  return `${data.known_as ?? data.first_name} ${data.last_name}`;
}

/**
 * Edit a clocking's time and/or raw type.
 * Stores edited values alongside originals; inference engine uses edited values.
 */
export async function editClocking(
  clockingId: string,
  editedClockedAt: string,           // ISO UTC — the adjusted timestamp
  editedRawType: string | null       // "IN" | "OUT" | null (bare swipe)
): Promise<{ success: boolean; error?: string }> {
  const caller = await getCallerMembership();
  if (!caller) return { success: false, error: "Not authenticated" };
  if (caller.role !== "owner" && caller.role !== "admin") {
    return { success: false, error: "Insufficient permissions" };
  }

  const admin = getAdminClient();

  const { data: clocking } = await admin
    .from("clockings")
    .select("id, organisation_id, member_id, clocked_at, raw_type, inferred_type, edited_clocked_at, edited_raw_type")
    .eq("id", clockingId)
    .eq("organisation_id", caller.organisation_id)
    .maybeSingle();

  if (!clocking) return { success: false, error: "Clocking not found" };

  const [callerName, targetName] = await Promise.all([
    getCallerName(caller.id),
    getCallerName(clocking.member_id),
  ]);
  const oldTime = clocking.edited_clocked_at ?? clocking.clocked_at;

  const { error: updateErr } = await admin
    .from("clockings")
    .update({
      edited_clocked_at:     editedClockedAt,
      edited_raw_type:       editedRawType,
      edited_by_member_id:   caller.id,
      edited_at:             new Date().toISOString(),
    })
    .eq("id", clockingId);

  if (updateErr) return { success: false, error: updateErr.message };

  await inferAround(clocking.member_id, caller.organisation_id, editedClockedAt.slice(0, 10));

  const { data: updated } = await admin
    .from("clockings")
    .select("inferred_type")
    .eq("id", clockingId)
    .maybeSingle();

  await logAudit({
    organisationId: caller.organisation_id,
    actorId:        caller.id,
    actorName:      callerName,
    action:         "Edited Timesheet",
    targetType:     "member",
    targetId:       clocking.member_id,
    targetLabel:    targetName,
    changes: {
      clocked_at:    { old: oldTime,                new: editedClockedAt                  },
      inferred_type: { old: clocking.inferred_type, new: updated?.inferred_type ?? null   },
    },
    metadata: { clocking_date: editedClockedAt.slice(0, 10) },
  });

  return { success: true };
}

/**
 * Revert an edited clocking back to its original state (clear edit fields).
 */
export async function deleteClockingEdit(
  clockingId: string
): Promise<{ success: boolean; error?: string }> {
  const caller = await getCallerMembership();
  if (!caller) return { success: false, error: "Not authenticated" };
  if (caller.role !== "owner" && caller.role !== "admin") {
    return { success: false, error: "Insufficient permissions" };
  }

  const admin = getAdminClient();

  const { data: clocking } = await admin
    .from("clockings")
    .select("id, organisation_id, member_id, clocked_at, raw_type, inferred_type, edited_clocked_at, edited_raw_type")
    .eq("id", clockingId)
    .eq("organisation_id", caller.organisation_id)
    .maybeSingle();

  if (!clocking) return { success: false, error: "Clocking not found" };
  if (!clocking.edited_clocked_at && !clocking.edited_raw_type) {
    return { success: false, error: "No edit to revert" };
  }

  const [callerName, targetName] = await Promise.all([
    getCallerName(caller.id),
    getCallerName(clocking.member_id),
  ]);

  const { error: updateErr } = await admin
    .from("clockings")
    .update({
      edited_clocked_at:   null,
      edited_raw_type:     null,
      edited_by_member_id: null,
      edited_at:           null,
    })
    .eq("id", clockingId);

  if (updateErr) return { success: false, error: updateErr.message };

  await inferAround(clocking.member_id, caller.organisation_id, clocking.clocked_at.slice(0, 10));

  const { data: reverted } = await admin
    .from("clockings")
    .select("inferred_type")
    .eq("id", clockingId)
    .maybeSingle();

  await logAudit({
    organisationId: caller.organisation_id,
    actorId:        caller.id,
    actorName:      callerName,
    action:         "Edited Timesheet",
    targetType:     "member",
    targetId:       clocking.member_id,
    targetLabel:    targetName,
    changes: {
      clocked_at:    { old: clocking.edited_clocked_at, new: clocking.clocked_at              },
      inferred_type: { old: clocking.inferred_type,     new: reverted?.inferred_type ?? null  },
    },
    metadata: { action: "reverted_edit", clocking_date: clocking.clocked_at.slice(0, 10) },
  });

  return { success: true };
}

/**
 * Hard-delete a clocking record and re-run inference.
 */
export async function deleteClocking(
  clockingId: string
): Promise<{ success: boolean; error?: string }> {
  const caller = await getCallerMembership();
  if (!caller) return { success: false, error: "Not authenticated" };
  if (caller.role !== "owner" && caller.role !== "admin") {
    return { success: false, error: "Insufficient permissions" };
  }

  const admin = getAdminClient();

  const { data: clocking } = await admin
    .from("clockings")
    .select("id, organisation_id, member_id, clocked_at, raw_type, inferred_type, edited_clocked_at")
    .eq("id", clockingId)
    .eq("organisation_id", caller.organisation_id)
    .maybeSingle();

  if (!clocking) return { success: false, error: "Clocking not found" };

  const [callerName, targetName] = await Promise.all([
    getCallerName(caller.id),
    getCallerName(clocking.member_id),
  ]);
  const effectiveDate = (clocking.edited_clocked_at ?? clocking.clocked_at).slice(0, 10);

  const { error: delErr } = await admin
    .from("clockings")
    .delete()
    .eq("id", clockingId);

  if (delErr) return { success: false, error: delErr.message };

  await logAudit({
    organisationId: caller.organisation_id,
    actorId:        caller.id,
    actorName:      callerName,
    action:         "Edited Timesheet",
    targetType:     "member",
    targetId:       clocking.member_id,
    targetLabel:    targetName,
    changes: {
      clocked_at:    { old: clocking.edited_clocked_at ?? clocking.clocked_at, new: null },
      inferred_type: { old: clocking.inferred_type,                            new: null },
    },
    metadata: { action: "deleted", clocking_date: effectiveDate },
  });

  await inferAround(clocking.member_id, caller.organisation_id, effectiveDate);

  return { success: true };
}

/**
 * Add a new clocking for a member and re-run inference.
 */
export async function addClocking(
  memberId: string,
  clockedAt: string,           // ISO UTC
  rawType: string | null,      // "IN" | "OUT" | null (bare swipe)
  overrideType?: string | null // inferred type override, bypasses inference
): Promise<{ success: boolean; error?: string }> {
  const caller = await getCallerMembership();
  if (!caller) return { success: false, error: "Not authenticated" };
  if (caller.role !== "owner" && caller.role !== "admin") {
    return { success: false, error: "Insufficient permissions" };
  }

  const admin = getAdminClient();

  const { data: target } = await admin
    .from("members")
    .select("id")
    .eq("id", memberId)
    .eq("organisation_id", caller.organisation_id)
    .maybeSingle();

  if (!target) return { success: false, error: "Member not found" };

  const [callerName, targetName] = await Promise.all([
    getCallerName(caller.id),
    getCallerName(memberId),
  ]);

  const { data: created, error: insertErr } = await admin
    .from("clockings")
    .insert({
      organisation_id: caller.organisation_id,
      member_id:       memberId,
      clocked_at:      clockedAt,
      raw_type:        rawType,
      override_type:   overrideType ?? null,
      source:          "manual",
    })
    .select("id")
    .single();

  if (insertErr) return { success: false, error: insertErr.message };

  await logAudit({
    organisationId: caller.organisation_id,
    actorId:        caller.id,
    actorName:      callerName,
    action:         "Edited Timesheet",
    targetType:     "member",
    targetId:       memberId,
    targetLabel:    targetName,
    changes: {
      clocked_at: { old: null, new: clockedAt },
    },
    metadata: { action: "added", clocking_date: clockedAt.slice(0, 10) },
  });

  await inferAround(memberId, caller.organisation_id, clockedAt.slice(0, 10));

  return { success: true };
}

export interface MapClocking {
  id:           string;
  clockedAt:    string;
  rawType:      string | null;
  inferredType: string | null;
  latitude:     number | null;
  longitude:    number | null;
}

/**
 * Fetch clockings with GPS coordinates for a single member on a given date.
 * Only owners and admins may call this.
 */
export async function getClockingsWithLocation(
  memberId: string,
  date: string,        // "YYYY-MM-DD"
): Promise<{ clockings: MapClocking[]; error?: string }> {
  const caller = await getCallerMembership();
  if (!caller) return { clockings: [], error: "Unauthenticated" };
  if (caller.role !== "owner" && caller.role !== "admin") return { clockings: [], error: "Forbidden" };

  const supabase = await createServerClient();

  // Verify target member belongs to same org
  const { data: target } = await supabase
    .from("members")
    .select("id")
    .eq("id", memberId)
    .eq("organisation_id", caller.organisation_id)
    .maybeSingle();

  if (!target) return { clockings: [], error: "Member not found" };

  const { data, error } = await supabase
    .from("clockings")
    .select("id, clocked_at, raw_type, inferred_type, latitude, longitude")
    .eq("member_id", memberId)
    .eq("organisation_id", caller.organisation_id)
    .eq("is_deleted", false)
    .gte("clocked_at", `${date}T00:00:00Z`)
    .lte("clocked_at", `${date}T23:59:59Z`)
    .order("clocked_at");

  if (error) return { clockings: [], error: error.message };

  return {
    clockings: (data ?? []).map((c) => ({
      id:           c.id as string,
      clockedAt:    c.clocked_at as string,
      rawType:      c.raw_type as string | null,
      inferredType: c.inferred_type as string | null,
      latitude:     c.latitude as number | null,
      longitude:    c.longitude as number | null,
    })),
  };
}
