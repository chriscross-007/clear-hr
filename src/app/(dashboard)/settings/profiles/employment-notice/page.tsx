export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getEffectiveRightsForUser } from "@/lib/rights-resolver";
import { getEmploymentNoticeProfiles } from "@/app/(dashboard)/employment-notice-actions";
import { ProfileExplainer } from "../profile-explainer";
import { EmploymentNoticeClient } from "./employment-notice-client";

// CLE-239 — Employment Notice profiles (contractual notice): list + popup
// CRUD. Each org has a Default ("Standard") seeded by trigger; members
// point at one profile via members.employment_notice_profile_id.

export default async function EmploymentNoticeProfilesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const resolved = await getEffectiveRightsForUser(user.id);
  if (!resolved) redirect("/organisation-setup");
  if (!resolved.rights.canEditOrgSettings) redirect("/settings");

  const res = await getEmploymentNoticeProfiles();

  return (
    <div className="space-y-6">
      <ProfileExplainer
        kind="live"
        note="Notice terms from a contract. The Employment tab shows each person's terms; documents made from templates take the figures at the moment they're created, so changing a profile never alters documents already issued."
      />
      {res.success ? (
        <EmploymentNoticeClient initialProfiles={res.profiles} />
      ) : (
        <p className="text-sm text-destructive">{res.error}</p>
      )}
    </div>
  );
}
