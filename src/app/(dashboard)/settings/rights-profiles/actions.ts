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
import { getEffectiveRightsForUser } from "@/lib/rights-resolver";
// CLE-197 — Types/constants live in `rights-types` so client-side
// imports of RightsProfileWritePayload don't drag in `next/headers`.
import { TAB_KEYS, type Rank, type CrossUserAccess, type TabKey, type TabAccess } from "@/lib/rights-types";
import { revalidatePath } from "next/cache";
import { logAudit } from "@/lib/audit";

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
  | { ok: true; organisationId: string; callerMemberId: string; callerUserId: string }
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
    return { ok: false, error: "You don't have permission to edit User Rights" };
  }
  return {
    ok: true,
    organisationId: resolved.ctx.organisationId,
    callerMemberId: resolved.ctx.memberId,
    callerUserId: user.id,
  };
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
      // CLE-197 — Flat-list ordering. sort_order is authoritative;
      // name breaks ties for stable output when two rows share it.
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
  orderedIds: string[]
): Promise<{ success: boolean; error?: string }> {
  const guard = await requireCanEditRightsProfiles();
  if (!guard.ok) return { success: false, error: guard.error };
  const admin = getAdmin();

  // CLE-197 — Flat-list reorder. Every profile in the org gets a
  // sort_order matching its index in the supplied list. rank + is_default
  // are ignored — the user sees one list, we persist one order.
  await Promise.all(
    orderedIds.map((id, i) =>
      admin
        .from("rights_profiles")
        .update({ sort_order: i })
        .eq("id", id)
        .eq("organisation_id", guard.organisationId)
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

// ---------------------------------------------------------------------------
// Assignment (picker on the Employment page)
// ---------------------------------------------------------------------------

/**
 * List of profiles usable for the picker on an individual member's
 * Employment page. Read is more permissive than the editor's own list
 * — anyone who can view the member's Personal tab can see which
 * profile they're on and swap them to any other org profile they can
 * see. The actual write is gated by canEditRightsProfiles.
 */
export async function getAssignableProfiles(): Promise<
  { id: string; name: string; rank: Rank }[]
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const resolved = await getEffectiveRightsForUser(user.id);
  if (!resolved) return [];

  const admin = getAdmin();
  const { data } = await admin
    .from("rights_profiles")
    .select("id, name, rank, sort_order")
    .eq("organisation_id", resolved.ctx.organisationId)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  return (
    (data ?? []) as Array<{ id: string; name: string; rank: Rank; sort_order: number }>
  ).map((r) => ({ id: r.id, name: r.name, rank: r.rank }));
}

/**
 * Assign a member to a specific rights_profile. Gated by
 * canEditRightsProfiles on the caller. The DB-level triggers (last-
 * Admin guard, rights-editors-≥2 guard) still enforce bus-factor
 * invariants — a caller with the right can't demote the last rights-
 * editor.
 */
export async function setMemberRightsProfile(
  memberId: string,
  profileId: string,
): Promise<{ success: boolean; error?: string }> {
  try {
  const guard = await requireCanEditRightsProfiles();
  if (!guard.ok) return { success: false, error: guard.error };
  const admin = getAdmin();

  // Verify the profile belongs to the caller's org.
  const { data: profile } = await admin
    .from("rights_profiles")
    .select("id, name")
    .eq("id", profileId)
    .eq("organisation_id", guard.organisationId)
    .single();
  if (!profile) return { success: false, error: "Profile not found" };

  // Fetch the target member (+ their current profile name) and the
  // caller's own member row for audit attribution. The caller's
  // memberId is already known from the guard (resolver has looked it
  // up), so this lookup is just to get first/last name.
  const [{ data: target }, { data: caller }] = await Promise.all([
    admin
      .from("members")
      .select("id, first_name, last_name, rights_profile_id, rights_profiles(name)")
      .eq("id", memberId)
      .eq("organisation_id", guard.organisationId)
      .single(),
    admin
      .from("members")
      .select("first_name, last_name")
      .eq("id", guard.callerMemberId)
      .single(),
  ]);
  if (!target) return { success: false, error: "Member not found" };

  const oldProfileName =
    (target.rights_profiles as unknown as { name?: string } | null)?.name ?? null;
  const newProfileName = profile.name;

  const { error } = await admin
    .from("members")
    .update({ rights_profile_id: profileId })
    .eq("id", memberId)
    .eq("organisation_id", guard.organisationId);
  if (error) return { success: false, error: error.message };

  // Audit on every real profile change. Await the insert so any
  // failure surfaces on the terminal, and the write always completes
  // before this server action returns (fire-and-forget can lose the
  // row on serverless environments).
  if (oldProfileName !== newProfileName) {
    const targetName = [target.first_name, target.last_name].filter(Boolean).join(" ");
    const actorName =
      `${caller?.first_name ?? ""} ${caller?.last_name ?? ""}`.trim() ||
      "Unknown";
    await logAudit({
      organisationId: guard.organisationId,
      actorId: guard.callerMemberId,
      actorName,
      action: "member.rights_profile_changed",
      targetType: "member",
      targetId: memberId,
      targetLabel: targetName || memberId,
      changes: {
        rights_profile: { old: oldProfileName, new: newProfileName },
      },
    });
  }

  revalidatePath(`/members/${memberId}/employment`);
  revalidatePath("/employees");
  revalidatePath("/settings/rights-profiles");
  return { success: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to update User Rights";
    console.error("[setMemberRightsProfile] threw:", msg);
    return { success: false, error: msg };
  }
}

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
