import { NextResponse } from "next/server";
import { buildDocumentsCallerFromBearer } from "@/lib/documents-caller";
import { _getDocumentSignatureState, _getSigningView } from "@/app/(dashboard)/documents/signature-actions-impl";

/**
 * GET /api/mobile/documents/{id}/signing (CLE-236)
 * `{ success, state, view }` — the signature state for the details
 * screen, plus the signing view (file URL etc.) when the caller can sign.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const caller = await buildDocumentsCallerFromBearer(request);
  if ("error" in caller) return NextResponse.json({ success: false, error: caller.error }, { status: caller.status });
  const { id } = await params;
  const state = await _getDocumentSignatureState(caller, id);
  if (!state.success) return NextResponse.json(state, { status: state.error === "Document not found" ? 404 : 400 });
  const view = state.state.callerCanSignAs ? await _getSigningView(caller, id) : null;
  return NextResponse.json({ success: true, state: state.state, view: view && view.success ? view.view : null });
}
