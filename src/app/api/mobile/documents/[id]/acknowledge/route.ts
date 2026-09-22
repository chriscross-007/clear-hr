import { NextResponse } from "next/server";
import { buildDocumentsCallerFromBearer } from "@/lib/documents-caller";
import { _acknowledgeDocument } from "@/app/(dashboard)/documents/acknowledgement-actions-impl";

/**
 * POST /api/mobile/documents/{id}/acknowledge  (CLE-227a)
 *
 * Records the caller's acknowledgement of a document. Idempotent —
 * a second call returns `{ success: true, alreadyAcknowledged: true }`
 * without writing a new row or audit entry.
 *
 * IP + user-agent for the audit trail come from the request headers
 * via `buildDocumentsCallerFromBearer`, so mobile calls carry the
 * device's IP the same way web calls carry the browser's.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const caller = await buildDocumentsCallerFromBearer(request);
  if ("error" in caller) {
    return NextResponse.json({ success: false, error: caller.error }, { status: caller.status });
  }
  const { id } = await params;
  const result = await _acknowledgeDocument(caller, id);
  const status = result.success ? 200 : (result.error === "Document not found" ? 404 : 400);
  return NextResponse.json(result, { status });
}
