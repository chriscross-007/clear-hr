export const dynamic = "force-dynamic";

import { createClient } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";
import { hasPlanFeature } from "@/lib/plan-config";
import { parseGridPrefs } from "@/lib/grid-prefs";
import { ALL_STANDARD_REPORTS } from "../definitions";
import { ReportClient } from "./report-client";

export default async function StandardReportPage({
  params,
}: {
  params: Promise<{ reportId: string }>;
}) {
  const { reportId } = await params;

  const report = ALL_STANDARD_REPORTS.find((r) => r.id === reportId);
  if (!report) notFound();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: membership } = await supabase
    .from("members")
    .select("id, organisation_id, role, permissions, organisations(plan, currency_symbol, name)")
    .eq("user_id", user.id)
    .limit(1)
    .single();

  if (!membership) redirect("/login");

  const org = membership.organisations as unknown as { plan: string; currency_symbol: string; name: string } | null;
  const plan = org?.plan ?? "lite";
  const currencySymbol = org?.currency_symbol ?? "£";
  const orgName = org?.name ?? "";

  if (!hasPlanFeature(plan, "reports")) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <p className="text-muted-foreground">Reports require a Pro or higher plan.</p>
      </div>
    );
  }

  if (membership.role !== "owner" && membership.role !== "admin") {
    return (
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <p className="text-muted-foreground">You don&apos;t have access to reports.</p>
      </div>
    );
  }

  const permissions = (membership.permissions as Record<string, unknown>) ?? {};
  const canSeeCurrency =
    membership.role === "owner" ||
    (membership.role === "admin" && (permissions.can_see_currency as boolean) === true);

  const gridId = `report_${reportId}`;

  const [
    { data: members },
    { data: teams },
    { data: adminProfiles },
    { data: employeeProfiles },
    { data: columnPrefsRow },
    { data: rawCustomFieldDefs },
    { data: favouritesData },
    { data: customReportsData },
  ] = await Promise.all([
    supabase.rpc("get_org_members"),
    supabase.from("teams").select("id, name").eq("organisation_id", membership.organisation_id).order("name"),
    supabase.from("admin_profiles").select("id, name, rights").eq("organisation_id", membership.organisation_id).order("name"),
    supabase.from("employee_profiles").select("id, name, rights").eq("organisation_id", membership.organisation_id).order("name"),
    supabase.from("user_grid_preferences").select("prefs").eq("user_id", user.id).eq("grid_id", gridId).maybeSingle(),
    supabase.from("custom_field_definitions").select("id, label, field_key, field_type, options, required, sort_order, max_decimal_places").eq("organisation_id", membership.organisation_id).eq("object_type", "member").order("sort_order"),
    supabase.from("report_favourites").select("report_id").eq("user_id", user.id),
    supabase.from("custom_reports").select("id, name, based_on, shared, created_by").eq("organisation_id", membership.organisation_id).order("name"),
  ]);

  const allDefs = (rawCustomFieldDefs ?? []) as { id: string; label: string; field_key: string; field_type: string; options: string[] | null; required: boolean; sort_order: number; max_decimal_places: number | null }[];
  const visibleDefs = canSeeCurrency ? allDefs : allDefs.filter((d) => d.field_type !== "currency");

  const favouriteIds = new Set((favouritesData ?? []).map((f: { report_id: string }) => f.report_id));
  const isFavourited = favouriteIds.has(reportId);

  const canCreateCustom = hasPlanFeature(plan, "custom_reports") &&
    (membership.role === "owner" || membership.role === "admin");

  const callerMemberId = membership.id;
  const customReports = (customReportsData ?? []) as { id: string; name: string; based_on: string; shared: boolean; created_by: string }[];
  const gridPrefs = parseGridPrefs(columnPrefsRow?.prefs);

  return (
    <ReportClient
      report={report}
      members={members ?? []}
      teams={teams ?? []}
      adminProfiles={(adminProfiles ?? []) as { id: string; name: string; rights: Record<string, unknown> }[]}
      employeeProfiles={(employeeProfiles ?? []) as { id: string; name: string; rights: Record<string, unknown> }[]}
      customFieldDefs={visibleDefs}
      currencySymbol={currencySymbol}
      canSeeCurrency={canSeeCurrency}
      initialColumnPrefs={gridPrefs.columns}
      initialGroupBy={gridPrefs.groupBy}
      initialPdfPageBreak={gridPrefs.pdfPageBreak}
      initialPdfRepeatHeaders={gridPrefs.pdfRepeatHeaders}
      initialAggregateMetrics={gridPrefs.aggregateMetrics}
      gridId={gridId}
      userId={user.id}
      isFavourited={isFavourited}
      canCreateCustom={canCreateCustom}
      callerMemberId={callerMemberId}
      existingCustomReports={customReports}
      orgName={orgName}
      savedFilters={gridPrefs.filters}
    />
  );
}
