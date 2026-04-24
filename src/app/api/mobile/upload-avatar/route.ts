import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
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

const ALLOWED_EXT = ["jpg", "jpeg", "png", "webp"];
const MAX_SIZE = 5 * 1024 * 1024;

/**
 * POST /api/mobile/upload-avatar
 * The mobile app uploads a photo as the authenticated employee's avatar.
 * Multipart body with field "avatar". Mirrors the web's uploadMemberAvatar
 * server action but the uploader is always the caller themselves (no
 * `memberId` parameter), and auth uses the Bearer token rather than cookies.
 */
export async function POST(request: Request) {
  console.log("[mobile/upload-avatar] POST hit");
  try {
    const result = await verifyCaller(request);
    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    const { admin, user, organisationId } = result;

    // Resolve the caller's member row so we know which row to update.
    const { data: member } = await admin
      .from("members")
      .select("id")
      .eq("user_id", user.id)
      .eq("organisation_id", organisationId)
      .single();
    if (!member) return NextResponse.json({ error: "Member not found" }, { status: 404 });

    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
    }

    const file = formData.get("avatar") as File | null;
    if (!file || file.size === 0) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }
    if (file.size > MAX_SIZE) {
      return NextResponse.json({ error: "File must be under 5MB" }, { status: 400 });
    }

    const ext = (file.name.split(".").pop() ?? "jpg").toLowerCase();
    if (!ALLOWED_EXT.includes(ext)) {
      return NextResponse.json({ error: "File must be a JPG, PNG or WebP" }, { status: 400 });
    }

    const path = `${organisationId}/${member.id}/${Date.now()}.${ext}`;
    const buffer = Buffer.from(await file.arrayBuffer());

    const { error: uploadError } = await admin.storage
      .from("member-avatars")
      .upload(path, buffer, { contentType: file.type || `image/${ext}`, upsert: false });
    if (uploadError) {
      return NextResponse.json({ error: uploadError.message }, { status: 500 });
    }

    const { data: { publicUrl } } = admin.storage.from("member-avatars").getPublicUrl(path);

    const { error: updateError } = await admin
      .from("members")
      .update({ avatar_url: publicUrl })
      .eq("id", member.id)
      .eq("organisation_id", organisationId);
    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, avatarUrl: publicUrl });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[mobile/upload-avatar] POST threw:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
