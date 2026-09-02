import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { runDocumentsSweep } from "@/lib/documents/sweep";

// CLE-209 — Nightly documents sweep. Wired into vercel.json to run
// at 02:00 UTC daily. Header-secret-guarded (same shape as
// /api/cron/holiday-reminder).
//
// Manually testable via a service-role token: send GET with header
// `Authorization: Bearer <CRON_SECRET>`.

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } },
  );
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = getAdminClient();
  const result = await runDocumentsSweep(admin);

  return NextResponse.json({
    ok: result.errors.length === 0,
    ...result,
    ranAt: new Date().toISOString(),
  }, { status: result.errors.length === 0 ? 200 : 207 });
}
