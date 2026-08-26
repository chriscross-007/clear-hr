"use server";

// CLE-197 — Server actions for the Rights Profiles v2 editor.
// Every action is gated by the caller's canEditRightsProfiles flag,
// which itself resolves through the Rights Profiles v2 resolver, so a
// profile can only be edited by a member whose profile grants that
// meta permission. All writes hit `rights_profiles` directly; the
// resolver reads live so changes apply immediately to every member
// on the affected profile.

import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { getEffectiveRightsForUser, TAB_KEYS, type Rank, type CrossUserAccess, type TabKey, type TabAccess } from "@/lib/rights-resolver";
import { revalidatePath } from "next/cache";

// ---------------------------------------------------------------------------
// DTO shape returned to the client
// ---------------------------------------------------------------------------

export interface RightsProfileDto {
  id: string;
  name: string;
  rank: Rank;
  sortOrder: number;
  isDefault: boolean;
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

  tabs: Record<TabKey, TabAccess>;

  /** Number of members currently assigned to this profile. Drives the
   *  "N members will pick up the change immediately" impact preview and
   *  disables Delete when > 0. */
  memberCount: number;
}

// Full editable payload for create/update. Client sends everything;
// server validates + writes.
export interface RightsProfileWritePayload {
  name: string;
  rank: Rank;
  isDefault: boolean;
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

  tabs: Record<TabKey, TabAccess>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getAdmin() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

async function requireCanEditRightsProfiles(): Promise<
  | { ok: true; organisationId: string }
  | { ok: false; error: string }
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not authenticated" };

  const resolved = await getEffectiveRightsForUser(user.id);
  if (!resolved) return { ok: false, error: "No organisation" };
  if (!resolved.rights.canEditRightsProfiles) {
    return { ok: false, error: "You don't have permission to edit Rights Profiles" };
  }
  return { ok: true, organisationId: resolved.ctx.organisationId };
}

// Full tab matrix defaulted to view:false, update:false. Used when
// creating a fresh profile from scratch.
function emptyTabMatrix(): Record<TabKey, TabAccess> {
  const out = {} as Record<TabKey, TabAccess>;
  for (const k of TAB_KEYS) out[k] = { view: false, update: false };
  return out;
}

interface DbRow {
  id: string;
  name: string;
  rank: Rank;
  sort_order: number;
  is_default: boolean;
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
  tab_matrix: Record<string, { view?: boolean; update?: boolean }>;
}

function normaliseTabs(raw: Record<string, { view?: boolean; update?: boolean }>): Record<TabKey, TabAccess> {
  const out = {} as Record<TabKey, TabAccess>;
  for (const k of TAB_KEYS) {
    const c = raw?.[k];
    out[k] = { view: c?.view === true, update: c?.update === true };
  }
  return out;
}

function rowToDto(row: DbRow, memberCount: number): RightsProfileDto {
  return {
    id: row.id,
    name: row.name,
    rank: row.rank,
    sortOrder: row.sort_order,
    isDefault: row.is_default,
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
    tabs: normaliseTabs(row.tab_matrix ?? {}),
    memberCount,
  };
}

const SELECT_COLUMNS =
  "id, name, rank, sort_order, is_default, cross_user_access, " +
  "can_create_users, can_invite_users, can_delete_users, " +
  "can_approve_holidays, can_override_holiday_rules, " +
  "can_run_reports, can_run_admin_reports, " +
  "can_manage_teams, can_edit_org_settings, can_edit_rights_profiles, " +
  "can_manage_billing, can_view_audit_logs, " +
  "can_view_sensitive_fields, can_edit_sensitive_fields, tab_matrix";

function payloadToRow(p: RightsProfileWritePayload): Record<string, unknown> {
  return {
    name: p.name.trim(),
    rank: p.rank,
    is_default: p.isDefault,
    cross_user_access: p.crossUserAccess,
    can_create_users: p.canCreateUsers,
    can_invite_users: p.canInviteUsers,
    can_delete_users: p.canDeleteUsers,
    can_approve_holidays: p.canApproveHolidays,
    can_override_holiday_rules: p.canOverrideHolidayRules,
    can_run_reports: p.canRunReports,
    can_run_admin_reports: p.canRunAdminReports,
    can_manage_teams: p.canManageTeams,
    can_edit_org_settings: p.canEditOrgSettings,
    can_edit_rights_profiles: p.canEditRightsProfiles,
    can_manage_billing: p.canManageBilling,
    can_view_audit_logs: p.canViewAuditLogs,
    can_view_sensitive_fields: p.canViewSensitiveFields,
    can_edit_sensitive_fields: p.canEditSensitiveFields,
    tab_matrix: p.tabs,
  };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function getRightsProfiles(): Promise<RightsProfileDto[]> {
  const guard = await requireCanEditRightsProfiles();
  if (!guard.ok) return [];
  const admin = getAdmin();

  const [{ data: profileRows }, { data: memberRows }] = await Promise.all([
    admin
      .from("rights_profiles")
      .select(SELECT_COLUMNS)
      .eq("organisation_id", guard.organisationId)
      .order("rank", { ascending: false })
      .order("is_default", { ascending: false })
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true }),
    admin
      .from("members")
      .select("rights_profile_id")
      .eq("organisation_id", guard.organisationId),
  ]);

  const counts = new Map<string, number>();
  for (const m of memberRows ?? []) {
    const id = (m as { rights_profile_id: string | null }).rights_profile_id;
    if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
  }

  return ((profileRows ?? []) as unknown as DbRow[]).map((r) =>
    rowToDto(r, counts.get(r.id) ?? 0)
  );
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export async function createRightsProfile(
  payload: RightsProfileWritePayload
): Promise<{ success: boolean; error?: string; id?: string }> {
  const guard = await requireCanEditRightsProfiles();
  if (!guard.ok) return { success: false, error: guard.error };
  if (!payload.name.trim()) return { success: false, error: "Name is required" };
  const admin = getAdmin();

  // Next sort_order at this rank.
  const { data: maxRow } = await admin
    .from("rights_profiles")
    .select("sort_order")
    .eq("organisation_id", guard.organisationId)
    .eq("rank", payload.rank)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextOrder = ((maxRow?.sort_order as number | null) ?? 0) + 1;

  const { data, error } = await admin
    .from("rights_profiles")
    .insert({
      organisation_id: guard.organisationId,
      sort_order: nextOrder,
      ...payloadToRow(payload),
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") return { success: false, error: "A profile with that name already exists" };
    return { success: false, error: error.message };
  }
  revalidatePath("/settings/rights-profiles");
  return { success: true, id: data?.id as string | undefined };
}

export async function updateRightsProfile(
  id: string,
  payload: RightsProfileWritePayload
): Promise<{ success: boolean; error?: string }> {
  const guard = await requireCanEditRightsProfiles();
  if (!guard.ok) return { success: false, error: guard.error };
  if (!payload.name.trim()) return { success: false, error: "Name is required" };
  const admin = getAdmin();

  const { error } = await admin
    .from("rights_profiles")
    .update(payloadToRow(payload))
    .eq("id", id)
    .eq("organisation_id", guard.organisationId);

  if (error) {
    if (error.code === "23505") return { success: false, error: "A profile with that name already exists" };
    return { success: false, error: error.message };
  }
  revalidatePath("/settings/rights-profiles");
  return { success: true };
}

export async function deleteRightsProfile(
  id: string
): Promise<{ success: boolean; error?: string }> {
  const guard = await requireCanEditRightsProfiles();
  if (!guard.ok) return { success: false, error: guard.error };
  const admin = getAdmin();

  const { data: profile } = await admin
    .from("rights_profiles")
    .select("is_default")
    .eq("id", id)
    .eq("organisation_id", guard.organisationId)
    .single();
  if (!profile) return { success: false, error: "Profile not found" };
  if (profile.is_default) return { success: false, error: "The default profile for a rank can't be deleted" };

  const { count } = await admin
    .from("members")
    .select("id", { count: "exact", head: true })
    .eq("rights_profile_id", id);
  if ((count ?? 0) > 0) {
    return { success: false, error: `${count} member${count === 1 ? "" : "s"} still assigned to this profile — reassign them first` };
  }

  const { error } = await admin
    .from("rights_profiles")
    .delete()
    .eq("id", id)
    .eq("organisation_id", guard.organisationId);
  if (error) return { success: false, error: error.message };
  revalidatePath("/settings/rights-profiles");
  return { success: true };
}

export async function reorderRightsProfiles(
  rank: Rank,
  orderedIds: string[]
): Promise<{ success: boolean; error?: string }> {
  const guard = await requireCanEditRightsProfiles();
  if (!guard.ok) return { success: false, error: guard.error };
  const admin = getAdmin();

  // Default row sits at sort_order 0 and isn't drag-reorderable, so
  // non-default rows start at 1.
  await Promise.all(
    orderedIds.map((id, i) =>
      admin
        .from("rights_profiles")
        .update({ sort_order: i + 1 })
        .eq("id", id)
        .eq("organisation_id", guard.organisationId)
        .eq("rank", rank)
        .eq("is_default", false)
    )
  );
  revalidatePath("/settings/rights-profiles");
  return { success: true };
}

export async function copyRightsProfile(
  sourceId: string
): Promise<{ success: boolean; error?: string; id?: string }> {
  const guard = await requireCanEditRightsProfiles();
  if (!guard.ok) return { success: false, error: guard.error };
  const admin = getAdmin();

  const { data: src } = await admin
    .from("rights_profiles")
    .select(SELECT_COLUMNS)
    .eq("id", sourceId)
    .eq("organisation_id", guard.organisationId)
    .single();
  if (!src) return { success: false, error: "Source profile not found" };
  const source = src as unknown as DbRow;

  const payload: RightsProfileWritePayload = {
    name: `${source.name} (Copy)`,
    rank: source.rank,
    isDefault: false,
    crossUserAccess: source.cross_user_access,
    canCreateUsers: source.can_create_users,
    canInviteUsers: source.can_invite_users,
    canDeleteUsers: source.can_delete_users,
    canApproveHolidays: source.can_approve_holidays,
    canOverrideHolidayRules: source.can_override_holiday_rules,
    canRunReports: source.can_run_reports,
    canRunAdminReports: source.can_run_admin_reports,
    canManageTeams: source.can_manage_teams,
    canEditOrgSettings: source.can_edit_org_settings,
    canEditRightsProfiles: source.can_edit_rights_profiles,
    canManageBilling: source.can_manage_billing,
    canViewAuditLogs: source.can_view_audit_logs,
    canViewSensitiveFields: source.can_view_sensitive_fields,
    canEditSensitiveFields: source.can_edit_sensitive_fields,
    tabs: normaliseTabs(source.tab_matrix),
  };

  return createRightsProfile(payload);
}

// ---------------------------------------------------------------------------
// Utility exposed to the editor for the "create fresh" button
// ---------------------------------------------------------------------------

export async function getBlankProfilePayload(rank: Rank): Promise<RightsProfileWritePayload> {
  return {
    name: "",
    rank,
    isDefault: false,
    crossUserAccess: rank === "employee" ? "self" : rank === "manager" ? "team" : "all",
    canCreateUsers: false,
    canInviteUsers: false,
    canDeleteUsers: false,
    canApproveHolidays: false,
    canOverrideHolidayRules: false,
    canRunReports: false,
    canRunAdminReports: false,
    canManageTeams: false,
    canEditOrgSettings: false,
    canEditRightsProfiles: false,
    canManageBilling: false,
    canViewAuditLogs: false,
    canViewSensitiveFields: false,
    canEditSensitiveFields: false,
    tabs: emptyTabMatrix(),
  };
}
