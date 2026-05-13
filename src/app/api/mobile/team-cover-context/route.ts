import { NextResponse } from "next/server";
import { verifyCaller } from "../lib";

// ---------------------------------------------------------------------------
// CLE-189 — Team cover context for the mobile holiday-request screen.
//
// Mirrors `getMyTeamCoverContext` in `(dashboard)/holiday-booking-actions.ts`
// — returns just enough data for the mobile client to compute, per-day,
// whether a proposed date range would drop the caller's team below the
// configured Min Cover, and whether the org wants those violations to be
// blocking (`block_requests = true`) or just warning.
//
// Why a dedicated endpoint instead of letting the mobile app fetch the
// pieces directly: counting teammates and reading their bookings crosses
// users, which the employee's session RLS would block. The web app's
// equivalent uses the service-role admin client; this route does the same
// behind a Bearer-auth check.
// ---------------------------------------------------------------------------

type TeamCoverContextPayload = {
  teamId: string | null;
  /** Total members in the team, including the caller. */
  teamSize: number;
  /** Configured Min Cover for the team (0 = unlimited). */
  minCover: number;
  /** Org-level block flag — when TRUE the cover violation hard-blocks
   *  the submission; when FALSE it's an informational warning. */
  blockRequests: boolean;
  /** Active pending/approved bookings of every other team member, with
   *  date ranges so the client can do day-by-day overlap counts. */
  teammateBookings: {
    memberId: string;
    startDate: string;
    endDate: string | null;
  }[];
  /** Map of teammate id → display name. Used by the mobile warning UI
   *  to name who's already off. */
  teammateNames: Record<string, string>;
};

const EMPTY: TeamCoverContextPayload = {
  teamId: null,
  teamSize: 0,
  minCover: 0,
  blockRequests: false,
  teammateBookings: [],
  teammateNames: {},
};

export async function GET(request: Request) {
  console.log("[mobile/team-cover-context] GET hit");
  try {
    const result = await verifyCaller(request);
    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    const { admin, user, organisationId } = result;

    const { data: caller } = await admin
      .from("members")
      .select("id, team_id")
      .eq("user_id", user.id)
      .eq("organisation_id", organisationId)
      .limit(1)
      .single();
    if (!caller || !caller.team_id) {
      return NextResponse.json({ context: EMPTY });
    }
    const callerMemberId = caller.id as string;
    const teamId = caller.team_id as string;

    const [
      { data: teamRow },
      { data: orgRow },
      { count: teamMemberCount },
      { data: teammates },
    ] = await Promise.all([
      admin.from("teams").select("min_cover").eq("id", teamId).single(),
      admin.from("organisations").select("notice_rules_block_requests").eq("id", organisationId).single(),
      admin
        .from("members")
        .select("id", { count: "exact", head: true })
        .eq("organisation_id", organisationId)
        .eq("team_id", teamId),
      admin
        .from("members")
        .select("id, first_name, last_name")
        .eq("organisation_id", organisationId)
        .eq("team_id", teamId)
        .neq("id", callerMemberId),
    ]);

    const minCover = Number((teamRow as { min_cover: number | null } | null)?.min_cover ?? 0);
    const blockRequests = !!(orgRow as { notice_rules_block_requests?: boolean } | null)?.notice_rules_block_requests;
    const teamSize = teamMemberCount ?? 0;
    const teammateRows = (teammates ?? []) as { id: string; first_name: string; last_name: string }[];
    const teammateIds = teammateRows.map((t) => t.id);
    const teammateNames: Record<string, string> = {};
    for (const t of teammateRows) {
      teammateNames[t.id] = `${t.first_name} ${t.last_name}`;
    }

    if (teammateIds.length === 0 || minCover <= 0) {
      return NextResponse.json({
        context: { teamId, teamSize, minCover, blockRequests, teammateBookings: [], teammateNames },
      });
    }

    const { data: bookings } = await admin
      .from("holiday_bookings")
      .select("member_id, start_date, end_date")
      .in("member_id", teammateIds)
      .in("status", ["approved", "pending"]);

    const teammateBookings = (bookings ?? []).map((b) => ({
      memberId: b.member_id as string,
      startDate: b.start_date as string,
      endDate: b.end_date as string | null,
    }));

    return NextResponse.json({
      context: { teamId, teamSize, minCover, blockRequests, teammateBookings, teammateNames },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[mobile/team-cover-context] GET threw:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
