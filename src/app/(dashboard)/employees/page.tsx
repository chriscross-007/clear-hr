export const dynamic = 'force-dynamic';

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { parseGridPrefs } from "@/lib/grid-prefs";
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

  const canEdit = membership?.role === "owner" || accessMembers === "write";
  const canAdd = membership?.role === "owner" ||
    (membership?.role === "admin" && permissions.can_add_members === true);

  const org = membership?.organisations as unknown as { name: string; max_employees: number; currency_symbol: string } | null;
  const orgName = org?.name ?? "";
  const maxEmployees = org?.max_employees ?? 999;
  const currencySymbol = org?.currency_symbol ?? "£";
  const canSeeCurrency = membership?.role === "owner" || (membership?.role === "admin" && (permissions.can_see_currency as boolean) === true);

  const today = new Date().toISOString().slice(0, 10);
  const [{ data: members }, { data: teams }, { data: adminProfiles }, { data: employeeProfiles }, { data: columnPrefsRow }, { data: customFieldDefs }, { data: absenceProfiles }, { data: currentYearRecords }, { data: empWorkProfiles }] =
    await Promise.all([
      supabase.rpc("get_org_members"),
      supabase.from("teams").select("id, name").eq("organisation_id", membership!.organisation_id).order("name"),
      supabase.from("admin_profiles").select("id, name, rights").eq("organisation_id", membership!.organisation_id).order("name"),
      supabase.from("employee_profiles").select("id, name, rights").eq("organisation_id", membership!.organisation_id).order("name"),
      supabase.from("user_grid_preferences").select("prefs").eq("user_id", user.id).eq("grid_id", "employees").maybeSingle(),
      supabase.from("custom_field_definitions").select("id, label, field_key, field_type, options, required, sort_order, max_decimal_places").eq("organisation_id", membership!.organisation_id).eq("object_type", "member").order("sort_order"),
      supabase.from("absence_profiles").select("id, organisation_id, name, absence_type_id, type, allowance, measurement_mode, carry_over_max, carry_over_max_period, carry_over_min, borrow_ahead_max, borrow_ahead_max_period").eq("organisation_id", membership!.organisation_id).order("name"),
      supabase.from("holiday_year_records").select("member_id, absence_type_id").eq("organisation_id", membership!.organisation_id).lte("year_start", today).gte("year_end", today),
      supabase.from("employee_work_profiles").select("member_id, effective_from, work_profiles(name)").lte("effective_from", today).order("effective_from", { ascending: false }),
    ]);

  // Build holiday profile name map: member_id → profile name (derived from current year record)
  const holidayProfileMap = new Map<string, string>();
  const apByTypeId = new Map<string, string>();
  for (const ap of absenceProfiles ?? []) apByTypeId.set(ap.absence_type_id, ap.name);
  for (const rec of currentYearRecords ?? []) {
    if (!holidayProfileMap.has(rec.member_id)) {
      const name = apByTypeId.get(rec.absence_type_id);
      if (name) holidayProfileMap.set(rec.member_id, name);
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

  const allDefs = (customFieldDefs ?? []) as { id: string; label: string; field_key: string; field_type: string; options: string[] | null; required: boolean; sort_order: number; max_decimal_places: number | null }[];
  const visibleDefs = canSeeCurrency ? allDefs : allDefs.filter((d) => d.field_type !== "currency");
  const gridPrefs = parseGridPrefs(columnPrefsRow?.prefs);

  // Enrich members with holiday profile and work pattern names
  const enrichedMembers = (members ?? []).map((m: Record<string, unknown>) => ({
    ...m,
    holiday_profile_name: holidayProfileMap.get(m.member_id as string) ?? null,
    work_pattern_name: workPatternMap.get(m.member_id as string) ?? null,
  }));

  return (
    <EmployeesClient
      initialMembers={enrichedMembers}
      canEdit={canEdit}
      canAdd={canAdd}
      maxEmployees={maxEmployees}
      isOwner={membership?.role === "owner"}
      orgName={orgName}
      teams={teams ?? []}
      adminProfiles={(adminProfiles ?? []) as { id: string; name: string; rights: Record<string, unknown> }[]}
      employeeProfiles={(employeeProfiles ?? []) as { id: string; name: string; rights: Record<string, unknown> }[]}
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
    />
  );
}
