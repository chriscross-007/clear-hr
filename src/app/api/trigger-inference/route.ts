import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { runInference } from "@/lib/timesheet/inference-engine";

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } },
  );
}

/**
 * POST /api/trigger-inference
 *
 * Called by the mobile app after inserting a clocking.
 * Expects:
 *   - Authorization: Bearer <supabase_access_token>
 *   - Body: { memberId: string, date: string }   // date = "YYYY-MM-DD"
 *
 * Runs the inference engine for a ±1-day window around the given date
 * so the mobile user sees up-to-date work_periods on their timesheet.
 */
export async function POST(request: Request) {
  // --- auth: verify the Supabase access token -------------------------
  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) {
    return NextResponse.json({ error: "Missing token" }, { status: 401 });
  }

  const admin = getAdminClient();
  const { data: { user }, error: authErr } = await admin.auth.getUser(token);
  if (authErr || !user) {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  }

  // --- parse body -----------------------------------------------------
  let body: { memberId?: string; date?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { memberId, date } = body;
  if (!memberId || !date) {
    return NextResponse.json({ error: "memberId and date required" }, { status: 400 });
  }

  // --- verify caller owns this member record --------------------------
  const { data: member } = await admin
    .from("members")
    .select("id, organisation_id")
    .eq("id", memberId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!member) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // --- run inference over ±1 day window -------------------------------
  const d = new Date(`${date}T00:00:00Z`);
  const rangeStart = new Date(d);
  rangeStart.setUTCDate(rangeStart.getUTCDate() - 1);
  const rangeEnd = new Date(d);
  rangeEnd.setUTCDate(rangeEnd.getUTCDate() + 1);

  try {
    const result = await runInference({
      supabase: admin,
      organisationId: member.organisation_id,
      memberId: member.id,
      rangeStart,
      rangeEnd,
    });

    return NextResponse.json({
      ok: true,
      periodsCreated: result.periodsCreated,
      periodsUpdated: result.periodsUpdated,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Inference failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
