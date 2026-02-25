import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { EmployeesClient } from "./employees-client";

export default async function EmployeesPage({
  searchParams,
}: {
  searchParams: Promise<{ memberId?: string }>;
}) {
  const { memberId } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: members } = await supabase.rpc("get_org_members");

  const { data: membership } = await supabase
    .from("members")
    .select("organisation_id, role, permissions, organisations(name, max_employees)")
    .eq("user_id", user.id)
    .limit(1)
    .single();

  const canManage =
    membership?.role === "owner" ||
    (membership?.role === "admin" &&
      (membership?.permissions as Record<string, boolean>)
        ?.can_manage_members === true);

  const org = membership?.organisations as unknown as { name: string; max_employees: number } | null;
  const orgName = org?.name ?? "";
  const maxEmployees = org?.max_employees ?? 999;

  // Fetch teams for the org
  const { data: teams } = await supabase
    .from("teams")
    .select("id, name")
    .eq("organisation_id", membership!.organisation_id)
    .order("name");

  // Fetch rights profiles
  const { data: adminProfiles } = await supabase
    .from("admin_profiles")
    .select("id, name, rights")
    .eq("organisation_id", membership!.organisation_id)
    .order("name");

  const { data: employeeProfiles } = await supabase
    .from("employee_profiles")
    .select("id, name, rights")
    .eq("organisation_id", membership!.organisation_id)
    .order("name");

  return (
    <EmployeesClient
      initialMembers={members ?? []}
      canManage={canManage}
      maxEmployees={maxEmployees}
      isOwner={membership?.role === "owner"}
      orgName={orgName}
      teams={teams ?? []}
      adminProfiles={(adminProfiles ?? []) as { id: string; name: string; rights: Record<string, unknown> }[]}
      employeeProfiles={(employeeProfiles ?? []) as { id: string; name: string; rights: Record<string, unknown> }[]}
      initialMemberId={memberId}
    />
  );
}
