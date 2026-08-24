export const dynamic = 'force-dynamic';

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { parseGridPrefs } from "@/lib/grid-prefs";
import { EmployeesClient } from "./employees-client";
import type { FieldDef } from "@/app/(dashboard)/employees/custom-field-actions";
import type { Profile } from "@/app/(dashboard)/employees/profile-actions";

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
    .select("organisation_id, role, permissions, organisations(name, max_employees, currency_symbol)")
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
      <div className="w-full px-4 py-8 sm:px-6 lg:px-8">
        <p className="text-muted-foreground">You don&apos;t have access to this page.</p>
      </div>
    );
  }

  const canAdd = membership?.role === "owner" ||
    (membership?.role === "admin" && permissions.can_add_members === true);

  const org = membership?.organisations as unknown as { name: string; max_employees: number; currency_symbol: string } | null;
  const orgName = org?.name ?? "";
  const maxEmployees = org?.max_employees ?? 999;
  const currencySymbol = org?.currency_symbol ?? "£";
  const canSeeCurrency = membership?.role === "owner" || (membership?.role === "admin" && (permissions.can_see_currency as boolean) === true);

  const today = new Date().toISOString().slice(0, 10);
  const [{ data: members }, { data: teams }, { data: adminProfiles }, { data: employeeProfiles }, { data: columnPrefsRow }, { data: customFieldDefs }, { data: currentHolidayPeriods }, { data: empWorkProfiles }, { data: approvalProfilesRaw }, { data: memberAssignmentsRaw }, { data: holidayAbsenceTypeRow }] =
    await Promise.all([
      supabase.rpc("get_org_members"),
      supabase.from("teams").select("id, name").eq("organisation_id", membership!.organisation_id).order("name"),
      supabase.from("admin_profiles").select("id, name, rights").eq("organisation_id", membership!.organisation_id).order("name"),
      supabase.from("employee_profiles").select("id, name, rights").eq("organisation_id", membership!.organisation_id).order("name"),
      supabase.from("user_grid_preferences").select("prefs").eq("user_id", user.id).eq("grid_id", "employees").maybeSingle(),
      supabase.from("custom_field_definitions").select("id, label, field_key, field_type, input_mode, options, required, sort_order, max_decimal_places").eq("organisation_id", membership!.organisation_id).eq("object_type", "member").order("sort_order"),
      // CLE-167 — read holiday_periods for the current period name per member,
      // replacing the old absence_profiles + holiday_year_records lookup. The
      // directory column "Holiday Profile" now shows the current Period name
      // until Phase 4 redesigns the column properly.
      supabase.from("holiday_periods").select("member_id, name").eq("organisation_id", membership!.organisation_id).lte("start_date", today).gte("end_date", today),
      supabase.from("employee_work_profiles").select("member_id, effective_from, work_profiles(name)").lte("effective_from", today).order("effective_from", { ascending: false }),
      // CLE-186 — Approver Profile column. We fetch the org's approval
      // profiles, every member's per-absence-type pointer, and resolve the
      // Holiday (Annual Leave) profile name for each member as the column's
      // displayed value.
      supabase.from("approval_profiles").select("id, name, absence_type_id, is_default").eq("organisation_id", membership!.organisation_id),
      supabase.from("members").select("id, approval_profile_assignments").eq("organisation_id", membership!.organisation_id),
      supabase.from("absence_types").select("id").eq("organisation_id", membership!.organisation_id).eq("is_default", true).eq("name", "Annual Leave").maybeSingle(),
    ]);

  // Build current Holiday Period name map: member_id → period name
  const holidayProfileMap = new Map<string, string>();
  for (const period of currentHolidayPeriods ?? []) {
    if (!holidayProfileMap.has(period.member_id)) {
      holidayProfileMap.set(period.member_id, period.name);
    }
  }

  // Build work pattern name map: member_id → most recent work profile name
  const workPatternMap = new Map<string, string>();
  for (const ewp of empWorkProfiles ?? []) {
    if (!workPatternMap.has(ewp.member_id)) {
      const wp = ewp.work_profiles as unknown as { name: string } | null;
      if (wp) workPatternMap.set(ewp.member_id, wp.name);
    }
  }

  // Canonical FieldDef type — catches missing SELECT columns at
  // compile time when the schema grows. See "Schema change discipline"
  // in CLAUDE.md.
  const allDefs = (customFieldDefs ?? []) as FieldDef[];
  const visibleDefs = canSeeCurrency ? allDefs : allDefs.filter((d) => d.field_type !== "currency");
  const gridPrefs = parseGridPrefs(columnPrefsRow?.prefs);

  // CLE-186 — build profile id → name map and member id → assignments map,
  // then resolve each member's Holiday (Annual Leave) approval profile name
  // for the Approver Profile column.
  const allApprovalProfiles = (approvalProfilesRaw ?? []) as { id: string; name: string; absence_type_id: string; is_default: boolean }[];
  const profileNameById = new Map<string, string>();
  for (const p of allApprovalProfiles) {
    profileNameById.set(p.id, p.name);
  }
  const assignmentsByMemberId = new Map<string, Record<string, string>>();
  for (const m of (memberAssignmentsRaw ?? []) as { id: string; approval_profile_assignments: Record<string, string> | null }[]) {
    assignmentsByMemberId.set(m.id, m.approval_profile_assignments ?? {});
  }
  const holidayAbsenceTypeId = (holidayAbsenceTypeRow as { id: string } | null)?.id ?? null;
  // Profiles for the Holiday (Annual Leave) absence type — used by the
  // Bulk Edit sheet's Approval Profile picker.
  const holidayApprovalProfiles = holidayAbsenceTypeId
    ? allApprovalProfiles
        .filter((p) => p.absence_type_id === holidayAbsenceTypeId)
        .map((p) => ({ id: p.id, name: p.name, isDefault: p.is_default }))
    : [];

  // Enrich members with holiday profile and work pattern names
  const enrichedMembers = (members ?? []).map((m: Record<string, unknown>) => {
    const memberIdStr = m.member_id as string;
    let approvalProfileName: string | null = null;
    if (holidayAbsenceTypeId) {
      const assignments = assignmentsByMemberId.get(memberIdStr) ?? {};
      const profileId = assignments[holidayAbsenceTypeId];
      if (profileId) {
        approvalProfileName = profileNameById.get(profileId) ?? null;
      }
    }
    return {
      ...m,
      holiday_profile_name: holidayProfileMap.get(memberIdStr) ?? null,
      work_pattern_name: workPatternMap.get(memberIdStr) ?? null,
      approval_profile_name: approvalProfileName,
    };
  });

  return (
    <EmployeesClient
      initialMembers={enrichedMembers}
      canAdd={canAdd}
      maxEmployees={maxEmployees}
      isOwner={membership?.role === "owner"}
      orgName={orgName}
      teams={teams ?? []}
      adminProfiles={(adminProfiles ?? []) as Profile[]}
      employeeProfiles={(employeeProfiles ?? []) as Profile[]}
      initialMemberId={memberId}
      initialColumnPrefs={gridPrefs.columns}
      initialGroupBy={gridPrefs.groupBy}
      initialPdfPageBreak={gridPrefs.pdfPageBreak}
      initialPdfRepeatHeaders={gridPrefs.pdfRepeatHeaders}
      initialAggregateMetrics={gridPrefs.aggregateMetrics}
      initialFilters={gridPrefs.filters}
      initialSorting={gridPrefs.sorting}
      customFieldDefs={visibleDefs}
      currencySymbol={currencySymbol}
      canSeeCurrency={canSeeCurrency}
      userId={user.id}
      holidayAbsenceTypeId={holidayAbsenceTypeId}
      holidayApprovalProfiles={holidayApprovalProfiles}
    />
  );
}
