"use server";

// CLE-221 — Server action powering the "My other documents" card on
// the /my-documents "My Documents" tab. This is the lightweight
// sibling of `getMemberRequiredDocumentRows`: it returns every
// member-scope document the caller owns that is NOT already surfaced
// by the required-docs card, so the caller can see (but not add to)
// the tail of ad-hoc uploads HR has stored against them (e.g. a
// once-off contract amendment, a legacy pension form, a training
// certificate that isn't required-per-member).
//
// Inclusion rule — a caller-owned, non-deleted `document` row lands
// here when both hold:
//   * subtype.type != 'evidence'   — RTW evidence is expressed as its
//                                    own row (or the aggregate
//                                    placeholder) on the required
//                                    card. Excluding it here avoids
//                                    double-appearance.
//   * subtype.trackable_per_member = false, OR the caller has no
//                                    `member_expected_document` row
//                                    for that subtype. Either branch
//                                    means the required card does
//                                    NOT surface this subtype for the
//                                    caller today.
//
// Deletion state mirrors `listMemberDocuments` — rows in
// `disposal_queue` and rows past their `disposal_date` are excluded.
//
// Batched ack read: single `document_acknowledgement` query keyed on
// the caller's memberId + doc-ids, `superseded_by_replace_at IS NULL`
// filter — same idiom the required-docs action uses. Same shape the
// dashboard ack chip relies on, so the two agree without a special
// case.

import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { getEffectiveRightsForUser } from "@/lib/rights-resolver";
import { deriveDocumentStatuses, type DocumentStatus } from "@/lib/document-status";

function getAdmin() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

export interface OtherMemberDocumentRow {
  documentId: string;
  subtypeId: string;
  subtypeName: string;
  subtypeType: string;
  fileName: string;
  /** CLE-221 follow-up — bytes. Rendered as "(12 KB)" alongside the
   *  file name in the Subtype cell, matching My Documents + Org Docs
   *  for column-1 consistency. */
  fileSize: number;
  uploadedAt: string;
  statuses: DocumentStatus[];
  expiresOn: string | null;
  verifiedOn: string | null;
  requiresAcknowledgement: boolean;
  isAcknowledged: boolean;
}

export async function getMyOtherMemberDocuments(): Promise<
  { success: true; rows: OtherMemberDocumentRow[] } | { success: false; error: string }
> {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: "Not authenticated" };
    const resolved = await getEffectiveRightsForUser(user.id);
    if (!resolved) return { success: false, error: "Not authenticated" };
    const { ctx } = resolved;
    const admin = getAdmin();

    // Every member-scope, non-deleted doc owned by the caller. `disposal_queue`
    // is a soft-FK — we exclude by id set below rather than a PostgREST join.
    // Cast is the standard idiom used throughout document-actions.ts: the FK
    // hint returns either a scalar or a single-element array depending on the
    // planner, so we widen at read-time and pick a single object out.
    type DocRow = {
      id: string;
      subtype_id: string | null;
      file_name: string;
      file_size: number;
      uploaded_at: string;
      expires_on: string | null;
      verified_on: string | null;
      disposal_date: string | null;
      document_subtype:
        | { id: string; name: string; type: string; trackable_per_member: boolean; requires_verification: boolean; requires_acknowledgement: boolean }
        | { id: string; name: string; type: string; trackable_per_member: boolean; requires_verification: boolean; requires_acknowledgement: boolean }[]
        | null;
    };
    const { data: docRows, error: dErr } = await admin
      .from("document")
      .select(
        "id, subtype_id, file_name, file_size, uploaded_at, expires_on, verified_on, disposal_date, " +
        "document_subtype!subtype_id(id, name, type, trackable_per_member, requires_verification, requires_acknowledgement)",
      )
      .eq("organisation_id", ctx.organisationId)
      .eq("owner_scope", "member")
      .eq("owner_id", ctx.memberId)
      .order("uploaded_at", { ascending: false });
    if (dErr) return { success: false, error: dErr.message };

    const today = new Date().toISOString().slice(0, 10);
    const { data: queuedRows } = await admin
      .from("disposal_queue")
      .select("document_id")
      .eq("organisation_id", ctx.organisationId);
    const queued = new Set<string>(((queuedRows ?? []) as { document_id: string }[]).map((r) => r.document_id));

    const activeDocs = ((docRows ?? []) as unknown as DocRow[])
      .filter((d) => !queued.has(d.id))
      .filter((d) => d.disposal_date === null || d.disposal_date > today)
      .filter((d) => d.subtype_id !== null);

    if (activeDocs.length === 0) return { success: true, rows: [] };

    // Caller's per-member expected subtypes — used to exclude rows the
    // required-docs card already renders. RTW-class docs are excluded via the
    // `type = 'evidence'` filter below rather than this set (RTW subtypes are
    // never assigned via `member_expected_document`).
    const { data: expectedRows } = await admin
      .from("member_expected_document")
      .select("subtype_id")
      .eq("member_id", ctx.memberId)
      .eq("organisation_id", ctx.organisationId);
    const expectedSubtypeIds = new Set<string>(
      ((expectedRows ?? []) as { subtype_id: string }[]).map((r) => r.subtype_id),
    );

    // Filter down to docs that the required card does NOT surface.
    const filtered = activeDocs.filter((d) => {
      const st = Array.isArray(d.document_subtype) ? (d.document_subtype[0] ?? null) : d.document_subtype;
      if (!st) return false;
      // RTW evidence is surfaced by the required card's own RTW rows —
      // never double-appear here.
      if (st.type === "evidence") return false;
      // Trackable-per-member AND explicitly assigned to the caller ⇒ the
      // required card owns the row. Everything else lands here.
      if (st.trackable_per_member && expectedSubtypeIds.has(st.id)) return false;
      return true;
    });

    if (filtered.length === 0) return { success: true, rows: [] };

    // Batched ack lookup: one query for every doc-id we're about to return.
    const docIds = filtered.map((d) => d.id);
    const { data: ackRows } = await admin
      .from("document_acknowledgement")
      .select("document_id")
      .eq("member_id", ctx.memberId)
      .is("superseded_by_replace_at", null)
      .in("document_id", docIds);
    const ackedIds = new Set<string>(((ackRows ?? []) as { document_id: string }[]).map((r) => r.document_id));

    const rows: OtherMemberDocumentRow[] = filtered.map((d) => {
      const st = Array.isArray(d.document_subtype) ? (d.document_subtype[0] ?? null) : d.document_subtype;
      const requiresVerification = st?.requires_verification === true;
      const requiresAcknowledgement = st?.requires_acknowledgement === true;
      return {
        documentId: d.id,
        subtypeId: st?.id ?? "",
        subtypeName: st?.name ?? "—",
        subtypeType: st?.type ?? "attachment",
        fileName: d.file_name,
        fileSize: d.file_size,
        uploadedAt: d.uploaded_at,
        statuses: deriveDocumentStatuses({
          requiresVerification,
          verifiedOn: d.verified_on,
          expiresOn: d.expires_on,
          nextReviewOn: null,
        }),
        expiresOn: d.expires_on,
        verifiedOn: d.verified_on,
        requiresAcknowledgement,
        isAcknowledged: ackedIds.has(d.id),
      };
    });

    // uploaded_at DESC is already ordered by the query — keep it explicit
    // in case the PostgREST plan ever changes.
    rows.sort((a, b) => (a.uploadedAt < b.uploadedAt ? 1 : -1));
    return { success: true, rows };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "An error occurred" };
  }
}
