// One rule for "which member documents need attention" (2026-10-25).
//
// The admin dashboard (traffic light), the Compliance page and the
// nightly admin email used to apply three different rules, so their
// counts disagreed. They all read from `computeMemberDocAttention` now.
//
// The rule (decided by Chris):
//   • Every live member document is an item — not queued for disposal,
//     not past its disposal date. Superseded copies still count: an old
//     expired copy stays flagged until an admin deletes it.
//   • Statuses come from `deriveDocumentStatuses` (verification, expiry,
//     review strands — CLE-234).
//   • Expiry (`expired`, `expiring_soon`) only counts for Certificates,
//     RTW evidence and Employment documents (`EXPIRY_COUNTED_TYPES`). An
//     expiry date on an Other document (e.g. a Prescription) is
//     informational and never flags.
//   • RTW evidence documents count individually, including an expired
//     one when another RTW document is still valid.
//   • Missing (`not_uploaded`) items:
//       - a certificate subtype required of the member with no live
//         document of that subtype;
//       - "Right to Work evidence" when the member is not opted out of
//         RTW and has no unexpired RTW document (one placeholder per
//         member, alongside any expired RTW documents).
//
// Plain module (not "use server") — called from server actions, impl
// siblings, mobile routes and the nightly job. Pass a service-role
// client; callers do the access check and choose the member set.

import type { SupabaseClient } from "@supabase/supabase-js";
import { deriveDocumentStatuses, type DocumentStatus } from "@/lib/document-status";
import { isRtwSubtype } from "@/lib/documents-rtw";
import { subtypeHiddenFromMember } from "@/lib/documents-member-visibility";

export type AttentionStatus = DocumentStatus | "not_uploaded";

/** Document kinds whose expiry date counts towards expired / expiring. */
export const EXPIRY_COUNTED_TYPES: ReadonlySet<string> = new Set(["certificate", "evidence", "contract"]);

/** Statuses that need someone to act (the Compliance default filter). */
export const ATTENTION_STATUSES: AttentionStatus[] = [
  "not_uploaded",
  "pending_verification",
  "expired",
  "expiring_soon",
  "overdue_review",
  "review_due_soon",
];

export interface MemberDocAttentionItem {
  /** `doc:{documentId}` | `missing:{memberId}:{subtypeId}` | `rtw:{memberId}` */
  key: string;
  memberId: string;
  documentId: string | null;
  subtypeId: string | null;
  subtypeName: string;
  /** Document kind (`certificate`, `evidence`, `contract`, `attachment`). */
  subtypeType: string;
  retentionClass: string;
  fileName: string | null;
  uploadedAt: string | null;
  verifiedOn: string | null;
  expiresOn: string | null;
  nextReviewOn: string | null;
  statuses: AttentionStatus[];
  /** Required of the member: a required certificate subtype, or RTW
   *  evidence for a member who isn't opted out. Drives the traffic
   *  light's green count. */
  required: boolean;
  /** HR-only Employment document (hidden from its owner). */
  hiddenFromOwner: boolean;
}

export interface AttentionMember {
  id: string;
  rtw_not_required: boolean | null;
}

interface SubtypeRow {
  id: string;
  type: string;
  name: string;
  retention_class: string;
  requires_verification: boolean;
  visible_to_member: boolean | null;
}

interface DocRow {
  id: string;
  owner_id: string;
  subtype_id: string | null;
  type: string;
  file_name: string;
  uploaded_at: string;
  expires_on: string | null;
  next_review_on: string | null;
  verified_on: string | null;
  disposal_date: string | null;
}

const CHUNK = 200;

async function selectPaged<T>(
  build: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const page = 1000;
  const out: T[] = [];
  for (let from = 0; ; from += page) {
    const { data, error } = await build(from, from + page - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < page) break;
  }
  return out;
}

/**
 * Attention items for each member, keyed by member id. Every member in
 * `members` gets an entry (possibly empty). Items carry every status
 * that applies, including `verified`; filter with `ATTENTION_STATUSES`
 * for "needs action" views.
 */
export async function computeMemberDocAttention(
  admin: SupabaseClient,
  organisationId: string,
  members: AttentionMember[],
  opts?: { today?: string },
): Promise<Map<string, MemberDocAttentionItem[]>> {
  const today = opts?.today ?? new Date().toISOString().slice(0, 10);
  const out = new Map<string, MemberDocAttentionItem[]>();
  for (const m of members) out.set(m.id, []);
  if (members.length === 0) return out;
  const memberIds = members.map((m) => m.id);

  const { data: subtypeRows, error: stErr } = await admin
    .from("document_subtype")
    .select("id, type, name, retention_class, requires_verification, visible_to_member")
    .eq("organisation_id", organisationId);
  if (stErr) throw new Error(stErr.message);
  const subtypes = (subtypeRows ?? []) as SubtypeRow[];
  const subtypeById = new Map(subtypes.map((s) => [s.id, s]));
  const rtwSubtypeIds = new Set(subtypes.filter((s) => isRtwSubtype(s)).map((s) => s.id));

  // Docs + expectations, chunked by member so `.in()` stays small.
  const docs: DocRow[] = [];
  const expected: Array<{ member_id: string; subtype_id: string }> = [];
  for (let i = 0; i < memberIds.length; i += CHUNK) {
    const ids = memberIds.slice(i, i + CHUNK);
    docs.push(
      ...(await selectPaged<DocRow>((a, b) =>
        admin
          .from("document")
          .select("id, owner_id, subtype_id, type, file_name, uploaded_at, expires_on, next_review_on, verified_on, disposal_date")
          .eq("organisation_id", organisationId)
          .eq("owner_scope", "member")
          .in("owner_id", ids)
          .order("id")
          .range(a, b),
      )),
    );
    expected.push(
      ...(await selectPaged<{ member_id: string; subtype_id: string }>((a, b) =>
        admin
          .from("member_expected_document")
          .select("member_id, subtype_id")
          .eq("organisation_id", organisationId)
          .in("member_id", ids)
          .order("member_id")
          .range(a, b),
      )),
    );
  }

  const queued = new Set(
    (
      await selectPaged<{ document_id: string }>((a, b) =>
        admin.from("disposal_queue").select("document_id").eq("organisation_id", organisationId).order("document_id").range(a, b),
      )
    ).map((r) => r.document_id),
  );
  const live = docs.filter((d) => !queued.has(d.id) && (d.disposal_date === null || d.disposal_date > today));

  const expectedByMember = new Map<string, Set<string>>();
  for (const r of expected) {
    const s = expectedByMember.get(r.member_id) ?? new Set<string>();
    s.add(r.subtype_id);
    expectedByMember.set(r.member_id, s);
  }
  const rtwOptedOut = new Map(members.map((m) => [m.id, m.rtw_not_required === true]));

  // Document items.
  for (const d of live) {
    const list = out.get(d.owner_id);
    if (!list) continue;
    const st = d.subtype_id ? subtypeById.get(d.subtype_id) : undefined;
    const kind = st?.type ?? d.type;
    let statuses: AttentionStatus[] = deriveDocumentStatuses({
      requiresVerification: st?.requires_verification === true,
      verifiedOn: d.verified_on,
      expiresOn: d.expires_on,
      nextReviewOn: d.next_review_on,
      today,
    });
    if (!EXPIRY_COUNTED_TYPES.has(kind)) {
      statuses = statuses.filter((s) => s !== "expired" && s !== "expiring_soon");
    }
    const isRtw = !!d.subtype_id && rtwSubtypeIds.has(d.subtype_id);
    list.push({
      key: `doc:${d.id}`,
      memberId: d.owner_id,
      documentId: d.id,
      subtypeId: d.subtype_id,
      subtypeName: st?.name ?? "—",
      subtypeType: kind,
      retentionClass: st?.retention_class ?? "other",
      fileName: d.file_name,
      uploadedAt: d.uploaded_at,
      verifiedOn: d.verified_on,
      expiresOn: d.expires_on,
      nextReviewOn: d.next_review_on,
      statuses,
      required:
        (isRtw && !rtwOptedOut.get(d.owner_id)) ||
        (!!d.subtype_id && (expectedByMember.get(d.owner_id)?.has(d.subtype_id) ?? false)),
      hiddenFromOwner: st ? subtypeHiddenFromMember({ visible_to_member: st.visible_to_member ?? true }) : false,
    });
  }

  // Missing items.
  for (const m of members) {
    const list = out.get(m.id)!;
    for (const subtypeId of expectedByMember.get(m.id) ?? []) {
      const s = subtypeById.get(subtypeId);
      if (!s || isRtwSubtype(s)) continue;
      if (live.some((d) => d.owner_id === m.id && d.subtype_id === subtypeId)) continue;
      list.push(missingItem(m.id, `missing:${m.id}:${s.id}`, s.id, s.name, s.type, s.retention_class));
    }
    if (!rtwOptedOut.get(m.id) && rtwSubtypeIds.size > 0) {
      const hasValidRtw = live.some(
        (d) =>
          d.owner_id === m.id &&
          !!d.subtype_id &&
          rtwSubtypeIds.has(d.subtype_id) &&
          (d.expires_on === null || d.expires_on > today),
      );
      if (!hasValidRtw) {
        list.push(missingItem(m.id, `rtw:${m.id}`, null, "Right to Work evidence", "evidence", "right_to_work"));
      }
    }
  }

  return out;
}

function missingItem(
  memberId: string,
  key: string,
  subtypeId: string | null,
  subtypeName: string,
  subtypeType: string,
  retentionClass: string,
): MemberDocAttentionItem {
  return {
    key,
    memberId,
    documentId: null,
    subtypeId,
    subtypeName,
    subtypeType,
    retentionClass,
    fileName: null,
    uploadedAt: null,
    verifiedOn: null,
    expiresOn: null,
    nextReviewOn: null,
    statuses: ["not_uploaded"],
    required: true,
    hiddenFromOwner: false,
  };
}

/** True when the item has at least one status that needs action. */
export function needsAttention(item: MemberDocAttentionItem): boolean {
  return item.statuses.some((s) => ATTENTION_STATUSES.includes(s));
}
