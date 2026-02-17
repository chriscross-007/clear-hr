"use server";

import { createClient } from "@/lib/supabase/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { Resend } from "resend";
import { headers } from "next/headers";

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
    .select("organisation_id, role, permissions")
    .eq("user_id", user.id)
    .limit(1)
    .single();

  if (!membership) throw new Error("No organisation");

  const canManage =
    membership.role === "owner" ||
    (membership.role === "admin" &&
      (membership.permissions as Record<string, boolean>)
        ?.can_manage_members === true);

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
};

// Add employee — creates org_member record only, no auth user
export async function addEmployee(formData: {
  email: string;
  firstName: string;
  lastName: string;
}): Promise<{ success: boolean; error?: string; member?: MemberResult }> {
  try {
    const membership = await getCallerMembership();
    const admin = createAdminClient();

    const { data: newMember, error: memberError } = await admin
      .from("members")
      .insert({
        organisation_id: membership.organisation_id,
        email: formData.email,
        first_name: formData.firstName,
        last_name: formData.lastName,
        role: "employee",
        permissions: {
          can_request_holidays: true,
          can_approve_holidays: false,
          can_view_team_members: false,
          can_view_all_teams: false,
          can_manage_members: false,
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
      },
    };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : "An error occurred",
    };
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
    const protocol = host.startsWith("localhost") ? "http" : "https";
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
}): Promise<{ success: boolean; error?: string }> {
  try {
    const membership = await getCallerMembership();
    const admin = createAdminClient();

    // Update the member record
    const { error } = await admin
      .from("members")
      .update({
        first_name: formData.firstName,
        last_name: formData.lastName,
      })
      .eq("id", formData.memberId)
      .eq("organisation_id", membership.organisation_id);

    if (error) {
      return { success: false, error: error.message };
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

    // Fetch the member to check ownership and get user_id
    const { data: member, error: fetchError } = await admin
      .from("members")
      .select("id, user_id, role")
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

    return { success: true };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : "An error occurred",
    };
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
