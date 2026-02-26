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

  const { data: membership } = await supabase
    .from("members")
    .select("organisation_id, role, permissions, organisations(name, max_employees)")
    .eq("user_id", user.id)
    .limit(1)
    .single();

  const permissions = (membership?.permissions as Record<string, unknown>) ?? {};

  const accessMembers = membership?.role === "admin"
    ? (permissions.can_manage_members as string | undefined) ?? "none"
    : membership?.role === "owner" ? "write" : "none";

  const canView = membership?.role === "owner" || accessMembers === "read" || accessMembers === "write";

  if (!canView) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <p className="text-muted-foreground">You don&apos;t have access to this page.</p>
      </div>
    );
  }

  const canEdit = membership?.role === "owner" || accessMembers === "write";
  const canAdd = membership?.role === "owner" ||
    (membership?.role === "admin" && permissions.can_add_members === true);

  const org = membership?.organisations as unknown as { name: string; max_employees: number } | null;
  const orgName = org?.name ?? "";
  const maxEmployees = org?.max_employees ?? 999;

  const [{ data: members }, { data: teams }, { data: adminProfiles }, { data: employeeProfiles }] =
    await Promise.all([
      supabase.rpc("get_org_members"),
      supabase.from("teams").select("id, name").eq("organisation_id", membership!.organisation_id).order("name"),
      supabase.from("admin_profiles").select("id, name, rights").eq("organisation_id", membership!.organisation_id).order("name"),
      supabase.from("employee_profiles").select("id, name, rights").eq("organisation_id", membership!.organisation_id).order("name"),
    ]);

  return (
    <EmployeesClient
      initialMembers={members ?? []}
      canEdit={canEdit}
      canAdd={canAdd}
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
