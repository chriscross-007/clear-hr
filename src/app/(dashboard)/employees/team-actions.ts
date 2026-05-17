"use server";

import { createClient } from "@/lib/supabase/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { logAudit } from "@/lib/audit";

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

export async function getTeams(): Promise<{
  success: boolean;
  error?: string;
  teams?: {
    id: string;
    name: string;
    min_cover: number | null;
    approver_id: string | null;
    block_cover_violations: boolean;
  }[];
}> {
  try {
    const membership = await getCallerMembership();
    const admin = createAdminClient();

    const { data: teams, error } = await admin
      .from("teams")
      .select("id, name, min_cover, approver_id, block_cover_violations")
      .eq("organisation_id", membership.organisation_id)
      .order("name");

    if (error) return { success: false, error: error.message };

    return {
      success: true,
      teams: (teams ?? []).map((t) => ({
        id: t.id as string,
        name: t.name as string,
        min_cover: (t.min_cover as number | null) ?? null,
        approver_id: (t.approver_id as string | null) ?? null,
        block_cover_violations: !!t.block_cover_violations,
      })),
    };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : "An error occurred",
    };
  }
}

export async function updateTeamBlockCover(
  teamId: string,
  blockCoverViolations: boolean,
): Promise<{ success: boolean; error?: string }> {
  try {
    const membership = await getCallerMembership();

    if (membership.role !== "owner" && membership.role !== "admin") {
      return { success: false, error: "Only owners and admins can update team settings" };
    }

    const admin = createAdminClient();

    const { error } = await admin
      .from("teams")
      .update({ block_cover_violations: blockCoverViolations })
      .eq("id", teamId)
      .eq("organisation_id", membership.organisation_id);

    if (error) return { success: false, error: error.message };
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "An error occurred" };
  }
}

export async function updateTeamMinCover(
  teamId: string,
  minCover: number | null
): Promise<{ success: boolean; error?: string }> {
  try {
    const membership = await getCallerMembership();

    if (membership.role !== "owner" && membership.role !== "admin") {
      return { success: false, error: "Only owners and admins can update team settings" };
    }

    const admin = createAdminClient();

    const { error } = await admin
      .from("teams")
      .update({ min_cover: minCover })
      .eq("id", teamId)
      .eq("organisation_id", membership.organisation_id);

    if (error) return { success: false, error: error.message };
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "An error occurred" };
  }
}

export async function getApproverMembers(): Promise<{
  success: boolean;
  error?: string;
  members?: { id: string; name: string }[];
}> {
  try {
    const membership = await getCallerMembership();
    const admin = createAdminClient();

    // Holiday approvers for a team are the owner (always — owners have all
    // rights by role) plus admins whose rights profile grants Approve
    // Holidays. Admins without the right are excluded. Mirrors the
    // approval-profile-actions.getApproverOptions filter.
    const { data, error } = await admin
      .from("members")
      .select("id, first_name, last_name, role, permissions")
      .eq("organisation_id", membership.organisation_id)
      .in("role", ["owner", "admin"])
      .order("first_name");

    if (error) return { success: false, error: error.message };

    return {
      success: true,
      members: (data ?? [])
        .filter((m) => {
          if (m.role === "owner") return true;
          const perms = (m.permissions as Record<string, unknown> | null) ?? {};
          return perms.can_approve_holidays === true;
        })
        .map((m) => ({ id: m.id, name: `${m.first_name} ${m.last_name}` })),
    };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "An error occurred" };
  }
}

export async function updateTeamApprover(
  teamId: string,
  approverId: string | null
): Promise<{ success: boolean; error?: string }> {
  try {
    const membership = await getCallerMembership();

    if (membership.role !== "owner" && membership.role !== "admin") {
      return { success: false, error: "Only owners and admins can update team settings" };
    }

    const admin = createAdminClient();

    const { error } = await admin
      .from("teams")
      .update({ approver_id: approverId })
      .eq("id", teamId)
      .eq("organisation_id", membership.organisation_id);

    if (error) return { success: false, error: error.message };
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "An error occurred" };
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

    logAudit({
      organisationId: membership.organisation_id,
      actorId: membership.id,
      actorName: `${membership.first_name} ${membership.last_name}`,
      action: "team.created",
      targetType: "team",
      targetId: team.id,
      targetLabel: team.name,
      changes: { name: { old: null, new: team.name } },
    });

    return { success: true, team };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : "An error occurred",
    };
  }
}

export async function renameTeams(
  renames: { id: string; newName: string }[]
): Promise<{ success: boolean; error?: string }> {
  try {
    if (renames.length === 0) return { success: true };

    const membership = await getCallerMembership();

    if (membership.role !== "owner") {
      return { success: false, error: "Only the owner can rename teams" };
    }

    const admin = createAdminClient();

    // Fetch current names for all teams being renamed
    const ids = renames.map((r) => r.id);
    const { data: currentTeams } = await admin
      .from("teams")
      .select("id, name")
      .in("id", ids)
      .eq("organisation_id", membership.organisation_id);

    if (!currentTeams || currentTeams.length !== renames.length) {
      return { success: false, error: "One or more teams not found" };
    }

    const currentNameMap: Record<string, string> = {};
    for (const t of currentTeams) currentNameMap[t.id] = t.name;

    // Filter to only actual changes
    const actualRenames = renames.filter(
      (r) => r.newName.trim() && r.newName.trim() !== currentNameMap[r.id]
    );
    if (actualRenames.length === 0) return { success: true };

    // Apply each rename
    for (const r of actualRenames) {
      const { error } = await admin
        .from("teams")
        .update({ name: r.newName.trim() })
        .eq("id", r.id)
        .eq("organisation_id", membership.organisation_id);

      if (error) {
        if (error.code === "23505") {
          return { success: false, error: `A team with the name "${r.newName.trim()}" already exists` };
        }
        return { success: false, error: error.message };
      }
    }

    // Single audit entry for all renames
    const changes: Record<string, { old: unknown; new: unknown }> = {};
    for (const r of actualRenames) {
      const oldName = currentNameMap[r.id];
      changes[oldName] = { old: oldName, new: r.newName.trim() };
    }

    logAudit({
      organisationId: membership.organisation_id,
      actorId: membership.id,
      actorName: `${membership.first_name} ${membership.last_name}`,
      action: "team.updated",
      targetType: "team",
      changes,
    });

    return { success: true };
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

    // Fetch team name for audit log
    const { data: team } = await admin
      .from("teams")
      .select("name")
      .eq("id", teamId)
      .eq("organisation_id", membership.organisation_id)
      .single();

    // Clear team_id on any members assigned to this team
    await admin
      .from("members")
      .update({ team_id: null })
      .eq("team_id", teamId)
      .eq("organisation_id", membership.organisation_id);

    // Delete the team
    const { error } = await admin
      .from("teams")
      .delete()
      .eq("id", teamId)
      .eq("organisation_id", membership.organisation_id);

    if (error) return { success: false, error: error.message };

    logAudit({
      organisationId: membership.organisation_id,
      actorId: membership.id,
      actorName: `${membership.first_name} ${membership.last_name}`,
      action: "team.deleted",
      targetType: "team",
      targetId: teamId,
      targetLabel: team?.name ?? "Unknown",
      metadata: { name: team?.name },
    });

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
  teamId: string | null,
  skipAudit?: boolean
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

    // Capture before-state for audit (only when we'll actually write one).
    let beforeTeamId: string | null = null;
    let memberLabel = "";
    if (!skipAudit) {
      const { data: before } = await admin
        .from("members")
        .select("team_id, first_name, last_name")
        .eq("id", memberId)
        .eq("organisation_id", membership.organisation_id)
        .single();
      beforeTeamId = before?.team_id ?? null;
      memberLabel = before ? `${before.first_name} ${before.last_name}` : memberId;
    }

    const { error } = await admin
      .from("members")
      .update({ team_id: teamId })
      .eq("id", memberId)
      .eq("organisation_id", membership.organisation_id);

    if (error) return { success: false, error: error.message };

    if (!skipAudit && beforeTeamId !== teamId) {
      const ids = [beforeTeamId, teamId].filter((x): x is string => !!x);
      const teamNameMap: Record<string, string> = {};
      if (ids.length > 0) {
        const { data: teams } = await admin.from("teams").select("id, name").in("id", ids);
        for (const t of teams ?? []) teamNameMap[t.id] = t.name;
      }
      logAudit({
        organisationId: membership.organisation_id,
        actorId:        membership.id,
        actorName:      `${membership.first_name} ${membership.last_name}`,
        action:         "member.team_changed",
        targetType:     "member",
        targetId:       memberId,
        targetLabel:    memberLabel,
        changes: {
          team: {
            old: beforeTeamId ? (teamNameMap[beforeTeamId] ?? "Unknown") : null,
            new: teamId       ? (teamNameMap[teamId]       ?? "Unknown") : null,
          },
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

// CLE-185 — multi-team membership has been retired. `getMemberTeams` and
// `setMemberTeams` previously read/wrote the `member_teams` junction.
// Membership is now a single `team_id` on `members` (see updateMemberTeam).
// Admins/owners who need to view multiple teams use the Team Access setting
// on Admin Profiles (permissions.object_access.teams).
