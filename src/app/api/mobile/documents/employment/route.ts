import { NextResponse } from "next/server";
import { buildDocumentsCallerFromBearer } from "@/lib/documents-caller";
import { _getMyEmploymentDocuments } from "@/app/(dashboard)/my-documents/actions-impl";

/**
 * GET /api/mobile/documents/employment  (CLE-231)
 *
 * Mobile wrapper over `getMyEmploymentDocuments`: documents the org has
 * issued to the caller (system type `contract`), HR-only subtypes
 * (`visible_to_member = false`) excluded. Same row shape + envelope as
 * /api/mobile/documents/other.
 */
export async function GET(request: Request) {
  const caller = await buildDocumentsCallerFromBearer(request);
  if ("error" in caller) {
    return NextResponse.json({ success: false, error: caller.error }, { status: caller.status });
  }
  const result = await _getMyEmploymentDocuments(caller);
  const status = result.success ? 200 : 500;
  return NextResponse.json(result, { status });
}
