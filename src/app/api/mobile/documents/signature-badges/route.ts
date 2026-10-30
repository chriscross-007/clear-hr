import { NextResponse } from "next/server";
import { buildDocumentsCallerFromBearer } from "@/lib/documents-caller";
import { _getSignatureBadges } from "@/app/(dashboard)/documents/signature-actions-impl";

/** POST /api/mobile/documents/signature-badges (CLE-236) — body `{ ids: string[] }` → `{ badges }`. */
export async function POST(request: Request) {
  const caller = await buildDocumentsCallerFromBearer(request);
  if ("error" in caller) return NextResponse.json({ success: false, error: caller.error }, { status: caller.status });
  let ids: string[] = [];
  try {
    const body = (await request.json()) as { ids?: unknown };
    ids = Array.isArray(body.ids) ? body.ids.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return NextResponse.json({ success: false, error: "Invalid request" }, { status: 400 });
  }
  const result = await _getSignatureBadges(caller, ids);
  return NextResponse.json(result, { status: result.success ? 200 : 400 });
}
