// CLE-227 — Impl-only sibling of `org-document-actions.ts`. Holds
// the body of `listOrgDocuments()` so it can be called from both the
// "use server" action file (via the cookies caller) and the mobile
// API route `/api/mobile/documents/org` (via the bearer caller).
//
// Other exports of `org-document-actions.ts` (CRUD, per-member list,
// visibility toggle) stay in the action file — they aren't wrapped
// by mobile Tier 1.

import type { DocumentsCaller } from "@/lib/documents-caller";
import {
  AUDIENCE_COLUMNS,
  audienceFromRow,
  canSeeOrgDoc,
  isExpectedToAcknowledge,
  loadOrgDocMembers,
  type AudienceDbRow,
  type AudienceMode,
  type OrgDocMember,
} from "@/lib/org-doc-audience";

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
  /** CLE-230 — "all" (Everyone) or "selected". */
  audienceMode: AudienceMode;
  /** CLE-230 — number of members in the audience (who can view org
   *  docs and match it). Only computed for callers who can manage org
   *  docs (drives the admin list's "Visible to" column); null otherwise. */
  audienceCount: number | null;
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

    // CLE-230 — per-document audience. Managers see every doc; everyone
    // else sees docs whose audience includes them. Evaluated against the
    // caller's *effective* rights so View-as-Employee previews correctly.
    const me = {
      id: memberId,
      teamId: caller.teamId,
      rightsProfileId: caller.rights.profileId,
      signedIn: true,
      canView: caller.rights.canViewOrganisationDocuments,
      canManage: caller.rights.canManageOrganisationDocuments,
    };

    const { data, error } = await admin
      .from("document")
      .select(
        "id, file_name, file_size, content_type, type, subtype_id, expires_on, uploaded_by, uploaded_at, " +
        AUDIENCE_COLUMNS +
        ", document_subtype!subtype_id(name, requires_acknowledgement), members!uploaded_by(first_name, last_name)",
      )
      .eq("organisation_id", organisationId)
      .eq("owner_scope", "organisation")
      .order("uploaded_at", { ascending: false });
    if (error) return { success: false, error: error.message, rows: [] };

    type Row = AudienceDbRow & {
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
      .filter((r) => canSeeOrgDoc(audienceFromRow(r), me));

    // CLE-230 — audience size per doc, for the admin list only.
    let orgMembers: OrgDocMember[] = [];
    if (me.canManage && visibleRows.length > 0) {
      orgMembers = await loadOrgDocMembers(admin, organisationId);
    }

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
        audienceMode: audienceFromRow(r).mode,
        audienceCount: me.canManage
          ? orgMembers.filter((m) => isExpectedToAcknowledge(audienceFromRow(r), m)).length
          : null,
      };
    });
    return { success: true, rows };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "An error occurred", rows: [] };
  }
}
