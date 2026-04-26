import { NextResponse } from "next/server";
import { verifyCaller } from "../../lib";

/**
 * POST /api/mobile/conversations/download-url
 * Body: { documentId }
 * Returns a 60-second signed URL for the document if the caller is the
 * document's owner or an admin/owner in the same org.
 */
export async function POST(request: Request) {
  console.log("[mobile/conversations/download-url] POST hit");
  try {
    const v = await verifyCaller(request);
    if ("error" in v) return NextResponse.json({ error: v.error }, { status: v.status });
    const { admin, user, organisationId } = v;

    const { data: callerMember } = await admin
      .from("members")
      .select("id, role")
      .eq("user_id", user.id)
      .eq("organisation_id", organisationId)
      .single();
    if (!callerMember) return NextResponse.json({ error: "Member not found" }, { status: 404 });

    let body: { documentId?: string };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
    if (!body.documentId) return NextResponse.json({ error: "documentId required" }, { status: 400 });

    // Mirror the RLS rule: caller is org member AND (owns the doc OR is admin/owner).
    const { data: doc } = await admin
      .from("member_documents")
      .select("storage_path, file_name, member_id, organisation_id")
      .eq("id", body.documentId)
      .eq("organisation_id", organisationId)
      .single();
    if (!doc) return NextResponse.json({ error: "Document not found" }, { status: 404 });

    const isAdmin = callerMember.role === "admin" || callerMember.role === "owner";
    const isOwnDoc = doc.member_id === callerMember.id;
    if (!isAdmin && !isOwnDoc) {
      return NextResponse.json({ error: "Not authorised" }, { status: 403 });
    }

    const { data: signed, error: signErr } = await admin.storage
      .from("member-documents")
      .createSignedUrl(doc.storage_path as string, 60);
    if (signErr || !signed) {
      return NextResponse.json({ error: signErr?.message ?? "Could not create download link" }, { status: 500 });
    }

    return NextResponse.json({ success: true, url: signed.signedUrl, fileName: doc.file_name });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[mobile/conversations/download-url] POST threw:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
