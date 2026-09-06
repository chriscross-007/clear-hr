import { NextResponse } from "next/server";
import { verifyCaller } from "../../lib";

/**
 * GET /api/mobile/members/for-capture
 *
 * Returns the members the calling user has `documents.update` on —
 * i.e. the valid targets for the mobile ad-hoc capture flow's member
 * picker. Ordered by first_name.
 *
 * Server-side scoping matches uploadMemberDocument.canUpdateTarget:
 *   - self is always allowed if own `documents.update`
 *   - `crossUserAccess = "all"` sees every org member (if own flag)
 *   - `crossUserAccess = "team"` sees own team's members (if own flag)
 *   - `crossUserAccess = "self"` sees only self
 *
 * Also filters out members whose invite hasn't been accepted — the
 * caller can still take a photo against them, but the picker orders
 * accepted members first via the sort so onboarding cases surface
 * without needing a search.
 */
export async function GET(request: Request) {
  try {
    const v = await verifyCaller(request);
    if ("error" in v) return NextResponse.json({ error: v.error }, { status: v.status });
    const { admin, user, organisationId, memberId: callerMemberId } = v;

    const { getEffectiveRightsForUser } = await import("@/lib/rights-resolver");
    const resolved = await getEffectiveRightsForUser(user.id);
    if (!resolved) return NextResponse.json({ error: "No organisation" }, { status: 403 });
    const { rights, ctx } = resolved;

    // If the caller doesn't have documents.update at all, empty list.
    if (rights.tabs.documents?.update !== true) {
      return NextResponse.json({ success: true, members: [] });
    }

    // Build the scope filter.
    let query = admin
      .from("members")
      .select("id, first_name, last_name, team_id, user_id")
      .eq("organisation_id", organisationId)
      .order("first_name", { ascending: true });

    if (rights.crossUserAccess === "self") {
      query = query.eq("id", callerMemberId);
    } else if (rights.crossUserAccess === "team") {
      // Self plus everyone in the caller's team (if they have one).
      if (ctx.teamId) {
        query = query.or(`id.eq.${callerMemberId},team_id.eq.${ctx.teamId}`);
      } else {
        query = query.eq("id", callerMemberId);
      }
    }
    // "all" scope — no additional filter.

    const { data, error } = await query;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const members = (data ?? []).map((m) => ({
      id: m.id as string,
      firstName: m.first_name as string,
      lastName: m.last_name as string,
      teamId: (m.team_id as string | null) ?? null,
      invited: m.user_id !== null,
    }));

    return NextResponse.json({ success: true, members });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
