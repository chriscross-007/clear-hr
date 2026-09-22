// CLE-227 — Impl-only sibling of `org-document-actions.ts`. Holds
// the body of `listOrgDocuments()` so it can be called from both the
// "use server" action file (via the cookies caller) and the mobile
// API route `/api/mobile/documents/org` (via the bearer caller).
//
// Other exports of `org-document-actions.ts` (CRUD, per-member list,
// visibility toggle) stay in the action file — they aren't wrapped
// by mobile Tier 1.

import type { DocumentsCaller } from "@/lib/documents-caller";

export interface OrgDocumentRow {
  id: string;
  fileName: string;
  fileSize: number;
  contentType: string;
  type: string;
  subtypeId: string | null;
  subtypeName: string | null;
  expiresOn: string | null;
  uploadedBy: string;
  uploadedAt: string;
  requiresAcknowledgement: boolean;
  isAcknowledged: boolean;
}

export async function _listOrgDocuments(
  caller: DocumentsCaller,
): Promise<{ success: boolean; error?: string; rows: OrgDocumentRow[] }> {
  try {
    if (!caller.rights.canViewOrganisationDocuments) {
      return { success: false, error: "Forbidden", rows: [] };
    }
    const { admin, memberId, organisationId } = caller;

    const { data: queued } = await admin
      .from("disposal_queue")
      .select("document_id")
      .eq("organisation_id", organisationId);
    const queuedIds = new Set<string>(
      ((queued ?? []) as { document_id: string }[]).map((r) => r.document_id),
    );

    // CLE-225 — Docs explicitly hidden from this caller drop out of
    // the visible set. Admins who've been hidden a doc don't see it
    // here either; per-member surfaces still expose the Viewable
    // state explicitly.
    const { data: hiddenRows } = await admin
      .from("member_org_document_hidden")
      .select("document_id")
      .eq("member_id", memberId);
    const hiddenIds = new Set<string>(
      ((hiddenRows ?? []) as { document_id: string }[]).map((r) => r.document_id),
    );

    const { data, error } = await admin
      .from("document")
      .select(
        "id, file_name, file_size, content_type, type, subtype_id, expires_on, uploaded_by, uploaded_at, document_subtype!subtype_id(name, requires_acknowledgement), members!uploaded_by(first_name, last_name)",
      )
      .eq("organisation_id", organisationId)
      .eq("owner_scope", "organisation")
      .order("uploaded_at", { ascending: false });
    if (error) return { success: false, error: error.message, rows: [] };

    type Row = {
      id: string;
      file_name: string;
      file_size: number;
      content_type: string;
      type: string;
      subtype_id: string | null;
      expires_on: string | null;
      uploaded_by: string | null;
      uploaded_at: string;
      document_subtype:
        | { name: string; requires_acknowledgement?: boolean }
        | { name: string; requires_acknowledgement?: boolean }[]
        | null;
      members: { first_name: string; last_name: string } | { first_name: string; last_name: string }[] | null;
    };
    const visibleRows = (data ?? [])
      .map((r) => r as unknown as Row)
      .filter((r) => !queuedIds.has(r.id))
      .filter((r) => !hiddenIds.has(r.id));

    const ackedSet = new Set<string>();
    if (visibleRows.length > 0) {
      const { data: acks } = await admin
        .from("document_acknowledgement")
        .select("document_id")
        .eq("member_id", memberId)
        .is("superseded_by_replace_at", null)
        .in("document_id", visibleRows.map((r) => r.id));
      for (const a of ((acks ?? []) as { document_id: string }[])) {
        ackedSet.add(a.document_id);
      }
    }

    const rows: OrgDocumentRow[] = visibleRows.map((r) => {
      const st = r.document_subtype;
      const stObj = Array.isArray(st) ? (st[0] ?? null) : st;
      const mem = r.members;
      const memPair = Array.isArray(mem) ? (mem[0] ?? null) : mem;
      return {
        id: r.id,
        fileName: r.file_name,
        fileSize: r.file_size,
        contentType: r.content_type,
        type: r.type,
        subtypeId: r.subtype_id,
        subtypeName: stObj?.name ?? null,
        expiresOn: r.expires_on,
        uploadedBy: `${memPair?.first_name ?? ""} ${memPair?.last_name ?? ""}`.trim() || "Unknown",
        uploadedAt: r.uploaded_at,
        requiresAcknowledgement: stObj?.requires_acknowledgement === true,
        isAcknowledged: ackedSet.has(r.id),
      };
    });
    return { success: true, rows };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "An error occurred", rows: [] };
  }
}
