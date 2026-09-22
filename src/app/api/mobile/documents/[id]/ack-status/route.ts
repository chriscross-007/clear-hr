import { NextResponse } from "next/server";
import { buildDocumentsCallerFromBearer } from "@/lib/documents-caller";
import { _getDocumentAcknowledgementStatus } from "@/app/(dashboard)/documents/acknowledgement-actions-impl";

/**
 * GET /api/mobile/documents/{id}/ack-status  (CLE-227a)
 *
 * Per-doc acknowledgement summary consumed by the mobile details
 * screen. Returns `requiresAcknowledgement`, `isCallerExpectedToAcknowledge`,
 * the caller's own ack row (if any), and — only for org-scope docs
 * viewed by callers with `can_view_organisation_documents` — a
 * compact coverage summary. Employee-only mobile means the coverage
 * summary rarely fires in practice.
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
  const result = await _getDocumentAcknowledgementStatus(caller, id);
  const status = result.success ? 200 : (result.error === "Document not found" ? 404 : 500);
  return NextResponse.json(result, { status });
}
