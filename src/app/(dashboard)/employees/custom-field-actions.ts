"use server";

import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";

export type FieldDef = {
  id: string;
  label: string;
  field_key: string;
  field_type: string;
  options: string[] | null;
  required: boolean;
  sort_order: number;
};

export async function getCustomFieldDefs(): Promise<FieldDef[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("custom_field_definitions")
    .select("id, label, field_key, field_type, options, required, sort_order")
    .eq("object_type", "member")
    .order("sort_order");
  return (data ?? []) as FieldDef[];
}

export async function createCustomFieldDef(
  def: Omit<FieldDef, "id">
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "Not authenticated" };

  const { data: membership } = await supabase
    .from("members")
    .select("organisation_id")
    .eq("user_id", user.id)
    .single();
  if (!membership) return { success: false, error: "No organisation" };

  const { error } = await supabase.from("custom_field_definitions").insert({
    organisation_id: membership.organisation_id,
    object_type: "member",
    label: def.label,
    field_key: def.field_key,
    field_type: def.field_type,
    options: def.options ? def.options : null,
    required: def.required,
    sort_order: def.sort_order,
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
  const supabase = await createClient();
  const payload: Record<string, unknown> = {};
  if (updates.label !== undefined) payload.label = updates.label;
  if (updates.field_type !== undefined) payload.field_type = updates.field_type;
  if (updates.options !== undefined)
    payload.options = updates.options?.length ? updates.options : null;
  if (updates.required !== undefined) payload.required = updates.required;
  if (updates.sort_order !== undefined) payload.sort_order = updates.sort_order;

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
  const supabase = await createClient();
  const { error } = await supabase
    .from("custom_field_definitions")
    .delete()
    .eq("id", id);
  if (error) return { success: false, error: error.message };
  return { success: true };
}

export async function reorderCustomFieldDefs(ids: string[]): Promise<void> {
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

  // Verify caller has edit access to this member's org
  const { data: callerMembership } = await supabase
    .from("members")
    .select("organisation_id, role, permissions")
    .eq("user_id", user.id)
    .single();
  if (!callerMembership) return { success: false, error: "No organisation" };

  const permissions =
    (callerMembership.permissions as Record<string, unknown>) ?? {};
  const accessMembers =
    callerMembership.role === "admin"
      ? (permissions.can_manage_members as string | undefined) ?? "none"
      : callerMembership.role === "owner"
        ? "write"
        : "none";
  const canEdit =
    callerMembership.role === "owner" || accessMembers === "write";
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
  if (targetMember.organisation_id !== callerMembership.organisation_id)
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
