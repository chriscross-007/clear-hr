export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { WorkingPatternProfilesClient } from "./working-pattern-client";
import { ProfileExplainer } from "../profile-explainer";
import type { WorkProfile } from "@/app/(dashboard)/work-profile-actions";

// CLE-191 — Working Pattern profiles. Lifts the same data fetching as
// the legacy /work-profiles page but renders with the new list + popup
// CRUD pattern. The legacy /work-profiles route is left in place during
// the parallel period.

export default async function WorkingPatternProfilesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: caller } = await supabase
    .from("members")
    .select("organisation_id, role")
    .eq("user_id", user.id)
    .limit(1)
    .single();
  if (!caller) redirect("/organisation-setup");
  if (caller.role !== "owner") redirect("/settings");

  const { data: profiles } = await supabase
    .from("work_profiles")
    .select(
      "id, organisation_id, name, hours_monday, hours_tuesday, hours_wednesday, hours_thursday, hours_friday, hours_saturday, hours_sunday",
    )
    .eq("organisation_id", caller.organisation_id)
    .is("member_id", null)
    .order("name");

  const { data: assignments } = await supabase
    .from("employee_work_profiles")
    .select("work_profile_id");

  const countMap = new Map<string, number>();
  for (const a of assignments ?? []) {
    countMap.set(a.work_profile_id, (countMap.get(a.work_profile_id) ?? 0) + 1);
  }

  const enriched: WorkProfile[] = (profiles ?? []).map((p) => ({
    ...p,
    employee_count: countMap.get(p.id) ?? 0,
  }));

  return (
    <div className="space-y-6">
      <ProfileExplainer
        kind="live"
        note="Compute helpers resolve a member's pattern per-date, so reassigning a working pattern affects all future calculations immediately."
      />
      <WorkingPatternProfilesClient initialProfiles={enriched} />
    </div>
  );
}
