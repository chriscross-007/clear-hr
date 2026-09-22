import { NextResponse } from "next/server";
import { buildDocumentsCallerFromBearer } from "@/lib/documents-caller";
import { _getMyOtherMemberDocuments } from "@/app/(dashboard)/my-documents/actions-impl";

/**
 * GET /api/mobile/documents/other  (CLE-227a)
 *
 * Mobile wrapper over the shipped `getMyOtherMemberDocuments` server
 * action. Bearer auth is verified up-front, then the shared impl is
 * called with the resolved `DocumentsCaller`. Envelope shape mirrors
 * the web action exactly: `{ success: true, rows } | { success: false, error }`.
 */
export async function GET(request: Request) {
  const caller = await buildDocumentsCallerFromBearer(request);
  if ("error" in caller) {
    return NextResponse.json({ success: false, error: caller.error }, { status: caller.status });
  }
  const result = await _getMyOtherMemberDocuments(caller);
  const status = result.success ? 200 : 500;
  return NextResponse.json(result, { status });
}
