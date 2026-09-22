import { NextResponse } from "next/server";
import { buildDocumentsCallerFromBearer } from "@/lib/documents-caller";
import { _getMemberRequiredDocumentRows } from "@/app/(dashboard)/members/[memberId]/docs/document-actions-impl";

/**
 * GET /api/mobile/documents/required  (CLE-227a)
 *
 * Mobile wrapper over `getMemberRequiredDocumentRows`. Mobile is
 * employee-only, so the impl is always called with the caller's own
 * memberId — HR's per-member required-docs view stays web-only.
 *
 * Returns the RTW aggregate + per-doc rows the web `/my-documents`
 * page's Required card renders, so the mobile Required tab and the
 * web Required card show the same set.
 */
export async function GET(request: Request) {
  const caller = await buildDocumentsCallerFromBearer(request);
  if ("error" in caller) {
    return NextResponse.json({ success: false, error: caller.error }, { status: caller.status });
  }
  const result = await _getMemberRequiredDocumentRows(caller, caller.memberId);
  const status = result.success ? 200 : (result.error === "Member not found" ? 404 : 500);
  return NextResponse.json(result, { status });
}
