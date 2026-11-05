import { NextResponse } from "next/server";
import { buildDocumentsCallerFromBearer } from "@/lib/documents-caller";
import { _checkTemplateTags } from "@/app/(dashboard)/documents/template-actions-impl";

/**
 * POST /api/word-addin/check  (CLE-238)
 *
 * Body `{ tags: string[] }` — the `{{...}}` contents found in the open
 * Word document. Returns each classified with the same rule ClearHR
 * applies on upload (`classifyTag`), so the panel can flag
 * unrecognised fields before sending. Bearer auth.
 */
export async function POST(request: Request) {
  const caller = await buildDocumentsCallerFromBearer(request);
  if ("error" in caller) {
    return NextResponse.json({ success: false, error: caller.error }, { status: caller.status });
  }
  let tags: unknown;
  try {
    tags = ((await request.json()) as { tags?: unknown }).tags;
  } catch {
    return NextResponse.json({ success: false, error: "Invalid request" }, { status: 400 });
  }
  if (!Array.isArray(tags)) return NextResponse.json({ success: false, error: "Invalid request" }, { status: 400 });
  const result = await _checkTemplateTags(caller, tags.map(String));
  return NextResponse.json(result, { status: result.success ? 200 : 403 });
}
