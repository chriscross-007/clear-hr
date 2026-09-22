import { NextResponse } from "next/server";
import { buildDocumentsCallerFromBearer } from "@/lib/documents-caller";
import { _getMemberDocumentSignedUrl } from "@/app/(dashboard)/members/[memberId]/docs/document-actions-impl";

/**
 * GET /api/mobile/documents/{id}/signed-url?mode=inline|download  (CLE-227a)
 *
 * Mobile wrapper over `getMemberDocumentSignedUrl`. Returns a
 * 120-second signed URL for the document's storage bytes plus its
 * file name + content type. Writes a `document.viewed` (mode=inline)
 * or `document.downloaded` (mode=download) audit row on every call —
 * mobile carries the device's IP + user-agent onto the audit trail
 * via `buildDocumentsCallerFromBearer`.
 *
 * The mobile client uses inline URLs for the `<Image>` preview and
 * download URLs for the `expo-sharing` hand-off to the OS viewer.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const caller = await buildDocumentsCallerFromBearer(request);
  if ("error" in caller) {
    return NextResponse.json({ success: false, error: caller.error }, { status: caller.status });
  }
  const url = new URL(request.url);
  const modeRaw = url.searchParams.get("mode");
  const mode: "inline" | "download" = modeRaw === "download" ? "download" : "inline";
  const { id } = await params;
  const result = await _getMemberDocumentSignedUrl(caller, id, mode);
  const status = result.success ? 200 : (result.error === "Document not found" ? 404 : 500);
  return NextResponse.json(result, { status });
}
