"use server";

// CLE-235 — Settings → Organisation → Notifications. Three org switches
// read by the nightly document emails (src/lib/documents/notifications.ts).

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getEffectiveRightsForUser } from "@/lib/rights-resolver";
import { diffChanges, logAudit } from "@/lib/audit";

export interface DocumentNotificationSettings {
  memberAcks: boolean;
  memberExpiry: boolean;
  adminDigest: boolean;
}

export async function updateDocumentNotificationSettings(
  settings: DocumentNotificationSettings,
): Promise<{ success: boolean; error?: string }> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { success: false, error: "Not authenticated" };

    const resolved = await getEffectiveRightsForUser(user.id);
    if (!resolved) return { success: false, error: "No organisation" };
    if (!resolved.rights.canEditOrgSettings) {
      return { success: false, error: "You do not have permission to edit organisation settings" };
    }
    const orgId = resolved.ctx.organisationId;

    const { data: before } = await supabase
      .from("organisations")
      .select("notify_member_doc_acks, notify_member_doc_expiry, notify_admin_doc_digest")
      .eq("id", orgId)
      .single();

    const after = {
      notify_member_doc_acks: settings.memberAcks === true,
      notify_member_doc_expiry: settings.memberExpiry === true,
      notify_admin_doc_digest: settings.adminDigest === true,
    };
    const { error } = await supabase.from("organisations").update(after).eq("id", orgId);
    if (error) return { success: false, error: error.message };

    if (before) {
      const changes = diffChanges(before as Record<string, unknown>, after);
      if (changes) {
        const { data: me } = await supabase
          .from("members")
          .select("first_name, last_name")
          .eq("id", resolved.ctx.memberId)
          .single();
        await logAudit({
          organisationId: orgId,
          actorId: resolved.ctx.memberId,
          actorName: `${me?.first_name ?? ""} ${me?.last_name ?? ""}`.trim() || "Unknown",
          action: "org.updated",
          targetType: "organisation",
          targetId: orgId,
          changes,
        });
      }
    }

    revalidatePath("/settings/organisation");
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "An error occurred" };
  }
}
