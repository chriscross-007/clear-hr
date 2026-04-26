import { NextResponse } from "next/server";
import { verifyCaller } from "../../lib";

const ALLOWED_CONTENT_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain",
  "text/csv",
];
const MAX_DOCUMENT_SIZE = 10 * 1024 * 1024;

/**
 * POST /api/mobile/conversations/upload
 * Multipart body: file, conversationMessageId, memberId.
 * Mirrors the web's uploadDocumentToMessage server action.
 */
export async function POST(request: Request) {
  console.log("[mobile/conversations/upload] POST hit");
  try {
    const v = await verifyCaller(request);
    if ("error" in v) return NextResponse.json({ error: v.error }, { status: v.status });
    const { admin, user, organisationId } = v;

    // Caller's member row
    const { data: callerMember } = await admin
      .from("members")
      .select("id, role")
      .eq("user_id", user.id)
      .eq("organisation_id", organisationId)
      .single();
    if (!callerMember) return NextResponse.json({ error: "Member not found" }, { status: 404 });

    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
    }

    const file = formData.get("file") as File | null;
    const conversationMessageId = formData.get("conversationMessageId") as string | null;
    const memberId = formData.get("memberId") as string | null;

    if (!file || file.size === 0) return NextResponse.json({ error: "No file provided" }, { status: 400 });
    if (!conversationMessageId) return NextResponse.json({ error: "conversationMessageId required" }, { status: 400 });
    if (!memberId) return NextResponse.json({ error: "memberId required" }, { status: 400 });
    if (file.size > MAX_DOCUMENT_SIZE) return NextResponse.json({ error: "File must be 10MB or smaller" }, { status: 400 });
    if (!ALLOWED_CONTENT_TYPES.includes(file.type)) {
      return NextResponse.json({ error: "Unsupported file type" }, { status: 400 });
    }

    // Verify message + conversation are in the caller's org
    const { data: messageRow } = await admin
      .from("conversation_messages")
      .select("id, conversations!inner(organisation_id)")
      .eq("id", conversationMessageId)
      .eq("conversations.organisation_id", organisationId)
      .single();
    if (!messageRow) return NextResponse.json({ error: "Message not found" }, { status: 404 });

    // Target member must be in the caller's org
    const { data: targetMember } = await admin
      .from("members")
      .select("id")
      .eq("id", memberId)
      .eq("organisation_id", organisationId)
      .single();
    if (!targetMember) return NextResponse.json({ error: "Member not found" }, { status: 404 });

    // Employees can only upload for themselves
    if (callerMember.role === "employee" && memberId !== callerMember.id) {
      return NextResponse.json({ error: "Not authorised" }, { status: 403 });
    }

    const path = `${organisationId}/${memberId}/absence_attachment/${Date.now()}_${file.name}`;
    const buffer = Buffer.from(await file.arrayBuffer());

    const { error: uploadError } = await admin.storage
      .from("member-documents")
      .upload(path, buffer, { contentType: file.type, upsert: false });
    if (uploadError) return NextResponse.json({ error: uploadError.message }, { status: 500 });

    const { data: inserted, error: insertError } = await admin
      .from("member_documents")
      .insert({
        organisation_id: organisationId,
        member_id: memberId,
        document_type: "absence_attachment",
        file_name: file.name,
        file_size: file.size,
        content_type: file.type,
        storage_path: path,
        uploaded_by_member_id: callerMember.id,
        conversation_message_id: conversationMessageId,
      })
      .select("id")
      .single();
    if (insertError || !inserted) {
      return NextResponse.json({ error: insertError?.message ?? "Could not record document" }, { status: 500 });
    }

    return NextResponse.json({ success: true, documentId: inserted.id });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[mobile/conversations/upload] POST threw:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
