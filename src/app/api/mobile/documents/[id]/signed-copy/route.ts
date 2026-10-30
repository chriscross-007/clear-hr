import { NextResponse } from "next/server";
import { buildDocumentsCallerFromBearer } from "@/lib/documents-caller";
import { _getOrgSignedCopyUrl } from "@/app/(dashboard)/documents/signature-actions-impl";

/** GET /api/mobile/documents/{id}/signed-copy (CLE-236) — the caller's own signed copy of an org document. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const caller = await buildDocumentsCallerFromBearer(request);
  if ("error" in caller) return NextResponse.json({ success: false, error: caller.error }, { status: caller.status });
  const { id } = await params;
  const result = await _getOrgSignedCopyUrl(caller, id, null);
  return NextResponse.json(result, { status: result.success ? 200 : 400 });
}
