export const dynamic = "force-dynamic";

import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ApprovalsClient } from "./approvals-client";
import type { ApprovalRow } from "../approvals-actions";
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

  // Fetch org members for name lookup and calendar
  const { data: orgMembers } = await supabase
    .from("members")
    .select("id, first_name, last_name, team_id")
    .eq("organisation_id", member.organisation_id)
    .order("first_name");

  const memberMap = new Map<string, { name: string }>();
  for (const m of orgMembers ?? []) {
    memberMap.set(m.id, {
      name: `${m.first_name} ${m.last_name}`,
    });
  }

  // Fetch pending bookings
  const { data: pendingData } = await supabase
    .from("holiday_bookings")
    .select("id, member_id, start_date, end_date, start_half, end_half, days_deducted, hours_deducted, status, approver1_id, approver_note, employee_note, created_at, absence_reasons(name, colour)")
    .eq("organisation_id", member.organisation_id)
    .eq("status", "pending")
    .order("created_at", { ascending: true });

  // Fetch all bookings
  const { data: allData } = await supabase
    .from("holiday_bookings")
    .select("id, member_id, start_date, end_date, start_half, end_half, days_deducted, hours_deducted, status, approver1_id, approver_note, employee_note, created_at, absence_reasons(name, colour)")
    .eq("organisation_id", member.organisation_id)
    .order("start_date", { ascending: true });

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

  // Calendar bookings (±2 months range)
  const rangeStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() - 2, 1));
  const rangeEnd = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() + 3, 0));
  const rangeStartStr = rangeStart.toISOString().slice(0, 10);
  const rangeEndStr = rangeEnd.toISOString().slice(0, 10);

  const { data: calBookingsData } = await supabase
    .from("holiday_bookings")
    .select("member_id, start_date, end_date, status, created_at, absence_reasons(name, colour)")
    .eq("organisation_id", member.organisation_id)
    .lte("start_date", rangeEndStr)
    .gte("end_date", rangeStartStr)
    .in("status", ["pending", "approved"]);

  const calendarBookings: TeamBooking[] = (calBookingsData ?? []).map((b) => {
    const reason = b.absence_reasons as unknown as { name: string; colour: string } | null;
    return {
      member_id: b.member_id,
      start_date: b.start_date,
      end_date: b.end_date,
      status: b.status,
      created_at: b.created_at,
      reason_name: reason?.name ?? "—",
      reason_colour: reason?.colour ?? "#6366f1",
    };
  });

  // Bank holidays
  const { data: bhData } = await supabase
    .from("bank_holidays")
    .select("date, name, is_excluded, organisation_id")
    .gte("date", rangeStartStr)
    .lte("date", rangeEndStr)
    .or(`organisation_id.is.null,organisation_id.eq.${member.organisation_id}`);

  const excluded = new Set<string>();
  const calendarBankHolidays: TeamBankHoliday[] = [];
  for (const bh of bhData ?? []) {
    if (bh.organisation_id && bh.is_excluded) excluded.add(bh.date);
    else if (!excluded.has(bh.date)) calendarBankHolidays.push({ date: bh.date, name: bh.name });
  }

  function mapRows(data: Record<string, unknown>[]): ApprovalRow[] {
    return data.map((b) => {
      const reason = b.absence_reasons as { name: string; colour: string } | null;
      const memberId = b.member_id as string;
      const mem = memberMap.get(memberId);
      const mode = "days"; // Simplified — measurement mode derived from booking context
      return {
        id: b.id as string,
        member_id: memberId,
        member_name: mem?.name ?? "—",
        start_date: b.start_date as string,
        end_date: b.end_date as string,
        start_half: b.start_half as string | null,
        end_half: b.end_half as string | null,
        days_deducted: b.days_deducted as number | null,
        hours_deducted: b.hours_deducted as number | null,
        status: b.status as string,
        approver_note: b.approver_note as string | null,
        approver_name: (b.approver1_id as string | null) ? memberMap.get(b.approver1_id as string)?.name ?? null : null,
        employee_note: b.employee_note as string | null,
        created_at: b.created_at as string,
        reason_name: reason?.name ?? "—",
        reason_colour: reason?.colour ?? "#6366f1",
        measurement_mode: mode,
      };
    });
  }

  return (
    <div className="w-full px-4 py-8 sm:px-6 lg:px-8">
      <ApprovalsClient
        pendingRows={mapRows(pendingData ?? [])}
        allRows={mapRows(allData ?? [])}
        calendarMembers={calendarMembers}
        calendarBookings={calendarBookings}
        calendarBankHolidays={calendarBankHolidays}
      />
    </div>
  );
}
