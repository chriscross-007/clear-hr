import { NextResponse } from "next/server";
import { buildDocumentsCallerFromBearer } from "@/lib/documents-caller";
import { _getDocumentDetail } from "@/app/(dashboard)/members/[memberId]/docs/document-actions-impl";

/**
 * GET /api/mobile/documents/{id}  (CLE-227a)
 *
 * Mobile wrapper over `getDocumentDetail`. Powers the mobile Details
 * screen — full doc metadata (row + uploaded-by name + verified-by
 * name + verification notes + isSelf) in one round-trip.
 *
 * 404 is returned indistinguishably for "no such doc", "not in your
 * org", "you can't view this member's docs", and "you don't have
 * org-doc view rights on this org-scope doc" — matches the web
 * action's F8 behaviour (never reveal existence via a 403).
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const caller = await buildDocumentsCallerFromBearer(request);
  if ("error" in caller) {
    return NextResponse.json({ success: false, error: caller.error }, { status: caller.status });
  }
  const { id } = await params;
  const result = await _getDocumentDetail(caller, id);
  const status = result.success ? 200 : (result.error === "Document not found" ? 404 : 500);
  return NextResponse.json(result, { status });
}
