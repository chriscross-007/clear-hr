"use server";

// CLE-194 — Holiday Profile actions (Phase 2).
//
// Owns CRUD over `holiday_profiles` and the per-member assignment via
// `members.holiday_profile_id`. Mirrors the shape of
// `notice-period-actions.ts` so the Settings → Profiles → Holiday
// Profiles tab and the Employment-page picker can wire up the same way
// as Notice Period.
//
// Auto-create-first-period: when both preconditions are met (member has
// a profile + the org/start_date precondition for first-period creation),
// the helper inserts the first holiday_periods row by reusing the period
// defaults computation from `holiday-period-actions.getNewPeriodDefaults`.
// Called from `addEmployee`, `setMemberHolidayProfile`, and any flow
// that sets `members.start_date`.

import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { getNewPeriodDefaults, createHolidayPeriod } from "./holiday-period-actions";

function getAdminClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } },
  );
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type HolidayProfile = {
  id: string;
  name: string;
  isDefault: boolean;
  sortOrder: number;
  holidayType: "fixed" | "earned";
  holidayUnits: "days" | "hours";
  holidayEarnedFactor: number;
  holidayAllowance: number;
  holidayToilHoursPerDay: number;
  holidayMaxCarryForward: number;
  holidayMinCarryForward: number;
  memberCount: number;
};

export type HolidayProfileInput = {
  name: string;
  holidayType: "fixed" | "earned";
  holidayUnits: "days" | "hours";
  holidayEarnedFactor: number;
  holidayAllowance: number;
  holidayToilHoursPerDay: number;
  holidayMaxCarryForward: number;
  holidayMinCarryForward: number;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getCallerMember() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  const { data: member } = await supabase
    .from("members")
    .select("id, organisation_id, role")
    .eq("user_id", user.id)
    .limit(1)
    .single();
  if (!member) throw new Error("No organisation");
  return { supabase, member };
}

async function getCallerOwner() {
  const { supabase, member } = await getCallerMember();
  if (member.role !== "owner") throw new Error("Owner only");
  return { supabase, member };
}

function mapRow(p: Record<string, unknown>, count: number): HolidayProfile {
  return {
    id: p.id as string,
    name: p.name as string,
    isDefault: !!p.is_default,
    sortOrder: Number(p.sort_order ?? 0),
    holidayType: p.holiday_type as "fixed" | "earned",
    holidayUnits: p.holiday_units as "days" | "hours",
    holidayEarnedFactor: Number(p.holiday_earned_factor ?? 0),
    holidayAllowance: Number(p.holiday_allowance ?? 0),
    holidayToilHoursPerDay: Number(p.holiday_toil_hours_per_day ?? 0),
    holidayMaxCarryForward: Number(p.holiday_max_carry_forward ?? 0),
    holidayMinCarryForward: Number(p.holiday_min_carry_forward ?? 0),
    memberCount: count,
  };
}

// ---------------------------------------------------------------------------
// List / create / update / delete
// ---------------------------------------------------------------------------

export async function getHolidayProfiles(): Promise<{
  success: boolean;
  error?: string;
  profiles?: HolidayProfile[];
}> {
  try {
    const { supabase, member } = await getCallerMember();

    const [{ data: profiles, error: pErr }, { data: counts }] = await Promise.all([
      supabase
        .from("holiday_profiles")
        .select("id, name, is_default, sort_order, holiday_type, holiday_units, holiday_earned_factor, holiday_allowance, holiday_toil_hours_per_day, holiday_max_carry_forward, holiday_min_carry_forward")
        .eq("organisation_id", member.organisation_id)
        .order("is_default", { ascending: false })
        .order("sort_order", { ascending: true })
        .order("name", { ascending: true }),
      supabase
        .from("members")
        .select("holiday_profile_id")
        .eq("organisation_id", member.organisation_id),
    ]);

    if (pErr) return { success: false, error: pErr.message };

    const countByProfile = new Map<string, number>();
    for (const m of counts ?? []) {
      const id = (m.holiday_profile_id as string | null) ?? null;
      if (!id) continue;
      countByProfile.set(id, (countByProfile.get(id) ?? 0) + 1);
    }

    return {
      success: true,
      profiles: (profiles ?? []).map((p) => mapRow(p, countByProfile.get(p.id as string) ?? 0)),
    };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "An error occurred" };
  }
}

export async function createHolidayProfile(
  input: HolidayProfileInput,
): Promise<{ success: boolean; error?: string; profileId?: string }> {
  try {
    const { supabase, member } = await getCallerOwner();
    const trimmed = input.name.trim();
    if (!trimmed) return { success: false, error: "Name is required" };

    // Append-at-end ordering.
    const { data: maxRow } = await supabase
      .from("holiday_profiles")
      .select("sort_order")
      .eq("organisation_id", member.organisation_id)
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle();
    const nextSortOrder = ((maxRow?.sort_order as number | null) ?? -1) + 1;

    const { data, error } = await supabase
      .from("holiday_profiles")
      .insert({
        organisation_id: member.organisation_id,
        name: trimmed,
        is_default: false,
        sort_order: nextSortOrder,
        holiday_type: input.holidayType,
        holiday_units: input.holidayUnits,
        holiday_earned_factor: input.holidayEarnedFactor,
        holiday_allowance: input.holidayAllowance,
        holiday_toil_hours_per_day: input.holidayToilHoursPerDay,
        holiday_max_carry_forward: input.holidayMaxCarryForward,
        holiday_min_carry_forward: input.holidayMinCarryForward,
      })
      .select("id")
      .single();
    if (error) {
      if (error.code === "23505") return { success: false, error: "A profile with that name already exists" };
      return { success: false, error: error.message };
    }
    return { success: true, profileId: (data as { id: string }).id };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "An error occurred" };
  }
}

export async function updateHolidayProfile(
  profileId: string,
  patch: Partial<HolidayProfileInput>,
): Promise<{ success: boolean; error?: string }> {
  try {
    const { supabase, member } = await getCallerOwner();

    const { data: existing } = await supabase
      .from("holiday_profiles")
      .select("organisation_id, is_default")
      .eq("id", profileId)
      .single();
    if (!existing || (existing as { organisation_id: string }).organisation_id !== member.organisation_id) {
      return { success: false, error: "Profile not found" };
    }

    const updates: Record<string, unknown> = {};
    if (patch.name !== undefined) {
      const trimmed = patch.name.trim();
      if (!trimmed) return { success: false, error: "Name is required" };
      // Default name is locked — matches Notice Period precedent.
      if ((existing as { is_default: boolean }).is_default) {
        // No-op: silently ignore name change on the Default profile.
      } else {
        updates.name = trimmed;
      }
    }
    if (patch.holidayType !== undefined) updates.holiday_type = patch.holidayType;
    if (patch.holidayUnits !== undefined) updates.holiday_units = patch.holidayUnits;
    if (patch.holidayEarnedFactor !== undefined) updates.holiday_earned_factor = patch.holidayEarnedFactor;
    if (patch.holidayAllowance !== undefined) updates.holiday_allowance = patch.holidayAllowance;
    if (patch.holidayToilHoursPerDay !== undefined) updates.holiday_toil_hours_per_day = patch.holidayToilHoursPerDay;
    if (patch.holidayMaxCarryForward !== undefined) updates.holiday_max_carry_forward = patch.holidayMaxCarryForward;
    if (patch.holidayMinCarryForward !== undefined) updates.holiday_min_carry_forward = patch.holidayMinCarryForward;

    if (Object.keys(updates).length === 0) return { success: true };

    const { error } = await supabase
      .from("holiday_profiles")
      .update(updates)
      .eq("id", profileId);
    if (error) {
      if (error.code === "23505") return { success: false, error: "A profile with that name already exists" };
      return { success: false, error: error.message };
    }
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "An error occurred" };
  }
}

export async function deleteHolidayProfile(
  profileId: string,
): Promise<{ success: boolean; error?: string; reassigned?: number }> {
  try {
    const { supabase, member } = await getCallerOwner();

    const { data: existing } = await supabase
      .from("holiday_profiles")
      .select("organisation_id, is_default")
      .eq("id", profileId)
      .single();
    if (!existing || (existing as { organisation_id: string }).organisation_id !== member.organisation_id) {
      return { success: false, error: "Profile not found" };
    }
    if ((existing as { is_default: boolean }).is_default) {
      return { success: false, error: "Cannot delete the Default profile" };
    }

    const { data: def } = await supabase
      .from("holiday_profiles")
      .select("id")
      .eq("organisation_id", member.organisation_id)
      .eq("is_default", true)
      .limit(1)
      .single();
    if (!def) return { success: false, error: "Org has no Default holiday profile — cannot reassign" };

    const { count: reassigned } = await supabase
      .from("members")
      .select("id", { count: "exact", head: true })
      .eq("holiday_profile_id", profileId);

    const { error: reErr } = await supabase
      .from("members")
      .update({ holiday_profile_id: (def as { id: string }).id })
      .eq("holiday_profile_id", profileId);
    if (reErr) return { success: false, error: reErr.message };

    const { error } = await supabase
      .from("holiday_profiles")
      .delete()
      .eq("id", profileId);
    if (error) return { success: false, error: error.message };

    return { success: true, reassigned: reassigned ?? 0 };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "An error occurred" };
  }
}

export async function reorderHolidayProfiles(
  orderedIds: string[],
): Promise<{ success: boolean; error?: string }> {
  try {
    const { supabase, member } = await getCallerOwner();

    const { data: existing } = await supabase
      .from("holiday_profiles")
      .select("id, is_default")
      .eq("organisation_id", member.organisation_id);
    const validNonDefault = new Set(
      (existing ?? []).filter((r) => !r.is_default).map((r) => r.id as string),
    );
    if (orderedIds.some((id) => !validNonDefault.has(id))) {
      return { success: false, error: "Some profiles cannot be reordered (Default is pinned)" };
    }

    for (let i = 0; i < orderedIds.length; i++) {
      const { error } = await supabase
        .from("holiday_profiles")
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
// Per-member assignment
// ---------------------------------------------------------------------------

export async function getMemberHolidayProfileAssignment(
  memberId: string,
): Promise<{ success: boolean; error?: string; profileId?: string | null }> {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: "Not authenticated" };

    const { data, error } = await supabase
      .from("members")
      .select("holiday_profile_id")
      .eq("id", memberId)
      .single();
    if (error) return { success: false, error: error.message };

    return {
      success: true,
      profileId: (data as { holiday_profile_id: string | null }).holiday_profile_id ?? null,
    };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "An error occurred" };
  }
}

export async function setMemberHolidayProfile(
  memberId: string,
  profileId: string | null,
): Promise<{ success: boolean; error?: string; createdPeriodId?: string }> {
  try {
    const { supabase, member } = await getCallerMember();

    const isOwner = member.role === "owner";
    if (!isOwner) {
      const { data: perms } = await supabase
        .from("members")
        .select("permissions")
        .eq("id", member.id)
        .single();
      const writeAccess =
        (perms?.permissions as Record<string, unknown> | undefined)?.can_manage_members === "write";
      if (!writeAccess) return { success: false, error: "Insufficient permissions" };
    }

    const { data: target } = await supabase
      .from("members")
      .select("organisation_id")
      .eq("id", memberId)
      .single();
    if (!target || (target as { organisation_id: string }).organisation_id !== member.organisation_id) {
      return { success: false, error: "Member not found" };
    }

    if (profileId) {
      const { data: profile } = await supabase
        .from("holiday_profiles")
        .select("organisation_id")
        .eq("id", profileId)
        .single();
      if (!profile || (profile as { organisation_id: string }).organisation_id !== member.organisation_id) {
        return { success: false, error: "Profile not found" };
      }
    }

    const { error } = await supabase
      .from("members")
      .update({ holiday_profile_id: profileId })
      .eq("id", memberId);
    if (error) return { success: false, error: error.message };

    // Auto-create-first-period: assigning a profile may now satisfy the
    // precondition for the first holiday period (if start_date is also
    // present, or the org runs a Fixed Day calendar).
    const createdPeriodId = await tryAutoCreateFirstPeriod(memberId);
    return { success: true, createdPeriodId };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "An error occurred" };
  }
}

// ---------------------------------------------------------------------------
// Auto-create-first-period
// ---------------------------------------------------------------------------
//
// Idempotent: bails if the member already has any holiday_periods row.
// Precondition:
//   - member has holiday_profile_id set, AND
//   - org's holiday_year_start_type is 'fixed', OR
//     org's holiday_year_start_type is 'employee_start_date' AND member
//     has start_date set.
//
// Computation is delegated to `getNewPeriodDefaults` which already handles
// both year-start modes and the prorating for mid-year hires.

export async function tryAutoCreateFirstPeriod(
  memberId: string,
): Promise<string | undefined> {
  const admin = getAdminClient();

  const { data: m } = await admin
    .from("members")
    .select("organisation_id, start_date, holiday_profile_id")
    .eq("id", memberId)
    .single();
  if (!m) return undefined;
  if (!m.holiday_profile_id) return undefined;

  const { data: org } = await admin
    .from("organisations")
    .select("holiday_year_start_type")
    .eq("id", m.organisation_id)
    .single();
  if (!org) return undefined;

  // Employee-start-date mode needs the start_date set first.
  if (org.holiday_year_start_type === "employee_start_date" && !m.start_date) {
    return undefined;
  }

  // Idempotency check.
  const { count: existing } = await admin
    .from("holiday_periods")
    .select("id", { count: "exact", head: true })
    .eq("member_id", memberId);
  if ((existing ?? 0) > 0) return undefined;

  // Fixed Day mode without a start_date: anchor on today's natural cycle
  // (getNewPeriodDefaults handles this, but it requires start_date today).
  // For Fixed Day with no start_date we use today as a placeholder so the
  // existing helper can compute boundaries. The user said the cog is gone;
  // for orgs running Fixed Day, missing start_date is unusual but possible.
  // We still bail if start_date isn't set to keep the flow predictable —
  // admin sets start_date on Employment page, that flow re-fires this.
  if (!m.start_date) return undefined;

  const defaultsRes = await getNewPeriodDefaults(memberId);
  if (!defaultsRes.success || !defaultsRes.defaults) return undefined;

  const d = defaultsRes.defaults;
  const created = await createHolidayPeriod(memberId, {
    name: d.name,
    startDate: d.startDate,
    endDate: d.endDate,
    type: d.type,
    units: d.units,
    allowance: d.allowance,
    earnedFactor: d.earnedFactor,
    adjust: d.adjust,
    maxCarryForward: d.maxCarryForward,
    minCarryForward: d.minCarryForward,
  });
  return created.success ? created.period?.id : undefined;
}
