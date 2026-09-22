import { NextResponse } from "next/server";
import { buildDocumentsCallerFromBearer } from "@/lib/documents-caller";
import { _listOrgDocuments } from "@/app/(dashboard)/documents/organisation/org-document-actions-impl";

/**
 * GET /api/mobile/documents/org  (CLE-227a)
 *
 * Mobile wrapper over the shipped `listOrgDocuments` server action.
 * Gated on `can_view_organisation_documents`; hidden-pair filter
 * applies inside the impl so callers see the same set as the web
 * /documents/organisation list.
 */
export async function GET(request: Request) {
  const caller = await buildDocumentsCallerFromBearer(request);
  if ("error" in caller) {
    return NextResponse.json({ success: false, error: caller.error, rows: [] }, { status: caller.status });
  }
  const result = await _listOrgDocuments(caller);
  const status = result.success ? 200 : (result.error === "Forbidden" ? 403 : 500);
  return NextResponse.json(result, { status });
}
