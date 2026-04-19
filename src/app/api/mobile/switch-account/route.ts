import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } },
  );
}

function getAnonNoPersistClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } },
  );
}

async function verifyCaller(request: Request) {
  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) return { error: "Missing token", status: 401 } as const;

  const admin = getAdminClient();
  const { data: { user }, error: authErr } = await admin.auth.getUser(token);
  if (authErr || !user) return { error: "Invalid token", status: 401 } as const;

  const { data: membership } = await admin
    .from("members")
    .select("organisation_id")
    .eq("user_id", user.id)
    .limit(1)
    .single();
  if (!membership) return { error: "No organisation", status: 403 } as const;

  return { admin, user, organisationId: membership.organisation_id } as const;
}

/**
 * GET /api/mobile/switch-account
 * Returns the list of members in the caller's organisation that they could switch to.
 */
export async function GET(request: Request) {
  console.log("[mobile/switch-account] GET hit");
  try {
    const result = await verifyCaller(request);
    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    const { admin, organisationId } = result;

    const { data, error } = await admin
      .from("members")
      .select("id, first_name, last_name, email, role")
      .eq("organisation_id", organisationId)
      .not("user_id", "is", null)
      .order("first_name");

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ members: data ?? [] });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[mobile/switch-account] GET threw:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/**
 * POST /api/mobile/switch-account
 * Body: { memberId: string }
 * Returns { access_token, refresh_token } for the target user, so the mobile
 * client can call supabase.auth.setSession() and continue as that user.
 */
export async function POST(request: Request) {
  console.log("[mobile/switch-account] POST hit");
  try {
    const result = await verifyCaller(request);
    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    const { admin, organisationId } = result;

    let body: { memberId?: string };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
    const { memberId } = body;
    if (!memberId) return NextResponse.json({ error: "memberId required" }, { status: 400 });

    // Target must be in the same org and have an accepted invite
    const { data: target } = await admin
      .from("members")
      .select("email")
      .eq("id", memberId)
      .eq("organisation_id", organisationId)
      .not("user_id", "is", null)
      .single();
    if (!target) return NextResponse.json({ error: "Target not found" }, { status: 404 });

    // Generate a magic link (admin only) — gives us a hashed token we can verify
    const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
      type: "magiclink",
      email: target.email,
    });
    if (linkError || !linkData) {
      return NextResponse.json(
        { error: linkError?.message ?? "Failed to generate link" },
        { status: 500 },
      );
    }

    // Verify the OTP on a fresh non-persistent client so we don't disturb any cookies.
    // The verify call returns a fully-formed session for the target user.
    const tempClient = getAnonNoPersistClient();
    const { data: verifyData, error: verifyError } = await tempClient.auth.verifyOtp({
      token_hash: linkData.properties.hashed_token,
      type: "magiclink",
    });
    if (verifyError || !verifyData.session) {
      return NextResponse.json(
        { error: verifyError?.message ?? "Failed to verify OTP" },
        { status: 500 },
      );
    }

    return NextResponse.json({
      access_token: verifyData.session.access_token,
      refresh_token: verifyData.session.refresh_token,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[mobile/switch-account] POST threw:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
