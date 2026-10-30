import { NextResponse } from "next/server";
import { buildDocumentsCallerFromBearer } from "@/lib/documents-caller";
import { _getMyOutstandingSignatures } from "@/app/(dashboard)/documents/signature-actions-impl";

/** GET /api/mobile/documents/outstanding-signatures (CLE-236) — the "N to sign" list. */
export async function GET(request: Request) {
  const caller = await buildDocumentsCallerFromBearer(request);
  if ("error" in caller) return NextResponse.json({ success: false, error: caller.error }, { status: caller.status });
  const result = await _getMyOutstandingSignatures(caller);
  return NextResponse.json(result, { status: result.success ? 200 : 400 });
}
