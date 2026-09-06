import { NextResponse } from "next/server";
import { verifyCaller } from "../../../lib";

const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/heic"];
const MAX_DOCUMENT_SIZE = 10 * 1024 * 1024;
const STORAGE_BUCKET = "member-documents";

/**
 * POST /api/mobile/capture-tasks/:id/upload
 *
 * Multipart body: `file`. Server-side flow:
 *   1. Verify the task exists, is pending, and is owned by the caller.
 *   2. Load the subtype for the retention_class / type snapshot on the doc row.
 *   3. Upload bytes to member-documents/{tenant}/{uuid}.{ext}.
 *   4. Insert a `document` row against the task's target member.
 *   5. Mark the task uploaded and stash the new document_id.
 *   6. Audit `document.uploaded` (existing shape) plus `document.capture_uploaded`.
 *
 * Realtime broadcasts the task update to the web dialog which closes
 * automatically. Same code path as a normal per-member upload from the
 * `capture_source = 'web_queued'` perspective.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const v = await verifyCaller(request);
    if ("error" in v) return NextResponse.json({ error: v.error }, { status: v.status });
    const { admin, user, organisationId, memberId: callerMemberId } = v;

    const { id: taskId } = await params;

    // 1. Task must exist, be pending, and be owned by caller.
    const { data: task } = await admin
      .from("capture_task")
      .select("id, status, queued_by_user_id, organisation_id, target_member_id, subtype_id, expires_on, expires_at")
      .eq("id", taskId)
      .single();
    if (!task || task.queued_by_user_id !== user.id) {
      return NextResponse.json({ error: "Task not found." }, { status: 404 });
    }
    if (task.status !== "pending") {
      return NextResponse.json({
        error: "This capture task is no longer active — start a new one from the web.",
      }, { status: 409 });
    }
    if (new Date(task.expires_at as string).getTime() < Date.now()) {
      return NextResponse.json({
        error: "This request has expired. Please ask HR to try again.",
      }, { status: 409 });
    }

    // 2. Multipart parse + validation.
    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
    }
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) {
      return NextResponse.json({ error: "No photo provided" }, { status: 400 });
    }
    if (file.size > MAX_DOCUMENT_SIZE) {
      return NextResponse.json({
        error: "Photo too large. Try retaking closer or at lower resolution.",
      }, { status: 400 });
    }
    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
      return NextResponse.json({ error: "That file type isn't supported." }, { status: 400 });
    }

    // 3. Subtype snapshot for the document row.
    const { data: subtype } = await admin
      .from("document_subtype")
      .select("id, type, name, retention_class")
      .eq("id", task.subtype_id as string)
      .eq("organisation_id", organisationId)
      .single();
    if (!subtype) {
      return NextResponse.json({ error: "Document type not available." }, { status: 500 });
    }

    // 4. Upload bytes.
    const uuid = crypto.randomUUID();
    const ext = (() => {
      if (file.name.includes(".")) return file.name.substring(file.name.lastIndexOf("."));
      // Derive from content-type as fallback for mobile clients that
      // don't send a filename.
      if (file.type === "image/jpeg") return ".jpg";
      if (file.type === "image/png") return ".png";
      if (file.type === "image/heic") return ".heic";
      return "";
    })();
    const storagePath = `${organisationId}/${uuid}${ext}`;
    const buffer = Buffer.from(await file.arrayBuffer());
    const { error: uploadError } = await admin.storage
      .from(STORAGE_BUCKET)
      .upload(storagePath, buffer, { contentType: file.type, upsert: false });
    if (uploadError) {
      return NextResponse.json({ error: uploadError.message }, { status: 500 });
    }

    // 5. Document row insert.
    const displayName = file.name && file.name.length > 0
      ? file.name.substring(0, 255)
      : `capture-${uuid}${ext}`;
    const { data: inserted, error: insertError } = await admin
      .from("document")
      .insert({
        organisation_id: organisationId,
        owner_scope: "member",
        owner_id: task.target_member_id,
        storage_path: storagePath,
        file_name: displayName,
        file_size: file.size,
        content_type: file.type,
        type: subtype.type,
        subtype_id: subtype.id,
        expires_on: task.expires_on,
        retention_class: subtype.retention_class,
        uploaded_by: callerMemberId,
        metadata: { capture_source: "web_queued", capture_task_id: taskId },
      })
      .select("id")
      .single();
    if (insertError || !inserted) {
      // Best-effort orphan cleanup.
      await admin.storage.from(STORAGE_BUCKET).remove([storagePath]);
      return NextResponse.json({
        error: insertError?.message ?? "Failed to insert document",
      }, { status: 500 });
    }

    // 6. Task transition to uploaded — RLS check pins it to the caller.
    const { error: taskError } = await admin
      .from("capture_task")
      .update({
        status: "uploaded",
        uploaded_at: new Date().toISOString(),
        uploaded_document_id: inserted.id,
      })
      .eq("id", taskId)
      .eq("queued_by_user_id", user.id)
      .eq("status", "pending");
    if (taskError) {
      // Document is created but the task didn't transition — that's a
      // Realtime consistency problem but not a data loss one. Log and
      // return success; the timeout sweep will clean up the task.
      console.warn("[capture-task upload] task status update failed:", taskError.message);
    }

    // 7. Audit — reuse the existing document.uploaded action shape so
    // the audit page's existing FIELD_LABELS + rendering just work.
    //
    // Include a separate capture-source annotation in metadata so the
    // audit reader can tell the flow apart from a normal Upload.
    const { data: targetMember } = await admin
      .from("members")
      .select("first_name, last_name")
      .eq("id", task.target_member_id as string)
      .single();
    const targetLabel = `${targetMember?.first_name ?? ""} ${targetMember?.last_name ?? ""}`.trim() || "Unknown";
    const { data: callerMember } = await admin
      .from("members")
      .select("first_name, last_name")
      .eq("id", callerMemberId)
      .single();
    const actorName = `${callerMember?.first_name ?? ""} ${callerMember?.last_name ?? ""}`.trim() || "Unknown";

    await admin.from("audit_log").insert({
      organisation_id: organisationId,
      actor_id: callerMemberId,
      actor_name: actorName,
      action: "document.uploaded",
      target_type: "member_document",
      target_id: inserted.id,
      target_label: displayName,
      metadata: {
        member: targetLabel,
        type_subtype: `${subtype.type} / ${subtype.name}`,
        file_size: file.size,
        capture_source: "web_queued",
      },
    });

    return NextResponse.json({ success: true, documentId: inserted.id });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[mobile/capture-tasks/:id/upload] threw:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
