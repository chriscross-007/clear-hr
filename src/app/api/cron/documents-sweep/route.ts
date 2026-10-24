import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { runDocumentsSweep } from "@/lib/documents/sweep";
import { runDocumentNotifications } from "@/lib/documents/notifications";

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

  // CLE-235 — nightly document emails, after the status sweep.
  const host = request.headers.get("host") ?? "localhost:3000";
  const baseUrl =
    process.env.NEXT_PUBLIC_APP_URL ?? `${host.includes("localhost") ? "http" : "https"}://${host}`;
  const notifications = await runDocumentNotifications(admin, { baseUrl });

  const errors = [...result.errors, ...notifications.errors];
  return NextResponse.json({
    ok: errors.length === 0,
    ...result,
    notifications,
    errors,
    ranAt: new Date().toISOString(),
  }, { status: errors.length === 0 ? 200 : 207 });
}
