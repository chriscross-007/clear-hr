import { NextResponse } from "next/server";
import { verifyCaller } from "../../lib";

const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/heic"];
const MAX_DOCUMENT_SIZE = 10 * 1024 * 1024;
const STORAGE_BUCKET = "member-documents";

/**
 * Same helper as the web-queued capture route — inlined per file
 * rather than shared. Composes {Member}_{Subtype}_{YYYY-MM-DD}.{ext}.
 */
function composeCaptureFilename(memberName: string, subtypeName: string, ext: string): string {
  const today = new Date().toISOString().slice(0, 10);
  const safe = (s: string) => s.trim().replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "");
  const mem = safe(memberName) || "member";
  const sub = safe(subtypeName) || "document";
  return `${mem}_${sub}_${today}${ext}`.slice(0, 255);
}

/**
 * POST /api/mobile/documents/adhoc-upload
 *
 * Multipart body: `file`, `targetMemberId`, `subtypeId`, `expiresOn?`.
 *
 * The mobile-initiated ad-hoc capture flow (CLE-211). No
 * `capture_task` row is created — HR is the same person on both
 * ends, so there's no paired web session to synchronise with. The
 * document row is written directly with
 * `metadata.capture_source = 'mobile_adhoc'` so the audit distinguishes
 * this path from the web-queued one.
 *
 * Authorisation: caller must have `documents.update` on the target
 * member's scope (defence-in-depth even though the mobile member
 * picker already filters to valid targets).
 */
export async function POST(request: Request) {
  try {
    const v = await verifyCaller(request);
    if ("error" in v) return NextResponse.json({ error: v.error }, { status: v.status });
    const { admin, user, organisationId, memberId: callerMemberId } = v;

    // Resolver-shaped scope + rights check.
    const { getEffectiveRightsForUser } = await import("@/lib/rights-resolver");
    const resolved = await getEffectiveRightsForUser(user.id);
    if (!resolved) return NextResponse.json({ error: "No organisation" }, { status: 403 });
    const { rights, ctx } = resolved;

    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
    }

    const file = formData.get("file");
    const targetMemberId = formData.get("targetMemberId");
    const subtypeId = formData.get("subtypeId");
    const expiresOnRaw = formData.get("expiresOn");
    const expiresOn = typeof expiresOnRaw === "string" && expiresOnRaw ? expiresOnRaw : null;

    if (!(file instanceof File) || file.size === 0) {
      return NextResponse.json({ error: "No photo provided" }, { status: 400 });
    }
    if (typeof targetMemberId !== "string" || !targetMemberId) {
      return NextResponse.json({ error: "targetMemberId required" }, { status: 400 });
    }
    if (typeof subtypeId !== "string" || !subtypeId) {
      return NextResponse.json({ error: "subtypeId required" }, { status: 400 });
    }
    if (file.size > MAX_DOCUMENT_SIZE) {
      return NextResponse.json({
        error: "Photo too large. Try retaking closer or at lower resolution.",
      }, { status: 400 });
    }
    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
      return NextResponse.json({ error: "That file type isn't supported." }, { status: 400 });
    }

    // Target must exist + be in tenant.
    const { data: target } = await admin
      .from("members")
      .select("id, team_id")
      .eq("id", targetMemberId)
      .eq("organisation_id", organisationId)
      .single();
    if (!target) {
      return NextResponse.json({ error: "That member is not available." }, { status: 404 });
    }

    // Scope check — mirrors uploadMemberDocument.canUpdateTarget.
    const canUpdate = (() => {
      if (target.id === ctx.memberId) return rights.tabs.documents?.update === true;
      if (rights.crossUserAccess === "all") return rights.tabs.documents?.update === true;
      if (rights.crossUserAccess === "team")
        return target.team_id !== null && target.team_id === ctx.teamId
          && rights.tabs.documents?.update === true;
      return false;
    })();
    if (!canUpdate) {
      return NextResponse.json({
        error: "You don't have permission to add documents for this employee.",
      }, { status: 403 });
    }

    // Subtype must be member-scope in tenant.
    const { data: subtype } = await admin
      .from("document_subtype")
      .select("id, type, name, retention_class, expiry_required")
      .eq("id", subtypeId)
      .eq("organisation_id", organisationId)
      .single();
    if (!subtype) {
      return NextResponse.json({ error: "That document type is not available." }, { status: 404 });
    }
    if (subtype.type === "organisation_document") {
      return NextResponse.json({
        error: "Organisation documents can't be captured this way.",
      }, { status: 400 });
    }
    if (subtype.expiry_required && !expiresOn) {
      return NextResponse.json({
        error: "This document type needs an expiry date.",
      }, { status: 400 });
    }

    // Upload bytes + compose a display filename from member + subtype.
    const uuid = crypto.randomUUID();
    const ext = (() => {
      if (file.type === "image/jpeg") return ".jpg";
      if (file.type === "image/png") return ".png";
      if (file.type === "image/heic") return ".heic";
      if (file.name.includes(".")) return file.name.substring(file.name.lastIndexOf("."));
      return "";
    })();
    const { data: targetMember } = await admin
      .from("members")
      .select("first_name, last_name")
      .eq("id", target.id)
      .single();
    const displayName = composeCaptureFilename(
      `${targetMember?.first_name ?? ""} ${targetMember?.last_name ?? ""}`,
      subtype.name as string,
      ext,
    );

    const storagePath = `${organisationId}/${uuid}${ext}`;
    const buffer = Buffer.from(await file.arrayBuffer());
    const { error: uploadError } = await admin.storage
      .from(STORAGE_BUCKET)
      .upload(storagePath, buffer, { contentType: file.type, upsert: false });
    if (uploadError) {
      return NextResponse.json({ error: uploadError.message }, { status: 500 });
    }
    const { data: inserted, error: insertError } = await admin
      .from("document")
      .insert({
        organisation_id: organisationId,
        owner_scope: "member",
        owner_id: target.id,
        storage_path: storagePath,
        file_name: displayName,
        file_size: file.size,
        content_type: file.type,
        type: subtype.type,
        subtype_id: subtype.id,
        expires_on: expiresOn,
        retention_class: subtype.retention_class,
        uploaded_by: callerMemberId,
        capture_source: "photo",
      })
      .select("id")
      .single();
    if (insertError || !inserted) {
      await admin.storage.from(STORAGE_BUCKET).remove([storagePath]);
      return NextResponse.json({
        error: insertError?.message ?? "Failed to insert document",
      }, { status: 500 });
    }

    // Audit. `targetMember` was fetched above for the display name.
    const { data: callerMember } = await admin
      .from("members")
      .select("first_name, last_name")
      .eq("id", callerMemberId)
      .single();
    const actorName = `${callerMember?.first_name ?? ""} ${callerMember?.last_name ?? ""}`.trim() || "Unknown";
    const targetName = `${targetMember?.first_name ?? ""} ${targetMember?.last_name ?? ""}`.trim() || "Unknown";

    await admin.from("audit_log").insert({
      organisation_id: organisationId,
      actor_id: callerMemberId,
      actor_name: actorName,
      action: "document.uploaded",
      target_type: "member_document",
      target_id: inserted.id,
      target_label: displayName,
      metadata: {
        member: targetName,
        type_subtype: `${subtype.type} / ${subtype.name}`,
        file_size: file.size,
        capture_source: "mobile_adhoc",
      },
    });

    return NextResponse.json({ success: true, documentId: inserted.id });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[mobile/documents/adhoc-upload] threw:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
