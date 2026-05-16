"use server";

// CLE-194 — Notice Period actions, multi-profile shape.
//
// Each org has a list of notice profiles (one is_default, the rest named
// alternatives). Each member points at exactly one profile via
// members.notice_period_profile_id (auto-seeded on member insert).
//
// Per-member resolution (`getMyNoticeContext`, `validateBookingRules`,
// mobile API routes) loads the booking author's profile, falling back to
// the org's Default if the column is NULL for any reason.

import { createClient } from "@/lib/supabase/server";
import { updateOrganisation } from "./organisation-actions";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type NoticePeriodRule = {
  id: string;
  min_booking_days: number;
  notice_days: number;
};

export type NoticePeriodProfile = {
  id: string;
  name: string;
  isDefault: boolean;
  blockRequests: boolean;
  memberCount: number;
  rules: NoticePeriodRule[];
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
    .select("id, organisation_id, role, notice_period_profile_id")
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

// ---------------------------------------------------------------------------
// Per-member context — used by the booking sheet to preview violations.
// ---------------------------------------------------------------------------

/**
 * Notice context for the caller's effective notice profile. Falls back to
 * the org's Default profile if `members.notice_period_profile_id` is NULL.
 */
export async function getMyOrgNoticeContext(): Promise<{
  rules: { min_booking_days: number; notice_days: number }[];
  blockRequests: boolean;
}> {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { rules: [], blockRequests: false };

    const { data: member } = await supabase
      .from("members")
      .select("organisation_id, notice_period_profile_id")
      .eq("user_id", user.id)
      .limit(1)
      .single();
    if (!member) return { rules: [], blockRequests: false };

    return await resolveNoticeContextForMember(
      supabase,
      member.organisation_id as string,
      (member.notice_period_profile_id as string | null) ?? null,
    );
  } catch {
    return { rules: [], blockRequests: false };
  }
}

/**
 * Internal helper used by `getMyOrgNoticeContext`. Takes a supabase client
 * (not a server-action param) so it stays inside this module. Server-side
 * callers like `validateBookingRules` and the mobile API routes inline
 * the same lookup pattern directly — they each have their own supabase /
 * admin client to use.
 */
async function resolveNoticeContextForMember(
  supabase: Awaited<ReturnType<typeof createClient>>,
  organisationId: string,
  noticeProfileId: string | null,
): Promise<{
  rules: { min_booking_days: number; notice_days: number }[];
  blockRequests: boolean;
}> {
  let profileId = noticeProfileId;
  if (!profileId) {
    const { data: def } = await supabase
      .from("notice_period_profiles")
      .select("id")
      .eq("organisation_id", organisationId)
      .eq("is_default", true)
      .limit(1)
      .single();
    profileId = (def?.id as string) ?? null;
  }
  if (!profileId) {
    return { rules: [], blockRequests: false };
  }

  const [{ data: rules }, { data: profile }] = await Promise.all([
    supabase
      .from("notice_period_rules")
      .select("min_booking_days, notice_days")
      .eq("profile_id", profileId)
      .order("min_booking_days", { ascending: false }),
    supabase
      .from("notice_period_profiles")
      .select("block_requests")
      .eq("id", profileId)
      .single(),
  ]);

  return {
    rules: (rules ?? []).map((r) => ({
      min_booking_days: Number(r.min_booking_days),
      notice_days: Number(r.notice_days),
    })),
    blockRequests: !!(profile as { block_requests?: boolean } | null)?.block_requests,
  };
}

// ---------------------------------------------------------------------------
// Settings page — list / create / update / delete profiles + edit rules
// ---------------------------------------------------------------------------

export async function getNoticePeriodProfiles(): Promise<{
  success: boolean;
  error?: string;
  profiles?: NoticePeriodProfile[];
}> {
  try {
    const { supabase, member } = await getCallerOwner();

    const [{ data: profiles, error: pErr }, { data: rules, error: rErr }, { data: counts }] = await Promise.all([
      supabase
        .from("notice_period_profiles")
        .select("id, name, is_default, block_requests, sort_order")
        .eq("organisation_id", member.organisation_id)
        // Default pinned at the top, then user-controlled sort_order, then
        // alphabetical as a tiebreaker for legacy rows with the same order.
        .order("is_default", { ascending: false })
        .order("sort_order", { ascending: true })
        .order("name", { ascending: true }),
      supabase
        .from("notice_period_rules")
        .select("id, profile_id, min_booking_days, notice_days")
        .order("min_booking_days", { ascending: false }),
      supabase
        .from("members")
        .select("notice_period_profile_id")
        .eq("organisation_id", member.organisation_id),
    ]);

    if (pErr) return { success: false, error: pErr.message };
    if (rErr) return { success: false, error: rErr.message };

    const rulesByProfile = new Map<string, NoticePeriodRule[]>();
    for (const r of rules ?? []) {
      const list = rulesByProfile.get(r.profile_id as string) ?? [];
      list.push({
        id: r.id as string,
        min_booking_days: Number(r.min_booking_days),
        notice_days: Number(r.notice_days),
      });
      rulesByProfile.set(r.profile_id as string, list);
    }

    const countByProfile = new Map<string, number>();
    for (const c of counts ?? []) {
      const id = (c.notice_period_profile_id as string | null) ?? null;
      if (!id) continue;
      countByProfile.set(id, (countByProfile.get(id) ?? 0) + 1);
    }

    const mapped: NoticePeriodProfile[] = (profiles ?? []).map((p) => ({
      id: p.id as string,
      name: p.name as string,
      isDefault: !!p.is_default,
      blockRequests: !!p.block_requests,
      memberCount: countByProfile.get(p.id as string) ?? 0,
      rules: rulesByProfile.get(p.id as string) ?? [],
    }));

    return { success: true, profiles: mapped };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "An error occurred" };
  }
}

export async function createNoticePeriodProfile(
  name: string,
): Promise<{ success: boolean; error?: string; profileId?: string }> {
  try {
    const { supabase, member } = await getCallerOwner();
    const trimmed = name.trim();
    if (!trimmed) return { success: false, error: "Name is required" };

    // Append-at-end ordering: new profile gets max(sort_order) + 1.
    const { data: maxRow } = await supabase
      .from("notice_period_profiles")
      .select("sort_order")
      .eq("organisation_id", member.organisation_id)
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle();
    const nextSortOrder = ((maxRow?.sort_order as number | null) ?? -1) + 1;

    const { data, error } = await supabase
      .from("notice_period_profiles")
      .insert({
        organisation_id: member.organisation_id,
        name: trimmed,
        is_default: false,
        block_requests: false,
        sort_order: nextSortOrder,
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

export async function reorderNoticePeriodProfiles(
  orderedIds: string[],
): Promise<{ success: boolean; error?: string }> {
  try {
    const { supabase, member } = await getCallerOwner();

    // Verify every supplied id belongs to caller's org and is non-default.
    // The Default profile is pinned at the top by the read query, so its
    // sort_order is irrelevant — we leave it untouched.
    const { data: existing } = await supabase
      .from("notice_period_profiles")
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
        .from("notice_period_profiles")
        .update({ sort_order: i + 1 }) // leave 0 for Default
        .eq("id", orderedIds[i])
        .eq("organisation_id", member.organisation_id);
      if (error) return { success: false, error: error.message };
    }
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "An error occurred" };
  }
}

export async function updateNoticePeriodProfile(
  profileId: string,
  patch: { name?: string; blockRequests?: boolean },
): Promise<{ success: boolean; error?: string }> {
  try {
    const { supabase, member } = await getCallerOwner();

    // Defence in depth — verify the profile belongs to caller's org
    const { data: existing } = await supabase
      .from("notice_period_profiles")
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
      updates.name = trimmed;
    }
    if (patch.blockRequests !== undefined) updates.block_requests = patch.blockRequests;

    if (Object.keys(updates).length === 0) return { success: true };

    const { error } = await supabase
      .from("notice_period_profiles")
      .update(updates)
      .eq("id", profileId);
    if (error) {
      if (error.code === "23505") return { success: false, error: "A profile with that name already exists" };
      return { success: false, error: error.message };
    }

    // Mirror the Default profile's block flag back to the org-level column
    // so the legacy OrganisationEditDialog Notice Periods tab stays in sync
    // during the parallel period.
    if (
      patch.blockRequests !== undefined
      && (existing as { is_default: boolean }).is_default
    ) {
      await updateOrganisation({ noticeRulesBlockRequests: patch.blockRequests });
    }

    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "An error occurred" };
  }
}

export async function deleteNoticePeriodProfile(
  profileId: string,
): Promise<{ success: boolean; error?: string; reassigned?: number }> {
  try {
    const { supabase, member } = await getCallerOwner();

    const { data: existing } = await supabase
      .from("notice_period_profiles")
      .select("organisation_id, is_default")
      .eq("id", profileId)
      .single();
    if (!existing || (existing as { organisation_id: string }).organisation_id !== member.organisation_id) {
      return { success: false, error: "Profile not found" };
    }
    if ((existing as { is_default: boolean }).is_default) {
      return { success: false, error: "Cannot delete the Default profile" };
    }

    // Re-point any members on this profile to the org's Default before
    // deleting. RLS lets us read+update our own org's members.
    const { data: def } = await supabase
      .from("notice_period_profiles")
      .select("id")
      .eq("organisation_id", member.organisation_id)
      .eq("is_default", true)
      .limit(1)
      .single();
    if (!def) return { success: false, error: "Org has no Default notice profile — cannot reassign" };

    // Count first, then reassign. supabase-js doesn't expose a row-count on
    // update() directly; the cheapest path is to count via a head request
    // and then issue the update.
    const { count: reassigned } = await supabase
      .from("members")
      .select("id", { count: "exact", head: true })
      .eq("notice_period_profile_id", profileId);

    const { error: reErr } = await supabase
      .from("members")
      .update({ notice_period_profile_id: (def as { id: string }).id })
      .eq("notice_period_profile_id", profileId);
    if (reErr) return { success: false, error: reErr.message };

    const { error } = await supabase
      .from("notice_period_profiles")
      .delete()
      .eq("id", profileId);
    if (error) return { success: false, error: error.message };

    return { success: true, reassigned: reassigned ?? 0 };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "An error occurred" };
  }
}

/**
 * Replace the rule set on a single profile. Adds new rules, updates
 * existing ones, deletes rules whose ids are not in the incoming list.
 */
export async function saveNoticePeriodRulesForProfile(
  profileId: string,
  rules: { id?: string; min_booking_days: number; notice_days: number }[],
): Promise<{ success: boolean; error?: string }> {
  try {
    const { supabase, member } = await getCallerOwner();

    const { data: profile } = await supabase
      .from("notice_period_profiles")
      .select("organisation_id")
      .eq("id", profileId)
      .single();
    if (!profile || (profile as { organisation_id: string }).organisation_id !== member.organisation_id) {
      return { success: false, error: "Profile not found" };
    }

    const { data: existing } = await supabase
      .from("notice_period_rules")
      .select("id")
      .eq("profile_id", profileId);
    const existingIds = new Set((existing ?? []).map((r) => r.id as string));
    const incomingIds = new Set(rules.filter((r) => r.id).map((r) => r.id!));

    const toDelete = [...existingIds].filter((id) => !incomingIds.has(id));
    if (toDelete.length > 0) {
      const { error } = await supabase
        .from("notice_period_rules")
        .delete()
        .in("id", toDelete)
        .eq("profile_id", profileId);
      if (error) return { success: false, error: error.message };
    }

    for (const rule of rules) {
      if (rule.id && existingIds.has(rule.id)) {
        const { error } = await supabase
          .from("notice_period_rules")
          .update({ min_booking_days: rule.min_booking_days, notice_days: rule.notice_days })
          .eq("id", rule.id)
          .eq("profile_id", profileId);
        if (error) return { success: false, error: error.message };
      } else {
        const { error } = await supabase
          .from("notice_period_rules")
          .insert({
            organisation_id: member.organisation_id,
            profile_id: profileId,
            min_booking_days: rule.min_booking_days,
            notice_days: rule.notice_days,
          });
        if (error) return { success: false, error: error.message };
      }
    }

    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "An error occurred" };
  }
}

// ---------------------------------------------------------------------------
// Member-level assignment
// ---------------------------------------------------------------------------

export async function getMemberNoticeProfileAssignment(
  memberId: string,
): Promise<{ success: boolean; error?: string; profileId?: string | null }> {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: "Not authenticated" };

    const { data, error } = await supabase
      .from("members")
      .select("notice_period_profile_id")
      .eq("id", memberId)
      .single();
    if (error) return { success: false, error: error.message };

    return {
      success: true,
      profileId: (data as { notice_period_profile_id: string | null }).notice_period_profile_id ?? null,
    };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "An error occurred" };
  }
}

export async function setMemberNoticeProfile(
  memberId: string,
  profileId: string | null,
): Promise<{ success: boolean; error?: string }> {
  try {
    const { supabase, member } = await getCallerMember();
    // Owners always; admins with member-write access.
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

    // Verify the target member is in the same org
    const { data: target } = await supabase
      .from("members")
      .select("organisation_id")
      .eq("id", memberId)
      .single();
    if (!target || (target as { organisation_id: string }).organisation_id !== member.organisation_id) {
      return { success: false, error: "Member not found" };
    }

    // Verify the profile (if any) belongs to the same org
    if (profileId) {
      const { data: profile } = await supabase
        .from("notice_period_profiles")
        .select("organisation_id")
        .eq("id", profileId)
        .single();
      if (!profile || (profile as { organisation_id: string }).organisation_id !== member.organisation_id) {
        return { success: false, error: "Profile not found" };
      }
    }

    const { error } = await supabase
      .from("members")
      .update({ notice_period_profile_id: profileId })
      .eq("id", memberId);
    if (error) return { success: false, error: error.message };

    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "An error occurred" };
  }
}

// ---------------------------------------------------------------------------
// Breach check — used by the editor to surface how many bookings the new
// rule set would break. Now scoped to one profile's member population.
// ---------------------------------------------------------------------------

export async function checkBookingsInBreachForProfile(
  profileId: string,
): Promise<{ success: boolean; error?: string; breachedCount?: number }> {
  try {
    const { supabase, member } = await getCallerOwner();

    const { data: profile } = await supabase
      .from("notice_period_profiles")
      .select("organisation_id")
      .eq("id", profileId)
      .single();
    if (!profile || (profile as { organisation_id: string }).organisation_id !== member.organisation_id) {
      return { success: false, error: "Profile not found" };
    }

    const { data: rules } = await supabase
      .from("notice_period_rules")
      .select("min_booking_days, notice_days")
      .eq("profile_id", profileId)
      .order("min_booking_days", { ascending: false });
    if (!rules || rules.length === 0) return { success: true, breachedCount: 0 };

    // Members on this profile
    const { data: profileMembers } = await supabase
      .from("members")
      .select("id")
      .eq("organisation_id", member.organisation_id)
      .eq("notice_period_profile_id", profileId);
    const memberIds = (profileMembers ?? []).map((m) => m.id as string);
    if (memberIds.length === 0) return { success: true, breachedCount: 0 };

    const { data: bookings } = await supabase
      .from("holiday_bookings")
      .select("id, start_date, days_deducted, created_at")
      .eq("organisation_id", member.organisation_id)
      .in("member_id", memberIds)
      .in("status", ["pending", "approved"]);
    if (!bookings || bookings.length === 0) return { success: true, breachedCount: 0 };

    let breached = 0;
    for (const b of bookings) {
      const bookingDays = b.days_deducted ? Number(b.days_deducted) : 1;
      const matchingRule = rules.find((r) => bookingDays >= r.min_booking_days);
      if (!matchingRule) continue;

      const createdAt = new Date(b.created_at as string);
      createdAt.setUTCHours(0, 0, 0, 0);
      const startDate = new Date((b.start_date as string) + "T00:00:00Z");
      const diffMs = startDate.getTime() - createdAt.getTime();
      const noticeDaysGiven = Math.floor(diffMs / 86_400_000);

      if (noticeDaysGiven < matchingRule.notice_days) breached++;
    }

    return { success: true, breachedCount: breached };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "An error occurred" };
  }
}

// ---------------------------------------------------------------------------
// Legacy shims — kept while the legacy OrganisationEditDialog Notice
// Periods tab is still wired up. They target the Default profile so the
// dialog continues to behave like the original "single rule set per org"
// model. Delete once the legacy dialog is removed.
// ---------------------------------------------------------------------------

export type NoticePeriodRuleWithOrg = NoticePeriodRule & { organisation_id: string };

async function resolveDefaultProfileId(): Promise<{
  ok: true;
  profileId: string | null;
  supabase: Awaited<ReturnType<typeof createClient>>;
} | { ok: false; error: string }> {
  try {
    const { supabase, member } = await getCallerOwner();
    const { data: def } = await supabase
      .from("notice_period_profiles")
      .select("id")
      .eq("organisation_id", member.organisation_id)
      .eq("is_default", true)
      .limit(1)
      .single();
    return { ok: true, profileId: (def?.id as string) ?? null, supabase };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "An error occurred" };
  }
}

export async function getNoticePeriodRules(): Promise<{
  success: boolean;
  error?: string;
  rules?: NoticePeriodRuleWithOrg[];
}> {
  const r = await resolveDefaultProfileId();
  if (!r.ok) return { success: false, error: r.error };
  if (!r.profileId) return { success: true, rules: [] };
  const { data, error } = await r.supabase
    .from("notice_period_rules")
    .select("id, organisation_id, min_booking_days, notice_days")
    .eq("profile_id", r.profileId)
    .order("min_booking_days", { ascending: false });
  if (error) return { success: false, error: error.message };
  return {
    success: true,
    rules: (data ?? []).map((row) => ({
      id: row.id as string,
      organisation_id: row.organisation_id as string,
      min_booking_days: Number(row.min_booking_days),
      notice_days: Number(row.notice_days),
    })),
  };
}

export async function saveNoticePeriodRules(
  rules: { id?: string; min_booking_days: number; notice_days: number }[],
): Promise<{ success: boolean; error?: string }> {
  const r = await resolveDefaultProfileId();
  if (!r.ok) return { success: false, error: r.error };
  if (!r.profileId) return { success: false, error: "No Default notice profile" };
  return saveNoticePeriodRulesForProfile(r.profileId, rules);
}

export async function checkBookingsInBreach(): Promise<{
  success: boolean;
  error?: string;
  breachedCount?: number;
}> {
  const r = await resolveDefaultProfileId();
  if (!r.ok) return { success: false, error: r.error };
  if (!r.profileId) return { success: true, breachedCount: 0 };
  return checkBookingsInBreachForProfile(r.profileId);
}
