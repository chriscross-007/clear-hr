export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ADMIN_RIGHTS, EMPLOYEE_RIGHTS } from "@/lib/rights-config";
import { getProfiles } from "@/app/(dashboard)/employees/profile-actions";
import { ProfileExplainer } from "../profile-explainer";
import { RightsProfilesClient } from "./rights-profiles-client";

// CLE-191 — Rights profiles. Wraps the existing `ProfileManager` for
// both admin + employee profile types. Internal switch lets the user
// toggle between the two roles; teams list is supplied so the admin
// team-access scope picker works.

export default async function RightsProfilesPage() {
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

  const [adminProfilesRes, employeeProfilesRes, { data: teams }] = await Promise.all([
    getProfiles("admin"),
    getProfiles("employee"),
    supabase
      .from("teams")
      .select("id, name")
      .eq("organisation_id", caller.organisation_id)
      .order("name"),
  ]);

  return (
    <div className="space-y-6">
      <ProfileExplainer
        kind="live"
        note="Assigned permissions update on the next page load after a profile change."
      />
      <RightsProfilesClient
        initialAdminProfiles={adminProfilesRes.success ? (adminProfilesRes.profiles ?? []) : []}
        initialEmployeeProfiles={employeeProfilesRes.success ? (employeeProfilesRes.profiles ?? []) : []}
        teams={(teams ?? []) as { id: string; name: string }[]}
        adminRights={ADMIN_RIGHTS}
        employeeRights={EMPLOYEE_RIGHTS}
      />
    </div>
  );
}
