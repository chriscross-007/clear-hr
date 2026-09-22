import { NextResponse } from "next/server";
import { buildDocumentsCallerFromBearer } from "@/lib/documents-caller";
import { _uploadMemberDocument } from "@/app/(dashboard)/members/[memberId]/docs/document-actions-impl";

/**
 * POST /api/mobile/documents/upload  (CLE-227a, multipart)
 *
 * Mobile wrapper over `uploadMemberDocument`. Mobile is employee-only,
 * so the impl is always called with the caller's own memberId —
 * cross-user upload is the web's `adhoc-upload` route's territory
 * (HR photographing another member on the HR handset).
 *
 * Expected multipart form fields:
 *   • `file`      — the bytes (10 MB cap, MIME allow-list enforced
 *                    by the impl)
 *   • `subtypeId` — the target `document_subtype.id`
 *   • `expiresOn` — optional ISO date (yyyy-MM-dd); some subtypes
 *                    can carry an expiry set at upload time
 *
 * The impl's self-upload gate is enforced: for callers with
 * `crossUserAccess = 'self'`, only subtypes where the tenant has set
 * `document_subtype.employee_can_upload = true` are accepted. Other
 * attempts return an explanatory error the mobile Toast can render.
 */
export async function POST(request: Request) {
  const caller = await buildDocumentsCallerFromBearer(request);
  if ("error" in caller) {
    return NextResponse.json({ success: false, error: caller.error }, { status: caller.status });
  }
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ success: false, error: "Invalid form data" }, { status: 400 });
  }
  const result = await _uploadMemberDocument(caller, caller.memberId, formData);
  if (!result.success) {
    const msg = result.error ?? "";
    let status = 400;
    if (msg === "Document not found") status = 404;
    else if (msg.startsWith("This file is too large")) status = 413;
    else if (msg.startsWith("This file type")) status = 415;
    else if (msg.includes("permission") || msg.includes("can't upload")) status = 403;
    return NextResponse.json(result, { status });
  }
  return NextResponse.json(result, { status: 200 });
}
