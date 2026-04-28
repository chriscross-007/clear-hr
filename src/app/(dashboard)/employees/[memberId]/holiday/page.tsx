export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { EmployeeHolidayClient } from "./employee-holiday-client";

type HolidayYearRecord = {
  id: string;
  absence_type_id: string;
  absence_profile_id: string | null;
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
  carry_over_max: number | null;
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
    .select("id, first_name, last_name, start_date")
    .eq("id", memberId)
    .eq("organisation_id", caller.organisation_id)
    .single();

  if (!member) redirect("/employees");

  // Fetch all absence profiles for the org
  const { data: absenceProfiles } = await supabase
    .from("absence_profiles")
    .select("id, name, allowance, measurement_mode, absence_type_id, carry_over_max")
    .eq("organisation_id", caller.organisation_id)
    .order("name");

  // Fetch holiday year records (initial)
  let { data: records } = await supabase
    .from("holiday_year_records")
    .select("id, absence_type_id, absence_profile_id, year_start, year_end, base_amount, adjustment, carried_over, borrow_forward, pro_rata_amount")
    .eq("member_id", memberId)
    .order("year_start", { ascending: true });

  // Derive current profile from current year record
  const today = new Date().toISOString().slice(0, 10);
  const typedRecords = (records ?? []) as HolidayYearRecord[];
  const currentYearRec = typedRecords.find((r) => r.year_start <= today && r.year_end >= today);

  // Build profile lookups — by ID (preferred) and by absence_type_id (fallback)
  const profileById = new Map<string, AbsenceProfileRow>();
  const profileByTypeId = new Map<string, AbsenceProfileRow>();
  for (const p of (absenceProfiles ?? []) as AbsenceProfileRow[]) {
    profileById.set(p.id, p);
    profileByTypeId.set(p.absence_type_id, p);
  }

  function resolveProfile(rec: HolidayYearRecord): AbsenceProfileRow | undefined {
    if (rec.absence_profile_id) return profileById.get(rec.absence_profile_id);
    return profileByTypeId.get(rec.absence_type_id);
  }

  const currentProfile = currentYearRec ? resolveProfile(currentYearRec) : undefined;
  const currentProfileName = currentProfile?.name ?? "No profile assigned";
  const currentMeasurementMode = currentProfile?.measurement_mode ?? "days";
  const currentProfileId = currentProfile?.id ?? null;

  // Auto-generate next year record if missing
  if (currentYearRec && currentProfile) {
    const nextStart = new Date(currentYearRec.year_end + "T00:00:00Z");
    nextStart.setUTCDate(nextStart.getUTCDate() + 1);
    const nextStartStr = nextStart.toISOString().slice(0, 10);

    const hasNextYear = typedRecords.some((r) => r.year_start === nextStartStr);

    if (!hasNextYear) {
      const profile = currentProfile;

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
          .select("id, absence_type_id, absence_profile_id, year_start, year_end, base_amount, adjustment, carried_over, borrow_forward, pro_rata_amount")
          .eq("member_id", memberId)
          .order("year_start", { ascending: true });
        records = refreshed;
      }
    }
  }

  // Fetch holiday bookings for this member (all non-cancelled for aggregation + display)
  const { data: bookings } = await supabase
    .from("holiday_bookings")
    .select("id, start_date, end_date, start_half, end_half, days_deducted, hours_deducted, status, approver_note, employee_note, created_at, absence_reasons(name, colour), sick_booking_details(completion_status)")
    .eq("member_id", memberId)
    .in("status", ["pending", "approved"])
    .order("start_date", { ascending: true });

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

  // Build profile name, allowance, and carry-over max maps (keyed by record ID)
  const profileMap: Record<string, string> = {};
  const profileAllowanceMap: Record<string, number> = {};
  const carryOverMaxMap: Record<string, number | null> = {};
  for (const rec of finalRecords) {
    const p = resolveProfile(rec);
    if (p) {
      profileMap[rec.id] = p.name;
      profileAllowanceMap[rec.id] = Number(p.allowance);
      carryOverMaxMap[rec.id] = p.carry_over_max !== null ? Number(p.carry_over_max) : null;
    }
  }

  // Fetch employee work profile assignments
  const { data: empWorkProfiles } = await supabase
    .from("employee_work_profiles")
    .select("id, work_profile_id, effective_from, work_profiles(name)")
    .eq("member_id", memberId)
    .order("effective_from", { ascending: false });

  const workProfileAssignments = (empWorkProfiles ?? []).map((r) => {
    const wp = r.work_profiles as unknown as { name: string } | null;
    return {
      id: r.id,
      work_profile_id: r.work_profile_id,
      work_profile_name: wp?.name ?? "—",
      effective_from: r.effective_from,
    };
  });

  // Fetch all org work profiles for the assignment dropdown
  const { data: orgWorkProfiles } = await supabase
    .from("work_profiles")
    .select("id, name")
    .eq("organisation_id", caller.organisation_id)
    .is("member_id", null)
    .order("name");

  // Fetch the org's default work profile so the assignment sheet can pre-select it
  const { data: orgRow } = await supabase
    .from("organisations")
    .select("default_work_profile_id")
    .eq("id", caller.organisation_id)
    .single();
  const orgDefaultWorkProfileId = orgRow?.default_work_profile_id ?? null;

  const fullName = [member.first_name, member.last_name].filter(Boolean).join(" ");

  return (
    <div className="w-full px-4 py-8 sm:px-6 lg:px-8">
      <EmployeeHolidayClient
        memberId={memberId}
        memberName={fullName}
        currentProfileName={currentProfileName}
        currentProfileId={currentProfileId}
        measurementMode={currentMeasurementMode}
        records={finalRecords}
        absenceProfiles={(absenceProfiles ?? []) as AbsenceProfileRow[]}
        bookingAggregates={bookingAggregates}
        profileMap={profileMap}
        profileAllowanceMap={profileAllowanceMap}
        carryOverMaxMap={carryOverMaxMap}
        workProfileAssignments={workProfileAssignments}
        orgWorkProfiles={(orgWorkProfiles ?? []) as { id: string; name: string }[]}
        orgDefaultWorkProfileId={orgDefaultWorkProfileId}
        memberBookings={(bookings ?? []).map((b) => {
          const reason = b.absence_reasons as unknown as { name: string; colour: string } | null;
          const sickDetails = b.sick_booking_details as unknown as { completion_status: string } | null;
          return {
            id: b.id,
            start_date: b.start_date,
            end_date: b.end_date,
            start_half: b.start_half,
            end_half: b.end_half,
            days_deducted: b.days_deducted,
            status: b.status,
            reason_name: reason?.name ?? "—",
            reason_colour: reason?.colour ?? "#6366f1",
            completion_status: sickDetails?.completion_status ?? null,
          };
        })}
      />
    </div>
  );
}
