"use server";

// CLE-239 — Employment Notice Profiles (contractual notice).
// Spec: Spec Vault → specs/Employee Records/Employment Notice Profiles.md
//
// CRUD over `employment_notice_profiles` (Settings → Profiles →
// Employment Notice; needs can_edit_org_settings) and the per-member
// assignment `members.employment_notice_profile_id` (Employment tab;
// needs Employment-tab update with reach). All writes go through the
// service-role client after these checks — the table has a read-only
// RLS policy.
//
// Types live in `@/lib/employment-notice` — import them from there.

import { createClient as createAdminClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { getEffectiveRightsForUser } from "@/lib/rights-resolver";
import { logAudit } from "@/lib/audit";
import {
  EMPLOYMENT_NOTICE_COLUMNS,
  formatNotice,
  mapEmploymentNoticeRow,
  statutoryEmployerNoticeWeeks,
  type EmploymentNoticeProfile,
  type EmploymentNoticeProfileInput,
  type EmploymentNoticeRow,
  type NoticeUnit,
} from "@/lib/employment-notice";

type Fail = { success: false; error: string };
const fail = (e: unknown): Fail => ({ success: false, error: e instanceof Error ? e.message : "An error occurred" });

function admin() {
  return createAdminClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

async function caller() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  const resolved = await getEffectiveRightsForUser(user.id);
  if (!resolved) throw new Error("No organisation");
  const a = admin();
  const { data: me } = await a.from("members").select("first_name, last_name").eq("id", resolved.ctx.memberId).single();
  return {
    a,
    rights: resolved.rights,
    memberId: resolved.ctx.memberId,
    orgId: resolved.ctx.organisationId,
    teamId: resolved.ctx.teamId ?? null,
    name: `${me?.first_name ?? ""} ${me?.last_name ?? ""}`.trim() || "Unknown",
  };
}

const UNITS: NoticeUnit[] = ["week", "month"];

function validate(input: EmploymentNoticeProfileInput): string | null {
  if (!input.name.trim()) return "Give the profile a name.";
  const amounts: [number | null, NoticeUnit | null][] = [
    [input.memberAmount, input.memberUnit],
    [input.employerAmount, input.employerUnit],
  ];
  for (const [n, u] of amounts) {
    if (!Number.isInteger(n) || (n as number) < 0 || (n as number) > 120) return "Notice must be a whole number between 0 and 120.";
    if (!u || !UNITS.includes(u)) return "Choose weeks or months.";
  }
  for (const [n, u] of [
    [input.probationMemberAmount, input.probationMemberUnit],
    [input.probationEmployerAmount, input.probationEmployerUnit],
  ] as [number | null, NoticeUnit | null][]) {
    if (n === null) continue;
    if (!Number.isInteger(n) || n < 0 || n > 120) return "Probation notice must be a whole number between 0 and 120.";
    if (!u || !UNITS.includes(u)) return "Choose weeks or months for the probation notice.";
  }
  return null;
}

function toRow(input: EmploymentNoticeProfileInput) {
  return {
    name: input.name.trim().slice(0, 80),
    member_amount: input.memberAmount,
    member_unit: input.memberUnit,
    employer_amount: input.employerAmount,
    employer_unit: input.employerUnit,
    employer_statutory_floor: input.employerStatutoryFloor,
    probation_member_amount: input.probationMemberAmount,
    probation_member_unit: input.probationMemberAmount === null ? null : input.probationMemberUnit,
    probation_employer_amount: input.probationEmployerAmount,
    probation_employer_unit: input.probationEmployerAmount === null ? null : input.probationEmployerUnit,
  };
}

/** Human values for the audit diff. */
function describe(p: EmploymentNoticeProfile | EmploymentNoticeProfileInput) {
  return {
    name: p.name,
    member_notice: formatNotice(p.memberAmount, p.memberUnit),
    employer_notice: formatNotice(p.employerAmount, p.employerUnit),
    statutory_floor: p.employerStatutoryFloor ? "Yes" : "No",
    probation_member_notice: p.probationMemberAmount === null ? "Same as above" : formatNotice(p.probationMemberAmount, p.probationMemberUnit),
    probation_employer_notice: p.probationEmployerAmount === null ? "Same as above" : formatNotice(p.probationEmployerAmount, p.probationEmployerUnit),
  };
}

// ---------------------------------------------------------------------------
// List (any signed-in member of the org — the Employment tab picker and
// the template field resolver read it)
// ---------------------------------------------------------------------------

export async function getEmploymentNoticeProfiles(): Promise<{ success: true; profiles: EmploymentNoticeProfile[] } | Fail> {
  try {
    const c = await caller();
    const [{ data: rows, error }, { data: members }] = await Promise.all([
      c.a
        .from("employment_notice_profiles")
        .select(EMPLOYMENT_NOTICE_COLUMNS)
        .eq("organisation_id", c.orgId)
        .order("is_default", { ascending: false })
        .order("sort_order")
        .order("name"),
      c.a.from("members").select("employment_notice_profile_id").eq("organisation_id", c.orgId),
    ]);
    if (error) {
      const missing = error.code === "42P01" || error.code === "PGRST205";
      return { success: false, error: missing ? "Employment Notice isn't available yet — the database update hasn't been applied." : error.message };
    }
    const counts = new Map<string, number>();
    for (const m of (members ?? []) as { employment_notice_profile_id: string | null }[]) {
      if (m.employment_notice_profile_id) counts.set(m.employment_notice_profile_id, (counts.get(m.employment_notice_profile_id) ?? 0) + 1);
    }
    return {
      success: true,
      profiles: ((rows ?? []) as EmploymentNoticeRow[]).map((r) => mapEmploymentNoticeRow(r, counts.get(r.id) ?? 0)),
    };
  } catch (e) {
    return fail(e);
  }
}

// ---------------------------------------------------------------------------
// Settings CRUD (can_edit_org_settings)
// ---------------------------------------------------------------------------

export async function createEmploymentNoticeProfile(input: EmploymentNoticeProfileInput): Promise<{ success: true; profileId: string } | Fail> {
  try {
    const c = await caller();
    if (!c.rights.canEditOrgSettings) return { success: false, error: "Not authorised" };
    const bad = validate(input);
    if (bad) return { success: false, error: bad };
    const { data: maxRow } = await c.a
      .from("employment_notice_profiles")
      .select("sort_order")
      .eq("organisation_id", c.orgId)
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle();
    const { data, error } = await c.a
      .from("employment_notice_profiles")
      .insert({ organisation_id: c.orgId, is_default: false, sort_order: ((maxRow?.sort_order as number | null) ?? 0) + 1, ...toRow(input) })
      .select("id")
      .single();
    if (error || !data) {
      if (error?.code === "23505") return { success: false, error: "A profile with that name already exists." };
      return { success: false, error: error?.message ?? "Couldn't create the profile" };
    }
    await logAudit({
      organisationId: c.orgId,
      actorId: c.memberId,
      actorName: c.name,
      action: "employment_notice_profile.created",
      targetType: "employment_notice_profile",
      targetId: data.id as string,
      targetLabel: input.name.trim(),
      metadata: describe(input),
    });
    return { success: true, profileId: data.id as string };
  } catch (e) {
    return fail(e);
  }
}

export async function updateEmploymentNoticeProfile(profileId: string, input: EmploymentNoticeProfileInput): Promise<{ success: true } | Fail> {
  try {
    const c = await caller();
    if (!c.rights.canEditOrgSettings) return { success: false, error: "Not authorised" };
    const bad = validate(input);
    if (bad) return { success: false, error: bad };
    const { data: existing } = await c.a
      .from("employment_notice_profiles")
      .select(EMPLOYMENT_NOTICE_COLUMNS)
      .eq("id", profileId)
      .eq("organisation_id", c.orgId)
      .single();
    if (!existing) return { success: false, error: "Profile not found" };
    // The Default profile's name is fixed.
    if ((existing as EmploymentNoticeRow).is_default) input = { ...input, name: (existing as EmploymentNoticeRow).name };
    const before = describe(mapEmploymentNoticeRow(existing as EmploymentNoticeRow));
    const after = describe(input);
    const changes: Record<string, { old: unknown; new: unknown }> = {};
    for (const k of Object.keys(after) as (keyof typeof after)[]) {
      if (before[k] !== after[k]) changes[k] = { old: before[k], new: after[k] };
    }
    if (Object.keys(changes).length === 0) return { success: true };
    const { error } = await c.a.from("employment_notice_profiles").update(toRow(input)).eq("id", profileId);
    if (error) {
      if (error.code === "23505") return { success: false, error: "A profile with that name already exists." };
      return { success: false, error: error.message };
    }
    await logAudit({
      organisationId: c.orgId,
      actorId: c.memberId,
      actorName: c.name,
      action: "employment_notice_profile.updated",
      targetType: "employment_notice_profile",
      targetId: profileId,
      targetLabel: input.name.trim(),
      changes,
    });
    return { success: true };
  } catch (e) {
    return fail(e);
  }
}

export async function deleteEmploymentNoticeProfile(profileId: string): Promise<{ success: true } | Fail> {
  try {
    const c = await caller();
    if (!c.rights.canEditOrgSettings) return { success: false, error: "Not authorised" };
    const { data: existing } = await c.a
      .from("employment_notice_profiles")
      .select("id, name, is_default")
      .eq("id", profileId)
      .eq("organisation_id", c.orgId)
      .single();
    if (!existing) return { success: false, error: "Profile not found" };
    if (existing.is_default) return { success: false, error: "The Default profile can't be deleted." };
    const { count } = await c.a
      .from("members")
      .select("id", { count: "exact", head: true })
      .eq("employment_notice_profile_id", profileId);
    if ((count ?? 0) > 0) {
      return { success: false, error: `${count} ${count === 1 ? "person is" : "people are"} on this profile — move them to another profile first.` };
    }
    const { error } = await c.a.from("employment_notice_profiles").delete().eq("id", profileId);
    if (error) return { success: false, error: error.message };
    await logAudit({
      organisationId: c.orgId,
      actorId: c.memberId,
      actorName: c.name,
      action: "employment_notice_profile.deleted",
      targetType: "employment_notice_profile",
      targetId: profileId,
      targetLabel: existing.name as string,
    });
    return { success: true };
  } catch (e) {
    return fail(e);
  }
}

export async function reorderEmploymentNoticeProfiles(orderedIds: string[]): Promise<{ success: true } | Fail> {
  try {
    const c = await caller();
    if (!c.rights.canEditOrgSettings) return { success: false, error: "Not authorised" };
    const { data: existing } = await c.a.from("employment_notice_profiles").select("id, is_default").eq("organisation_id", c.orgId);
    const valid = new Set(((existing ?? []) as { id: string; is_default: boolean }[]).filter((r) => !r.is_default).map((r) => r.id));
    if (orderedIds.some((id) => !valid.has(id))) return { success: false, error: "Some profiles can't be reordered (the Default stays first)." };
    for (let i = 0; i < orderedIds.length; i++) {
      const { error } = await c.a.from("employment_notice_profiles").update({ sort_order: i + 1 }).eq("id", orderedIds[i]).eq("organisation_id", c.orgId);
      if (error) return { success: false, error: error.message };
    }
    return { success: true };
  } catch (e) {
    return fail(e);
  }
}

// ---------------------------------------------------------------------------
// Per-member assignment (Employment tab)
// ---------------------------------------------------------------------------

function reach(c: Awaited<ReturnType<typeof caller>>, target: { id: string; team_id: string | null }, tab: "view" | "update"): boolean {
  const allowed = c.rights.tabs.employment?.[tab] === true;
  if (!allowed) return false;
  if (target.id === c.memberId) return true;
  if (c.rights.crossUserAccess === "all") return true;
  if (c.rights.crossUserAccess === "team") return !!target.team_id && target.team_id === c.teamId;
  return false;
}

/** The member's profile id + the statutory minimum (weeks) as of today. */
export async function getMemberEmploymentNotice(
  memberId: string,
): Promise<{ success: true; profileId: string | null; startDate: string | null; statutoryWeeks: number | null; memberName: string } | Fail> {
  try {
    const c = await caller();
    const { data: t } = await c.a
      .from("members")
      .select("id, team_id, start_date, first_name, employment_notice_profile_id")
      .eq("id", memberId)
      .eq("organisation_id", c.orgId)
      .single();
    if (!t || !reach(c, t as { id: string; team_id: string | null }, "view")) return { success: false, error: "Member not found" };
    return {
      success: true,
      profileId: (t.employment_notice_profile_id as string | null) ?? null,
      startDate: (t.start_date as string | null) ?? null,
      statutoryWeeks: statutoryEmployerNoticeWeeks(t.start_date as string | null),
      memberName: (t.first_name as string) ?? "",
    };
  } catch (e) {
    return fail(e);
  }
}

export async function setMemberEmploymentNoticeProfile(memberId: string, profileId: string): Promise<{ success: true } | Fail> {
  try {
    const c = await caller();
    const { data: t } = await c.a
      .from("members")
      .select("id, team_id, first_name, last_name, employment_notice_profile_id")
      .eq("id", memberId)
      .eq("organisation_id", c.orgId)
      .single();
    if (!t) return { success: false, error: "Member not found" };
    if (!reach(c, t as { id: string; team_id: string | null }, "update")) return { success: false, error: "You don't have permission to change this." };
    const { data: profiles } = await c.a
      .from("employment_notice_profiles")
      .select("id, name")
      .eq("organisation_id", c.orgId)
      .in("id", [profileId, (t.employment_notice_profile_id as string | null) ?? profileId]);
    const names = new Map(((profiles ?? []) as { id: string; name: string }[]).map((p) => [p.id, p.name]));
    if (!names.has(profileId)) return { success: false, error: "Profile not found" };
    const oldId = (t.employment_notice_profile_id as string | null) ?? null;
    if (oldId === profileId) return { success: true };
    const { error } = await c.a.from("members").update({ employment_notice_profile_id: profileId }).eq("id", memberId);
    if (error) return { success: false, error: error.message };
    await logAudit({
      organisationId: c.orgId,
      actorId: c.memberId,
      actorName: c.name,
      action: "member.employment_notice_profile_changed",
      targetType: "member",
      targetId: memberId,
      targetLabel: `${t.first_name ?? ""} ${t.last_name ?? ""}`.trim(),
      changes: { employment_notice_profile: { old: oldId ? (names.get(oldId) ?? null) : null, new: names.get(profileId) } },
    });
    return { success: true };
  } catch (e) {
    return fail(e);
  }
}
