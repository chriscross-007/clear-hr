export const dynamic = "force-dynamic";

import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ApprovalsClient } from "./approvals-client";
import type { ApprovalRow } from "../approvals-actions";

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

  // Fetch org members for name lookup (new RLS policy allows admins to read all)
  const { data: orgMembers } = await supabase
    .from("members")
    .select("id, first_name, last_name")
    .eq("organisation_id", member.organisation_id);

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
      />
    </div>
  );
}
