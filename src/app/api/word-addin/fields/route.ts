import { NextResponse } from "next/server";
import { buildDocumentsCallerFromBearer } from "@/lib/documents-caller";
import { _getTemplateFieldCatalogue } from "@/app/(dashboard)/documents/template-actions-impl";

/**
 * GET /api/word-addin/fields  (CLE-238)
 *
 * The merge-field catalogue for the ClearHR panel in Word: built-in
 * fields + the organisation's custom fields, grouped, with the member
 * label. Bearer auth (Supabase access token from the panel's sign-in
 * dialog). Needs `can_edit_org_settings`.
 */
export async function GET(request: Request) {
  const caller = await buildDocumentsCallerFromBearer(request);
  if ("error" in caller) {
    return NextResponse.json({ success: false, error: caller.error }, { status: caller.status });
  }
  const result = await _getTemplateFieldCatalogue(caller);
  return NextResponse.json(result, { status: result.success ? 200 : 403 });
}
