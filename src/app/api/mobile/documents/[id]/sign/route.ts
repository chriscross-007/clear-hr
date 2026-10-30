import { NextResponse } from "next/server";
import { buildDocumentsCallerFromBearer } from "@/lib/documents-caller";
import { _signDocument } from "@/app/(dashboard)/documents/signature-actions-impl";

/**
 * POST /api/mobile/documents/{id}/sign (CLE-236)
 * Body: `{ markType: "typed" | "drawn", typedName?, drawnPng? (data:image/png;base64,…), agreed: true }`.
 * IP + device come from the request headers, as for acknowledgements.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const caller = await buildDocumentsCallerFromBearer(request);
  if ("error" in caller) return NextResponse.json({ success: false, error: caller.error }, { status: caller.status });
  const { id } = await params;
  let body: { markType?: string; typedName?: string | null; drawnPng?: string | null; agreed?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: "Invalid request" }, { status: 400 });
  }
  const result = await _signDocument(caller, id, {
    markType: body.markType === "drawn" ? "drawn" : "typed",
    typedName: body.typedName ?? null,
    drawnPng: body.drawnPng ?? null,
    agreed: body.agreed === true,
  });
  return NextResponse.json(result, { status: result.success ? 200 : result.error === "Document not found" ? 404 : 400 });
}
