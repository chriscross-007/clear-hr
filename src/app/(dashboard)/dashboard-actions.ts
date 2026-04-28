"use server";

import { createClient } from "@/lib/supabase/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { AbsentMember, BirthdayMember, DashboardSummary } from "./dashboard-types";

function getAdminClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } },
  );
}

async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const { data: member } = await supabase
    .from("members")
    .select("id, organisation_id, role")
    .eq("user_id", user.id)
    .single();
  if (!member) throw new Error("No membership found");
  if (member.role !== "admin" && member.role !== "owner") {
    throw new Error("Not authorised");
  }
  return member;
}

// ---------------------------------------------------------------------------
// getDashboardSummary — fetch today's absences and birthdays
// ---------------------------------------------------------------------------

export async function getDashboardSummary(): Promise<{
  success: boolean;
  error?: string;
  data?: DashboardSummary;
}> {
  try {
    const caller = await requireAdmin();
    const admin = getAdminClient();
    const today = new Date().toISOString().slice(0, 10);

    // 1. Get the "Annual Leave" absence type ID(s) for this org
    const { data: annualLeaveTypes } = await admin
      .from("absence_types")
      .select("id")
      .eq("organisation_id", caller.organisation_id)
      .ilike("name", "Annual Leave");
    const annualLeaveTypeIds = new Set(
      (annualLeaveTypes ?? []).map((t) => t.id as string),
    );

    // 2. Fetch all approved bookings that cover today
    //    A booking covers today if: start_date <= today AND (end_date >= today OR end_date IS NULL)
    const { data: bookings, error: bookErr } = await admin
      .from("holiday_bookings")
      .select(`
        id,
        member_id,
        start_date,
        end_date,
        start_half,
        end_half,
        status,
        absence_reasons!inner(
          name,
          colour,
          absence_type_id
        ),
        members!holiday_bookings_member_id_fkey(
          first_name,
          last_name
        )
      `)
      .eq("organisation_id", caller.organisation_id)
      .in("status", ["approved", "pending"])
      .lte("start_date", today)
      .or(`end_date.gte.${today},end_date.is.null`);

    if (bookErr) return { success: false, error: bookErr.message };

    const absentToday: AbsentMember[] = [];
    const onHolidayToday: AbsentMember[] = [];

    for (const b of bookings ?? []) {
      const reason = b.absence_reasons as unknown as {
        name: string;
        colour: string;
        absence_type_id: string;
      };
      const mem = b.members as unknown as {
        first_name: string;
        last_name: string;
      };
      const memberName = `${mem.first_name ?? ""} ${mem.last_name ?? ""}`.trim();

      // Determine if today is a half-day for this booking
      let isHalfDay = false;
      let halfDayPeriod: string | null = null;

      if (b.start_date === today && b.start_half) {
        isHalfDay = true;
        halfDayPeriod = b.start_half as string;
      } else if (b.end_date === today && b.end_half) {
        isHalfDay = true;
        halfDayPeriod = b.end_half as string;
      }

      const entry: AbsentMember = {
        memberId: b.member_id,
        memberName,
        reasonName: reason.name,
        reasonColour: reason.colour,
        isHalfDay,
        halfDayPeriod,
      };

      if (annualLeaveTypeIds.has(reason.absence_type_id)) {
        onHolidayToday.push(entry);
      } else {
        absentToday.push(entry);
      }
    }

    // Sort alphabetically
    absentToday.sort((a, b) => a.memberName.localeCompare(b.memberName));
    onHolidayToday.sort((a, b) => a.memberName.localeCompare(b.memberName));

    // 3. Birthdays — check for a custom field definition with key "date_of_birth"
    //    Custom fields are stored as JSONB on members.custom_fields
    const birthdaysToday: BirthdayMember[] = [];

    const { data: dobField } = await admin
      .from("custom_field_definitions")
      .select("field_key")
      .eq("organisation_id", caller.organisation_id)
      .eq("object_type", "member")
      .eq("field_type", "date")
      .ilike("field_key", "date_of_birth")
      .maybeSingle();

    if (dobField) {
      // Fetch all members and check their custom_fields for matching month/day
      const todayMonth = new Date().getUTCMonth() + 1;
      const todayDay = new Date().getUTCDate();

      const { data: members } = await admin
        .from("members")
        .select("id, first_name, last_name, custom_fields")
        .eq("organisation_id", caller.organisation_id);

      for (const m of members ?? []) {
        const fields = (m.custom_fields as Record<string, unknown>) ?? {};
        const dob = fields[dobField.field_key] as string | undefined;
        if (dob && typeof dob === "string") {
          const parts = dob.split("-");
          if (parts.length === 3) {
            const month = parseInt(parts[1], 10);
            const day = parseInt(parts[2], 10);
            if (month === todayMonth && day === todayDay) {
              birthdaysToday.push({
                memberId: m.id as string,
                memberName: `${m.first_name ?? ""} ${m.last_name ?? ""}`.trim(),
              });
            }
          }
        }
      }
      birthdaysToday.sort((a, b) => a.memberName.localeCompare(b.memberName));
    }

    return {
      success: true,
      data: { absentToday, onHolidayToday, birthdaysToday },
    };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "An error occurred" };
  }
}
