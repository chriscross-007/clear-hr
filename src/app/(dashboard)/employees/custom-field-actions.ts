"use server";

import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { getEffectiveRightsForUser } from "@/lib/rights-resolver";

/**
 * CLE-196b-2 — Resolve the caller's write access to custom field
 * definitions via the Rights Profiles v2 resolver. Custom fields fold
 * into `canEditOrgSettings` in the new model.
 */
async function requireCustomFieldDefWriteAccess(): Promise<
  | { ok: true; organisationId: string }
  | { ok: false; error: string }
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not authenticated" };

  const resolved = await getEffectiveRightsForUser(user.id);
  if (!resolved) return { ok: false, error: "No organisation" };
  if (!resolved.rights.canEditOrgSettings) {
    return { ok: false, error: "You don't have write access to custom field definitions" };
  }
  return { ok: true, organisationId: resolved.ctx.organisationId };
}

/** Data type of the field's underlying value. Nine base types only —
 *  "dropdown" and "multiselect" were folded into `input_mode` on the
 *  20260824 migration. */
export type FieldType =
  | "text"
  | "multiline"
  | "email"
  | "url"
  | "phone"
  | "number"
  | "currency"
  | "date"
  | "checkbox";

/** How the user enters (or picks) the value. Options apply for the two
 *  choice modes; ignored/null for freeform. */
export type InputMode = "freeform" | "single_choice" | "multi_choice";

export type FieldDef = {
  id: string;
  label: string;
  field_key: string;
  field_type: string;
  input_mode: InputMode;
  options: string[] | null;
  required: boolean;
  sort_order: number;
  max_decimal_places: number | null;
};

export async function getCustomFieldDefs(): Promise<FieldDef[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("custom_field_definitions")
    .select("id, label, field_key, field_type, input_mode, options, required, sort_order, max_decimal_places")
    .eq("object_type", "member")
    .order("sort_order");
  return (data ?? []) as FieldDef[];
}

export async function createCustomFieldDef(
  def: Omit<FieldDef, "id">
): Promise<{ success: boolean; error?: string }> {
  const guard = await requireCustomFieldDefWriteAccess();
  if (!guard.ok) return { success: false, error: guard.error };
  const supabase = await createClient();

  const { error } = await supabase.from("custom_field_definitions").insert({
    organisation_id: guard.organisationId,
    object_type: "member",
    label: def.label,
    field_key: def.field_key,
    field_type: def.field_type,
    input_mode: def.input_mode ?? "freeform",
    options: def.options ? def.options : null,
    required: def.required,
    sort_order: def.sort_order,
    max_decimal_places: def.max_decimal_places ?? null,
  });

  if (error) {
    if (error.code === "23505")
      return { success: false, error: "A field with that key already exists" };
    return { success: false, error: error.message };
  }
  return { success: true };
}

export async function updateCustomFieldDef(
  id: string,
  updates: Partial<Omit<FieldDef, "id">>
): Promise<{ success: boolean; error?: string }> {
  const guard = await requireCustomFieldDefWriteAccess();
  if (!guard.ok) return { success: false, error: guard.error };
  const supabase = await createClient();
  const payload: Record<string, unknown> = {};
  if (updates.label !== undefined) payload.label = updates.label;
  if (updates.field_type !== undefined) payload.field_type = updates.field_type;
  if (updates.input_mode !== undefined) payload.input_mode = updates.input_mode;
  if (updates.options !== undefined)
    payload.options = updates.options?.length ? updates.options : null;
  if (updates.required !== undefined) payload.required = updates.required;
  if (updates.sort_order !== undefined) payload.sort_order = updates.sort_order;
  if ("max_decimal_places" in updates) payload.max_decimal_places = updates.max_decimal_places ?? null;

  const { error } = await supabase
    .from("custom_field_definitions")
    .update(payload)
    .eq("id", id);
  if (error) return { success: false, error: error.message };
  return { success: true };
}

export async function deleteCustomFieldDef(
  id: string
): Promise<{ success: boolean; error?: string }> {
  const guard = await requireCustomFieldDefWriteAccess();
  if (!guard.ok) return { success: false, error: guard.error };
  const supabase = await createClient();
  const { error } = await supabase
    .from("custom_field_definitions")
    .delete()
    .eq("id", id);
  if (error) return { success: false, error: error.message };
  return { success: true };
}

export async function reorderCustomFieldDefs(ids: string[]): Promise<void> {
  const guard = await requireCustomFieldDefWriteAccess();
  if (!guard.ok) return;
  const supabase = await createClient();
  await Promise.all(
    ids.map((id, i) =>
      supabase
        .from("custom_field_definitions")
        .update({ sort_order: i })
        .eq("id", id)
    )
  );
}

export async function saveCustomFieldValues(
  memberId: string,
  values: Record<string, unknown>
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "Not authenticated" };

  // CLE-196b-2 — Resolver-shaped edit check. Custom fields sit on the
  // Personal tab; anyone whose profile grants Personal.update on the
  // target's scope may edit them.
  const resolved = await getEffectiveRightsForUser(user.id);
  if (!resolved) return { success: false, error: "No organisation" };
  const callerOrgId = resolved.ctx.organisationId;
  const canEdit = resolved.rights.tabs.personal?.update === true;
  if (!canEdit) return { success: false, error: "Insufficient permissions" };

  const adminClient = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Verify target member is in same org
  const { data: targetMember } = await adminClient
    .from("members")
    .select("organisation_id, custom_fields")
    .eq("id", memberId)
    .single();
  if (!targetMember) return { success: false, error: "Member not found" };
  if (targetMember.organisation_id !== callerOrgId)
    return { success: false, error: "Member not in your organisation" };

  // Merge new values into existing custom_fields
  const existing = (targetMember.custom_fields as Record<string, unknown>) ?? {};
  const merged = { ...existing, ...values };

  const { error } = await adminClient
    .from("members")
    .update({ custom_fields: merged })
    .eq("id", memberId);
  if (error) return { success: false, error: error.message };
  return { success: true };
}
