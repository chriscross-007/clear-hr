"use server";

import { createClient } from "@/lib/supabase/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

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
    .select("id, organisation_id, role, permissions")
    .eq("user_id", user.id)
    .limit(1)
    .single();

  if (!membership) throw new Error("No organisation");

  return membership;
}

export async function getTeams(): Promise<{
  success: boolean;
  error?: string;
  teams?: { id: string; name: string }[];
}> {
  try {
    const membership = await getCallerMembership();
    const admin = createAdminClient();

    const { data: teams, error } = await admin
      .from("teams")
      .select("id, name")
      .eq("organisation_id", membership.organisation_id)
      .order("name");

    if (error) return { success: false, error: error.message };

    return { success: true, teams: teams ?? [] };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : "An error occurred",
    };
  }
}

export async function createTeam(
  name: string
): Promise<{ success: boolean; error?: string; team?: { id: string; name: string } }> {
  try {
    const membership = await getCallerMembership();

    if (membership.role !== "owner") {
      return { success: false, error: "Only the owner can create teams" };
    }

    const admin = createAdminClient();

    const { data: team, error } = await admin
      .from("teams")
      .insert({
        organisation_id: membership.organisation_id,
        name: name.trim(),
      })
      .select("id, name")
      .single();

    if (error) {
      if (error.code === "23505") {
        return { success: false, error: "A team with this name already exists" };
      }
      return { success: false, error: error.message };
    }

    return { success: true, team };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : "An error occurred",
    };
  }
}

export async function deleteTeam(
  teamId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const membership = await getCallerMembership();

    if (membership.role !== "owner") {
      return { success: false, error: "Only the owner can delete teams" };
    }

    const admin = createAdminClient();

    // Clear team_id on any members assigned to this team
    await admin
      .from("members")
      .update({ team_id: null })
      .eq("team_id", teamId)
      .eq("organisation_id", membership.organisation_id);

    // Delete member_teams junction entries
    await admin
      .from("member_teams")
      .delete()
      .eq("team_id", teamId);

    // Delete the team
    const { error } = await admin
      .from("teams")
      .delete()
      .eq("id", teamId)
      .eq("organisation_id", membership.organisation_id);

    if (error) return { success: false, error: error.message };

    return { success: true };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : "An error occurred",
    };
  }
}

export async function updateMemberTeam(
  memberId: string,
  teamId: string | null
): Promise<{ success: boolean; error?: string }> {
  try {
    const membership = await getCallerMembership();

    const canManage =
      membership.role === "owner" ||
      (membership.role === "admin" &&
        (membership.permissions as Record<string, boolean>)
          ?.can_manage_members === true);

    if (!canManage) {
      return { success: false, error: "Insufficient permissions" };
    }

    const admin = createAdminClient();

    const { error } = await admin
      .from("members")
      .update({ team_id: teamId })
      .eq("id", memberId)
      .eq("organisation_id", membership.organisation_id);

    if (error) return { success: false, error: error.message };

    return { success: true };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : "An error occurred",
    };
  }
}

export async function getMemberTeams(
  memberId: string
): Promise<{ success: boolean; error?: string; teamIds?: string[] }> {
  try {
    const membership = await getCallerMembership();
    const admin = createAdminClient();

    // Verify member belongs to same org
    const { data: member } = await admin
      .from("members")
      .select("id")
      .eq("id", memberId)
      .eq("organisation_id", membership.organisation_id)
      .single();

    if (!member) return { success: false, error: "Member not found" };

    const { data: memberTeams, error } = await admin
      .from("member_teams")
      .select("team_id")
      .eq("member_id", memberId);

    if (error) return { success: false, error: error.message };

    return {
      success: true,
      teamIds: (memberTeams ?? []).map((mt) => mt.team_id),
    };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : "An error occurred",
    };
  }
}

export async function setMemberTeams(
  memberId: string,
  teamIds: string[]
): Promise<{ success: boolean; error?: string }> {
  try {
    const membership = await getCallerMembership();

    const canManage =
      membership.role === "owner" ||
      (membership.role === "admin" &&
        (membership.permissions as Record<string, boolean>)
          ?.can_manage_members === true);

    if (!canManage) {
      return { success: false, error: "Insufficient permissions" };
    }

    const admin = createAdminClient();

    // Verify member belongs to same org
    const { data: member } = await admin
      .from("members")
      .select("id")
      .eq("id", memberId)
      .eq("organisation_id", membership.organisation_id)
      .single();

    if (!member) return { success: false, error: "Member not found" };

    // Delete existing member_teams
    await admin
      .from("member_teams")
      .delete()
      .eq("member_id", memberId);

    // Insert new member_teams
    if (teamIds.length > 0) {
      const { error: insertError } = await admin
        .from("member_teams")
        .insert(
          teamIds.map((tid) => ({
            member_id: memberId,
            team_id: tid,
          }))
        );

      if (insertError) return { success: false, error: insertError.message };
    }

    // Also set members.team_id to first team (for backward compatibility)
    await admin
      .from("members")
      .update({ team_id: teamIds.length > 0 ? teamIds[0] : null })
      .eq("id", memberId);

    return { success: true };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : "An error occurred",
    };
  }
}
