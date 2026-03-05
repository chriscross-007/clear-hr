export const dynamic = "force-dynamic";

import { createClient } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";
import { hasPlanFeature } from "@/lib/plan-config";
import { ALL_STANDARD_REPORTS } from "../../definitions";
import { CustomReportViewClient } from "./custom-report-view-client";

export default async function CustomReportViewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

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

  if (!hasPlanFeature(plan, "custom_reports") || (membership.role !== "owner" && membership.role !== "admin")) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <p className="text-muted-foreground">Custom reports require a Pro or higher plan.</p>
      </div>
    );
  }

  const { data: customReport } = await supabase
    .from("custom_reports")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (!customReport) notFound();

  const report = ALL_STANDARD_REPORTS.find((r) => r.id === customReport.based_on);
  if (!report) notFound();

  const permissions = (membership.permissions as Record<string, unknown>) ?? {};
  const canSeeCurrency =
    membership.role === "owner" ||
    (membership.role === "admin" && (permissions.can_see_currency as boolean) === true);

  const [
    { data: members },
    { data: teams },
    { data: adminProfiles },
    { data: employeeProfiles },
    { data: rawCustomFieldDefs },
    { data: favouriteRow },
  ] = await Promise.all([
    supabase.rpc("get_org_members"),
    supabase.from("teams").select("id, name").eq("organisation_id", membership.organisation_id).order("name"),
    supabase.from("admin_profiles").select("id, name, rights").eq("organisation_id", membership.organisation_id).order("name"),
    supabase.from("employee_profiles").select("id, name, rights").eq("organisation_id", membership.organisation_id).order("name"),
    supabase.from("custom_field_definitions").select("id, label, field_key, field_type, options, required, sort_order, max_decimal_places").eq("organisation_id", membership.organisation_id).eq("object_type", "member").order("sort_order"),
    supabase.from("report_favourites").select("report_id").eq("user_id", user.id).eq("report_id", id).maybeSingle(),
  ]);

  const allDefs = (rawCustomFieldDefs ?? []) as { id: string; label: string; field_key: string; field_type: string; options: string[] | null; required: boolean; sort_order: number; max_decimal_places: number | null }[];
  const visibleDefs = canSeeCurrency ? allDefs : allDefs.filter((d) => d.field_type !== "currency");

  const savedPrefs = customReport.prefs as { columns?: { id: string; visible: boolean }[]; filters?: Record<string, unknown>; groupBy?: string };
  const isCreator = customReport.created_by === membership.id;
  const isFavourited = !!favouriteRow;

  return (
    <CustomReportViewClient
      customReport={{
        id: customReport.id,
        name: customReport.name,
        based_on: customReport.based_on,
        shared: customReport.shared,
        created_by: customReport.created_by,
        prefs: savedPrefs,
      }}
      baseReport={report}
      members={members ?? []}
      teams={teams ?? []}
      adminProfiles={(adminProfiles ?? []) as { id: string; name: string; rights: Record<string, unknown> }[]}
      employeeProfiles={(employeeProfiles ?? []) as { id: string; name: string; rights: Record<string, unknown> }[]}
      customFieldDefs={visibleDefs}
      currencySymbol={currencySymbol}
      userId={user.id}
      isCreator={isCreator}
      isFavourited={isFavourited}
      orgName={orgName}
    />
  );
}
