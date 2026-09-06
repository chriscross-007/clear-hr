"use server";

// CLE-211b — Server actions for Remote Camera Capture (web side).
//
// The web-side "Photo" button on the Add Document dialog calls
// `queueCaptureTask`, which inserts a `capture_task` row for the
// caller. Supabase Realtime (enabled in migration 20260904000002)
// broadcasts the INSERT to the caller's own mobile app; HR captures
// the shot and uploads via /api/mobile/capture-tasks/:id/upload,
// which flips the task to `uploaded` and the web dialog closes.
//
// Both `queueCaptureTask` and `cancelCaptureTask` are gated by the
// resolver: `documents.update` on the target member's scope.

import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { getEffectiveRightsForUser } from "@/lib/rights-resolver";
import { logAudit } from "@/lib/audit";

const TASK_TTL_MINUTES = 60;

function getAdmin() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

async function callerName(admin: ReturnType<typeof getAdmin>, callerMemberId: string): Promise<string> {
  const { data } = await admin
    .from("members")
    .select("first_name, last_name")
    .eq("id", callerMemberId)
    .single();
  return `${data?.first_name ?? ""} ${data?.last_name ?? ""}`.trim() || "Unknown";
}

function memberDisplay(target: { first_name: string; last_name: string }): string {
  return `${target.first_name ?? ""} ${target.last_name ?? ""}`.trim() || "Unknown";
}

// ---------------------------------------------------------------------------
// queueCaptureTask — web → server
// ---------------------------------------------------------------------------

export async function queueCaptureTask(
  targetMemberId: string,
  subtypeId: string,
  expiresOn: string | null,
  note: string | null,
): Promise<{ success: true; taskId: string } | { success: false; error: string }> {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: "Not authenticated" };

    const resolved = await getEffectiveRightsForUser(user.id);
    if (!resolved) return { success: false, error: "No organisation" };
    const { rights, ctx } = resolved;

    const admin = getAdmin();

    // Target must be in the same tenant.
    const { data: target } = await admin
      .from("members")
      .select("id, team_id, first_name, last_name, organisation_id")
      .eq("id", targetMemberId)
      .eq("organisation_id", ctx.organisationId)
      .single();
    if (!target) return { success: false, error: "That member is not available." };

    // Scope check — mirrors uploadMemberDocument.canUpdateTarget.
    const canUpdate = (() => {
      if (target.id === ctx.memberId) return rights.tabs.documents?.update === true;
      if (rights.crossUserAccess === "all") return rights.tabs.documents?.update === true;
      if (rights.crossUserAccess === "team")
        return target.team_id !== null && target.team_id === ctx.teamId
          && rights.tabs.documents?.update === true;
      return false;
    })();
    if (!canUpdate) {
      return { success: false, error: "You don't have permission to add documents for this employee." };
    }

    // Subtype must be member-scope + same tenant.
    const { data: subtype } = await admin
      .from("document_subtype")
      .select("id, type, name, expiry_required")
      .eq("id", subtypeId)
      .eq("organisation_id", ctx.organisationId)
      .single();
    if (!subtype) return { success: false, error: "That document type is not available." };
    if (subtype.type === "organisation_document") {
      return { success: false, error: "Organisation documents can't be captured this way." };
    }
    if (subtype.expiry_required && !expiresOn) {
      return { success: false, error: "This document type needs an expiry date before you can queue a photo." };
    }

    // Trim / cap the note.
    const cleanNote = note && note.trim() ? note.trim().slice(0, 240) : null;

    const expiresAtIso = new Date(Date.now() + TASK_TTL_MINUTES * 60 * 1000).toISOString();

    const { data: inserted, error: insertError } = await admin
      .from("capture_task")
      .insert({
        organisation_id: ctx.organisationId,
        queued_by_user_id: user.id,
        queued_by_member_id: ctx.memberId,
        target_member_id: target.id,
        subtype_id: subtype.id,
        expires_on: expiresOn,
        note: cleanNote,
        expires_at: expiresAtIso,
      })
      .select("id")
      .single();
    if (insertError || !inserted) {
      return { success: false, error: insertError?.message ?? "Failed to queue capture task" };
    }

    await logAudit({
      organisationId: ctx.organisationId,
      actorId: ctx.memberId,
      actorName: await callerName(admin, ctx.memberId),
      action: "document.capture_queued",
      targetType: "capture_task",
      targetId: inserted.id,
      targetLabel: `${subtype.name} for ${memberDisplay(target)}`,
      metadata: {
        member: memberDisplay(target),
        type_subtype: `${subtype.type} / ${subtype.name}`,
        expires_on: expiresOn,
        expires_at: expiresAtIso,
      },
    });

    return { success: true, taskId: inserted.id as string };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "An error occurred" };
  }
}

// ---------------------------------------------------------------------------
// cancelCaptureTask — web or mobile → server
// ---------------------------------------------------------------------------
//
// Also called directly from the web dialog's unmount cleanup so the
// task doesn't hang around after the user closes the dialog without
// hitting Cancel.

export async function cancelCaptureTask(
  taskId: string,
): Promise<{ success: true } | { success: false; error: string }> {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: "Not authenticated" };

    const resolved = await getEffectiveRightsForUser(user.id);
    if (!resolved) return { success: false, error: "No organisation" };
    const { ctx } = resolved;

    const admin = getAdmin();

    const { data: task } = await admin
      .from("capture_task")
      .select("id, status, queued_by_user_id, organisation_id, target_member_id, subtype_id, document_subtype(name), members!capture_task_target_member_id_fkey(first_name, last_name)")
      .eq("id", taskId)
      .single();
    if (!task || task.queued_by_user_id !== user.id) {
      return { success: false, error: "Task not found." };
    }
    if (task.status !== "pending") {
      // Already terminal; noop but don't lie about success — helps
      // debug races between mobile upload and web unmount cancel.
      return { success: true };
    }

    const { error: updateError } = await admin
      .from("capture_task")
      .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
      .eq("id", taskId)
      .eq("queued_by_user_id", user.id)
      .eq("status", "pending");
    if (updateError) return { success: false, error: updateError.message };

    const subtypeName = ((task.document_subtype as unknown as { name?: string } | { name?: string }[] | null) instanceof Array
      ? (task.document_subtype as { name?: string }[])[0]?.name
      : (task.document_subtype as { name?: string } | null)?.name) ?? "—";
    const memberRow = ((task.members as unknown as { first_name?: string; last_name?: string } | { first_name?: string; last_name?: string }[] | null) instanceof Array
      ? (task.members as { first_name?: string; last_name?: string }[])[0]
      : (task.members as { first_name?: string; last_name?: string } | null)) ?? null;

    await logAudit({
      organisationId: ctx.organisationId,
      actorId: ctx.memberId,
      actorName: await callerName(admin, ctx.memberId),
      action: "document.capture_cancelled",
      targetType: "capture_task",
      targetId: taskId,
      targetLabel: `${subtypeName} for ${memberDisplay({ first_name: memberRow?.first_name ?? "", last_name: memberRow?.last_name ?? "" })}`,
    });

    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "An error occurred" };
  }
}
