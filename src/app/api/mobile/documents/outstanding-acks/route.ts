import { NextResponse } from "next/server";
import { buildDocumentsCallerFromBearer } from "@/lib/documents-caller";
import { _getMyOutstandingAcknowledgements } from "@/app/(dashboard)/documents/acknowledgement-actions-impl";

/**
 * GET /api/mobile/documents/outstanding-acks  (CLE-227a)
 *
 * Mobile wrapper over `getMyOutstandingAcknowledgements`. Powers the
 * numeric ack badge on the home screen — `rows.length` is what the
 * badge displays (hidden when 0).
 */
export async function GET(request: Request) {
  const caller = await buildDocumentsCallerFromBearer(request);
  if ("error" in caller) {
    return NextResponse.json({ success: false, error: caller.error }, { status: caller.status });
  }
  const result = await _getMyOutstandingAcknowledgements(caller);
  const status = result.success ? 200 : 500;
  return NextResponse.json(result, { status });
}
