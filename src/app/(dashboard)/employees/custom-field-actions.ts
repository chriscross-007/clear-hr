"use server";

import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { getEffectiveRightsForUser } from "@/lib/rights-resolver";
import { logAudit } from "@/lib/audit";

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
  /** CLE-198 — when true, values in this field are redacted for
   *  viewers who lack `can_view_sensitive_fields` and every write is
   *  always audited regardless of profile rights. */
  is_sensitive: boolean;
};

export async function getCustomFieldDefs(): Promise<FieldDef[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("custom_field_definitions")
    .select("id, label, field_key, field_type, input_mode, options, required, sort_order, max_decimal_places, is_sensitive")
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
    is_sensitive: def.is_sensitive ?? false,
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
  if (updates.is_sensitive !== undefined) payload.is_sensitive = updates.is_sensitive;

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

  // CLE-198 — Audit sensitive-field writes. Any change to a field
  // flagged `is_sensitive` always writes an audit_log row regardless
  // of profile rights. Non-sensitive edits are NOT audited here
  // (existing member-update paths cover those). We fetch the def
  // metadata to know which changed keys are sensitive.
  const changedKeys = Object.keys(values).filter(
    (k) => JSON.stringify(existing[k]) !== JSON.stringify(values[k]),
  );
  if (changedKeys.length > 0) {
    const { data: defs } = await adminClient
      .from("custom_field_definitions")
      .select("field_key, label, is_sensitive")
      .eq("organisation_id", callerOrgId)
      .eq("object_type", "member")
      .in("field_key", changedKeys);
    const sensitiveChanges: Record<string, { old: unknown; new: unknown }> = {};
    for (const def of (defs ?? []) as Array<{ field_key: string; label: string; is_sensitive: boolean }>) {
      if (def.is_sensitive === true) {
        sensitiveChanges[def.label] = {
          old: existing[def.field_key] ?? null,
          new: values[def.field_key] ?? null,
        };
      }
    }
    if (Object.keys(sensitiveChanges).length > 0) {
      const { data: actorRow } = await adminClient
        .from("members")
        .select("id, first_name, last_name")
        .eq("user_id", user.id)
        .eq("organisation_id", callerOrgId)
        .single();
      const { data: targetRow } = await adminClient
        .from("members")
        .select("first_name, last_name")
        .eq("id", memberId)
        .single();
      await logAudit({
        organisationId: callerOrgId,
        actorId: (actorRow?.id as string) ?? user.id,
        actorName: `${actorRow?.first_name ?? ""} ${actorRow?.last_name ?? ""}`.trim() || "Unknown",
        action: "member.sensitive_fields.updated",
        targetType: "member",
        targetId: memberId,
        targetLabel: targetRow
          ? `${targetRow.first_name} ${targetRow.last_name}`
          : memberId,
        changes: sensitiveChanges,
        metadata: { is_sensitive: true },
      });
    }
  }

  return { success: true };
}
