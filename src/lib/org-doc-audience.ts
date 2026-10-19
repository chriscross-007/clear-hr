// CLE-230 — Per-document audience for organisation documents.
//
// Every "who can see / who must acknowledge this org doc?" decision goes
// through here. Plain module (not "use server") so web actions, impl
// siblings and mobile routes can all import it.
//
// Rules:
//   • mode 'all'       → every member whose profile grants
//                        can_view_organisation_documents.
//   • mode 'selected'  → a member is in the audience when
//       (a) at least one filter is set AND they match every filter that
//           is set (team ∈ teamIds if teams chosen; profile ∈
//           rightsProfileIds if profiles chosen), OR
//       (b) they're on the Always-include list.
//   • VISIBILITY: can_view_organisation_documents AND
//                 (can_manage_organisation_documents OR in audience).
//     Managers always see every doc.
//   • ACK EXPECTATION: can_view_organisation_documents AND in audience.
//     Managers outside the audience can see the doc but aren't chased.

import type { SupabaseClient } from "@supabase/supabase-js";

export type AudienceMode = "all" | "selected";

export interface OrgDocAudience {
  mode: AudienceMode;
  teamIds: string[];
  rightsProfileIds: string[];
  includeMemberIds: string[];
}

/** Columns to add to any `.from("document").select(...)` that needs
 *  to evaluate the audience. */
export const AUDIENCE_COLUMNS =
  "audience_mode, audience_team_ids, audience_rights_profile_ids, audience_include_member_ids";

export interface AudienceDbRow {
  audience_mode?: string | null;
  audience_team_ids?: string[] | null;
  audience_rights_profile_ids?: string[] | null;
  audience_include_member_ids?: string[] | null;
}

export const EVERYONE: OrgDocAudience = {
  mode: "all",
  teamIds: [],
  rightsProfileIds: [],
  includeMemberIds: [],
};

export function audienceFromRow(row: AudienceDbRow): OrgDocAudience {
  return {
    mode: row.audience_mode === "selected" ? "selected" : "all",
    teamIds: row.audience_team_ids ?? [],
    rightsProfileIds: row.audience_rights_profile_ids ?? [],
    includeMemberIds: row.audience_include_member_ids ?? [],
  };
}

/** The minimum a member needs to carry for audience evaluation. */
export interface AudienceMember {
  id: string;
  teamId: string | null;
  rightsProfileId: string | null;
}

export function memberInAudience(a: OrgDocAudience, m: AudienceMember): boolean {
  if (a.mode === "all") return true;
  if (a.includeMemberIds.includes(m.id)) return true;
  const hasTeams = a.teamIds.length > 0;
  const hasProfiles = a.rightsProfileIds.length > 0;
  if (!hasTeams && !hasProfiles) return false;
  if (hasTeams && (!m.teamId || !a.teamIds.includes(m.teamId))) return false;
  if (hasProfiles && (!m.rightsProfileId || !a.rightsProfileIds.includes(m.rightsProfileId))) return false;
  return true;
}

/** A member row with the two org-doc flags from their rights profile. */
export interface OrgDocMember extends AudienceMember {
  signedIn: boolean;
  canView: boolean;
  canManage: boolean;
}

export function canSeeOrgDoc(a: OrgDocAudience, m: OrgDocMember): boolean {
  if (!m.canView) return false;
  return m.canManage || memberInAudience(a, m);
}

export function isExpectedToAcknowledge(a: OrgDocAudience, m: OrgDocMember): boolean {
  return m.canView && memberInAudience(a, m);
}

type ProfileFlags = {
  can_view_organisation_documents?: boolean | null;
  can_manage_organisation_documents?: boolean | null;
};
type MemberDbRow = {
  id: string;
  user_id: string | null;
  team_id: string | null;
  rights_profile_id: string | null;
  rights_profiles: ProfileFlags | ProfileFlags[] | null;
};

function toOrgDocMember(r: MemberDbRow): OrgDocMember {
  const rp = Array.isArray(r.rights_profiles) ? r.rights_profiles[0] : r.rights_profiles;
  return {
    id: r.id,
    teamId: r.team_id,
    rightsProfileId: r.rights_profile_id,
    signedIn: r.user_id !== null,
    canView: rp?.can_view_organisation_documents === true,
    canManage: rp?.can_manage_organisation_documents === true,
  };
}

const MEMBER_SELECT =
  "id, user_id, team_id, rights_profile_id, rights_profiles(can_view_organisation_documents, can_manage_organisation_documents)";

/** Every member in the org with the fields audience evaluation needs.
 *  Pass the service-role client — this is a cross-user read. */
export async function loadOrgDocMembers(
  admin: SupabaseClient,
  organisationId: string,
): Promise<OrgDocMember[]> {
  const { data } = await admin
    .from("members")
    .select(MEMBER_SELECT)
    .eq("organisation_id", organisationId);
  return ((data ?? []) as unknown as MemberDbRow[]).map(toOrgDocMember);
}

/** One member, same shape. Null when not found in the org. */
export async function loadOrgDocMember(
  admin: SupabaseClient,
  organisationId: string,
  memberId: string,
): Promise<OrgDocMember | null> {
  const { data } = await admin
    .from("members")
    .select(MEMBER_SELECT)
    .eq("organisation_id", organisationId)
    .eq("id", memberId)
    .maybeSingle();
  return data ? toOrgDocMember(data as unknown as MemberDbRow) : null;
}

/** Signed-in members expected to acknowledge a doc with this audience.
 *  Matches the coverage denominator used across the Compliance pages. */
export function expectedAcknowledgerIds(a: OrgDocAudience, members: OrgDocMember[]): string[] {
  return members.filter((m) => m.signedIn && isExpectedToAcknowledge(a, m)).map((m) => m.id);
}
