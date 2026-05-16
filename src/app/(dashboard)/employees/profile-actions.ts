"use server";

import { createClient } from "@/lib/supabase/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { logAudit, diffChanges } from "@/lib/audit";

function createAdminClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    }
  );
}

async function getCallerMembership() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Not authenticated");

  const { data: membership } = await supabase
    .from("members")
    .select("id, organisation_id, role, permissions, first_name, last_name")
    .eq("user_id", user.id)
    .limit(1)
    .single();

  if (!membership) throw new Error("No organisation");

  return membership;
}

export type Profile = {
  id: string;
  name: string;
  rights: Record<string, unknown>;
  /** Count of members in the caller's org currently pointing at this profile.
   *  For admin profiles this is admins; for employee profiles, employees.
   *  Optional: populated only by `getProfiles()` (used by the Rights settings
   *  tab). Other callers that cast raw `admin_profiles` rows into Profile[]
   *  don't compute this — readers should treat undefined as 0. */
  memberCount?: number;
};

type ProfileType = "admin" | "employee";

function tableName(type: ProfileType) {
  return type === "admin" ? "admin_profiles" : "employee_profiles";
}

function profileFk(type: ProfileType) {
  return type === "admin" ? "admin_profile_id" : "employee_profile_id";
}

export async function getProfiles(
  type: ProfileType
): Promise<{
  success: boolean;
  error?: string;
  profiles?: Profile[];
  /** Count of members in the role that have no profile assigned. Useful
   *  for the rights-tab summary so admins can see overall coverage. */
  noProfileCount?: number;
}> {
  try {
    const membership = await getCallerMembership();
    const admin = createAdminClient();

    const fk = profileFk(type);
    const memberRole = type === "admin" ? "admin" : "employee";

    const [{ data: profiles, error: pErr }, { data: members, error: mErr }] = await Promise.all([
      admin
        .from(tableName(type))
        .select("id, name, rights, sort_order")
        .eq("organisation_id", membership.organisation_id)
        .order("sort_order", { ascending: true })
        .order("name", { ascending: true }),
      // Pull all members of the matching role so we can group counts in JS.
      // Cheap — one row per member of the role for the caller's org.
      admin
        .from("members")
        .select(`id, ${fk}`)
        .eq("organisation_id", membership.organisation_id)
        .eq("role", memberRole),
    ]);

    if (pErr) return { success: false, error: pErr.message };
    if (mErr) return { success: false, error: mErr.message };

    const countById = new Map<string, number>();
    let noProfileCount = 0;
    for (const m of members ?? []) {
      const pid = (m as Record<string, unknown>)[fk] as string | null | undefined;
      if (!pid) {
        noProfileCount += 1;
      } else {
        countById.set(pid, (countById.get(pid) ?? 0) + 1);
      }
    }

    const enriched: Profile[] = (profiles ?? []).map((p) => ({
      id: p.id as string,
      name: p.name as string,
      rights: (p.rights as Record<string, unknown>) ?? {},
      memberCount: countById.get(p.id as string) ?? 0,
    }));

    return { success: true, profiles: enriched, noProfileCount };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : "An error occurred",
    };
  }
}

export async function createProfile(
  type: ProfileType,
  name: string,
  rights: Record<string, unknown>
): Promise<{ success: boolean; error?: string; profile?: Profile }> {
  try {
    const membership = await getCallerMembership();

    if (membership.role !== "owner") {
      return { success: false, error: "Only the owner can create profiles" };
    }

    const admin = createAdminClient();

    // Append-at-end ordering: new profile gets max(sort_order) + 1 so it
    // lands at the bottom of the user-controlled list.
    const { data: maxRow } = await admin
      .from(tableName(type))
      .select("sort_order")
      .eq("organisation_id", membership.organisation_id)
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle();
    const nextSortOrder = ((maxRow?.sort_order as number | null) ?? -1) + 1;

    const { data: profile, error } = await admin
      .from(tableName(type))
      .insert({
        organisation_id: membership.organisation_id,
        name: name.trim(),
        rights,
        sort_order: nextSortOrder,
      })
      .select("id, name, rights")
      .single();

    if (error) {
      if (error.code === "23505") {
        return { success: false, error: "A profile with this name already exists" };
      }
      return { success: false, error: error.message };
    }

    logAudit({
      organisationId: membership.organisation_id,
      actorId: membership.id,
      actorName: `${membership.first_name} ${membership.last_name}`,
      action: `${type}_profile.created`,
      targetType: `${type}_profile`,
      targetId: profile.id,
      targetLabel: profile.name,
      metadata: { rights },
    });

    // New profiles always start with zero members assigned.
    return {
      success: true,
      profile: {
        id: profile.id as string,
        name: profile.name as string,
        rights: (profile.rights as Record<string, unknown>) ?? {},
        memberCount: 0,
      },
    };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : "An error occurred",
    };
  }
}

export async function updateProfile(
  type: ProfileType,
  profileId: string,
  name: string,
  rights: Record<string, unknown>
): Promise<{ success: boolean; error?: string }> {
  try {
    const membership = await getCallerMembership();

    if (membership.role !== "owner") {
      return { success: false, error: "Only the owner can update profiles" };
    }

    const admin = createAdminClient();

    // Fetch old state for diff
    const { data: old } = await admin
      .from(tableName(type))
      .select("name, rights")
      .eq("id", profileId)
      .eq("organisation_id", membership.organisation_id)
      .single();

    if (!old) return { success: false, error: "Profile not found" };

    const { error } = await admin
      .from(tableName(type))
      .update({ name: name.trim(), rights })
      .eq("id", profileId)
      .eq("organisation_id", membership.organisation_id);

    if (error) {
      if (error.code === "23505") {
        return { success: false, error: "A profile with this name already exists" };
      }
      return { success: false, error: error.message };
    }

    // Also update permissions on all members currently using this profile
    await admin
      .from("members")
      .update({ permissions: rights })
      .eq(profileFk(type), profileId)
      .eq("organisation_id", membership.organisation_id);

    const changes = diffChanges(
      { name: old.name, rights: old.rights },
      { name: name.trim(), rights }
    );

    if (changes) {
      logAudit({
        organisationId: membership.organisation_id,
        actorId: membership.id,
        actorName: `${membership.first_name} ${membership.last_name}`,
        action: `${type}_profile.updated`,
        targetType: `${type}_profile`,
        targetId: profileId,
        targetLabel: name.trim(),
        changes,
      });
    }

    return { success: true };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : "An error occurred",
    };
  }
}

export async function deleteProfile(
  type: ProfileType,
  profileId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const membership = await getCallerMembership();

    if (membership.role !== "owner") {
      return { success: false, error: "Only the owner can delete profiles" };
    }

    const admin = createAdminClient();

    // Fetch profile name for audit
    const { data: profile } = await admin
      .from(tableName(type))
      .select("name")
      .eq("id", profileId)
      .eq("organisation_id", membership.organisation_id)
      .single();

    // Nullify FK on members (ON DELETE SET NULL handles this, but also clear the other FK field)
    // The DB ON DELETE SET NULL will handle the FK column automatically

    const { error } = await admin
      .from(tableName(type))
      .delete()
      .eq("id", profileId)
      .eq("organisation_id", membership.organisation_id);

    if (error) return { success: false, error: error.message };

    logAudit({
      organisationId: membership.organisation_id,
      actorId: membership.id,
      actorName: `${membership.first_name} ${membership.last_name}`,
      action: `${type}_profile.deleted`,
      targetType: `${type}_profile`,
      targetId: profileId,
      targetLabel: profile?.name ?? "Unknown",
    });

    return { success: true };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : "An error occurred",
    };
  }
}

export async function reorderProfiles(
  type: ProfileType,
  orderedIds: string[],
): Promise<{ success: boolean; error?: string }> {
  try {
    const membership = await getCallerMembership();
    if (membership.role !== "owner") {
      return { success: false, error: "Only the owner can reorder profiles" };
    }
    const admin = createAdminClient();

    // Verify every supplied id belongs to the caller's org, both as a
    // sanity check and to scope the write.
    const { data: existing } = await admin
      .from(tableName(type))
      .select("id")
      .eq("organisation_id", membership.organisation_id);
    const validIds = new Set((existing ?? []).map((r) => r.id as string));
    if (orderedIds.some((id) => !validIds.has(id))) {
      return { success: false, error: "Some profiles are not in your organisation" };
    }

    // Apply the new ordering. Each id's index becomes its sort_order.
    for (let i = 0; i < orderedIds.length; i++) {
      const { error } = await admin
        .from(tableName(type))
        .update({ sort_order: i })
        .eq("id", orderedIds[i])
        .eq("organisation_id", membership.organisation_id);
      if (error) return { success: false, error: error.message };
    }
    return { success: true };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : "An error occurred",
    };
  }
}

export async function getMemberProfile(
  memberId: string
): Promise<{ success: boolean; error?: string; adminProfileId?: string | null; employeeProfileId?: string | null }> {
  try {
    const membership = await getCallerMembership();
    const admin = createAdminClient();

    const { data, error } = await admin
      .from("members")
      .select("admin_profile_id, employee_profile_id")
      .eq("id", memberId)
      .eq("organisation_id", membership.organisation_id)
      .single();

    if (error || !data) return { success: false, error: error?.message ?? "Member not found" };

    return {
      success: true,
      adminProfileId: data.admin_profile_id,
      employeeProfileId: data.employee_profile_id,
    };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : "An error occurred",
    };
  }
}

export async function assignProfile(
  memberId: string,
  type: ProfileType,
  profileId: string | null
): Promise<{ success: boolean; error?: string }> {
  try {
    const membership = await getCallerMembership();

    const canManage =
      membership.role === "owner" ||
      (membership.role === "admin" &&
        (membership.permissions as Record<string, boolean>)
          ?.can_add_members === true);

    if (!canManage) {
      return { success: false, error: "Insufficient permissions" };
    }

    const admin = createAdminClient();

    // Fetch the member's current profile assignment
    const { data: member } = await admin
      .from("members")
      .select("id, first_name, last_name, admin_profile_id, employee_profile_id, permissions")
      .eq("id", memberId)
      .eq("organisation_id", membership.organisation_id)
      .single();

    if (!member) return { success: false, error: "Member not found" };

    const fk = profileFk(type);
    const oldProfileId = type === "admin" ? member.admin_profile_id : member.employee_profile_id;

    // Build update payload
    const update: Record<string, unknown> = { [fk]: profileId };

    let newProfileName: string | null = null;
    let oldProfileName: string | null = null;

    // Get old profile name
    if (oldProfileId) {
      const { data: oldP } = await admin
        .from(tableName(type))
        .select("name")
        .eq("id", oldProfileId)
        .single();
      oldProfileName = oldP?.name ?? null;
    }

    // If assigning a profile, copy its rights to permissions
    if (profileId) {
      const { data: profile } = await admin
        .from(tableName(type))
        .select("name, rights")
        .eq("id", profileId)
        .eq("organisation_id", membership.organisation_id)
        .single();

      if (!profile) return { success: false, error: "Profile not found" };

      update.permissions = profile.rights;
      newProfileName = profile.name;
    }

    const { error } = await admin
      .from("members")
      .update(update)
      .eq("id", memberId)
      .eq("organisation_id", membership.organisation_id);

    if (error) return { success: false, error: error.message };

    if (oldProfileName !== newProfileName) {
      logAudit({
        organisationId: membership.organisation_id,
        actorId: membership.id,
        actorName: `${membership.first_name} ${membership.last_name}`,
        action: "member.updated",
        targetType: "member",
        targetId: memberId,
        targetLabel: `${member.first_name} ${member.last_name}`,
        changes: {
          [`${type}_profile`]: { old: oldProfileName, new: newProfileName },
        },
      });
    }

    return { success: true };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : "An error occurred",
    };
  }
}
