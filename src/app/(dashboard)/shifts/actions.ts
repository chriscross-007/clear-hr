"use server";

import { revalidatePath } from "next/cache";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient } from "@supabase/supabase-js";

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

async function getCallerMembership() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: membership } = await supabase
    .from("members")
    .select("id, organisation_id, role")
    .eq("user_id", user.id)
    .limit(1)
    .single();
  return membership ?? null;
}

interface SaveShiftPayload {
  id?: string;
  organisationId: string;
  name: string;
  isOpenShift: boolean;
  plannedStart: string | null;
  plannedEnd: string | null;
  crossesMidnight: boolean;
  breakType: string;
  active: boolean;
  sortOrder: number;
  breakRules: { band_start: string; band_end: string; allowed_break: string; penalty_break: string | null; paid: boolean; rate_id: string | null }[];
  overtimeAfterRules: { id?: string; period: string; threshold_hours: number; sort_order: number }[];
  overtimeBands: { id?: string; rate_id: string | null; from_time: string; to_time: string | null; min_time: string | null; sort_order: number }[];
}

export async function saveShiftDefinition(
  payload: SaveShiftPayload
): Promise<{ success: true; id: string } | { success: false; error: string }> {
  const caller = await getCallerMembership();
  if (!caller) return { success: false, error: "Not authenticated" };
  if (caller.role !== "owner" && caller.role !== "admin") {
    return { success: false, error: "Insufficient permissions" };
  }
  // Ensure the org matches
  if (caller.organisation_id !== payload.organisationId) {
    return { success: false, error: "Organisation mismatch" };
  }

  const admin = getAdminClient();
  const isNew = !payload.id;

  // Upsert the shift definition
  const shiftRow = {
    organisation_id:  payload.organisationId,
    name:             payload.name,
    is_open_shift:    payload.isOpenShift,
    planned_start:    payload.plannedStart,
    planned_end:      payload.plannedEnd,
    crosses_midnight: payload.crossesMidnight,
    break_type:       payload.breakType,
    break_rules:      payload.breakRules, // JSONB array
    active:           payload.active,
    sort_order:       payload.sortOrder,
  };

  let shiftId: string;

  if (isNew) {
    const { data, error } = await admin
      .from("shift_definitions")
      .insert(shiftRow)
      .select("id")
      .single();
    if (error) return { success: false, error: error.message };
    shiftId = data.id;
  } else {
    // Verify ownership before update
    const { data: existing } = await admin
      .from("shift_definitions")
      .select("id")
      .eq("id", payload.id)
      .eq("organisation_id", payload.organisationId)
      .maybeSingle();
    if (!existing) return { success: false, error: "Shift definition not found" };

    const { error } = await admin
      .from("shift_definitions")
      .update(shiftRow)
      .eq("id", payload.id!);
    if (error) return { success: false, error: error.message };
    shiftId = payload.id!;
  }

  // Replace overtime_after_rules: delete all, re-insert
  await admin.from("overtime_after_rules").delete().eq("shift_definition_id", shiftId);
  if (payload.overtimeAfterRules.length > 0) {
    const { error } = await admin.from("overtime_after_rules").insert(
      payload.overtimeAfterRules.map((r, i) => ({
        shift_definition_id: shiftId,
        period:              r.period,
        threshold_hours:     r.threshold_hours,
        sort_order:          i,
      }))
    );
    if (error) return { success: false, error: error.message };
  }

  // Replace overtime_bands: delete all, re-insert
  await admin.from("overtime_bands").delete().eq("shift_definition_id", shiftId);
  if (payload.overtimeBands.length > 0) {
    const { error } = await admin.from("overtime_bands").insert(
      payload.overtimeBands.map((b, i) => ({
        shift_definition_id: shiftId,
        rate_id:             b.rate_id,
        from_time:           b.from_time,
        to_time:             b.to_time,
        min_time:            b.min_time,
        sort_order:          i,
      }))
    );
    if (error) return { success: false, error: error.message };
  }

  revalidatePath("/", "layout");
  return { success: true, id: shiftId };
}

export async function deleteShiftDefinition(
  id: string
): Promise<{ success: boolean; error?: string }> {
  const caller = await getCallerMembership();
  if (!caller) return { success: false, error: "Not authenticated" };
  if (caller.role !== "owner" && caller.role !== "admin") {
    return { success: false, error: "Insufficient permissions" };
  }

  const admin = getAdminClient();
  const { error } = await admin
    .from("shift_definitions")
    .delete()
    .eq("id", id)
    .eq("organisation_id", caller.organisation_id);

  if (error) return { success: false, error: error.message };
  revalidatePath("/", "layout");
  return { success: true };
}
