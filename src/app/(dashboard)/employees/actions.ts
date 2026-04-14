"use server";

import { createClient } from "@/lib/supabase/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { Resend } from "resend";
import { headers } from "next/headers";
import { logAudit, diffChanges } from "@/lib/audit";
import { sendBookingCancelledEmail } from "@/lib/email";

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

  const canManage =
    membership.role === "owner" ||
    (membership.role === "admin" &&
      (membership.permissions as Record<string, boolean>)
        ?.can_add_members === true);

  if (!canManage) throw new Error("Insufficient permissions");

  return membership;
}

export type MemberResult = {
  member_id: string;
  user_id: string | null;
  first_name: string;
  last_name: string;
  email: string;
  role: string;
  invited_at: string | null;
  accepted_at: string | null;
  team_id: string | null;
  payroll_number: string | null;
  last_log_in: string | null;
  profile_name: string | null;
  custom_fields: Record<string, unknown>;
  avatar_url: string | null;
  updated_at: string | null;
  holiday_profile_name: string | null;
  work_pattern_name: string | null;
};

// Add employee — creates org_member record only, no auth user
export async function addEmployee(formData: {
  email: string;
  firstName: string;
  lastName: string;
  teamId?: string | null;
  payrollNumber?: string | null;
  startDate?: string | null;
}): Promise<{ success: boolean; error?: string; member?: MemberResult }> {
  try {
    const membership = await getCallerMembership();
    const admin = createAdminClient();

    // Check max_employees limit
    const { data: org } = await admin
      .from("organisations")
      .select("max_employees")
      .eq("id", membership.organisation_id)
      .single();

    const { count } = await admin
      .from("members")
      .select("id", { count: "exact", head: true })
      .eq("organisation_id", membership.organisation_id);

    if (org && count !== null && count >= org.max_employees) {
      return {
        success: false,
        error: `Your organisation has reached its limit of ${org.max_employees} members. Ask the owner to increase the limit in Billing.`,
      };
    }

    // Check for duplicate payroll number
    const trimmedPayroll = formData.payrollNumber?.trim() || null;
    if (trimmedPayroll) {
      const { data: existing } = await admin
        .from("members")
        .select("first_name, last_name")
        .eq("organisation_id", membership.organisation_id)
        .eq("payroll_number", trimmedPayroll)
        .limit(1)
        .single();

      if (existing) {
        return {
          success: false,
          error: `Payroll Number ${trimmedPayroll} has already been issued to ${existing.first_name} ${existing.last_name}. Please resolve the conflict.`,
        };
      }
    }

    const { data: newMember, error: memberError } = await admin
      .from("members")
      .insert({
        organisation_id: membership.organisation_id,
        email: formData.email.trim().toLowerCase(),
        first_name: formData.firstName,
        last_name: formData.lastName,
        role: "employee",
        team_id: formData.teamId || null,
        payroll_number: trimmedPayroll,
        start_date: formData.startDate || null,
        permissions: {
          can_request_holidays: true,
          can_approve_holidays: false,
          can_view_team_members: false,
          can_view_all_teams: false,
          can_add_members: false,
          can_edit_organisation: false,
        },
      })
      .select("id, invite_token")
      .single();

    if (memberError) {
      if (memberError.code === "23505") {
        return {
          success: false,
          error: "An employee with this email already exists in your organisation.",
        };
      }
      return { success: false, error: memberError.message };
    }

    // Resolve team ID to name for audit
    let teamName: string | null = null;
    if (formData.teamId) {
      const { data: teamRow } = await admin
        .from("teams")
        .select("name")
        .eq("id", formData.teamId)
        .single();
      teamName = teamRow?.name ?? null;
    }

    logAudit({
      organisationId: membership.organisation_id,
      actorId: membership.id,
      actorName: `${membership.first_name} ${membership.last_name}`,
      action: "member.created",
      targetType: "member",
      targetId: newMember.id,
      targetLabel: `${formData.firstName} ${formData.lastName}`,
      changes: {
        email: { old: null, new: formData.email },
        first_name: { old: null, new: formData.firstName },
        last_name: { old: null, new: formData.lastName },
        role: { old: null, new: "employee" },
        team: { old: null, new: teamName },
        payroll_number: { old: null, new: trimmedPayroll },
      },
      metadata: {
        member_count: (count ?? 0) + 1,
        max_employees: org?.max_employees,
      },
    });

    return {
      success: true,
      member: {
        member_id: newMember.id,
        user_id: null,
        first_name: formData.firstName,
        last_name: formData.lastName,
        email: formData.email,
        role: "employee",
        invited_at: null,
        accepted_at: null,
        team_id: formData.teamId || null,
        payroll_number: trimmedPayroll,
        last_log_in: null,
        profile_name: null,
        custom_fields: {},
        avatar_url: null,
        updated_at: null,
        holiday_profile_name: null,
        work_pattern_name: null,
      },
    };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : "An error occurred",
    };
  }
}

// Get start_date for a member (used by edit dialog)
export async function getMemberHolidayFields(
  memberId: string
): Promise<{ success: boolean; startDate?: string | null }> {
  try {
    const membership = await getCallerMembership();
    const admin = createAdminClient();

    const { data } = await admin
      .from("members")
      .select("start_date")
      .eq("id", memberId)
      .eq("organisation_id", membership.organisation_id)
      .single();

    if (!data) return { success: false };
    return {
      success: true,
      startDate: data.start_date,
    };
  } catch {
    return { success: false };
  }
}

// Send invite email via Resend
export async function sendInvite(
  memberId: string
): Promise<{ success: boolean; error?: string; invited_at?: string }> {
  try {
    const membership = await getCallerMembership();
    const admin = createAdminClient();

    // Fetch the member record + org name
    const { data: member, error: fetchError } = await admin
      .from("members")
      .select("id, email, first_name, invite_token, accepted_at, organisations(name)")
      .eq("id", memberId)
      .eq("organisation_id", membership.organisation_id)
      .single();

    if (fetchError || !member) {
      return { success: false, error: "Employee not found" };
    }

    if (member.accepted_at) {
      return { success: false, error: "This employee has already accepted their invite" };
    }

    const org = member.organisations as unknown as { name: string };
    const headersList = await headers();
    const host = headersList.get("host") ?? "localhost:3000";
    const protocol = host.includes("localhost") ? "http" : "https";
    const origin = `${protocol}://${host}`;
    const inviteUrl = `${origin}/accept-invite?token=${member.invite_token}`;

    // Send email via Resend
    const resend = new Resend(process.env.RESEND_API_KEY);
    const { error: emailError } = await resend.emails.send({
      from: "ClearHR <noreply@contacts.clear-hr.com>",
      to: member.email,
      subject: `You're invited to join ${org.name} on ClearHR`,
      html: `
        <h2>Hi ${member.first_name},</h2>
        <p>You've been invited to join <strong>${org.name}</strong> on ClearHR.</p>
        <p>Click the link below to set up your account:</p>
        <p><a href="${inviteUrl}" style="display:inline-block;padding:12px 24px;background:#18181b;color:#fff;text-decoration:none;border-radius:6px;">Accept Invite</a></p>
        <p>Or copy this link: ${inviteUrl}</p>
        <p style="color:#666;font-size:14px;">If you weren't expecting this invite, you can safely ignore this email.</p>
      `,
    });

    if (emailError) {
      return { success: false, error: emailError.message };
    }

    // Update invited_at
    const now = new Date().toISOString();
    await admin
      .from("members")
      .update({ invited_at: now })
      .eq("id", memberId);

    logAudit({
      organisationId: membership.organisation_id,
      actorId: membership.id,
      actorName: `${membership.first_name} ${membership.last_name}`,
      action: "member.invited",
      targetType: "member",
      targetId: memberId,
      targetLabel: `${member.first_name} (${member.email})`,
      changes: { invited_at: { old: null, new: now } },
    });

    return { success: true, invited_at: now };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : "An error occurred",
    };
  }
}

// Update employee details
export async function updateEmployee(formData: {
  memberId: string;
  firstName: string;
  lastName: string;
  role?: string;
  payrollNumber?: string | null;
  teamIds?: string[];
  isMultiTeam?: boolean;
  // undefined = no change, "__none__" = clear profile, UUID = assign profile
  profileId?: string;
  updatedAt?: string | null;
  startDate?: string | null;
}): Promise<{ success: boolean; error?: string; conflict?: boolean }> {
  try {
    const membership = await getCallerMembership();
    const admin = createAdminClient();

    const trimmedPayroll = formData.payrollNumber?.trim() || null;

    // Fetch before-state for audit diff (include team_id and profile FKs)
    const { data: beforeState } = await admin
      .from("members")
      .select("first_name, last_name, role, payroll_number, team_id, admin_profile_id, employee_profile_id")
      .eq("id", formData.memberId)
      .eq("organisation_id", membership.organisation_id)
      .single();

    // Check for duplicate payroll number (exclude current member)
    if (trimmedPayroll) {
      const { data: existing } = await admin
        .from("members")
        .select("first_name, last_name")
        .eq("organisation_id", membership.organisation_id)
        .eq("payroll_number", trimmedPayroll)
        .neq("id", formData.memberId)
        .limit(1)
        .single();

      if (existing) {
        return {
          success: false,
          error: `Payroll Number ${trimmedPayroll} has already been issued to ${existing.first_name} ${existing.last_name}. Please resolve the conflict.`,
        };
      }
    }

    const updateData: Record<string, unknown> = {
      first_name: formData.firstName,
      last_name: formData.lastName,
      payroll_number: trimmedPayroll,
    };

    if (formData.startDate !== undefined) {
      updateData.start_date = formData.startDate || null;
    }

    // Role change validation (skip if owner — owner role is immutable)
    if (formData.role && formData.role !== "owner") {
      const validRoles = ["admin", "employee"];
      if (!validRoles.includes(formData.role)) {
        return { success: false, error: "Invalid role" };
      }

      // Fetch the target member to prevent changing the owner's role
      const { data: target } = await admin
        .from("members")
        .select("role")
        .eq("id", formData.memberId)
        .eq("organisation_id", membership.organisation_id)
        .single();

      if (target?.role === "owner") {
        return { success: false, error: "Cannot change the owner's role" };
      }

      updateData.role = formData.role;
    }

    // Resolve profile assignment — included in the same DB update
    let profileChanges: Record<string, { old: unknown; new: unknown }> | undefined;
    if (formData.profileId !== undefined && beforeState) {
      const newRole = (updateData.role as string | undefined) ?? beforeState.role;
      const isAdmin = newRole === "admin";
      const profileFk = isAdmin ? "admin_profile_id" : "employee_profile_id";
      const profileTable = isAdmin ? "admin_profiles" : "employee_profiles";
      const oldProfileId = isAdmin ? beforeState.admin_profile_id : beforeState.employee_profile_id;

      let oldProfileName: string | null = null;
      if (oldProfileId) {
        const { data: oldP } = await admin
          .from(profileTable)
          .select("name")
          .eq("id", oldProfileId)
          .single();
        oldProfileName = oldP?.name ?? null;
      }

      let newProfileName: string | null = null;
      if (formData.profileId !== "__none__") {
        const { data: newP } = await admin
          .from(profileTable)
          .select("name, rights")
          .eq("id", formData.profileId)
          .eq("organisation_id", membership.organisation_id)
          .single();
        if (!newP) return { success: false, error: "Profile not found" };
        updateData[profileFk] = formData.profileId;
        updateData.permissions = newP.rights;
        newProfileName = newP.name;
      } else {
        updateData[profileFk] = null;
      }

      if (oldProfileName !== newProfileName) {
        profileChanges = {
          [`${isAdmin ? "admin" : "employee"}_profile`]: {
            old: oldProfileName,
            new: newProfileName,
          },
        };
      }
    }

    const query = admin
      .from("members")
      .update(updateData)
      .eq("id", formData.memberId)
      .eq("organisation_id", membership.organisation_id);

    if (formData.updatedAt) {
      query.eq("updated_at", formData.updatedAt);
    }

    const { data: updated, error } = await query.select("id");

    if (error) {
      return { success: false, error: error.message };
    }

    if (formData.updatedAt && (!updated || updated.length === 0)) {
      return {
        success: false,
        conflict: true,
        error: "This record was updated by someone else while you were editing. Please close and reopen to see the latest changes.",
      };
    }

    if (beforeState) {
      const fieldChanges = diffChanges(
        {
          first_name: beforeState.first_name,
          last_name: beforeState.last_name,
          role: beforeState.role,
          payroll_number: beforeState.payroll_number,
        },
        {
          first_name: formData.firstName,
          last_name: formData.lastName,
          role: (updateData.role as string | undefined) ?? beforeState.role,
          payroll_number: trimmedPayroll,
        }
      );

      // Include team changes in the same audit entry if teamIds were provided
      let teamChanges: Record<string, { old: unknown; new: unknown }> | undefined;
      if (formData.teamIds !== undefined) {
        if (formData.isMultiTeam) {
          // Multi-team: compare old team list vs new
          const { data: oldTeamRows } = await admin
            .from("member_teams")
            .select("team_id")
            .eq("member_id", formData.memberId);
          const oldTeamIds = (oldTeamRows ?? []).map((r) => r.team_id).sort();
          const newTeamIds = [...formData.teamIds].sort();
          if (JSON.stringify(oldTeamIds) !== JSON.stringify(newTeamIds)) {
            const allIds = [...new Set([...oldTeamIds, ...newTeamIds])];
            const teamNameMap: Record<string, string> = {};
            if (allIds.length > 0) {
              const { data: teams } = await admin
                .from("teams")
                .select("id, name")
                .in("id", allIds);
              for (const t of teams ?? []) teamNameMap[t.id] = t.name;
            }
            teamChanges = {
              teams: {
                old: oldTeamIds.map((id: string) => teamNameMap[id] ?? "Unknown"),
                new: newTeamIds.map((id: string) => teamNameMap[id] ?? "Unknown"),
              },
            };
          }
        } else {
          // Single-team: compare old team_id vs new
          const newTeamId = formData.teamIds.length > 0 ? formData.teamIds[0] : null;
          if ((beforeState.team_id ?? null) !== (newTeamId ?? null)) {
            const idsToResolve = [beforeState.team_id, newTeamId].filter(Boolean) as string[];
            const teamNameMap: Record<string, string> = {};
            if (idsToResolve.length > 0) {
              const { data: teams } = await admin
                .from("teams")
                .select("id, name")
                .in("id", idsToResolve);
              for (const t of teams ?? []) teamNameMap[t.id] = t.name;
            }
            teamChanges = {
              team: {
                old: beforeState.team_id ? (teamNameMap[beforeState.team_id] ?? "Unknown") : null,
                new: newTeamId ? (teamNameMap[newTeamId] ?? "Unknown") : null,
              },
            };
          }
        }
      }

      const allChanges = { ...fieldChanges, ...teamChanges, ...profileChanges };
      if (Object.keys(allChanges).length > 0) {
        logAudit({
          organisationId: membership.organisation_id,
          actorId: membership.id,
          actorName: `${membership.first_name} ${membership.last_name}`,
          action: "member.updated",
          targetType: "member",
          targetId: formData.memberId,
          targetLabel: `${formData.firstName} ${formData.lastName}`,
          changes: allChanges,
        });
      }
    }

    return { success: true };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : "An error occurred",
    };
  }
}

// Delete employee — removes org_member record and auth user if linked
export async function deleteEmployee(
  memberId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const membership = await getCallerMembership();
    const admin = createAdminClient();

    // Fetch the member to check ownership and get full record for audit
    const { data: member, error: fetchError } = await admin
      .from("members")
      .select("id, user_id, role, email, first_name, last_name, payroll_number, team_id")
      .eq("id", memberId)
      .eq("organisation_id", membership.organisation_id)
      .single();

    if (fetchError || !member) {
      return { success: false, error: "Employee not found" };
    }

    if (member.role === "owner") {
      return { success: false, error: "Cannot delete the organisation owner" };
    }

    // Delete the members record
    const { error: deleteError } = await admin
      .from("members")
      .delete()
      .eq("id", memberId);

    if (deleteError) {
      return { success: false, error: deleteError.message };
    }

    // If the employee had an auth account, delete it too
    if (member.user_id) {
      const { error: authError } = await admin.auth.admin.deleteUser(
        member.user_id
      );
      if (authError) {
        // The member is already deleted — log but don't fail
        console.error("Failed to delete auth user:", authError.message);
      }
    }

    // Get current member count (after deletion) and max for audit
    const { data: delOrg } = await admin
      .from("organisations")
      .select("max_employees")
      .eq("id", membership.organisation_id)
      .single();
    const { count: delCount } = await admin
      .from("members")
      .select("id", { count: "exact", head: true })
      .eq("organisation_id", membership.organisation_id);

    logAudit({
      organisationId: membership.organisation_id,
      actorId: membership.id,
      actorName: `${membership.first_name} ${membership.last_name}`,
      action: "member.deleted",
      targetType: "member",
      targetId: memberId,
      targetLabel: `${member.first_name} ${member.last_name}`,
      metadata: {
        email: member.email,
        first_name: member.first_name,
        last_name: member.last_name,
        role: member.role,
        payroll_number: member.payroll_number,
        team_id: member.team_id,
        member_count: delCount ?? 0,
        max_employees: delOrg?.max_employees,
      },
    });

    return { success: true };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : "An error occurred",
    };
  }
}

// Upload member avatar photo
export async function uploadMemberAvatar(
  memberId: string,
  formData: FormData
): Promise<{ success: boolean; error?: string; avatarUrl?: string }> {
  try {
    const membership = await getCallerMembership();
    const admin = createAdminClient();

    const file = formData.get("avatar") as File | null;
    if (!file || file.size === 0) return { success: false, error: "No file provided" };
    if (file.size > 5 * 1024 * 1024) return { success: false, error: "File must be under 5MB" };

    const ext = file.name.split(".").pop()?.toLowerCase() ?? "jpg";
    if (!["jpg", "jpeg", "png", "webp", "gif"].includes(ext)) {
      return { success: false, error: "File must be an image (jpg, png, webp, gif)" };
    }

    // Verify the target member belongs to caller's org
    const { data: targetMember } = await admin
      .from("members")
      .select("id, avatar_url")
      .eq("id", memberId)
      .eq("organisation_id", membership.organisation_id)
      .single();

    if (!targetMember) return { success: false, error: "Member not found" };

    const path = `${membership.organisation_id}/${memberId}/${Date.now()}.${ext}`;
    const buffer = Buffer.from(await file.arrayBuffer());

    const { error: uploadError } = await admin.storage
      .from("member-avatars")
      .upload(path, buffer, { contentType: file.type, upsert: false });

    if (uploadError) return { success: false, error: uploadError.message };

    const { data: { publicUrl } } = admin.storage.from("member-avatars").getPublicUrl(path);

    await admin
      .from("members")
      .update({ avatar_url: publicUrl })
      .eq("id", memberId)
      .eq("organisation_id", membership.organisation_id);

    return { success: true, avatarUrl: publicUrl };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "An error occurred" };
  }
}

// Get invite details for accept-invite page (no auth required)
export async function getInviteDetails(token: string): Promise<{
  success: boolean;
  error?: string;
  data?: {
    email: string;
    firstName: string;
    orgName: string;
  };
}> {
  try {
    const admin = createAdminClient();

    const { data: member, error } = await admin
      .from("members")
      .select("email, first_name, accepted_at, organisations(name)")
      .eq("invite_token", token)
      .single();

    if (error || !member) {
      return { success: false, error: "Invalid or expired invite link" };
    }

    if (member.accepted_at) {
      return { success: false, error: "This invite has already been accepted" };
    }

    const org = member.organisations as unknown as { name: string };

    return {
      success: true,
      data: {
        email: member.email,
        firstName: member.first_name,
        orgName: org.name,
      },
    };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : "An error occurred",
    };
  }
}

// Accept invite — creates auth user with confirmed email (no verification needed)
export async function acceptInvite(
  token: string,
  password: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const admin = createAdminClient();

    const { data: member, error: fetchError } = await admin
      .from("members")
      .select("id, organisation_id, email, first_name, last_name, accepted_at")
      .eq("invite_token", token)
      .single();

    if (fetchError || !member) {
      return { success: false, error: "Invalid or expired invite link" };
    }

    if (member.accepted_at) {
      return { success: false, error: "This invite has already been accepted" };
    }

    // Create auth user with email auto-confirmed
    const { error: createError } = await admin.auth.admin.createUser({
      email: member.email,
      password,
      email_confirm: true,
      user_metadata: {
        first_name: member.first_name,
        last_name: member.last_name,
      },
    });

    if (createError) {
      if (createError.message?.includes("already been registered")) {
        return {
          success: false,
          error: "An account with this email already exists. Please sign in instead.",
        };
      }
      return { success: false, error: createError.message };
    }

    // The DB trigger link_user_to_org_member will automatically link the user
    logAudit({
      organisationId: member.organisation_id,
      actorId: member.id,
      actorName: `${member.first_name} ${member.last_name}`,
      action: "member.accepted_invite",
      targetType: "member",
      targetId: member.id,
      targetLabel: `${member.first_name} ${member.last_name}`,
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
// Bulk update members
// ---------------------------------------------------------------------------

export type BulkUpdatePayload = {
  team_id?: string;
  role?: "admin" | "employee";
  custom_fields?: Record<string, unknown>;
};

export async function bulkUpdateMembers(
  memberIds: string[],
  updates: BulkUpdatePayload
): Promise<{ success: boolean; error?: string }> {
  try {
    if (!memberIds.length) return { success: false, error: "No members selected" };

    // Verify caller — owner or admin with can_manage_members write access
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { success: false, error: "Not authenticated" };

    const { data: membership } = await supabase
      .from("members")
      .select("id, organisation_id, role, permissions, first_name, last_name")
      .eq("user_id", user.id)
      .limit(1)
      .single();

    if (!membership) return { success: false, error: "No organisation" };

    const permissions = (membership.permissions as Record<string, unknown>) ?? {};
    const canEdit =
      membership.role === "owner" ||
      (membership.role === "admin" && permissions.can_manage_members === "write");

    if (!canEdit) return { success: false, error: "Insufficient permissions" };

    // Validate role if provided
    if (updates.role && !["admin", "employee"].includes(updates.role)) {
      return { success: false, error: "Invalid role" };
    }

    // Call the RPC via service role client (bypasses RLS, runs in single transaction)
    const admin = createAdminClient();
    const { error } = await admin.rpc("bulk_update_members", {
      p_member_ids: memberIds,
      p_org_id: membership.organisation_id,
      p_team_id: updates.team_id ?? null,
      p_role: updates.role ?? null,
      p_custom_fields: updates.custom_fields ?? null,
    });

    if (error) {
      return { success: false, error: error.message };
    }

    // Audit log
    const changedParts: string[] = [];
    if (updates.team_id) changedParts.push("team");
    if (updates.role) changedParts.push("role");
    if (updates.custom_fields) changedParts.push("custom fields");

    logAudit({
      organisationId: membership.organisation_id,
      actorId: membership.id,
      actorName: `${membership.first_name} ${membership.last_name}`,
      action: "member.bulk_update",
      targetType: "member",
      targetId: memberIds[0],
      targetLabel: `${memberIds.length} members (${changedParts.join(", ")})`,
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
// Change an employee's holiday profile
// ---------------------------------------------------------------------------

export async function changeEmployeeHolidayProfile(
  memberId: string,
  newProfileId: string,
  effectiveDate: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const membership = await getCallerMembership();
    const admin = createAdminClient();

    // Verify member belongs to caller's org
    const { data: member } = await admin
      .from("members")
      .select("id, organisation_id")
      .eq("id", memberId)
      .eq("organisation_id", membership.organisation_id)
      .single();

    if (!member) return { success: false, error: "Member not found" };

    // Fetch the new profile
    const { data: profile } = await admin
      .from("absence_profiles")
      .select("id, absence_type_id, allowance")
      .eq("id", newProfileId)
      .eq("organisation_id", membership.organisation_id)
      .single();

    if (!profile) return { success: false, error: "Holiday profile not found" };

    const fullAllowance = Number(profile.allowance);

    /** Count calendar days between two ISO date strings (inclusive) */
    function daysBetween(start: string, end: string): number {
      const s = new Date(start + "T00:00:00Z");
      const e = new Date(end + "T00:00:00Z");
      return Math.round((e.getTime() - s.getTime()) / (1000 * 60 * 60 * 24)) + 1;
    }

    /** Pro-rate allowance for a partial year, rounded down to nearest 0.5 */
    function proRate(recordDays: number, yearDays: number): number {
      const raw = fullAllowance * (recordDays / yearDays);
      return Math.floor(raw * 2) / 2;
    }

    // Find any existing record whose range contains the new start date
    const { data: overlapping } = await admin
      .from("holiday_year_records")
      .select("id, year_start, year_end")
      .eq("member_id", member.id)
      .lte("year_start", effectiveDate)
      .gte("year_end", effectiveDate)
      .limit(1)
      .single();

    // Determine the new record's end date and pro-rated amounts
    let newEndDate: string;
    let fullYearDays: number;

    if (overlapping) {
      // Use the overlapping record's original year_end
      newEndDate = overlapping.year_end;
      fullYearDays = daysBetween(overlapping.year_start, overlapping.year_end);

      // Truncate the overlapping record to end the day before the new record starts
      const truncatedEnd = new Date(effectiveDate + "T00:00:00Z");
      truncatedEnd.setUTCDate(truncatedEnd.getUTCDate() - 1);
      const truncatedEndStr = truncatedEnd.toISOString().slice(0, 10);

      if (truncatedEndStr >= overlapping.year_start) {
        const truncatedDays = daysBetween(overlapping.year_start, truncatedEndStr);
        const truncatedAmount = proRate(truncatedDays, fullYearDays);
        await admin
          .from("holiday_year_records")
          .update({
            year_end: truncatedEndStr,
            base_amount: truncatedAmount,
            pro_rata_amount: truncatedAmount,
          })
          .eq("id", overlapping.id);
      } else {
        // New start date is the same as existing start — delete the old record
        await admin
          .from("holiday_year_records")
          .delete()
          .eq("id", overlapping.id);
      }
    } else {
      // No overlap — default to 1 year from start
      const start = new Date(effectiveDate + "T00:00:00Z");
      const end = new Date(Date.UTC(start.getUTCFullYear() + 1, start.getUTCMonth(), start.getUTCDate() - 1));
      newEndDate = end.toISOString().slice(0, 10);
      fullYearDays = daysBetween(effectiveDate, newEndDate);
    }

    // Calculate the new record's pro-rated allowance
    const newRecordDays = daysBetween(effectiveDate, newEndDate);
    const newAmount = newRecordDays >= fullYearDays ? fullAllowance : proRate(newRecordDays, fullYearDays);

    // Insert the new record
    const { error: insertError } = await admin
      .from("holiday_year_records")
      .upsert({
        organisation_id: member.organisation_id,
        member_id: member.id,
        absence_type_id: profile.absence_type_id,
        absence_profile_id: profile.id,
        year_start: effectiveDate,
        year_end: newEndDate,
        base_amount: newAmount,
        adjustment: 0,
        carried_over: 0,
        borrow_forward: 0,
        pro_rata_amount: newAmount,
      }, { onConflict: "member_id,absence_type_id,year_start" });

    if (insertError) return { success: false, error: insertError.message };

    logAudit({
      organisationId: membership.organisation_id,
      actorId: membership.id,
      actorName: `${membership.first_name} ${membership.last_name}`,
      action: "member.holiday_profile_changed",
      targetType: "member",
      targetId: memberId,
      targetLabel: `Changed holiday profile`,
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
// Update a holiday year record
// ---------------------------------------------------------------------------

export async function updateHolidayYearRecord(
  recordId: string,
  fields: {
    year_start?: string;
    year_end?: string;
    base_amount?: number;
    adjustment?: number;
    carried_over?: number;
  }
): Promise<{ success: boolean; error?: string }> {
  try {
    const membership = await getCallerMembership();
    const admin = createAdminClient();

    const { data: record } = await admin
      .from("holiday_year_records")
      .select("id, organisation_id, member_id, absence_type_id, year_start")
      .eq("id", recordId)
      .eq("organisation_id", membership.organisation_id)
      .single();

    if (!record) return { success: false, error: "Record not found" };

    const updatePayload: Record<string, unknown> = {};
    // Only include year_start if it actually changed (avoid false unique constraint violations)
    if (fields.year_start !== undefined && fields.year_start !== record.year_start) {
      updatePayload.year_start = fields.year_start;
    }
    if (fields.year_end !== undefined) updatePayload.year_end = fields.year_end;
    if (fields.base_amount !== undefined) {
      updatePayload.base_amount = fields.base_amount;
      updatePayload.pro_rata_amount = fields.base_amount;
    }
    if (fields.adjustment !== undefined) updatePayload.adjustment = fields.adjustment;
    if (fields.carried_over !== undefined) updatePayload.carried_over = fields.carried_over;

    const { error } = await admin
      .from("holiday_year_records")
      .update(updatePayload)
      .eq("id", recordId);

    if (error) return { success: false, error: error.message };

    // If year_end changed, adjust next record's year_start to maintain contiguity
    if (fields.year_end !== undefined) {
      const newYearEnd = fields.year_end;
      const { data: nextRecord } = await admin
        .from("holiday_year_records")
        .select("id, year_start")
        .eq("member_id", record.member_id)
        .eq("absence_type_id", record.absence_type_id)
        .gt("year_start", record.year_start)
        .order("year_start", { ascending: true })
        .limit(1)
        .single();

      if (nextRecord) {
        const expectedStart = new Date(newYearEnd + "T00:00:00Z");
        expectedStart.setUTCDate(expectedStart.getUTCDate() + 1);
        const expectedStartStr = expectedStart.toISOString().slice(0, 10);
        if (nextRecord.year_start !== expectedStartStr) {
          await admin
            .from("holiday_year_records")
            .update({ year_start: expectedStartStr })
            .eq("id", nextRecord.id);
        }
      }
    }

    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "An error occurred" };
  }
}

// ---------------------------------------------------------------------------
// Delete a holiday year record
// ---------------------------------------------------------------------------

export async function deleteHolidayYearRecord(
  recordId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const membership = await getCallerMembership();
    const admin = createAdminClient();

    const { error } = await admin
      .from("holiday_year_records")
      .delete()
      .eq("id", recordId)
      .eq("organisation_id", membership.organisation_id);

    if (error) return { success: false, error: error.message };
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "An error occurred" };
  }
}

// ---------------------------------------------------------------------------
// Cancel a holiday booking as admin
// ---------------------------------------------------------------------------

export async function cancelBookingAsAdmin(
  bookingId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const membership = await getCallerMembership();
    const admin = createAdminClient();

    // Fetch booking details before cancelling (for email)
    const { data: booking } = await admin
      .from("holiday_bookings")
      .select("member_id, start_date, end_date, days_deducted, absence_reasons(name)")
      .eq("id", bookingId)
      .eq("organisation_id", membership.organisation_id)
      .single();

    const { error } = await admin
      .from("holiday_bookings")
      .update({ status: "cancelled" })
      .eq("id", bookingId)
      .eq("organisation_id", membership.organisation_id)
      .in("status", ["pending", "approved"]);

    if (error) return { success: false, error: error.message };

    // Fire-and-forget email to employee (only if admin cancelled someone else's booking)
    if (booking && booking.member_id !== membership.id) {
      const reasonName = (booking.absence_reasons as unknown as { name: string } | null)?.name ?? "Holiday";
      const headersList = await headers();
      const host = headersList.get("host") ?? "localhost:3000";
      const baseUrl = `${host.includes("localhost") ? "http" : "https"}://${host}`;
      void sendBookingCancelledEmail({
        bookingId, memberId: booking.member_id,
        startDate: booking.start_date, endDate: booking.end_date,
        days: booking.days_deducted ? Number(booking.days_deducted) : null,
        leaveType: reasonName, cancelledByAdmin: true, baseUrl,
      });
    }

    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "An error occurred" };
  }
}
