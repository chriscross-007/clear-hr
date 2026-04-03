export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { EmployeeHolidayClient } from "./employee-holiday-client";

type HolidayYearRecord = {
  id: string;
  absence_type_id: string;
  year_start: string;
  year_end: string;
  base_amount: number;
  adjustment: number;
  carried_over: number;
  borrow_forward: number;
  pro_rata_amount: number | null;
};

type AbsenceProfileRow = {
  id: string;
  name: string;
  allowance: number;
  measurement_mode: string;
  absence_type_id: string;
};

export default async function EmployeeHolidayPage({
  params,
}: {
  params: Promise<{ memberId: string }>;
}) {
  const { memberId } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: caller } = await supabase
    .from("members")
    .select("role, organisation_id")
    .eq("user_id", user.id)
    .limit(1)
    .single();

  if (!caller || caller.role === "employee") redirect("/dashboard");

  // Fetch target member
  const { data: member } = await supabase
    .from("members")
    .select("id, first_name, last_name, holiday_profile_id, start_date")
    .eq("id", memberId)
    .eq("organisation_id", caller.organisation_id)
    .single();

  if (!member) redirect("/employees");

  // Fetch current profile name
  let currentProfileName = "No profile assigned";
  let currentMeasurementMode = "days";
  if (member.holiday_profile_id) {
    const { data: profile } = await supabase
      .from("absence_profiles")
      .select("name, measurement_mode")
      .eq("id", member.holiday_profile_id)
      .single();
    if (profile) {
      currentProfileName = profile.name;
      currentMeasurementMode = profile.measurement_mode;
    }
  }

  // Fetch all absence profiles for the org (for the change profile dropdown + profile name lookup)
  const { data: absenceProfiles } = await supabase
    .from("absence_profiles")
    .select("id, name, allowance, measurement_mode, absence_type_id")
    .eq("organisation_id", caller.organisation_id)
    .order("name");

  // Fetch holiday year records (initial)
  let { data: records } = await supabase
    .from("holiday_year_records")
    .select("id, absence_type_id, year_start, year_end, base_amount, adjustment, carried_over, borrow_forward, pro_rata_amount")
    .eq("member_id", memberId)
    .order("year_start", { ascending: true });

  // Auto-generate next year record if missing
  const today = new Date().toISOString().slice(0, 10);
  const typedRecords = (records ?? []) as HolidayYearRecord[];
  const currentYearRec = typedRecords.find((r) => r.year_start <= today && r.year_end >= today);

  if (currentYearRec && member.holiday_profile_id) {
    // Next year starts the day after current year ends
    const nextStart = new Date(currentYearRec.year_end + "T00:00:00Z");
    nextStart.setUTCDate(nextStart.getUTCDate() + 1);
    const nextStartStr = nextStart.toISOString().slice(0, 10);

    const hasNextYear = typedRecords.some((r) => r.year_start === nextStartStr);

    if (!hasNextYear) {
      // Find the current profile for allowance + absence_type_id
      const profile = (absenceProfiles ?? []).find(
        (p: AbsenceProfileRow) => p.id === member.holiday_profile_id
      ) as AbsenceProfileRow | undefined;

      if (profile) {
        const nextEnd = new Date(Date.UTC(
          nextStart.getUTCFullYear() + 1,
          nextStart.getUTCMonth(),
          nextStart.getUTCDate() - 1
        ));
        const allowance = Number(profile.allowance);

        await supabase.from("holiday_year_records").insert({
          organisation_id: caller.organisation_id,
          member_id: memberId,
          absence_type_id: profile.absence_type_id,
          year_start: nextStartStr,
          year_end: nextEnd.toISOString().slice(0, 10),
          base_amount: allowance,
          adjustment: 0,
          carried_over: 0,
          borrow_forward: 0,
          pro_rata_amount: allowance,
        });

        // Re-fetch records to include the new row
        const { data: refreshed } = await supabase
          .from("holiday_year_records")
          .select("id, absence_type_id, year_start, year_end, base_amount, adjustment, carried_over, borrow_forward, pro_rata_amount")
          .eq("member_id", memberId)
          .order("year_start", { ascending: true });
        records = refreshed;
      }
    }
  }

  // Fetch holiday bookings for this member to calculate Booked and Taken
  const { data: bookings } = await supabase
    .from("holiday_bookings")
    .select("start_date, end_date, days_deducted, status")
    .eq("member_id", memberId)
    .eq("status", "approved");

  // Build booked/taken aggregates keyed by holiday_year_record id
  const bookingAggregates: Record<string, { booked: number; taken: number }> = {};
  const finalRecords = (records ?? []) as HolidayYearRecord[];

  for (const rec of finalRecords) {
    let booked = 0;
    let taken = 0;
    for (const b of (bookings ?? [])) {
      if (!b.days_deducted) continue;
      if (b.start_date >= rec.year_start && b.start_date <= rec.year_end) {
        if (b.end_date < today) {
          taken += Number(b.days_deducted);
        } else {
          booked += Number(b.days_deducted);
        }
      }
    }
    bookingAggregates[rec.id] = { booked, taken };
  }

  // Build profile name map for the records table
  const profileMap: Record<string, string> = {};
  for (const p of (absenceProfiles ?? []) as AbsenceProfileRow[]) {
    profileMap[p.absence_type_id] = p.name;
  }

  const fullName = [member.first_name, member.last_name].filter(Boolean).join(" ");

  return (
    <div className="w-full px-4 py-8 sm:px-6 lg:px-8">
      <EmployeeHolidayClient
        memberId={memberId}
        memberName={fullName}
        currentProfileName={currentProfileName}
        currentProfileId={member.holiday_profile_id}
        measurementMode={currentMeasurementMode}
        records={finalRecords}
        absenceProfiles={(absenceProfiles ?? []) as AbsenceProfileRow[]}
        bookingAggregates={bookingAggregates}
        profileMap={profileMap}
      />
    </div>
  );
}
