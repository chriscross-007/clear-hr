// CLE-209 — Documents nightly sweep.
//
// Two responsibilities:
//   1. Status sweep — write `document.expired` / `document.review_overdue`
//      audit rows for any doc whose derived status flipped since the
//      last sweep. Stateless: fires on the exact day of transition
//      (expires_on = yesterday, or next_review_on = yesterday). A
//      missed run means missing audit rows for that day but the
//      derived status on the row itself is unaffected.
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
  errors: string[];
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function yesterdayIso(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
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
  const yesterday = (() => {
    const d = new Date(today + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
  })();
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
  // ---------------------------------------------------------------------------
  let expired = 0;
  {
    let q = admin
      .from("document")
      .select(
        "id, organisation_id, file_name, type, owner_scope, owner_id, document_subtype!subtype_id(name, requires_verification)",
      )
      .eq("expires_on", yesterday)
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
  // ---------------------------------------------------------------------------
  let overdueReview = 0;
  {
    let q = admin
      .from("document")
      .select(
        "id, organisation_id, file_name, type, owner_scope, owner_id, expires_on, document_subtype!subtype_id(name, requires_verification)",
      )
      .eq("next_review_on", yesterday)
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

            const { error: dErr } = await admin
              .from("document")
              .delete()
              .eq("id", doc.id as string);
            if (dErr) {
              errors.push(`purge document ${doc.id}: ${dErr.message}`);
              continue;
            }

            const st = doc.document_subtype as unknown as { name?: string } | { name?: string }[] | null;
            const stName = Array.isArray(st) ? (st[0]?.name ?? null) : (st?.name ?? null);
            await logAudit({
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

  return { expired, overdueReview, purged, errors };
}
