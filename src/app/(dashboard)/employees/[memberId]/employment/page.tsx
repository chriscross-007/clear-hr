export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { EmploymentForm } from "./employment-form";

export default async function EmploymentPage({
  params,
}: {
  params: Promise<{ memberId: string }>;
}) {
  const { memberId } = await params;
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: caller } = await supabase
    .from("members")
    .select("organisation_id, role, permissions, organisations(currency_symbol)")
    .eq("user_id", user.id)
    .limit(1)
    .single();
  if (!caller) redirect("/organisation-setup");
  if (caller.role === "employee") redirect("/dashboard");

  const perms = (caller.permissions as Record<string, unknown>) ?? {};
  const accessMembers = caller.role === "owner"
    ? "write"
    : caller.role === "admin" ? ((perms.can_manage_members as string | undefined) ?? "none") : "none";
  const canEdit = caller.role === "owner" || accessMembers === "write";
  const canSeeCurrency = caller.role === "owner" || (caller.role === "admin" && perms.can_see_currency === true);
  const canAddMembers = caller.role === "owner" || (caller.role === "admin" && perms.can_add_members === true);
  const currencySymbol = (caller.organisations as unknown as { currency_symbol: string } | null)?.currency_symbol ?? "£";

  // Target member
  const { data: member } = await supabase
    .from("members")
    .select("id, first_name, last_name, email, role, team_id, payroll_number, avatar_url, invited_at, accepted_at, user_id, custom_fields, start_date, updated_at, admin_profile_id, employee_profile_id")
    .eq("id", memberId)
    .eq("organisation_id", caller.organisation_id)
    .single();
  if (!member) redirect("/employees");

  // Supporting data (mirrors the main Employees page)
  const [
    { data: teams },
    { data: adminProfiles },
    { data: employeeProfiles },
    { data: customFieldDefs },
    { data: teamsAssignments },
  ] = await Promise.all([
    supabase.from("teams").select("id, name").eq("organisation_id", caller.organisation_id).order("name"),
    supabase.from("admin_profiles").select("id, name").eq("organisation_id", caller.organisation_id).order("name"),
    supabase.from("employee_profiles").select("id, name").eq("organisation_id", caller.organisation_id).order("name"),
    supabase.from("custom_field_definitions").select("id, label, field_key, field_type, options, required, sort_order, max_decimal_places").eq("organisation_id", caller.organisation_id).eq("object_type", "member").order("sort_order"),
    supabase.from("member_teams").select("team_id").eq("member_id", memberId),
  ]);

  const allDefs = (customFieldDefs ?? []) as { id: string; label: string; field_key: string; field_type: string; options: string[] | null; required: boolean; sort_order: number; max_decimal_places: number | null }[];
  const visibleDefs = canSeeCurrency ? allDefs : allDefs.filter((d) => d.field_type !== "currency");

  const currentProfileId = member.role === "admin" || member.role === "owner"
    ? (member.admin_profile_id as string | null)
    : (member.employee_profile_id as string | null);

  const selectedTeamIds: string[] = (teamsAssignments ?? []).map((r) => r.team_id as string);
  if (selectedTeamIds.length === 0 && member.team_id) selectedTeamIds.push(member.team_id);

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold">Employment</h1>
        <p className="text-sm text-muted-foreground">
          {member.first_name} {member.last_name}
        </p>
      </div>

      <EmploymentForm
        member={{
          member_id: member.id,
          first_name: member.first_name,
          last_name: member.last_name,
          email: member.email,
          role: member.role,
          team_id: member.team_id,
          payroll_number: member.payroll_number,
          avatar_url: member.avatar_url,
          invited_at: member.invited_at,
          accepted_at: member.accepted_at,
          user_id: member.user_id,
          custom_fields: (member.custom_fields as Record<string, unknown>) ?? {},
          updated_at: member.updated_at,
          start_date: member.start_date,
          current_profile_id: currentProfileId,
          selected_team_ids: selectedTeamIds,
        }}
        canEdit={canEdit}
        canDelete={canAddMembers && member.role !== "owner"}
        teams={(teams ?? []) as { id: string; name: string }[]}
        adminProfiles={(adminProfiles ?? []) as { id: string; name: string }[]}
        employeeProfiles={(employeeProfiles ?? []) as { id: string; name: string }[]}
        customFieldDefs={visibleDefs}
        currencySymbol={currencySymbol}
      />
    </div>
  );
}
