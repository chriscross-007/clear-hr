"use server";

// CLE-188 — server actions for the Availability page.
//
// The page server-loads an initial 12-month window of bookings. The
// TeamCalendar then lets the user scroll to any month; when a month falls
// outside the loaded window we lazy-load it via the action below.

import { createClient } from "@/lib/supabase/server";
import type { TeamBooking } from "@/components/team-calendar";

export async function getAvailabilityBookingsForMonth(
  year: number,
  month: number, // 0-indexed (Jan = 0)
): Promise<{ success: boolean; error?: string; bookings: TeamBooking[] }> {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: "Not authenticated", bookings: [] };

    const { data: member } = await supabase
      .from("members")
      .select("organisation_id, role")
      .eq("user_id", user.id)
      .limit(1)
      .single();
    if (!member) return { success: false, error: "No organisation", bookings: [] };
    if (member.role !== "owner" && member.role !== "admin") {
      return { success: false, error: "Not authorised", bookings: [] };
    }

    const monthStart = new Date(Date.UTC(year, month, 1));
    const monthEnd = new Date(Date.UTC(year, month + 1, 0));
    const fromISO = monthStart.toISOString().slice(0, 10);
    const toISO = monthEnd.toISOString().slice(0, 10);

    const { data, error } = await supabase
      .from("holiday_bookings")
      .select("id, member_id, start_date, end_date, status, days_deducted, absence_reasons(name, colour)")
      .eq("organisation_id", member.organisation_id)
      .lte("start_date", toISO)
      .or(`end_date.gte.${fromISO},end_date.is.null`)
      .in("status", ["pending", "approved"]);
    if (error) return { success: false, error: error.message, bookings: [] };

    const bookings: TeamBooking[] = (data ?? []).map((b) => {
      const reason = b.absence_reasons as unknown as { name: string; colour: string } | null;
      return {
        id: b.id as string,
        member_id: b.member_id as string,
        start_date: b.start_date as string,
        end_date: b.end_date as string | null,
        status: b.status as string,
        days_deducted: b.days_deducted ? Number(b.days_deducted) : null,
        reason_name: reason?.name ?? "—",
        reason_colour: reason?.colour ?? "#6366f1",
      };
    });
    return { success: true, bookings };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : "An error occurred",
      bookings: [],
    };
  }
}
