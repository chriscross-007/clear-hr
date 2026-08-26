export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getTeams, getApproverMembers } from "@/app/(dashboard)/employees/team-actions";
import { TeamsManager } from "./teams-manager";

// CLE-191 — /settings/groups. Today this renders only Teams; the page
// is named "Groups" so we can add Skills / Locations etc. later without
// renaming the route or the sidebar entry.

export default async function GroupsSettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: caller } = await supabase
    .from("members")
    .select("organisation_id")
    .eq("user_id", user.id)
    .limit(1)
    .single();
  if (!caller) redirect("/organisation-setup");

  // CLE-196b-5 — Groups (teams) gated by canManageTeams.
  const { getEffectiveRightsForUser } = await import("@/lib/rights-resolver");
  const resolved = await getEffectiveRightsForUser(user.id);
  if (!resolved?.rights.canManageTeams) redirect("/dashboard");

  const [teamsRes, approverRes] = await Promise.all([
    getTeams(),
    getApproverMembers(),
  ]);
  const initialTeams = teamsRes.success ? (teamsRes.teams ?? []) : [];
  const approverMembers = approverRes.success ? (approverRes.members ?? []) : [];

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <div>
        <h1 className="text-2xl font-bold">Groups</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Teams. (Skills, Locations and other group types arrive later.)
        </p>
      </div>
      <TeamsManager initialTeams={initialTeams} approverMembers={approverMembers} />
    </div>
  );
}
