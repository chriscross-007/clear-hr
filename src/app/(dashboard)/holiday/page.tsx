export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { MyHolidayClient } from "./my-holiday-client";
import type {
  HolidayBookingRow,
  BalanceSummary,
  AbsenceReasonOption,
} from "../holiday-booking-actions";

export default async function MyHolidayPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: member } = await supabase
    .from("members")
    .select("id, organisation_id, role, team_id, holiday_profile_id")
    .eq("user_id", user.id)
    .limit(1)
    .single();

  if (!member) redirect("/login");

  const today = new Date().toISOString().slice(0, 10);

  // Fetch current year record
  const { data: yearRec } = await supabase
    .from("holiday_year_records")
    .select("id, year_start, year_end, pro_rata_amount, base_amount, adjustment, carried_over")
    .eq("member_id", member.id)
    .lte("year_start", today)
    .gte("year_end", today)
    .limit(1)
    .single();

  // Determine measurement mode
  let measurementMode = "days";
  if (member.holiday_profile_id) {
    const { data: profile } = await supabase
      .from("absence_profiles")
      .select("measurement_mode")
      .eq("id", member.holiday_profile_id)
      .single();
    if (profile) measurementMode = profile.measurement_mode;
  }

  // Compute balance
  let balance: BalanceSummary | null = null;
  if (yearRec) {
    const proRata = yearRec.pro_rata_amount ?? yearRec.base_amount;
    const entitlement = Number(proRata) + Number(yearRec.adjustment) + Number(yearRec.carried_over);

    const { data: bookings } = await supabase
      .from("holiday_bookings")
      .select("days_deducted, hours_deducted, status, end_date")
      .eq("member_id", member.id)
      .gte("start_date", yearRec.year_start)
      .lte("start_date", yearRec.year_end)
      .in("status", ["pending", "approved"]);

    let pending = 0;
    let booked = 0;
    let taken = 0;
    for (const b of bookings ?? []) {
      const val = measurementMode === "hours"
        ? Number(b.hours_deducted ?? 0)
        : Number(b.days_deducted ?? 0);
      if (b.status === "pending") {
        pending += val;
      } else if (b.status === "approved" && b.end_date < today) {
        taken += val;
      } else {
        booked += val;
      }
    }

    balance = {
      entitlement,
      pending,
      booked,
      taken,
      remaining: entitlement - pending - booked - taken,
      unit: measurementMode,
      yearStart: yearRec.year_start,
      yearEnd: yearRec.year_end,
    };
  }

  // Fetch bookings
  const { data: bookingsData } = await supabase
    .from("holiday_bookings")
    .select("id, leave_reason_id, start_date, end_date, start_half, end_half, days_deducted, hours_deducted, status, approver1_id, approver_note, employee_note, created_at, absence_reasons(name, colour)")
    .eq("member_id", member.id)
    .order("start_date", { ascending: true });

  // Resolve approver names
  const approverIds = [...new Set((bookingsData ?? []).map((b) => b.approver1_id).filter(Boolean))] as string[];
  const approverMap = new Map<string, string>();
  if (approverIds.length > 0) {
    const { data: approvers } = await supabase
      .from("members")
      .select("id, first_name, last_name")
      .in("id", approverIds);
    for (const a of approvers ?? []) {
      approverMap.set(a.id, `${a.first_name} ${a.last_name}`);
    }
  }

  const bookings: HolidayBookingRow[] = (bookingsData ?? []).map((b) => {
    const reason = b.absence_reasons as unknown as { name: string; colour: string } | null;
    return {
      id: b.id,
      leave_reason_id: b.leave_reason_id,
      start_date: b.start_date,
      end_date: b.end_date,
      start_half: b.start_half,
      end_half: b.end_half,
      days_deducted: b.days_deducted,
      hours_deducted: b.hours_deducted,
      status: b.status,
      approver_note: b.approver_note,
      approver_name: b.approver1_id ? approverMap.get(b.approver1_id) ?? null : null,
      employee_note: b.employee_note,
      created_at: b.created_at,
      reason_name: reason?.name ?? "—",
      reason_colour: reason?.colour ?? "#6366f1",
    };
  });

  // Fetch absence reasons for booking form
  const { data: reasonsData } = await supabase
    .from("absence_reasons")
    .select("id, name, colour, absence_type_id, absence_types(name, requires_approval)")
    .eq("organisation_id", member.organisation_id)
    .order("name");

  const reasons: AbsenceReasonOption[] = (reasonsData ?? []).map((r) => {
    const aType = r.absence_types as unknown as { name: string; requires_approval: boolean } | null;
    return {
      id: r.id,
      name: r.name,
      colour: r.colour,
      absence_type_id: r.absence_type_id,
      absence_type_name: aType?.name ?? "—",
      requires_approval: aType?.requires_approval ?? false,
    };
  });

  return (
    <div className="w-full px-4 py-8 sm:px-6 lg:px-8">
      <MyHolidayClient
        balance={balance}
        bookings={bookings}
        reasons={reasons}
        measurementMode={measurementMode}
      />
    </div>
  );
}
