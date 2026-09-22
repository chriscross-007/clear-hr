import { NextResponse } from "next/server";
import { buildDocumentsCallerFromBearer } from "@/lib/documents-caller";
import { _getMyDocumentsTrafficLight } from "@/app/(dashboard)/documents/compliance-actions-impl";

/**
 * GET /api/mobile/documents/traffic-light  (CLE-227a)
 *
 * Mobile wrapper over `getMyDocumentsTrafficLight`. Returns the
 * caller's single traffic-light colour + underlying counts, so the
 * home screen can render the coloured dot on the Documents menu
 * button.
 */
export async function GET(request: Request) {
  const caller = await buildDocumentsCallerFromBearer(request);
  if ("error" in caller) {
    return NextResponse.json({ success: false, error: caller.error }, { status: caller.status });
  }
  const result = await _getMyDocumentsTrafficLight(caller);
  const status = result.success ? 200 : (result.error === "Member not found" ? 404 : 500);
  return NextResponse.json(result, { status });
}
