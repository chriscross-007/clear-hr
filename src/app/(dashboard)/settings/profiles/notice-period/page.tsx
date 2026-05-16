export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getNoticePeriodProfiles } from "@/app/(dashboard)/notice-period-actions";
import { ProfileExplainer } from "../profile-explainer";
import { NoticePeriodClient } from "./notice-period-client";

// CLE-194 — Notice Period: multi-profile list + popup CRUD.
//
// Each org carries one is_default profile plus any number of named
// alternatives. Members point at a single profile (auto-seeded to the
// org's Default on member insert via DB trigger); admins re-assign via
// the Employment page.
//
// The block-or-warn flag lives on the profile, not the org. The legacy
// `organisations.notice_rules_block_requests` column is kept during the
// parallel period as a mirror of the Default profile's flag so the
// legacy OrganisationEditDialog Notice Periods tab continues to work.

export default async function NoticePeriodProfilesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: caller } = await supabase
    .from("members")
    .select("role")
    .eq("user_id", user.id)
    .limit(1)
    .single();
  if (!caller) redirect("/organisation-setup");
  if (caller.role !== "owner") redirect("/settings");

  const profilesRes = await getNoticePeriodProfiles();
  const initialProfiles = profilesRes.success ? (profilesRes.profiles ?? []) : [];

  return (
    <div className="space-y-6">
      <ProfileExplainer
        kind="live"
        note="The block-or-warn flag on each profile applies only to notice rules. The Cover rule has its own flag per team in Settings → Groups."
      />
      <NoticePeriodClient initialProfiles={initialProfiles} />
    </div>
  );
}
