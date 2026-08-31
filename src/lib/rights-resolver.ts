/**
 * CLE-196 — Rights Profiles v2 resolver.
 *
 * Canonical read path for every access decision in the app. Consumers
 * pass a member ID (or the caller's own auth user); the resolver
 * returns an EffectiveRights object with the member's rank, cross-user
 * access scope, all non-tab flags and the per-tab matrix.
 *
 * Read this instead of `members.role` or `members.permissions.can_*` —
 * both of those are legacy and being removed in CLE-196c.
 *
 * The resolver is called from server components and server actions
 * only. Do not import into client code.
 */

import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import {
  TAB_KEYS,
  rankGte,
  type Rank,
  type CrossUserAccess,
  type TabKey,
  type TabAccess,
  type EffectiveRights,
  type MemberContext,
} from "@/lib/rights-types";

// Re-export the shared surface so existing server-only imports of
// `@/lib/rights-resolver` keep working after the split in CLE-197.
export {
  TAB_KEYS,
  rankGte,
  type Rank,
  type CrossUserAccess,
  type TabKey,
  type TabAccess,
  type EffectiveRights,
  type MemberContext,
};
export { rankGt } from "@/lib/rights-types";

// ---------------------------------------------------------------------------
// Access check for cross-user actions
// ---------------------------------------------------------------------------

/**
 * Decides whether an actor can perform an action on a target member.
 * Combines the actor's cross-user access scope with the rank check.
 *
 * Rules (see CLE-195):
 *   - View / update / assign profile: A.rank >= B.rank AND scope match
 *   - Delete user: same as above; last-Admin guard enforced at DB level
 *   - Full peer editing among Admins (rank equality is fine at rank 4)
 *
 * `assignProfile` is the specific right for changing another member's
 * rights_profile_id. It piggybacks on canUpdate but the caller is
 * expected to also check the new profile's rank <= actor's rank.
 */
export function canActOn(
  actor: EffectiveRights,
  actorCtx: MemberContext,
  target: { rank: Rank; teamId: string | null; memberId: string }
): {
  view: boolean;
  update: boolean;
  delete: boolean;
  assignProfile: boolean;
} {
  // Scope check.
  let inScope = false;
  if (actor.crossUserAccess === "all") inScope = true;
  else if (actor.crossUserAccess === "team") {
    inScope = actorCtx.teamId !== null && actorCtx.teamId === target.teamId;
  } else {
    // "self" only
    inScope = actorCtx.memberId === target.memberId;
  }

  // Self is always visible + updatable within own tab matrix (subject
  // to the tab matrix itself — callers layer that check on top).
  if (actorCtx.memberId === target.memberId) inScope = true;

  if (!inScope) {
    return { view: false, update: false, delete: false, assignProfile: false };
  }

  const rankOk = rankGte(actor.rank, target.rank);
  const view = rankOk;
  const update = rankOk;
  const del = rankOk && actorCtx.memberId !== target.memberId; // can't delete self
  const assignProfile = rankOk;

  return { view, update, delete: del, assignProfile };
}

/**
 * Convenience: read the view/update pair for a given tab. Missing keys
 * default to { view: false, update: false } so a newly-added tab is
 * denied to every existing profile until the admin ticks it.
 */
export function resolveTab(rights: EffectiveRights, tab: TabKey): TabAccess {
  return rights.tabs[tab] ?? { view: false, update: false };
}

// ---------------------------------------------------------------------------
// DB reads
// ---------------------------------------------------------------------------

interface RightsProfileRow {
  id: string;
  name: string;
  rank: Rank;
  cross_user_access: CrossUserAccess;
  can_create_users: boolean;
  can_invite_users: boolean;
  can_delete_users: boolean;
  can_approve_holidays: boolean;
  can_override_holiday_rules: boolean;
  can_run_reports: boolean;
  can_run_admin_reports: boolean;
  can_manage_teams: boolean;
  can_edit_org_settings: boolean;
  can_edit_rights_profiles: boolean;
  can_manage_billing: boolean;
  can_view_audit_logs: boolean;
  can_view_sensitive_fields: boolean;
  can_edit_sensitive_fields: boolean;
  // CLE-205 — Documents Tier 1
  can_view_organisation_documents: boolean;
  can_manage_deleted_documents: boolean;
  can_force_delete_documents: boolean;
  tab_matrix: Record<string, { view?: boolean; update?: boolean }>;
}

function normaliseTabMatrix(
  raw: Record<string, { view?: boolean; update?: boolean }>
): Record<TabKey, TabAccess> {
  const out = {} as Record<TabKey, TabAccess>;
  for (const key of TAB_KEYS) {
    const cell = raw?.[key];
    out[key] = {
      view: cell?.view === true,
      update: cell?.update === true,
    };
  }
  return out;
}

function rowToEffective(row: RightsProfileRow): EffectiveRights {
  return {
    profileId: row.id,
    profileName: row.name,
    rank: row.rank,
    crossUserAccess: row.cross_user_access,
    canCreateUsers: row.can_create_users,
    canInviteUsers: row.can_invite_users,
    canDeleteUsers: row.can_delete_users,
    canApproveHolidays: row.can_approve_holidays,
    canOverrideHolidayRules: row.can_override_holiday_rules,
    canRunReports: row.can_run_reports,
    canRunAdminReports: row.can_run_admin_reports,
    canManageTeams: row.can_manage_teams,
    canEditOrgSettings: row.can_edit_org_settings,
    canEditRightsProfiles: row.can_edit_rights_profiles,
    canManageBilling: row.can_manage_billing,
    canViewAuditLogs: row.can_view_audit_logs,
    canViewSensitiveFields: row.can_view_sensitive_fields,
    canEditSensitiveFields: row.can_edit_sensitive_fields,
    canViewOrganisationDocuments: row.can_view_organisation_documents,
    canManageDeletedDocuments: row.can_manage_deleted_documents,
    canForceDeleteDocuments: row.can_force_delete_documents,
    tabs: normaliseTabMatrix(row.tab_matrix ?? {}),
  };
}

const PROFILE_COLUMNS =
  "id, name, rank, cross_user_access, " +
  "can_create_users, can_invite_users, can_delete_users, " +
  "can_approve_holidays, can_override_holiday_rules, " +
  "can_run_reports, can_run_admin_reports, " +
  "can_manage_teams, can_edit_org_settings, can_edit_rights_profiles, " +
  "can_manage_billing, can_view_audit_logs, " +
  "can_view_sensitive_fields, can_edit_sensitive_fields, " +
  "can_view_organisation_documents, can_manage_deleted_documents, " +
  "can_force_delete_documents, tab_matrix";

/**
 * Read the effective rights for a given member. Uses the service-role
 * admin client because looking up other members' profiles is a
 * cross-user read RLS wouldn't otherwise allow.
 */
export async function getEffectiveRights(
  memberId: string
): Promise<EffectiveRights | null> {
  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
  const { data: member } = await admin
    .from("members")
    .select("rights_profile_id")
    .eq("id", memberId)
    .single();
  if (!member?.rights_profile_id) return null;

  const { data: profile } = await admin
    .from("rights_profiles")
    .select(PROFILE_COLUMNS)
    .eq("id", member.rights_profile_id)
    .single();
  if (!profile) return null;

  return rowToEffective(profile as unknown as RightsProfileRow);
}

/**
 * Same as getEffectiveRights but starts from a Supabase auth user id.
 * Handy from server components that already have `user.id`.
 */
export async function getEffectiveRightsForUser(
  userId: string
): Promise<{ rights: EffectiveRights; ctx: MemberContext } | null> {
  const supabase = await createClient();
  const { data: member } = await supabase
    .from("members")
    .select("id, organisation_id, team_id, rights_profile_id")
    .eq("user_id", userId)
    .single();
  if (!member?.rights_profile_id) return null;

  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
  const { data: profile } = await admin
    .from("rights_profiles")
    .select(PROFILE_COLUMNS)
    .eq("id", member.rights_profile_id)
    .single();
  if (!profile) return null;

  return {
    rights: rowToEffective(profile as unknown as RightsProfileRow),
    ctx: {
      memberId: member.id,
      organisationId: member.organisation_id,
      teamId: member.team_id,
    },
  };
}

/** Cheap read for the warning banner / Admin-count queries. */
export async function getMemberRank(memberId: string): Promise<Rank | null> {
  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
  const { data } = await admin
    .from("members")
    .select("rights_profiles(rank)")
    .eq("id", memberId)
    .single();
  const profile = (data as { rights_profiles?: { rank?: Rank } } | null)
    ?.rights_profiles;
  return profile?.rank ?? null;
}

/** Admin count for a given org — legacy helper kept for backwards
 *  compat. Prefer `getRightsEditorCount` for the CLE-199 warning
 *  banner (see CLE-197 flat-list refactor). */
export async function getAdminCount(organisationId: string): Promise<number> {
  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
  const { count } = await admin
    .from("members")
    .select("id, rights_profiles!inner(rank)", { count: "exact", head: true })
    .eq("organisation_id", organisationId)
    .eq("rights_profiles.rank", "admin");
  return count ?? 0;
}

/**
 * CLE-199 — Count of members whose profile grants `can_edit_rights_profiles`.
 * This is the ONLY count that drives the ≥2 bus-factor guard trigger
 * and the warning banner. Rank is vestigial in the flat model
 * (CLE-197); a member's ability to edit User Rights (and by extension,
 * their peers') is governed by the profile flag alone.
 */
export async function getRightsEditorCount(organisationId: string): Promise<number> {
  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
  const { count } = await admin
    .from("members")
    .select("id, rights_profiles!inner(can_edit_rights_profiles)", { count: "exact", head: true })
    .eq("organisation_id", organisationId)
    .eq("rights_profiles.can_edit_rights_profiles", true);
  return count ?? 0;
}
