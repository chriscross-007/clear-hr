import { NextResponse } from "next/server";
import { verifyCaller } from "../lib";

// ---------------------------------------------------------------------------
// CLE-190 — Notice-period rules context for the mobile holiday-request
// screen. Mirrors `getMyOrgNoticeContext` from
// `(dashboard)/notice-period-actions.ts` — returns the org's notice rules
// + the block-or-warn flag so the mobile client can preview a notice
// violation as the user adjusts dates.
//
// The rules themselves are not user-scoped data, but going through a
// dedicated Bearer-auth route lets us authenticate the caller and scope
// the read to their org without exposing the table to a wider client.
// ---------------------------------------------------------------------------

type NoticeRulesContextPayload = {
  /** Sorted descending by min_booking_days — the existing convention so
   *  the first match in a `.find()` is the strictest applicable rule. */
  rules: { min_booking_days: number; notice_days: number }[];
  /** Org-level block flag. When TRUE notice violations hard-block the
   *  submission; when FALSE they're informational warnings only. Same
   *  flag governs the cover check. */
  blockRequests: boolean;
};

const EMPTY: NoticeRulesContextPayload = {
  rules: [],
  blockRequests: false,
};

export async function GET(request: Request) {
  console.log("[mobile/notice-rules-context] GET hit");
  try {
    const result = await verifyCaller(request);
    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    const { admin, organisationId } = result;

    const [{ data: rules }, { data: org }] = await Promise.all([
      admin
        .from("notice_period_rules")
        .select("min_booking_days, notice_days")
        .eq("organisation_id", organisationId)
        .order("min_booking_days", { ascending: false }),
      admin
        .from("organisations")
        .select("notice_rules_block_requests")
        .eq("id", organisationId)
        .single(),
    ]);

    const payload: NoticeRulesContextPayload = {
      rules: (rules ?? []).map((r) => ({
        min_booking_days: Number(r.min_booking_days),
        notice_days: Number(r.notice_days),
      })),
      blockRequests: !!(org as { notice_rules_block_requests?: boolean } | null)?.notice_rules_block_requests,
    };

    return NextResponse.json({ context: payload });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[mobile/notice-rules-context] GET threw:", msg);
    return NextResponse.json({ error: msg, context: EMPTY }, { status: 500 });
  }
}
