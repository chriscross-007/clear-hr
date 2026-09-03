"use server";

// Holiday Approvals — server actions for Approval Profile CRUD and routing
// helpers (CLE-181, parent CLE-180).
//
// Settled spec:
//   https://linear.app/clearhr/document/holiday-approvals-settled-spec-5a4138404dbb
//
// Phase A only wires Level 1 in the application layer; the schema supports
// L2/L3 and they're carried through DTOs ready for Phase B.

import { createClient } from "@/lib/supabase/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

import { logAudit, diffChanges } from "@/lib/audit";

// ---------------------------------------------------------------------------
// Types / DTOs
// ---------------------------------------------------------------------------

export type ApprovalLevelInput = {
  /** 1, 2, or 3. */
  level: number;
  /** NULL = always required when the booking unit is days. */
  lengthThresholdDays: number | null;
  /** NULL = always required when the booking unit is hours. */
  lengthThresholdHours: number | null;
  /** Lists of member.ids — caller-supplied. Must be non-empty for L1. */
  mainApproverIds: string[];
  /** Empty array = no fallback configured. */
  delegateApproverIds: string[];
};

export type ApprovalProfileLevel = ApprovalLevelInput & {
  id: string;
};

export type ApprovalProfile = {
  id: string;
  organisationId: string;
  name: string;
  absenceTypeId: string;
  absenceTypeName: string;
  isDefault: boolean;
  levels: ApprovalProfileLevel[];
  createdAt: string;
  updatedAt: string;
};

export type ApprovalProfileInput = {
  name: string;
  absenceTypeId: string;
  /** Levels in order. Phase A: only level 1 is meaningful — caller may pass
   *  unset L2/L3 entries with empty mainApproverIds; this server action
   *  silently drops levels with no mains so the DB constraint is satisfied. */
  levels: ApprovalLevelInput[];
};

export type ApproverOption = {
  id: string;
  name: string;
  /** Assigned User Rights profile name (e.g. "Admin", "HR", "Manager")
   *  — shown as the small chip on the approver picker so the caller
   *  can tell approvers apart at a glance. */
  profileName: string;
  isActive: boolean;
};

// ---------------------------------------------------------------------------
// Standard helpers (mirroring holiday-period-actions.ts)
// ---------------------------------------------------------------------------

function getAdminClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } },
  );
}

async function getCallerMember() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const { data: member } = await supabase
    .from("members")
    .select("id, organisation_id, first_name, last_name")
    .eq("user_id", user.id)
    .limit(1)
    .single();
  if (!member) throw new Error("No membership found");

  return { supabase, member };
}

async function requireAdminOrOwner() {
  const { supabase, member } = await getCallerMember();
  // CLE-196b-3 — Managing approval profiles = org-level config.
  const { getEffectiveRightsForUser } = await import("@/lib/rights-resolver");
  const { data: { user } } = await supabase.auth.getUser();
  const resolved = user ? await getEffectiveRightsForUser(user.id) : null;
  if (!resolved?.rights.canEditOrgSettings) {
    throw new Error("Insufficient permissions");
  }
  return { supabase, member };
}

// ---------------------------------------------------------------------------
// DTO row shapes (raw from supabase) and mappers
// ---------------------------------------------------------------------------

type ProfileRow = {
  id: string;
  organisation_id: string;
  name: string;
  absence_type_id: string;
  is_default: boolean;
  created_at: string;
  updated_at: string;
  absence_types: { name: string } | null;
};

type LevelRow = {
  id: string;
  profile_id: string;
  level: number;
  length_threshold_days: number | null;
  length_threshold_hours: number | string | null;
  main_approver_ids: string[];
  delegate_approver_ids: string[];
};

const PROFILE_SELECT =
  "id, organisation_id, name, absence_type_id, is_default, sort_order, created_at, updated_at, absence_types(name)";
const LEVEL_SELECT =
  "id, profile_id, level, length_threshold_days, length_threshold_hours, main_approver_ids, delegate_approver_ids";

function mapLevel(row: LevelRow): ApprovalProfileLevel {
  return {
    id: row.id,
    level: row.level,
    lengthThresholdDays: row.length_threshold_days,
    lengthThresholdHours:
      row.length_threshold_hours === null
        ? null
        : typeof row.length_threshold_hours === "string"
          ? Number(row.length_threshold_hours)
          : row.length_threshold_hours,
    mainApproverIds: row.main_approver_ids ?? [],
    delegateApproverIds: row.delegate_approver_ids ?? [],
  };
}

function mapProfile(row: ProfileRow, levels: LevelRow[]): ApprovalProfile {
  const levelsForThis = levels
    .filter((l) => l.profile_id === row.id)
    .sort((a, b) => a.level - b.level)
    .map(mapLevel);
  return {
    id: row.id,
    organisationId: row.organisation_id,
    name: row.name,
    absenceTypeId: row.absence_type_id,
    absenceTypeName: row.absence_types?.name ?? "",
    isDefault: row.is_default,
    levels: levelsForThis,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ---------------------------------------------------------------------------
// getApprovalProfilesForOrg
// ---------------------------------------------------------------------------

export async function getApprovalProfilesForOrg(): Promise<{
  success: boolean;
  error?: string;
  profiles: ApprovalProfile[];
}> {
  try {
    const { supabase, member } = await getCallerMember();

    const { data: profileRows, error: pErr } = await supabase
      .from("approval_profiles")
      .select(PROFILE_SELECT)
      .eq("organisation_id", member.organisation_id)
      // Default pinned at the top; user-controlled order applies among the
      // rest; name as tiebreaker.
      .order("is_default", { ascending: false })
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true });
    if (pErr) return { success: false, error: pErr.message, profiles: [] };

    const profileIds = (profileRows ?? []).map((r) => r.id as string);
    let levelRows: LevelRow[] = [];
    if (profileIds.length > 0) {
      const { data: lRows, error: lErr } = await supabase
        .from("approval_profile_levels")
        .select(LEVEL_SELECT)
        .in("profile_id", profileIds);
      if (lErr) return { success: false, error: lErr.message, profiles: [] };
      levelRows = (lRows as unknown as LevelRow[]) ?? [];
    }

    const profiles = ((profileRows as unknown as ProfileRow[]) ?? []).map((p) =>
      mapProfile(p, levelRows),
    );
    return { success: true, profiles };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : "An error occurred",
      profiles: [],
    };
  }
}

// ---------------------------------------------------------------------------
// getOrgAbsenceTypesForApprovals — list of absence types for the profile UI
// ---------------------------------------------------------------------------

export async function getOrgAbsenceTypesForApprovals(): Promise<{
  success: boolean;
  error?: string;
  absenceTypes: { id: string; name: string }[];
}> {
  try {
    const { supabase, member } = await getCallerMember();
    const { data, error } = await supabase
      .from("absence_types")
      .select("id, name")
      .eq("organisation_id", member.organisation_id)
      .order("name", { ascending: true });
    if (error) return { success: false, error: error.message, absenceTypes: [] };
    return { success: true, absenceTypes: (data ?? []).map((r) => ({ id: r.id as string, name: r.name as string })) };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : "An error occurred",
      absenceTypes: [],
    };
  }
}

// ---------------------------------------------------------------------------
// getApproverOptions — owner + admins with the `can_approve_holidays` right
// ---------------------------------------------------------------------------
//
// Selectable approvers are:
//   - the owner (always, regardless of the permissions blob — owners have
//     all rights by virtue of role, and small orgs may want the owner as
//     a real approver), and
//   - admins whose rights profile grants Approve Holidays.
// Admins without the right are excluded.
//
// Note: existing approval profiles may have approver_id snapshots that
// point at rights-less admins from before this filter was in place. Those
// routings keep working (approve/reject decisions don't re-validate
// against this list), but the IDs won't appear in the picker for
// re-selection — re-pick approvers from the filtered list to refresh.

export async function getApproverOptions(): Promise<{
  success: boolean;
  error?: string;
  approvers: ApproverOption[];
}> {
  try {
    const { supabase, member } = await requireAdminOrOwner();

    // CLE-196b-3 — Approver candidates are members whose Rights Profile
    // grants `can_approve_holidays`. Anyone senior enough to be an
    // approver but who hasn't ticked that specific flag is expected to
    // fix it themselves in Settings → User Rights.
    // CLE-201c-9 — surface the profile *name* on the picker chip
    // rather than the legacy 3-way role tag.
    const { data, error } = await supabase
      .from("members")
      .select("id, first_name, last_name, user_id, rights_profiles!inner(name, can_approve_holidays)")
      .eq("organisation_id", member.organisation_id)
      .eq("rights_profiles.can_approve_holidays", true)
      .order("first_name", { ascending: true });
    if (error) return { success: false, error: error.message, approvers: [] };

    const approvers: ApproverOption[] = (data ?? []).map((m) => {
      const rp = m.rights_profiles as unknown as { name: string } | null;
      return {
        id: m.id as string,
        name: `${m.first_name ?? ""} ${m.last_name ?? ""}`.trim() || "—",
        profileName: rp?.name ?? "—",
        isActive: m.user_id !== null,
      };
    });
    return { success: true, approvers };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : "An error occurred",
      approvers: [],
    };
  }
}

// ---------------------------------------------------------------------------
// saveApprovalProfile — create or update
// ---------------------------------------------------------------------------

export async function saveApprovalProfile(
  input: ApprovalProfileInput,
  profileId?: string,
): Promise<{ success: boolean; error?: string; profileId?: string }> {
  try {
    const { supabase, member } = await requireAdminOrOwner();

    const trimmedName = input.name.trim();
    if (!trimmedName) return { success: false, error: "Name is required" };
    if (!input.absenceTypeId)
      return { success: false, error: "Absence Type is required" };

    // Validate the supplied levels. Phase A: only L1 is enforced; L2/L3 may
    // arrive empty and are dropped here.
    const cleanedLevels = (input.levels ?? [])
      .filter((l) => Array.isArray(l.mainApproverIds) && l.mainApproverIds.length > 0)
      .map((l) => ({
        level: l.level,
        length_threshold_days: l.lengthThresholdDays,
        length_threshold_hours: l.lengthThresholdHours,
        main_approver_ids: l.mainApproverIds,
        delegate_approver_ids: l.delegateApproverIds ?? [],
      }));

    if (!cleanedLevels.some((l) => l.level === 1)) {
      return { success: false, error: "Level 1 must have at least one main approver" };
    }

    // Verify the absence_type belongs to the caller's org (defence in depth).
    const { data: absType } = await supabase
      .from("absence_types")
      .select("id, name, organisation_id")
      .eq("id", input.absenceTypeId)
      .single();
    if (!absType || absType.organisation_id !== member.organisation_id) {
      return { success: false, error: "Absence Type not found in your organisation" };
    }

    let id: string;
    if (profileId) {
      // Verify the existing profile belongs to the caller's org.
      const { data: existing } = await supabase
        .from("approval_profiles")
        .select("id, organisation_id, is_default, name, absence_type_id")
        .eq("id", profileId)
        .single();
      if (!existing || existing.organisation_id !== member.organisation_id) {
        return { success: false, error: "Profile not found" };
      }

      const { error: updErr } = await supabase
        .from("approval_profiles")
        .update({
          name: trimmedName,
          absence_type_id: input.absenceTypeId,
        })
        .eq("id", profileId);
      if (updErr) return { success: false, error: updErr.message };

      // Replace levels: simplest / safest. Profile edits don't ripple to
      // in-flight bookings (those snapshot at submit time), so a delete +
      // insert cycle is correct.
      const { error: delErr } = await supabase
        .from("approval_profile_levels")
        .delete()
        .eq("profile_id", profileId);
      if (delErr) return { success: false, error: delErr.message };
      id = profileId;

      logAudit({
        organisationId: member.organisation_id,
        actorId: member.id,
        actorName: `${member.first_name ?? ""} ${member.last_name ?? ""}`.trim(),
        action: "approval_profile.updated",
        targetType: "approval_profile",
        targetId: id,
        targetLabel: trimmedName,
        changes: diffChanges(
          { name: existing.name, absence_type_id: existing.absence_type_id },
          { name: trimmedName, absence_type_id: input.absenceTypeId },
        ),
      });
    } else {
      // Append-at-end ordering: new profile gets max(sort_order) + 1.
      const { data: maxRow } = await supabase
        .from("approval_profiles")
        .select("sort_order")
        .eq("organisation_id", member.organisation_id)
        .order("sort_order", { ascending: false })
        .limit(1)
        .maybeSingle();
      const nextSortOrder = ((maxRow?.sort_order as number | null) ?? -1) + 1;

      const { data: created, error: insErr } = await supabase
        .from("approval_profiles")
        .insert({
          organisation_id: member.organisation_id,
          name: trimmedName,
          absence_type_id: input.absenceTypeId,
          is_default: false,
          sort_order: nextSortOrder,
        })
        .select("id")
        .single();
      if (insErr || !created) return { success: false, error: insErr?.message ?? "Insert failed" };
      id = created.id as string;

      logAudit({
        organisationId: member.organisation_id,
        actorId: member.id,
        actorName: `${member.first_name ?? ""} ${member.last_name ?? ""}`.trim(),
        action: "approval_profile.created",
        targetType: "approval_profile",
        targetId: id,
        targetLabel: trimmedName,
      });
    }

    // Insert levels (replacement on update; fresh on create).
    const levelInserts = cleanedLevels.map((l) => ({
      profile_id: id,
      level: l.level,
      length_threshold_days: l.length_threshold_days,
      length_threshold_hours: l.length_threshold_hours,
      main_approver_ids: l.main_approver_ids,
      delegate_approver_ids: l.delegate_approver_ids,
    }));
    if (levelInserts.length > 0) {
      const { error: lErr } = await supabase
        .from("approval_profile_levels")
        .insert(levelInserts);
      if (lErr) return { success: false, error: lErr.message };
    }

    return { success: true, profileId: id };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : "An error occurred",
    };
  }
}

// ---------------------------------------------------------------------------
// reorderApprovalProfiles — user-controlled list order (non-default rows)
// ---------------------------------------------------------------------------

export async function reorderApprovalProfiles(
  orderedIds: string[],
): Promise<{ success: boolean; error?: string }> {
  try {
    const { supabase, member } = await requireAdminOrOwner();

    const { data: existing } = await supabase
      .from("approval_profiles")
      .select("id, is_default")
      .eq("organisation_id", member.organisation_id);
    const validNonDefault = new Set(
      (existing ?? []).filter((r) => !r.is_default).map((r) => r.id as string),
    );
    if (orderedIds.some((id) => !validNonDefault.has(id))) {
      return { success: false, error: "Some profiles cannot be reordered (Default is pinned)" };
    }

    // Defaults sit at sort_order 0 by convention; bump non-defaults to 1+.
    for (let i = 0; i < orderedIds.length; i++) {
      const { error } = await supabase
        .from("approval_profiles")
        .update({ sort_order: i + 1 })
        .eq("id", orderedIds[i])
        .eq("organisation_id", member.organisation_id);
      if (error) return { success: false, error: error.message };
    }
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "An error occurred" };
  }
}

// ---------------------------------------------------------------------------
// deleteApprovalProfile — non-default profiles only
// ---------------------------------------------------------------------------

export async function deleteApprovalProfile(
  profileId: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const { supabase, member } = await requireAdminOrOwner();

    const { data: existing } = await supabase
      .from("approval_profiles")
      .select("id, organisation_id, is_default, name")
      .eq("id", profileId)
      .single();
    if (!existing || existing.organisation_id !== member.organisation_id) {
      return { success: false, error: "Profile not found" };
    }
    if (existing.is_default) {
      return { success: false, error: "The default Holiday Approval Profile cannot be deleted" };
    }

    // Block deletion if any member currently points to this profile. The
    // Supabase JS filter API can't express "any JSONB value equals X" cleanly,
    // so pull all org members and inspect in code (orgs are bounded).
    const admin = getAdminClient();
    const { data: allMembers } = await admin
      .from("members")
      .select("id, approval_profile_assignments")
      .eq("organisation_id", member.organisation_id);
    const inUse = (allMembers ?? []).some((m) => {
      const assignments = (m.approval_profile_assignments ?? {}) as Record<string, string>;
      return Object.values(assignments).includes(profileId);
    });
    if (inUse) {
      return {
        success: false,
        error:
          "This profile is currently assigned to one or more employees. Reassign them before deleting.",
      };
    }

    const { error } = await supabase
      .from("approval_profiles")
      .delete()
      .eq("id", profileId);
    if (error) return { success: false, error: error.message };

    logAudit({
      organisationId: member.organisation_id,
      actorId: member.id,
      actorName: `${member.first_name ?? ""} ${member.last_name ?? ""}`.trim(),
      action: "approval_profile.deleted",
      targetType: "approval_profile",
      targetId: profileId,
      targetLabel: existing.name as string,
    });

    return { success: true };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : "An error occurred",
    };
  }
}

// ---------------------------------------------------------------------------
// isMemberUnavailableToday — true if the member has an APPROVED holiday or
// sick booking covering todayISO. Used at submit time to decide whether to
// route a level to mains or delegates. Ignores `deducts_from_entitlement` —
// any approved Holiday/Sick booking means the member is physically out.
// ---------------------------------------------------------------------------

type AbsenceTypeMini = { id: string; name: string };

async function getOrgAbsenceTypeMap(
  client: ReturnType<typeof getAdminClient>,
  orgId: string,
): Promise<Map<string, string>> {
  const { data } = await client
    .from("absence_types")
    .select("id, name")
    .eq("organisation_id", orgId);
  const map = new Map<string, string>();
  for (const at of (data ?? []) as AbsenceTypeMini[]) {
    map.set(at.id, at.name);
  }
  return map;
}

export async function isMemberUnavailableToday(
  memberId: string,
  todayISO: string,
): Promise<boolean> {
  const admin = getAdminClient();

  // Pull the member's org so we can resolve absence_type names.
  const { data: m } = await admin
    .from("members")
    .select("organisation_id")
    .eq("id", memberId)
    .single();
  if (!m) return false;

  const typeMap = await getOrgAbsenceTypeMap(admin, m.organisation_id);

  const { data: bookings } = await admin
    .from("holiday_bookings")
    .select("start_date, end_date, status, absence_reasons(absence_type_id)")
    .eq("member_id", memberId)
    .eq("status", "approved")
    .lte("start_date", todayISO);

  for (const b of bookings ?? []) {
    const end = b.end_date as string | null;
    if (end !== null && end < todayISO) continue;
    const ar = b.absence_reasons as unknown as { absence_type_id: string } | null;
    if (!ar) continue;
    const typeName = typeMap.get(ar.absence_type_id);
    if (typeName === "Annual Leave" || typeName === "Sick") {
      return true;
    }
  }
  return false;
}

/** Bulk variant for routing decisions. Returns the set of memberIds that
 *  ARE unavailable on todayISO. More efficient than calling the singular
 *  helper in a loop because we issue one query per absence_types lookup. */
export async function getUnavailableMemberIds(
  memberIds: string[],
  todayISO: string,
): Promise<Set<string>> {
  if (memberIds.length === 0) return new Set();
  const admin = getAdminClient();

  // All these memberIds are in the same org (caller's org); resolve org once.
  const { data: first } = await admin
    .from("members")
    .select("organisation_id")
    .in("id", memberIds)
    .limit(1)
    .single();
  if (!first) return new Set();

  const typeMap = await getOrgAbsenceTypeMap(admin, first.organisation_id);

  const { data: bookings } = await admin
    .from("holiday_bookings")
    .select("member_id, start_date, end_date, status, absence_reasons(absence_type_id)")
    .in("member_id", memberIds)
    .eq("status", "approved")
    .lte("start_date", todayISO);

  const unavailable = new Set<string>();
  for (const b of bookings ?? []) {
    const end = b.end_date as string | null;
    if (end !== null && end < todayISO) continue;
    const ar = b.absence_reasons as unknown as { absence_type_id: string } | null;
    if (!ar) continue;
    const typeName = typeMap.get(ar.absence_type_id);
    if (typeName === "Annual Leave" || typeName === "Sick") {
      unavailable.add(b.member_id as string);
    }
  }
  return unavailable;
}

// ---------------------------------------------------------------------------
// getMemberApprovalProfileAssignments — read the JSONB pointer map for the
// given member. Used by an employee-form profile picker.
// ---------------------------------------------------------------------------

export async function getMemberApprovalProfileAssignments(
  memberId: string,
): Promise<{ success: boolean; error?: string; assignments: Record<string, string> }> {
  try {
    const { supabase, member } = await getCallerMember();
    const { data } = await supabase
      .from("members")
      .select("organisation_id, approval_profile_assignments")
      .eq("id", memberId)
      .single();
    if (!data || data.organisation_id !== member.organisation_id) {
      return { success: false, error: "Member not found", assignments: {} };
    }
    const assignments = (data.approval_profile_assignments ?? {}) as Record<string, string>;
    return { success: true, assignments };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : "An error occurred",
      assignments: {},
    };
  }
}

// ---------------------------------------------------------------------------
// setMemberApprovalProfile — assign a profile to a member for a given
// absence type. Pass profileId=null to clear the assignment (which falls
// the member back to the legacy "any admin" model for that absence type).
// ---------------------------------------------------------------------------

export async function setMemberApprovalProfile(
  memberId: string,
  absenceTypeId: string,
  profileId: string | null,
): Promise<{ success: boolean; error?: string }> {
  try {
    // Verify caller's permission first via the session client.
    const { member } = await requireAdminOrOwner();

    // Cross-user reads + write use the admin client to bypass RLS — the
    // members UPDATE policy in the DB compares can_manage_members against
    // a boolean, but our codebase stores it as a "read"/"write" string,
    // which throws "invalid input syntax for type boolean: 'write'" when
    // the policy runs. Caller permissions are already verified above.
    const admin = getAdminClient();

    // Verify target member belongs to caller's org.
    const { data: target } = await admin
      .from("members")
      .select("id, organisation_id, approval_profile_assignments")
      .eq("id", memberId)
      .single();
    if (!target || target.organisation_id !== member.organisation_id) {
      return { success: false, error: "Member not found" };
    }

    // Verify profile (if given) belongs to caller's org and matches the
    // absence type.
    if (profileId) {
      const { data: prof } = await admin
        .from("approval_profiles")
        .select("id, organisation_id, absence_type_id")
        .eq("id", profileId)
        .single();
      if (!prof || prof.organisation_id !== member.organisation_id) {
        return { success: false, error: "Profile not found" };
      }
      if (prof.absence_type_id !== absenceTypeId) {
        return { success: false, error: "Profile is for a different absence type" };
      }
    }

    const current = (target.approval_profile_assignments ?? {}) as Record<string, string>;
    const next = { ...current };
    if (profileId === null) {
      delete next[absenceTypeId];
    } else {
      next[absenceTypeId] = profileId;
    }

    const { error } = await admin
      .from("members")
      .update({ approval_profile_assignments: next })
      .eq("id", memberId);
    if (error) return { success: false, error: error.message };

    logAudit({
      organisationId: member.organisation_id,
      actorId: member.id,
      actorName: `${member.first_name ?? ""} ${member.last_name ?? ""}`.trim(),
      action: "member.approval_profile.changed",
      targetType: "member",
      targetId: memberId,
      changes: diffChanges(
        { [absenceTypeId]: current[absenceTypeId] ?? null },
        { [absenceTypeId]: profileId },
      ),
    });

    return { success: true };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : "An error occurred",
    };
  }
}

// ---------------------------------------------------------------------------
// resolveProfileForBooking — given an employee and an absence type, return
// the profile they're routed through (if any). NULL = legacy "any admin"
// fallback (member has no pointer set for this absence type).
// ---------------------------------------------------------------------------

export type ResolvedProfile = {
  profileId: string;
  levels: ApprovalProfileLevel[];
};

export async function resolveProfileForBooking(
  memberId: string,
  absenceTypeId: string,
): Promise<ResolvedProfile | null> {
  const admin = getAdminClient();

  const { data: m } = await admin
    .from("members")
    .select("approval_profile_assignments")
    .eq("id", memberId)
    .single();
  if (!m) return null;

  const assignments = (m.approval_profile_assignments ?? {}) as Record<string, string>;
  const profileId = assignments[absenceTypeId];
  if (!profileId) return null;

  const { data: levels } = await admin
    .from("approval_profile_levels")
    .select(LEVEL_SELECT)
    .eq("profile_id", profileId)
    .order("level", { ascending: true });

  return {
    profileId,
    levels: ((levels as unknown as LevelRow[]) ?? []).map(mapLevel),
  };
}
