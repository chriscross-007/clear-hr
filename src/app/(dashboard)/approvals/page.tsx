export const dynamic = "force-dynamic";

import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ApprovalsClient } from "./approvals-client";
import { getPendingApprovals, getAllRequests } from "../approvals-actions";
import type { TeamMember, TeamBooking, TeamBankHoliday } from "@/components/team-calendar";

export default async function ApprovalsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: member } = await supabase
    .from("members")
    .select("id, organisation_id, role")
    .eq("user_id", user.id)
    .limit(1)
    .single();

  if (!member) redirect("/login");
  if (member.role !== "owner" && member.role !== "admin") notFound();

  // Fetch org country code
  const { data: orgRow } = await supabase
    .from("organisations")
    .select("country_code, bank_holiday_colour")
    .eq("id", member.organisation_id)
    .single();
  const orgCountryCode = (orgRow as { country_code?: string; bank_holiday_colour?: string } | null)?.country_code ?? "england-and-wales";
  const bankHolidayColour = (orgRow as { country_code?: string; bank_holiday_colour?: string } | null)?.bank_holiday_colour ?? "#EF4444";

  // Fetch org members for the calendar widget (calendarMembers below).
  const { data: orgMembers } = await supabase
    .from("members")
    .select("id, first_name, last_name, team_id")
    .eq("organisation_id", member.organisation_id)
    .order("first_name");

  // CLE-181 — fetch via actions so the pending list reflects only bookings
  // the caller can decide (profile-routed approvers + legacy "any admin"
  // bookings). The "All requests" tab still shows org-wide history.
  const pendingRows = await getPendingApprovals();
  const allRows = await getAllRequests();

  // --- Calendar data for inline TeamCalendar ---

  // Work profile assignments (latest effective per member)
  const today = new Date().toISOString().slice(0, 10);
  const { data: wpAssignments } = await supabase
    .from("employee_work_profiles")
    .select("member_id, work_profiles(hours_monday, hours_tuesday, hours_wednesday, hours_thursday, hours_friday, hours_saturday, hours_sunday)")
    .lte("effective_from", today)
    .order("effective_from", { ascending: false });

  const wpMap = new Map<string, number[]>();
  for (const a of wpAssignments ?? []) {
    if (wpMap.has(a.member_id)) continue;
    const wp = a.work_profiles as unknown as { hours_monday: number; hours_tuesday: number; hours_wednesday: number; hours_thursday: number; hours_friday: number; hours_saturday: number; hours_sunday: number } | null;
    if (wp) {
      wpMap.set(a.member_id, [
        Number(wp.hours_monday), Number(wp.hours_tuesday), Number(wp.hours_wednesday),
        Number(wp.hours_thursday), Number(wp.hours_friday), Number(wp.hours_saturday), Number(wp.hours_sunday),
      ]);
    }
  }

  const calendarMembers: (TeamMember & { teamId: string | null })[] = (orgMembers ?? []).map((m) => ({
    id: m.id,
    name: `${m.first_name} ${m.last_name}`,
    teamId: m.team_id,
    workPattern: wpMap.get(m.id) ?? null,
  }));

  // CLE-188 — widened from ±2 months to ±12. The inline TeamCalendar uses
  // a focusRange centred on the booking being approved, so the fetched
  // bookings must cover whichever month that booking falls in (not just
  // months near "today"). Approvals is admin-only and bounded in volume,
  // so over-fetching here is cheap.
  const todayUtcYear = new Date().getUTCFullYear();
  const todayUtcMonth = new Date().getUTCMonth();
  const rangeStart = new Date(Date.UTC(todayUtcYear, todayUtcMonth - 12, 1));
  const rangeEnd = new Date(Date.UTC(todayUtcYear, todayUtcMonth + 13, 0));
  const rangeStartStr = rangeStart.toISOString().slice(0, 10);
  const rangeEndStr = rangeEnd.toISOString().slice(0, 10);

  const { data: calBookingsData } = await supabase
    .from("holiday_bookings")
    .select("member_id, start_date, end_date, status, created_at, days_deducted, absence_reasons(name, colour)")
    .eq("organisation_id", member.organisation_id)
    .lte("start_date", rangeEndStr)
    .or(`end_date.gte.${rangeStartStr},end_date.is.null`)
    .in("status", ["pending", "approved"]);

  const calendarBookings: TeamBooking[] = (calBookingsData ?? []).map((b) => {
    const reason = b.absence_reasons as unknown as { name: string; colour: string } | null;
    return {
      member_id: b.member_id,
      start_date: b.start_date,
      end_date: b.end_date,
      status: b.status,
      created_at: b.created_at,
      days_deducted: b.days_deducted ? Number(b.days_deducted) : null,
      reason_name: reason?.name ?? "—",
      reason_colour: reason?.colour ?? "#6366f1",
    };
  });

  // Bank holidays
  const { data: bhData } = await supabase
    .from("bank_holidays")
    .select("date, name, is_excluded, organisation_id")
    .eq("country_code", orgCountryCode)
    .gte("date", rangeStartStr)
    .lte("date", rangeEndStr)
    .or(`organisation_id.is.null,organisation_id.eq.${member.organisation_id}`);

  const excluded = new Set<string>();
  const calendarBankHolidays: TeamBankHoliday[] = [];
  for (const bh of bhData ?? []) {
    if (bh.organisation_id && bh.is_excluded) excluded.add(bh.date);
    else if (!excluded.has(bh.date)) calendarBankHolidays.push({ date: bh.date, name: bh.name });
  }

  return (
    <div className="w-full px-4 py-8 sm:px-6 lg:px-8">
      <ApprovalsClient
        pendingRows={pendingRows}
        allRows={allRows}
        calendarMembers={calendarMembers}
        calendarBookings={calendarBookings}
        calendarBankHolidays={calendarBankHolidays}
        bankHolidayColour={bankHolidayColour}
      />
    </div>
  );
}
