import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sendHolidayReminderEmail } from "@/lib/email";

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }
  );
}

export async function GET(request: NextRequest) {
  // Verify cron secret
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = getAdminClient();

  // Find bookings starting in 3 days
  const target = new Date();
  target.setUTCDate(target.getUTCDate() + 3);
  const targetDate = target.toISOString().slice(0, 10);

  const { data: bookings, error } = await admin
    .from("holiday_bookings")
    .select("id, member_id, start_date, end_date, days_deducted, absence_reasons(name)")
    .eq("status", "approved")
    .eq("start_date", targetDate);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!bookings || bookings.length === 0) {
    return NextResponse.json({ sent: 0, message: "No bookings starting in 3 days" });
  }

  // Fetch member details for all booking owners
  const memberIds = [...new Set(bookings.map((b) => b.member_id))];
  const { data: members } = await admin
    .from("members")
    .select("id, email, first_name, organisations(name)")
    .in("id", memberIds);

  const memberMap = new Map<string, { email: string; firstName: string; orgName: string }>();
  for (const m of members ?? []) {
    const org = m.organisations as unknown as { name: string } | null;
    memberMap.set(m.id, { email: m.email, firstName: m.first_name, orgName: org?.name ?? "your organisation" });
  }

  // Determine base URL
  const host = request.headers.get("host") ?? "localhost:3000";
  const baseUrl = `${host.includes("localhost") ? "http" : "https"}://${host}`;

  let sent = 0;
  for (const b of bookings) {
    const member = memberMap.get(b.member_id);
    if (!member) continue;

    const reasonName = (b.absence_reasons as unknown as { name: string } | null)?.name ?? "Holiday";
    await sendHolidayReminderEmail(
      member.email,
      member.firstName,
      member.orgName,
      b.start_date,
      b.end_date,
      b.days_deducted ? Number(b.days_deducted) : null,
      reasonName,
      baseUrl
    );
    sent++;
  }

  return NextResponse.json({ sent, targetDate });
}
