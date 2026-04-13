export const dynamic = "force-dynamic";

import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { hasPlanFeature } from "@/lib/plan-config";
import { parseGridPrefs } from "@/lib/grid-prefs";
import { HolidayReportClient, type HolidayBookingRow } from "./holiday-report-client";

export default async function HolidayReportPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: membership } = await supabase
    .from("members")
    .select("id, organisation_id, role, organisations(plan, name, holiday_year_start_day, holiday_year_start_month)")
    .eq("user_id", user.id)
    .limit(1)
    .single();

  if (!membership) redirect("/login");
  if (membership.role !== "owner" && membership.role !== "admin") notFound();

  const org = membership.organisations as unknown as {
    plan: string;
    holiday_year_start_day: number;
    holiday_year_start_month: number;
    name: string;
  } | null;

  if (!hasPlanFeature(org?.plan ?? "lite", "reports")) notFound();

  const orgId = membership.organisation_id;
  const plan = org?.plan ?? "lite";
  const canCreateCustom = hasPlanFeature(plan, "custom_reports");

  // Fetch saved prefs and favourite status
  const [{ data: prefsRow }, { data: favRow }] = await Promise.all([
    supabase.from("user_grid_preferences").select("prefs").eq("user_id", user.id).eq("grid_id", "holiday-report").maybeSingle(),
    supabase.from("report_favourites").select("report_id").eq("user_id", user.id).eq("report_id", "holiday").maybeSingle(),
  ]);
  const savedPrefs = parseGridPrefs(prefsRow?.prefs);
  const isFavourited = !!favRow;

  // Compute default year range from org config
  const now = new Date();
  const startMonth = (org?.holiday_year_start_month ?? 1) - 1; // 0-indexed
  const startDay = org?.holiday_year_start_day ?? 1;
  let yearStart = new Date(Date.UTC(now.getUTCFullYear(), startMonth, startDay));
  if (yearStart > now) yearStart = new Date(Date.UTC(now.getUTCFullYear() - 1, startMonth, startDay));
  const yearEnd = new Date(Date.UTC(yearStart.getUTCFullYear() + 1, startMonth, startDay));
  yearEnd.setUTCDate(yearEnd.getUTCDate() - 1);

  const defaultFrom = yearStart.toISOString().slice(0, 10);
  const defaultTo = yearEnd.toISOString().slice(0, 10);

  // Fetch all org members for name/team lookup
  const { data: orgMembers } = await supabase
    .from("members")
    .select("id, first_name, last_name, payroll_number, team_id")
    .eq("organisation_id", orgId);

  const memberMap = new Map<string, { firstName: string; lastName: string; payrollNumber: string | null; teamId: string | null }>();
  for (const m of orgMembers ?? []) {
    memberMap.set(m.id, { firstName: m.first_name, lastName: m.last_name, payrollNumber: m.payroll_number, teamId: m.team_id });
  }

  // Fetch teams
  const { data: teams } = await supabase
    .from("teams")
    .select("id, name")
    .eq("organisation_id", orgId)
    .order("name");

  const teamMap = new Map<string, string>();
  for (const t of teams ?? []) teamMap.set(t.id, t.name);

  // Fetch absence reasons
  const { data: absenceReasons } = await supabase
    .from("absence_reasons")
    .select("id, name, colour")
    .eq("organisation_id", orgId)
    .eq("is_deprecated", false)
    .order("name");

  // Fetch all bookings for the org
  const { data: bookingsData } = await supabase
    .from("holiday_bookings")
    .select("id, member_id, leave_reason_id, start_date, end_date, days_deducted, status, approver1_id, created_at, updated_at, absence_reasons(name, colour)")
    .eq("organisation_id", orgId)
    .order("start_date", { ascending: true });

  const rows: HolidayBookingRow[] = (bookingsData ?? []).map((b) => {
    const mem = memberMap.get(b.member_id);
    const reason = b.absence_reasons as unknown as { name: string; colour: string } | null;
    const approver = b.approver1_id ? memberMap.get(b.approver1_id) : null;
    return {
      id: b.id,
      first_name: mem?.firstName ?? "—",
      last_name: mem?.lastName ?? "—",
      payroll_number: mem?.payrollNumber ?? null,
      team_name: mem?.teamId ? teamMap.get(mem.teamId) ?? "—" : "—",
      team_id: mem?.teamId ?? null,
      leave_type: reason?.name ?? "—",
      leave_colour: reason?.colour ?? "#6366f1",
      leave_reason_id: b.leave_reason_id,
      start_date: b.start_date,
      end_date: b.end_date,
      days: b.days_deducted ? Number(b.days_deducted) : 0,
      status: b.status,
      created_at: b.created_at,
      actioned_by: approver ? `${approver.firstName} ${approver.lastName}` : null,
      actioned_at: (b.status === "approved" || b.status === "rejected") ? b.updated_at : null,
    };
  });

  return (
    <div className="w-full px-4 py-8 sm:px-6 lg:px-8">
      <HolidayReportClient
        rows={rows}
        teams={(teams ?? []) as { id: string; name: string }[]}
        absenceReasons={(absenceReasons ?? []) as { id: string; name: string; colour: string }[]}
        defaultFrom={defaultFrom}
        defaultTo={defaultTo}
        orgName={org?.name ?? ""}
        initialFavourited={isFavourited}
        initialPrefs={savedPrefs}
        canCreateCustom={canCreateCustom}
      />
    </div>
  );
}
