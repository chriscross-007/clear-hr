import { NextResponse } from "next/server";
import { buildDocumentsCallerFromBearer } from "@/lib/documents-caller";
import { _declineSignature } from "@/app/(dashboard)/documents/signature-actions-impl";

/** POST /api/mobile/documents/{id}/decline (CLE-236) — body `{ reason }`. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const caller = await buildDocumentsCallerFromBearer(request);
  if ("error" in caller) return NextResponse.json({ success: false, error: caller.error }, { status: caller.status });
  const { id } = await params;
  let reason = "";
  try {
    reason = String(((await request.json()) as { reason?: string }).reason ?? "");
  } catch {
    return NextResponse.json({ success: false, error: "Invalid request" }, { status: 400 });
  }
  const result = await _declineSignature(caller, id, reason);
  return NextResponse.json(result, { status: result.success ? 200 : 400 });
}
