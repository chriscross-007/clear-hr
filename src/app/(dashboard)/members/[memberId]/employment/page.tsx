export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getEffectiveRightsForUser, resolveTab } from "@/lib/rights-resolver";
import { EmploymentForm } from "./employment-form";
import { BookingsCard } from "./bookings-card";
import { UserRightsPicker } from "./user-rights-picker";
import { getAssignableProfiles } from "@/app/(dashboard)/settings/rights-profiles/actions";
import type { WorkProfileAssignmentRow } from "./work-profile-section";
import type { FieldDef } from "@/app/(dashboard)/employees/custom-field-actions";

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
    .select("organisation_id, organisations(currency_symbol)")
    .eq("user_id", user.id)
    .limit(1)
    .single();
  if (!caller) redirect("/organisation-setup");

  // CLE-196b-2 — Resolver-shaped permission gates.
  const resolved = await getEffectiveRightsForUser(user.id);
  if (!resolved) redirect("/organisation-setup");
  const { rights } = resolved;
  if (rights.crossUserAccess === "self") redirect("/dashboard");

  const canEdit = resolveTab(rights, "employment").update;
  const canSeeCurrency = rights.canViewSensitiveFields;
  const canEditSensitiveFields = rights.canEditSensitiveFields;
  const canAddMembers = rights.canDeleteUsers; // delete-user right gates the delete button
  const currencySymbol = (caller.organisations as unknown as { currency_symbol: string } | null)?.currency_symbol ?? "£";

  // Target member
  const { data: member } = await supabase
    .from("members")
    .select("id, first_name, last_name, email, role, team_id, payroll_number, avatar_url, invited_at, accepted_at, user_id, custom_fields, start_date, updated_at, rights_profile_id")
    .eq("id", memberId)
    .eq("organisation_id", caller.organisation_id)
    .single();
  if (!member) redirect("/employees");

  // CLE-198 follow-up — Assignable User Rights profiles for the picker.
  const rightsProfilesList = await getAssignableProfiles();

  // Supporting data (mirrors the main Employees page) — plus the
  // Work Profile assignment surface relocated from the Holiday page (CLE-170).
  const [
    { data: teams },
    { data: customFieldDefs },
    { data: empWorkProfiles },
    { data: orgWorkProfiles },
    { data: orgRow },
  ] = await Promise.all([
    supabase.from("teams").select("id, name").eq("organisation_id", caller.organisation_id).order("name"),
    supabase.from("custom_field_definitions").select("id, label, field_key, field_type, input_mode, options, required, sort_order, max_decimal_places, is_sensitive").eq("organisation_id", caller.organisation_id).eq("object_type", "member").order("sort_order"),
    supabase.from("employee_work_profiles").select("id, work_profile_id, effective_from, work_profiles(name)").eq("member_id", memberId).order("effective_from", { ascending: false }),
    supabase.from("work_profiles").select("id, name").eq("organisation_id", caller.organisation_id).is("member_id", null).order("name"),
    supabase.from("organisations").select("default_work_profile_id").eq("id", caller.organisation_id).single(),
  ]);

  const workProfileAssignments: WorkProfileAssignmentRow[] = (empWorkProfiles ?? []).map((r) => {
    const wp = r.work_profiles as unknown as { name: string } | null;
    return {
      id: r.id,
      work_profile_id: r.work_profile_id,
      work_profile_name: wp?.name ?? "—",
      effective_from: r.effective_from,
    };
  });
  const orgDefaultWorkProfileId = (orgRow as { default_work_profile_id: string | null } | null)?.default_work_profile_id ?? null;

  // Canonical FieldDef type — catches missing SELECT columns at
  // compile time when the schema grows. See "Schema change discipline"
  // in CLAUDE.md.
  const allDefs = (customFieldDefs ?? []) as FieldDef[];
  const visibleDefs = canSeeCurrency ? allDefs : allDefs.filter((d) => d.field_type !== "currency");

  // CLE-201c — legacy admin/employee profile assignment resolved via
  // the User Rights profile id now.
  const currentProfileId = (member.rights_profile_id as string | null) ?? null;

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
        }}
        canEdit={canEdit}
        canDelete={canAddMembers}
        teams={(teams ?? []) as { id: string; name: string }[]}
        customFieldDefs={visibleDefs}
        currencySymbol={currencySymbol}
        workProfileAssignments={workProfileAssignments}
        orgWorkProfiles={(orgWorkProfiles ?? []) as { id: string; name: string }[]}
        orgDefaultWorkProfileId={orgDefaultWorkProfileId}
        canViewSensitiveFields={canSeeCurrency}
        canEditSensitiveFields={canEditSensitiveFields}
      />

      <UserRightsPicker
        memberId={member.id}
        memberName={`${member.first_name} ${member.last_name}`}
        currentProfileId={(member as { rights_profile_id: string | null }).rights_profile_id}
        profiles={rightsProfilesList.map((p) => ({ id: p.id, name: p.name }))}
        canEdit={rights.canEditRightsProfiles}
      />

      {/* CLE-188 — Member Bookings utility. Admin/owner with manage-members
          rights only. Lets admins find and delete orphaned bookings (e.g.
          an open-ended sick booking left behind after Holiday Periods were
          removed). */}
      {canEdit && (
        <BookingsCard
          memberId={member.id}
          memberName={`${member.first_name} ${member.last_name}`}
          canManage={canEdit}
        />
      )}
    </div>
  );
}
