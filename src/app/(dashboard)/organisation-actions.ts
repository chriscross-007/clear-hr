"use server";

import { createClient } from "@/lib/supabase/server";

export async function updateOrganisation(data: {
  name: string;
  memberLabel: string;
  requireMfa?: boolean;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { success: false, error: "Not authenticated" };

  // Verify caller is owner
  const { data: membership } = await supabase
    .from("members")
    .select("organisation_id, role")
    .eq("user_id", user.id)
    .limit(1)
    .single();

  if (!membership) return { success: false, error: "No organisation" };
  if (membership.role !== "owner")
    return { success: false, error: "Only the owner can edit organisation settings" };

  const updatePayload: Record<string, string | boolean> = {
    name: data.name,
    member_label: data.memberLabel || "member",
  };

  if (typeof data.requireMfa === "boolean") {
    updatePayload.require_mfa = data.requireMfa;
  }

  const { error } = await supabase
    .from("organisations")
    .update(updatePayload)
    .eq("id", membership.organisation_id);

  if (error) return { success: false, error: error.message };

  return { success: true };
}
