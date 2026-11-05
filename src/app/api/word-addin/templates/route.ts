import { NextResponse } from "next/server";
import { buildDocumentsCallerFromBearer } from "@/lib/documents-caller";
import {
  _createDocumentTemplate,
  _listDocumentTemplates,
  _listTemplateSubtypes,
  _uploadTemplateVersion,
} from "@/app/(dashboard)/documents/template-actions-impl";

const SOURCE = "Word add-in";

/**
 * GET /api/word-addin/templates  (CLE-238)
 *
 * Live templates (for "Send as a new version of…") and the document
 * kinds a template can produce (for "Send as a new template"). Bearer
 * auth; needs `can_edit_org_settings`.
 */
export async function GET(request: Request) {
  const caller = await buildDocumentsCallerFromBearer(request);
  if ("error" in caller) {
    return NextResponse.json({ success: false, error: caller.error }, { status: caller.status });
  }
  const [t, s] = await Promise.all([_listDocumentTemplates(caller), _listTemplateSubtypes(caller)]);
  if (!t.success) return NextResponse.json(t, { status: 403 });
  if (!s.success) return NextResponse.json(s, { status: 403 });
  return NextResponse.json({
    success: true,
    templates: t.templates
      .filter((x) => !x.archivedAt)
      .map((x) => ({ id: x.id, name: x.name, subtypeName: x.subtypeName, versionNumber: x.current?.versionNumber ?? 0 })),
    subtypes: s.subtypes,
  });
}

/**
 * POST /api/word-addin/templates  (CLE-238, multipart)
 *
 *   • `file`        — the open document as .docx
 *   • `mode`        — "new" | "version"
 *   • new:     `name`, `subtypeId`
 *   • version: `templateId`
 *
 * Same checks, versioning and audit as Settings → Documents →
 * Templates; the audit row carries `source: "Word add-in"`.
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
  const mode = formData.get("mode");
  if (mode === "version") {
    const templateId = String(formData.get("templateId") ?? "");
    if (!templateId) return NextResponse.json({ success: false, error: "Choose a template" }, { status: 400 });
    const result = await _uploadTemplateVersion(caller, templateId, formData, { source: SOURCE });
    return NextResponse.json(result.success ? { success: true, templateId } : result, { status: result.success ? 200 : 400 });
  }
  if (mode === "new") {
    const result = await _createDocumentTemplate(caller, formData, { source: SOURCE });
    return NextResponse.json(result, { status: result.success ? 200 : 400 });
  }
  return NextResponse.json({ success: false, error: "Invalid request" }, { status: 400 });
}
