import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getEffectiveRightsForUser } from "@/lib/rights-resolver";
import { SettingsSidebar } from "./settings-sidebar";

// CLE-196b-1 — Settings shell. Rewired onto the Rights Profiles v2
// resolver. The Settings section is visible to anyone whose profile
// grants any settings-related right; individual sub-routes gate
// further via the same resolver flags.

export default async function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const resolved = await getEffectiveRightsForUser(user.id);
  if (!resolved) redirect("/organisation-setup");
  const { rights } = resolved;

  const canManageAny =
    rights.canEditOrgSettings ||
    rights.canManageBilling ||
    rights.canManageTeams ||
    rights.canEditRightsProfiles ||
    rights.canCreateUsers ||
    rights.canInviteUsers;
  if (!canManageAny) redirect("/dashboard");

  return (
    <div className="flex">
      <SettingsSidebar
        canEditOrgSettings={rights.canEditOrgSettings}
        canManageTeams={rights.canManageTeams}
        canEditRightsProfiles={rights.canEditRightsProfiles}
        canManageBilling={rights.canManageBilling}
      />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
