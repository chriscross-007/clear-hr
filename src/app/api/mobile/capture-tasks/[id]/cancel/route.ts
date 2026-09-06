import { NextResponse } from "next/server";
import { verifyCaller } from "../../../lib";

/**
 * POST /api/mobile/capture-tasks/:id/cancel
 *
 * Mobile-side cancel. Marks the task cancelled if still pending; noop
 * if already terminal. Realtime broadcasts the status change to the
 * caller's other surfaces (specifically the web dialog).
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const v = await verifyCaller(request);
    if ("error" in v) return NextResponse.json({ error: v.error }, { status: v.status });
    const { admin, user, organisationId, memberId: callerMemberId } = v;

    const { id: taskId } = await params;

    const { data: task } = await admin
      .from("capture_task")
      .select("id, status, queued_by_user_id, subtype_id, target_member_id")
      .eq("id", taskId)
      .single();
    if (!task || task.queued_by_user_id !== user.id) {
      return NextResponse.json({ error: "Task not found." }, { status: 404 });
    }
    if (task.status !== "pending") {
      // Already terminal — nothing to do. Return success to keep the
      // client's UX simple.
      return NextResponse.json({ success: true });
    }

    const { error: updateError } = await admin
      .from("capture_task")
      .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
      .eq("id", taskId)
      .eq("queued_by_user_id", user.id)
      .eq("status", "pending");
    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    // Audit — best-effort join for the target name + subtype.
    const { data: subtype } = await admin
      .from("document_subtype")
      .select("name")
      .eq("id", task.subtype_id as string)
      .single();
    const { data: targetMember } = await admin
      .from("members")
      .select("first_name, last_name")
      .eq("id", task.target_member_id as string)
      .single();
    const { data: callerMember } = await admin
      .from("members")
      .select("first_name, last_name")
      .eq("id", callerMemberId)
      .single();
    const actorName = `${callerMember?.first_name ?? ""} ${callerMember?.last_name ?? ""}`.trim() || "Unknown";
    const targetName = `${targetMember?.first_name ?? ""} ${targetMember?.last_name ?? ""}`.trim() || "Unknown";

    await admin.from("audit_log").insert({
      organisation_id: organisationId,
      actor_id: callerMemberId,
      actor_name: actorName,
      action: "document.capture_cancelled",
      target_type: "capture_task",
      target_id: taskId,
      target_label: `${subtype?.name ?? "—"} for ${targetName}`,
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
