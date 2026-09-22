// CLE-227 — Impl-only sibling of `actions.ts` for the /my-documents
// domain. Non-`"use server"` on purpose: exports here are regular
// module functions, not Server Actions, so they can be called from
// BOTH the "use server" action file (via the cookies caller) and the
// mobile API routes (via the bearer caller) without either path
// exposing an unauthenticated Server Action to the client.
//
// The exported `_getMyOtherMemberDocuments(caller)` is the moved body
// of `getMyOtherMemberDocuments()` from `actions.ts`. Auth prelude
// (reading cookies, resolving user + ctx) stays in `actions.ts`; this
// file starts from the fully-resolved `DocumentsCaller`.

import { deriveDocumentStatuses, type DocumentStatus } from "@/lib/document-status";
import type { DocumentsCaller } from "@/lib/documents-caller";

// Re-export the DTO shape from the actions file so callers only need
// one import point. `actions.ts` re-exports the type verbatim.
export interface OtherMemberDocumentRow {
  documentId: string;
  subtypeId: string;
  subtypeName: string;
  subtypeType: string;
  fileName: string;
  fileSize: number;
  uploadedAt: string;
  statuses: DocumentStatus[];
  expiresOn: string | null;
  verifiedOn: string | null;
  requiresAcknowledgement: boolean;
  isAcknowledged: boolean;
}

export async function _getMyOtherMemberDocuments(
  caller: DocumentsCaller,
): Promise<
  { success: true; rows: OtherMemberDocumentRow[] } | { success: false; error: string }
> {
  try {
    const { admin, memberId, organisationId } = caller;

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
      .eq("organisation_id", organisationId)
      .eq("owner_scope", "member")
      .eq("owner_id", memberId)
      .order("uploaded_at", { ascending: false });
    if (dErr) return { success: false, error: dErr.message };

    const today = new Date().toISOString().slice(0, 10);
    const { data: queuedRows } = await admin
      .from("disposal_queue")
      .select("document_id")
      .eq("organisation_id", organisationId);
    const queued = new Set<string>(((queuedRows ?? []) as { document_id: string }[]).map((r) => r.document_id));

    const activeDocs = ((docRows ?? []) as unknown as DocRow[])
      .filter((d) => !queued.has(d.id))
      .filter((d) => d.disposal_date === null || d.disposal_date > today)
      .filter((d) => d.subtype_id !== null);

    if (activeDocs.length === 0) return { success: true, rows: [] };

    const { data: expectedRows } = await admin
      .from("member_expected_document")
      .select("subtype_id")
      .eq("member_id", memberId)
      .eq("organisation_id", organisationId);
    const expectedSubtypeIds = new Set<string>(
      ((expectedRows ?? []) as { subtype_id: string }[]).map((r) => r.subtype_id),
    );

    const filtered = activeDocs.filter((d) => {
      const st = Array.isArray(d.document_subtype) ? (d.document_subtype[0] ?? null) : d.document_subtype;
      if (!st) return false;
      if (st.type === "evidence") return false;
      if (st.trackable_per_member && expectedSubtypeIds.has(st.id)) return false;
      return true;
    });

    if (filtered.length === 0) return { success: true, rows: [] };

    const docIds = filtered.map((d) => d.id);
    const { data: ackRows } = await admin
      .from("document_acknowledgement")
      .select("document_id")
      .eq("member_id", memberId)
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

    rows.sort((a, b) => (a.uploadedAt < b.uploadedAt ? 1 : -1));
    return { success: true, rows };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "An error occurred" };
  }
}
