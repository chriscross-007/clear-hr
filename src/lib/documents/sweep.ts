// CLE-209 — Documents nightly sweep.
//
// Two responsibilities:
//   1. Status sweep — write `document.expired` / `document.review_overdue`
//      audit rows once per verification cycle for any doc whose live
//      status has flipped to expired or overdue for review. CLE-212
//      follow-up: was previously keyed on `expires_on = yesterday` /
//      `next_review_on = yesterday`, which meant missed sweep days or
//      backdated dates never generated an audit row. Now keyed on
//      `≤ today` with a dedupe check against the audit log itself so
//      each cycle fires exactly one audit row (see
//      `alreadyAuditedThisCycle`).
//   2. Disposal sweep — permanently delete any doc past its 30-day
//      Trash grace: purge storage bytes, delete the `document` row,
//      remove the `disposal_queue` entry, write `document.purged`
//      audit row.
//
// Shape: pure function that takes an admin Supabase client + an
// optional organisation filter. The cron route calls it with no
// filter (all orgs); the manual admin trigger scopes to the caller's
// org so an admin can test their own tenant only.

import type { SupabaseClient } from "@supabase/supabase-js";
import { logAudit } from "@/lib/audit";

const GRACE_MS = 30 * 24 * 60 * 60 * 1000;

const MEMBER_BUCKET = "member-documents";
const ORG_BUCKET = "org-documents";

export interface SweepResult {
  expired: number;
  overdueReview: number;
  purged: number;
  captureTasksTimedOut: number;
  errors: string[];
}

// CLE-212 follow-up — "audit once per verification cycle" dedupe.
// Returns true when the given transition action has already been
// audited for this document since its most recent verify/renew (i.e.
// the current verification cycle). Used to stop the sweep firing the
// same `document.expired` / `document.review_overdue` row more than
// once for the same state.
//
// Semantics: fetch the newest audit row on the doc among {this
// transition action, document.verified, document.renewed}. If the
// newest is the transition action, we've already audited this cycle.
// If the newest is a verify/renew (or nothing matches), we haven't.
async function alreadyAuditedThisCycle(
  admin: SupabaseClient,
  targetId: string,
  transitionAction: "document.expired" | "document.review_overdue",
): Promise<boolean> {
  const { data } = await admin
    .from("audit_log")
    .select("action")
    .eq("target_id", targetId)
    .in("action", [transitionAction, "document.verified", "document.renewed"])
    .order("created_at", { ascending: false })
    .limit(1);
  return data?.[0]?.action === transitionAction;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

const TYPE_DISPLAY: Record<string, string> = {
  contract: "Contract",
  certificate: "Certificate",
  evidence: "Evidence",
  policy: "Policy",
  handbook: "Handbook",
  attachment: "Attachment",
  other: "Other",
};

function typeSubtypeLabel(type: string, subtypeName: string | null): string {
  const t = TYPE_DISPLAY[type] ?? type;
  return subtypeName ? `${t} / ${subtypeName}` : t;
}

export async function runDocumentsSweep(
  admin: SupabaseClient,
  opts?: { organisationId?: string; today?: string },
): Promise<SweepResult> {
  const errors: string[] = [];
  const today = opts?.today ?? todayIso();
  const graceCutoff = new Date(Date.now() - GRACE_MS).toISOString();

  // Members map — hydrated per-org so we can attach a friendly name
  // to each status-change audit row. document.owner_id is a soft-FK
  // (org-scoped rows leave it NULL) so PostgREST can't auto-join;
  // two-step lookup instead.
  async function hydrateMembers(ownerIds: string[]): Promise<Map<string, string>> {
    const uniq = Array.from(new Set(ownerIds.filter((id): id is string => id !== null && id !== undefined)));
    if (uniq.length === 0) return new Map();
    let q = admin.from("members").select("id, first_name, last_name").in("id", uniq);
    if (opts?.organisationId) q = q.eq("organisation_id", opts.organisationId);
    const { data } = await q;
    const m = new Map<string, string>();
    for (const r of data ?? []) {
      const name = `${(r as { first_name?: string }).first_name ?? ""} ${(r as { last_name?: string }).last_name ?? ""}`.trim();
      if (name) m.set(r.id as string, name);
    }
    return m;
  }

  // ---------------------------------------------------------------------------
  // 1. Status sweep — expired
  //
  // CLE-212 follow-up. Was "expires_on = yesterday" (fires once on the
  // transition day, misses everything if the sweep didn't run or the
  // date was backdated). Now "expires_on ≤ today, once per verification
  // cycle" — matches the doc's live-derived `expired` status, so the
  // audit log stays honest about the state the user sees.
  // ---------------------------------------------------------------------------
  let expired = 0;
  {
    let q = admin
      .from("document")
      .select(
        "id, organisation_id, file_name, type, owner_scope, owner_id, expires_on, document_subtype!subtype_id(name, requires_verification)",
      )
      .lte("expires_on", today)
      .not("verified_on", "is", null);
    if (opts?.organisationId) q = q.eq("organisation_id", opts.organisationId);
    const { data, error } = await q;
    if (error) {
      errors.push(`status/expired select: ${error.message}`);
    } else {
      const memMap = await hydrateMembers(
        (data ?? []).map((r) => r.owner_id as string).filter(Boolean),
      );
      for (const row of data ?? []) {
        const st = row.document_subtype as unknown as { name?: string; requires_verification?: boolean } | { name?: string; requires_verification?: boolean }[] | null;
        const stObj = Array.isArray(st) ? (st[0] ?? null) : st;
        if (!stObj?.requires_verification) continue;
        if (await alreadyAuditedThisCycle(admin, row.id as string, "document.expired")) continue;
        const member = row.owner_id ? memMap.get(row.owner_id as string) ?? null : null;
        await logAudit({
          organisationId: row.organisation_id as string,
          actorId: null as unknown as string, // system-authored row
          actorName: "System (nightly sweep)",
          action: "document.expired",
          targetType: row.owner_scope === "organisation" ? "org_document" : "member_document",
          targetId: row.id as string,
          targetLabel: (row.file_name as string) ?? "",
          metadata: {
            type_subtype: typeSubtypeLabel(row.type as string, stObj.name ?? null),
            ...(member ? { member } : {}),
          },
        });
        expired++;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // 2. Status sweep — overdue_review
  //
  // CLE-212 follow-up. Same shift as expired: was "next_review_on =
  // yesterday", now "next_review_on ≤ today, once per verification
  // cycle." Preserves the existing guard that suppresses this event
  // for docs already expired today (expiry supersedes review).
  // ---------------------------------------------------------------------------
  let overdueReview = 0;
  {
    let q = admin
      .from("document")
      .select(
        "id, organisation_id, file_name, type, owner_scope, owner_id, expires_on, document_subtype!subtype_id(name, requires_verification)",
      )
      .lte("next_review_on", today)
      .not("verified_on", "is", null);
    if (opts?.organisationId) q = q.eq("organisation_id", opts.organisationId);
    const { data, error } = await q;
    if (error) {
      errors.push(`status/overdue select: ${error.message}`);
    } else {
      const memMap = await hydrateMembers(
        (data ?? []).map((r) => r.owner_id as string).filter(Boolean),
      );
      for (const row of data ?? []) {
        // Skip rows where expires_on has already fired the expired event today.
        if (row.expires_on !== null && (row.expires_on as string) <= today) continue;
        const st = row.document_subtype as unknown as { name?: string; requires_verification?: boolean } | { name?: string; requires_verification?: boolean }[] | null;
        const stObj = Array.isArray(st) ? (st[0] ?? null) : st;
        if (!stObj?.requires_verification) continue;
        if (await alreadyAuditedThisCycle(admin, row.id as string, "document.review_overdue")) continue;
        const member = row.owner_id ? memMap.get(row.owner_id as string) ?? null : null;
        await logAudit({
          organisationId: row.organisation_id as string,
          actorId: null as unknown as string,
          actorName: "System (nightly sweep)",
          action: "document.review_overdue",
          targetType: row.owner_scope === "organisation" ? "org_document" : "member_document",
          targetId: row.id as string,
          targetLabel: (row.file_name as string) ?? "",
          metadata: {
            type_subtype: typeSubtypeLabel(row.type as string, stObj.name ?? null),
            ...(member ? { member } : {}),
          },
        });
        overdueReview++;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // 3. Disposal sweep — permanent purge past 30-day grace
  // ---------------------------------------------------------------------------
  let purged = 0;
  {
    let q = admin
      .from("disposal_queue")
      .select("id, organisation_id, document_id, queued_at")
      .lte("queued_at", graceCutoff);
    if (opts?.organisationId) q = q.eq("organisation_id", opts.organisationId);
    const { data: queueRows, error: qErr } = await q;
    if (qErr) {
      errors.push(`disposal/queue select: ${qErr.message}`);
    } else {
      for (const q of queueRows ?? []) {
        try {
          const { data: doc } = await admin
            .from("document")
            .select("id, organisation_id, owner_scope, storage_path, file_name, type, document_subtype!subtype_id(name)")
            .eq("id", q.document_id as string)
            .single();

          if (doc) {
            const bucket = doc.owner_scope === "organisation" ? ORG_BUCKET : MEMBER_BUCKET;
            const { error: sErr } = await admin.storage.from(bucket).remove([doc.storage_path as string]);
            if (sErr && !/not.*found|no.*such/i.test(sErr.message)) {
              errors.push(`purge storage ${doc.id}: ${sErr.message}`);
              continue;
            }

            // Write the audit row BEFORE deleting the document. If
            // `audit_log` carries a soft/hard reference to `document.id`
            // (or a trigger reads the row), inserting after the delete
            // silently fails inside logAudit's fire-and-forget catch
            // and the purge event never surfaces on the audit page.
            // Writing first also preserves the trail if the delete
            // itself crashes for any reason.
            const st = doc.document_subtype as unknown as { name?: string } | { name?: string }[] | null;
            const stName = Array.isArray(st) ? (st[0]?.name ?? null) : (st?.name ?? null);
            const auditRes = await logAudit({
              organisationId: doc.organisation_id as string,
              actorId: null as unknown as string,
              actorName: "System (nightly sweep)",
              action: "document.purged",
              targetType: doc.owner_scope === "organisation" ? "org_document" : "member_document",
              targetId: doc.id as string,
              targetLabel: (doc.file_name as string) ?? "",
              metadata: {
                type_subtype: typeSubtypeLabel(doc.type as string, stName),
                queued_at: q.queued_at as string,
              },
            });
            if (!auditRes.success) {
              // Surface the DB error to the sweep's debug dashboard —
              // logAudit only console.errors otherwise, and the audit
              // gap silently loses visibility on the purge.
              errors.push(`purge audit ${doc.id}: ${auditRes.error}`);
              // Keep going — losing an audit row shouldn't stop the
              // purge itself.
            }

            const { error: dErr } = await admin
              .from("document")
              .delete()
              .eq("id", doc.id as string);
            if (dErr) {
              errors.push(`purge document ${doc.id}: ${dErr.message}`);
              continue;
            }
          }

          // Remove the queue row regardless of doc presence (belt-and-braces
          // for rows where the doc was already gone).
          await admin.from("disposal_queue").delete().eq("id", q.id as string);
          purged++;
        } catch (e) {
          errors.push(`purge exception ${q.document_id}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // 4. Capture task timeout sweep — CLE-211. Flip any capture_task
  //    rows whose expires_at has passed while still in 'pending' to
  //    'timeout'. Realtime broadcasts the update so the web dialog
  //    (if still open) surfaces the timeout copy. No audit — timeouts
  //    are noise; if HR wants the row they can look at the queued
  //    audit that fired at creation.
  // ---------------------------------------------------------------------------
  let captureTasksTimedOut = 0;
  {
    const nowIso = new Date().toISOString();
    let q = admin
      .from("capture_task")
      .update({ status: "timeout" })
      .eq("status", "pending")
      .lt("expires_at", nowIso)
      .select("id");
    if (opts?.organisationId) q = q.eq("organisation_id", opts.organisationId);
    const { data, error } = await q;
    if (error) {
      errors.push(`capture_task/timeout: ${error.message}`);
    } else {
      captureTasksTimedOut = (data ?? []).length;
    }
  }

  return { expired, overdueReview, purged, captureTasksTimedOut, errors };
}
