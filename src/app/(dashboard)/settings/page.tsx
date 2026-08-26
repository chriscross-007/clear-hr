import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getEffectiveRightsForUser } from "@/lib/rights-resolver";

// CLE-196b-5 — /settings landing. Sends the caller to the first
// section their profile grants access to. Layout has already enforced
// "has at least one settings right", so this only picks the destination.

export default async function SettingsIndexPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const resolved = await getEffectiveRightsForUser(user.id);
  if (!resolved) redirect("/organisation-setup");
  const { rights } = resolved;

  if (rights.canEditOrgSettings) redirect("/settings/organisation");
  if (rights.canManageTeams) redirect("/settings/groups");
  if (rights.canEditRightsProfiles) redirect("/settings/profiles");
  if (rights.canManageBilling) redirect("/settings/backups");
  // Layout gate should have prevented us reaching here. Fallback to
  // dashboard just in case.
  redirect("/dashboard");
}
