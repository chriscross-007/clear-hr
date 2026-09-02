// CLE-197 — Runtime constants + types for Rights Profiles v2.
//
// Split from `rights-resolver.ts` so client components can import
// TAB_KEYS / Rank / TabKey / etc. without pulling in the resolver's
// server-only dependencies (`next/headers`, service-role Supabase
// client). The resolver re-exports everything from here for server
// callers that want the whole surface in one import.

export type Rank = "employee" | "manager" | "hr" | "admin";
export type CrossUserAccess = "self" | "team" | "all";

/**
 * The ten tabs on the employee form (source of truth for the tab_matrix
 * JSONB keys). Adding a tab means:
 *  1. Append the key here.
 *  2. Add it to the manager's tab matrix editor (CLE-197).
 *  3. Backfill the key on existing rights_profiles rows (default to
 *     view:false, update:false).
 */
export const TAB_KEYS = [
  "planner",
  "timesheet",
  "dashboard",
  "holiday",
  "employment",
  "personal",
  "contacts",
  "documents",
  "expenses",
  "history",
] as const;
export type TabKey = (typeof TAB_KEYS)[number];

export interface TabAccess {
  view: boolean;
  update: boolean;
}

export interface EffectiveRights {
  profileId: string;
  profileName: string;
  rank: Rank;
  crossUserAccess: CrossUserAccess;

  canCreateUsers: boolean;
  canInviteUsers: boolean;
  canDeleteUsers: boolean;
  canApproveHolidays: boolean;
  canOverrideHolidayRules: boolean;
  canRunReports: boolean;
  canRunAdminReports: boolean;
  canManageTeams: boolean;
  canEditOrgSettings: boolean;
  canEditRightsProfiles: boolean;
  canManageBilling: boolean;
  canViewAuditLogs: boolean;
  canViewSensitiveFields: boolean;
  canEditSensitiveFields: boolean;

  // CLE-205 → CLE-209 follow-up — Documents Tier 1 flags.
  canViewOrganisationDocuments: boolean;
  canManageOrganisationDocuments: boolean;
  canForceDeleteDocuments: boolean;

  tabs: Record<TabKey, TabAccess>;
}

export interface MemberContext {
  memberId: string;
  organisationId: string;
  teamId: string | null;
}

// Rank ordering — safe to use client-side.
const RANK_ORDER: Record<Rank, number> = {
  employee: 1,
  manager: 2,
  hr: 3,
  admin: 4,
};

/** Returns true if rank A is at least as high as rank B. */
export function rankGte(a: Rank, b: Rank): boolean {
  return RANK_ORDER[a] >= RANK_ORDER[b];
}

/** Returns true if rank A is strictly higher than rank B. */
export function rankGt(a: Rank, b: Rank): boolean {
  return RANK_ORDER[a] > RANK_ORDER[b];
}
