import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// CLE-191 — /settings landing. Sends the caller to the first section
// they can see. The layout has already enforced "has at least one
// settings right", so we never land here for a fully-blocked caller.

export default async function SettingsIndexPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: caller } = await supabase
    .from("members")
    .select("role, permissions")
    .eq("user_id", user.id)
    .limit(1)
    .single();
  if (!caller) redirect("/organisation-setup");

  const perms = (caller.permissions as Record<string, unknown>) ?? {};
  const isOwner = caller.role === "owner";

  if (isOwner || perms.can_edit_organisation === true) {
    redirect("/settings/organisation");
  }
  if (perms.can_define_custom_fields === true) {
    redirect("/settings/custom-fields");
  }
  if (perms.can_add_members === true) {
    redirect("/settings/groups");
  }
  // Layout gate should have prevented us reaching here. Fallback to
  // dashboard just in case.
  redirect("/dashboard");
}
