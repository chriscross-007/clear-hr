import { NextResponse } from "next/server";
import { verifyCaller } from "../lib";

// ---------------------------------------------------------------------------
// CLE-190 — Notice-period rules context for the mobile holiday-request
// screen. Mirrors `getMyOrgNoticeContext` from
// `(dashboard)/notice-period-actions.ts` — returns the caller's notice
// rules + block-or-warn flag so the mobile client can preview a notice
// violation as the user adjusts dates.
//
// CLE-194 — multi-profile notice rules. Resolves the caller's
// `members.notice_period_profile_id`, falling back to the org's Default
// profile if NULL, then loads that profile's rules + block flag.
// ---------------------------------------------------------------------------

type NoticeRulesContextPayload = {
  /** Sorted descending by min_booking_days — the existing convention so
   *  the first match in a `.find()` is the strictest applicable rule. */
  rules: { min_booking_days: number; notice_days: number }[];
  /** Profile-level block flag. When TRUE notice violations hard-block the
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
    const { admin, organisationId, memberId } = result;

    // Resolve the caller's notice profile.
    const { data: callerRow } = await admin
      .from("members")
      .select("notice_period_profile_id")
      .eq("id", memberId)
      .single();
    let profileId =
      (callerRow as { notice_period_profile_id: string | null } | null)?.notice_period_profile_id ?? null;
    if (!profileId) {
      const { data: def } = await admin
        .from("notice_period_profiles")
        .select("id")
        .eq("organisation_id", organisationId)
        .eq("is_default", true)
        .limit(1)
        .single();
      profileId = (def?.id as string) ?? null;
    }

    let rules: { min_booking_days: number; notice_days: number }[] = [];
    let blockRequests = false;
    if (profileId) {
      const [{ data: rulesRows }, { data: profile }] = await Promise.all([
        admin
          .from("notice_period_rules")
          .select("min_booking_days, notice_days")
          .eq("profile_id", profileId)
          .order("min_booking_days", { ascending: false }),
        admin
          .from("notice_period_profiles")
          .select("block_requests")
          .eq("id", profileId)
          .single(),
      ]);
      rules = (rulesRows ?? []).map((r) => ({
        min_booking_days: Number(r.min_booking_days),
        notice_days: Number(r.notice_days),
      }));
      blockRequests = !!(profile as { block_requests?: boolean } | null)?.block_requests;
    }

    const payload: NoticeRulesContextPayload = { rules, blockRequests };
    return NextResponse.json({ context: payload });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[mobile/notice-rules-context] GET threw:", msg);
    return NextResponse.json({ error: msg, context: EMPTY }, { status: 500 });
  }
}
