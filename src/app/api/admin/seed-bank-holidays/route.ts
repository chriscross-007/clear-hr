import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

function getAdminClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }
  );
}

type GovUKEvent = { title: string; date: string };
type GovUKDivision = { events: GovUKEvent[] };
type GovUKResponse = Record<string, GovUKDivision>;

export async function POST() {
  // Auth check: caller must be admin/owner
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { data: member } = await supabase
    .from("members")
    .select("id, organisation_id, role")
    .eq("user_id", user.id)
    .limit(1)
    .single();

  if (!member || (member.role !== "owner" && member.role !== "admin")) {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  // Get org's country_code
  const admin = getAdminClient();
  const { data: org } = await admin
    .from("organisations")
    .select("country_code")
    .eq("id", member.organisation_id)
    .single();

  const countryCode = org?.country_code ?? "england-and-wales";

  // Fetch from GOV.UK API
  let govData: GovUKResponse;
  try {
    const res = await fetch("https://www.gov.uk/bank-holidays.json");
    govData = await res.json() as GovUKResponse;
  } catch {
    return NextResponse.json({ error: "Failed to fetch from GOV.UK API" }, { status: 502 });
  }

  const division = govData[countryCode];
  if (!division) {
    return NextResponse.json({ error: `Unknown division: ${countryCode}` }, { status: 400 });
  }

  // Get existing bank holidays for this country_code (shared records with org_id = null)
  const { data: existing } = await admin
    .from("bank_holidays")
    .select("date")
    .eq("country_code", countryCode)
    .is("organisation_id", null);

  const existingDates = new Set((existing ?? []).map((r) => r.date));

  let inserted = 0;
  let skipped = 0;

  for (const event of division.events) {
    if (existingDates.has(event.date)) {
      skipped++;
      continue;
    }

    const { error } = await admin
      .from("bank_holidays")
      .insert({
        country_code: countryCode,
        organisation_id: null,
        date: event.date,
        name: event.title,
        is_excluded: false,
      });

    if (!error) inserted++;
    else skipped++;
  }

  return NextResponse.json({ inserted, skipped, countryCode });
}
