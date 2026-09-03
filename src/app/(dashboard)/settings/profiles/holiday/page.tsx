export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getHolidayProfiles } from "@/app/(dashboard)/holiday-profile-actions";
import { ProfileExplainer } from "../profile-explainer";
import { HolidayProfilesClient } from "./holiday-profiles-client";

// CLE-194 Phase 2 — Holiday Profiles list + popup CRUD. Each org has a
// Default profile auto-seeded by trigger; admins create alternatives,
// reorder them, and copy. Each member points at one profile via
// `members.holiday_profile_id` (auto-assigned to the Default by another
// trigger on member insert). The profile's 7 values are snapshotted onto
// each new `holiday_periods` row at creation — future profile changes do
// NOT propagate to existing periods.

export default async function HolidayProfilesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { getEffectiveRightsForUser: _grH } = await import("@/lib/rights-resolver");
  const _rH = await _grH(user.id);
  if (!_rH) redirect("/organisation-setup");
  if (!_rH.rights.canEditOrgSettings) redirect("/settings");

  const profilesRes = await getHolidayProfiles();
  const initialProfiles = profilesRes.success ? (profilesRes.profiles ?? []) : [];

  return (
    <div className="space-y-6">
      <ProfileExplainer
        kind="seed"
        note="Each profile's 7 values are snapshotted onto a Holiday Period at creation. Changing a profile only affects periods created from that point onwards — existing periods keep their snapshotted values."
      />
      <HolidayProfilesClient initialProfiles={initialProfiles} />
    </div>
  );
}
