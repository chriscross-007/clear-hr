export const dynamic = "force-dynamic";

import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { WorkProfilesClient } from "./work-profiles-client";
import type { WorkProfile } from "../work-profile-actions";

export default async function WorkProfilesPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: member } = await supabase
    .from("members")
    .select("id, organisation_id, role")
    .eq("user_id", user.id)
    .limit(1)
    .single();

  if (!member) redirect("/login");
  if (member.role !== "owner" && member.role !== "admin") notFound();

  const { data: profiles } = await supabase
    .from("work_profiles")
    .select("id, organisation_id, name, hours_monday, hours_tuesday, hours_wednesday, hours_thursday, hours_friday, hours_saturday, hours_sunday")
    .eq("organisation_id", member.organisation_id)
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
    <div className="w-full px-4 py-8 sm:px-6 lg:px-8">
      <WorkProfilesClient initialProfiles={enriched} />
    </div>
  );
}
