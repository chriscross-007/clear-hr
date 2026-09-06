import { NextResponse } from "next/server";
import { verifyCaller } from "../lib";

/**
 * GET /api/mobile/capture-tasks
 *
 * Returns the calling user's pending capture tasks (CLE-211). Result
 * shape is what the mobile "pending tasks" banner needs to render:
 * task id, subtype label, target member name, note, queued time.
 * Ordered oldest-first so HR can work through them in the order they
 * were queued.
 */
export async function GET(request: Request) {
  try {
    const v = await verifyCaller(request);
    if ("error" in v) return NextResponse.json({ error: v.error }, { status: v.status });
    const { admin, user } = v;

    // Two FKs to members on this table — target_member_id and
    // queued_by_member_id — so the join needs an explicit FK hint.
    const { data, error } = await admin
      .from("capture_task")
      .select(
        `id, subtype_id, target_member_id, expires_on, note, expires_at, created_at,
         document_subtype!subtype_id(name, type),
         target:members!capture_task_target_member_id_fkey(first_name, last_name)`,
      )
      .eq("queued_by_user_id", user.id)
      .eq("status", "pending")
      .order("created_at", { ascending: true });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    type Row = {
      id: string;
      subtype_id: string;
      target_member_id: string;
      expires_on: string | null;
      note: string | null;
      expires_at: string;
      created_at: string;
      document_subtype: { name: string; type: string } | { name: string; type: string }[] | null;
      target: { first_name: string; last_name: string } | { first_name: string; last_name: string }[] | null;
    };

    const tasks = ((data ?? []) as Row[]).map((r) => {
      const st = Array.isArray(r.document_subtype) ? r.document_subtype[0] : r.document_subtype;
      const tgt = Array.isArray(r.target) ? r.target[0] : r.target;
      return {
        id: r.id,
        subtypeId: r.subtype_id,
        subtypeName: st?.name ?? "—",
        subtypeType: st?.type ?? null,
        targetMemberId: r.target_member_id,
        targetName: `${tgt?.first_name ?? ""} ${tgt?.last_name ?? ""}`.trim() || "—",
        expiresOn: r.expires_on,
        note: r.note,
        expiresAt: r.expires_at,
        createdAt: r.created_at,
      };
    });

    return NextResponse.json({ success: true, tasks });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
