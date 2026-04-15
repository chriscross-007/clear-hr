export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { HolidayCalendar, type CalendarBooking, type CalendarBankHoliday } from "@/components/holiday-calendar";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";

export default async function EmployeeCalendarPage({
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

  const { data: member } = await supabase
    .from("members")
    .select("id, first_name, last_name")
    .eq("id", memberId)
    .eq("organisation_id", caller.organisation_id)
    .single();

  if (!member) redirect("/employees");

  const fullName = [member.first_name, member.last_name].filter(Boolean).join(" ");
  const today = new Date().toISOString().slice(0, 10);

  // Find current year record
  const { data: yearRec } = await supabase
    .from("holiday_year_records")
    .select("year_start, year_end")
    .eq("member_id", memberId)
    .lte("year_start", today)
    .gte("year_end", today)
    .limit(1)
    .single();

  if (!yearRec) {
    return (
      <div className="w-full px-4 py-8 sm:px-6 lg:px-8">
        <Link href="/employees" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4">
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to directory
        </Link>
        <h1 className="text-2xl font-bold mb-2">{fullName} — Calendar</h1>
        <p className="text-muted-foreground">No active holiday year record found.</p>
      </div>
    );
  }

  // Calculate 13-month range
  const rangeStart = yearRec.year_start;
  const startDate = new Date(rangeStart + "T00:00:00Z");
  const rangeEnd = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth() + 13, 0));
  const rangeEndStr = rangeEnd.toISOString().slice(0, 10);

  // Fetch bookings in range
  const { data: bookingsData } = await supabase
    .from("holiday_bookings")
    .select("id, start_date, end_date, status, days_deducted, absence_reasons(name, colour)")
    .eq("member_id", memberId)
    .lte("start_date", rangeEndStr)
    .gte("end_date", rangeStart)
    .in("status", ["pending", "approved"]);

  const bookings: CalendarBooking[] = (bookingsData ?? []).map((b) => {
    const reason = b.absence_reasons as unknown as { name: string; colour: string } | null;
    return {
      id: b.id,
      start_date: b.start_date,
      end_date: b.end_date,
      status: b.status,
      days_deducted: b.days_deducted,
      reason_name: reason?.name ?? "—",
      reason_colour: reason?.colour ?? "#6366f1",
    };
  });

  // Fetch org bank holiday colour
  const { data: orgRow } = await supabase
    .from("organisations")
    .select("bank_holiday_colour")
    .eq("id", caller.organisation_id)
    .single();
  const bankHolidayColour = (orgRow as { bank_holiday_colour?: string } | null)?.bank_holiday_colour ?? "#EF4444";

  // Fetch bank holidays in range
  const { data: bhData } = await supabase
    .from("bank_holidays")
    .select("date, name, is_excluded, organisation_id")
    .gte("date", rangeStart)
    .lte("date", rangeEndStr)
    .or(`organisation_id.is.null,organisation_id.eq.${caller.organisation_id}`);

  const excluded = new Set<string>();
  const bhList: CalendarBankHoliday[] = [];
  for (const bh of bhData ?? []) {
    if (bh.organisation_id && bh.is_excluded) {
      excluded.add(bh.date);
    } else if (!excluded.has(bh.date)) {
      bhList.push({ date: bh.date, name: bh.name });
    }
  }

  return (
    <div className="w-full px-4 py-8 sm:px-6 lg:px-8">
      <Link href="/employees" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4">
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to directory
      </Link>
      <h1 className="text-2xl font-bold mb-6">{fullName} — Calendar</h1>
      <HolidayCalendar
        yearStart={rangeStart}
        bookings={bookings}
        bankHolidays={bhList}
        bankHolidayColour={bankHolidayColour}
      />
    </div>
  );
}
