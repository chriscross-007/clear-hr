"use server";

// CLE-206 — Per-Member Documents server actions against the
// `document` table. Every mutation is audited. RLS on the `document`
// table enforces tenant scope + cross-user access; each action layers
// its own explicit permission check on top (target-scope tab-matrix
// documents.update for writes; can_force_delete_documents for the
// retention override; documents.update for per-member trash).

import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { getEffectiveRightsForUser } from "@/lib/rights-resolver";
import { logAudit } from "@/lib/audit";
import {
  ALLOWED_CONTENT_TYPES,
  MAX_DOCUMENT_SIZE,
  STORAGE_BUCKET,
  type MemberDocumentRow,
  type TrashedMemberDocumentRow,
} from "./document-types";
import { deriveDocumentStatuses, type DocumentStatus } from "@/lib/document-status";
import { buildDocumentsCallerFromCookies } from "@/lib/documents-caller";
import {
  _getDocumentDetail,
  _getMemberDocumentSignedUrl,
  _uploadMemberDocument,
  _getMemberRequiredDocumentRows,
} from "./document-actions-impl";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getAdmin() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

type CallerCtx = {
  userId: string;
  memberId: string;
  organisationId: string;
  crossUserAccess: "self" | "team" | "all";
  isSelf: (targetMemberId: string) => boolean;
  canViewTarget: (target: { memberId: string; teamId: string | null }) => boolean;
  canUpdateTarget: (target: { memberId: string; teamId: string | null }) => boolean;
  canManageDeleted: boolean;
  canForceDelete: boolean;
  /** CLE-219 — Org-doc view flag. Some read paths (getDocumentDetail,
   *  getMemberDocumentSignedUrl) accept both member and org-scope
   *  docs; org-scope docs check this instead of `canViewTarget`. */
  canViewOrgDocs: boolean;
};

async function resolveCaller(): Promise<CallerCtx | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const resolved = await getEffectiveRightsForUser(user.id);
  if (!resolved) return null;
  const { rights, ctx } = resolved;

  return {
    userId: user.id,
    memberId: ctx.memberId,
    organisationId: ctx.organisationId,
    crossUserAccess: rights.crossUserAccess,
    isSelf: (tid) => tid === ctx.memberId,
    canViewTarget: (target) => {
      if (target.memberId === ctx.memberId) return true;
      if (rights.crossUserAccess === "all") return rights.tabs.documents?.view === true;
      if (rights.crossUserAccess === "team")
        return target.teamId !== null && target.teamId === ctx.teamId
          && rights.tabs.documents?.view === true;
      return false;
    },
    canUpdateTarget: (target) => {
      if (target.memberId === ctx.memberId) return rights.tabs.documents?.update === true;
      if (rights.crossUserAccess === "all") return rights.tabs.documents?.update === true;
      if (rights.crossUserAccess === "team")
        return target.teamId !== null && target.teamId === ctx.teamId
          && rights.tabs.documents?.update === true;
      return false;
    },
    // Per-member Trash is gated by documents.update on the target
    // scope — anyone with write access can delete + restore. Cheapest
    // proxy for the check is the caller's own documents.update, which
    // downstream trash actions still cross-check per target member.
    canManageDeleted: rights.tabs.documents?.update === true,
    canForceDelete: rights.canForceDeleteDocuments,
    canViewOrgDocs: rights.canViewOrganisationDocuments,
  };
}

async function getTarget(admin: ReturnType<typeof getAdmin>, memberId: string, organisationId: string) {
  const { data } = await admin
    .from("members")
    .select("id, team_id, first_name, last_name")
    .eq("id", memberId)
    .eq("organisation_id", organisationId)
    .single();
  return data as { id: string; team_id: string | null; first_name: string; last_name: string } | null;
}

async function callerName(admin: ReturnType<typeof getAdmin>, callerMemberId: string): Promise<string> {
  const { data } = await admin
    .from("members")
    .select("first_name, last_name")
    .eq("id", callerMemberId)
    .single();
  return `${data?.first_name ?? ""} ${data?.last_name ?? ""}`.trim() || "Unknown";
}

// Retention classes that block delete on active members without the
// force-delete flag.
const PROTECTED_RETENTION_CLASSES = new Set(["right_to_work", "contract", "payroll"]);

const TYPE_DISPLAY: Record<string, string> = {
  contract: "Contract",
  certificate: "Certificate",
  evidence: "RTW Evidence",
  attachment: "Attachment",
  organisation_document: "Organisation document",
};

function typeSubtypeLabel(type: string, subtypeName: string | null): string {
  const typeLabel = TYPE_DISPLAY[type] ?? type;
  return subtypeName ? `${typeLabel} / ${subtypeName}` : typeLabel;
}

function memberDisplay(target: { first_name: string; last_name: string }): string {
  return `${target.first_name ?? ""} ${target.last_name ?? ""}`.trim() || "Unknown";
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

export async function listMemberDocuments(
  memberId: string,
): Promise<{ success: boolean; error?: string; rows: MemberDocumentRow[] }> {
  try {
    const caller = await resolveCaller();
    if (!caller) return { success: false, error: "Not authenticated", rows: [] };
    const admin = getAdmin();
    const target = await getTarget(admin, memberId, caller.organisationId);
    if (!target) return { success: false, error: "Document not found", rows: [] }; // F8 — never 403

    if (!caller.canViewTarget({ memberId: target.id, teamId: target.team_id })) {
      return { success: false, error: "Document not found", rows: [] };
    }

    const today = new Date().toISOString().slice(0, 10);
    // Exclude queued rows via NOT EXISTS on disposal_queue.
    const { data: queued } = await admin
      .from("disposal_queue")
      .select("document_id")
      .eq("organisation_id", caller.organisationId);
    const queuedIds = new Set<string>((queued ?? []).map((r) => r.document_id as string));

    const { data, error } = await admin
      .from("document")
      .select(
        "id, file_name, file_size, content_type, type, subtype_id, expires_on, retention_class, disposal_date, uploaded_by, uploaded_at, verified_on, verified_by, next_review_on, capture_source, document_subtype!subtype_id(name, requires_verification), members!uploaded_by(first_name, last_name)",
      )
      .eq("organisation_id", caller.organisationId)
      .eq("owner_scope", "member")
      .eq("owner_id", memberId)
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
      retention_class: string;
      disposal_date: string | null;
      uploaded_by: string | null;
      uploaded_at: string;
      verified_on: string | null;
      verified_by: string | null;
      next_review_on: string | null;
      capture_source: "upload" | "photo";
      document_subtype: { name: string; requires_verification: boolean } | { name: string; requires_verification: boolean }[] | null;
      members: { first_name: string; last_name: string } | { first_name: string; last_name: string }[] | null;
    };
    const rows: MemberDocumentRow[] = (data ?? [])
      .map((r) => r as unknown as Row)
      .filter((r) => !queuedIds.has(r.id))
      .filter((r) => r.disposal_date === null || r.disposal_date > today)
      .map((row) => {
        const st = row.document_subtype;
        const stObj = Array.isArray(st) ? (st[0] ?? null) : st;
        const mem = row.members;
        const memPair = Array.isArray(mem) ? (mem[0] ?? null) : mem;
        const uploader = `${memPair?.first_name ?? ""} ${memPair?.last_name ?? ""}`.trim() || "Unknown";
        const requiresVerification = stObj?.requires_verification === true;
        return {
          id: row.id,
          fileName: row.file_name,
          fileSize: row.file_size,
          contentType: row.content_type,
          type: row.type,
          subtypeId: row.subtype_id,
          subtypeName: stObj?.name ?? null,
          requiresVerification,
          verifiedOn: row.verified_on,
          verifiedBy: row.verified_by,
          nextReviewOn: row.next_review_on,
          expiresOn: row.expires_on,
          retentionClass: row.retention_class,
          disposalDate: row.disposal_date,
          uploadedBy: uploader,
          uploadedAt: row.uploaded_at,
          statuses: deriveDocumentStatuses({
            requiresVerification,
            verifiedOn: row.verified_on,
            expiresOn: row.expires_on,
            nextReviewOn: row.next_review_on,
          }),
          captureSource: row.capture_source ?? "upload",
        };
      });
    return { success: true, rows };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "An error occurred", rows: [] };
  }
}

// ---------------------------------------------------------------------------
// Single-document detail fetch — used by the Document Details dialog
// (§7b.13) so both the per-member grid and the Compliance dashboard
// route through the same action rather than each shape-shifting their
// list rows.
// ---------------------------------------------------------------------------

export interface DocumentDetailContext {
  row: MemberDocumentRow;
  targetMemberId: string;
  targetMemberName: string;
  uploadedByName: string | null;
  verifiedByName: string | null;
  verificationNotes: string | null;
  isSelf: boolean;
}

export async function getDocumentDetail(
  documentId: string,
): Promise<{ success: true; detail: DocumentDetailContext } | { success: false; error: string }> {
  // CLE-227 — thin cookies-auth passthrough over `_getDocumentDetail`.
  // Impl body lives in `./document-actions-impl` and is shared with
  // the mobile API-route wrapper at /api/mobile/documents/{id}.
  const caller = await buildDocumentsCallerFromCookies();
  if (!caller) return { success: false, error: "Not authenticated" };
  return _getDocumentDetail(caller, documentId);
}

// ---------------------------------------------------------------------------
// Audit history for a single document — powers §7b.13 History section.
// ---------------------------------------------------------------------------

export interface DocumentAuditEntry {
  id: string;
  actorName: string;
  action: string;
  createdAt: string;
  metadata: Record<string, unknown> | null;
  changes: Record<string, unknown> | null;
}

export async function getDocumentAuditHistory(
  documentId: string,
): Promise<{ success: true; entries: DocumentAuditEntry[] } | { success: false; error: string }> {
  try {
    const caller = await resolveCaller();
    if (!caller) return { success: false, error: "Not authenticated" };
    const admin = getAdmin();

    // Confirm the caller can see this doc before returning its history.
    const detail = await getDocumentDetail(documentId);
    if (!detail.success) return { success: false, error: detail.error };

    const { data, error } = await admin
      .from("audit_log")
      .select("id, actor_name, action, created_at, metadata, changes")
      .eq("target_id", documentId)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) return { success: false, error: error.message };

    const entries: DocumentAuditEntry[] = (data ?? []).map((r) => ({
      id: r.id as string,
      actorName: (r.actor_name as string | null) ?? "System",
      action: r.action as string,
      createdAt: r.created_at as string,
      metadata: (r.metadata as Record<string, unknown> | null) ?? null,
      changes: (r.changes as Record<string, unknown> | null) ?? null,
    }));
    return { success: true, entries };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "An error occurred" };
  }
}

// ---------------------------------------------------------------------------
// Document Activity — CLE-212. Comments live in the same
// `conversations` / `conversation_messages` tables the Absence Bookings
// thread uses, keyed by (entity_type='document', entity_id=documentId).
// The dialog's Activity section calls getDocumentActivity() to get a
// merged, chronologically sorted feed of audit events + comments.
// ---------------------------------------------------------------------------

export interface DocumentComment {
  id: string;
  authorMemberId: string;
  authorName: string;
  body: string;
  createdAt: string;
}

export type DocumentActivityItem =
  | { kind: "audit"; entry: DocumentAuditEntry }
  | { kind: "comment"; comment: DocumentComment };

/** Lookup (or lazily create) the conversation row for a document. Only
 *  callers with view rights on the document get an id back. Called by
 *  the dialog on first mount + before every comment post. */
export async function getOrCreateDocumentConversation(
  documentId: string,
): Promise<{ success: true; conversationId: string } | { success: false; error: string }> {
  try {
    const caller = await resolveCaller();
    if (!caller) return { success: false, error: "Not authenticated" };
    const admin = getAdmin();

    // View-rights check via getDocumentDetail (already does org-scope +
    // cross-user-access + owner-scope validation).
    const detail = await getDocumentDetail(documentId);
    if (!detail.success) return { success: false, error: detail.error };

    const { data: existing } = await admin
      .from("conversations")
      .select("id")
      .eq("entity_type", "document")
      .eq("entity_id", documentId)
      .maybeSingle();
    if (existing) return { success: true, conversationId: existing.id as string };

    const { data: created, error: insertError } = await admin
      .from("conversations")
      .insert({
        organisation_id: caller.organisationId,
        entity_type: "document",
        entity_id: documentId,
      })
      .select("id")
      .single();
    if (insertError || !created) {
      return { success: false, error: insertError?.message ?? "Could not open conversation" };
    }
    return { success: true, conversationId: created.id as string };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "An error occurred" };
  }
}

/** Post a comment on the document's Activity thread. Author = caller.
 *  Immutable once posted (no edit/delete server actions). */
export async function postDocumentComment(
  documentId: string,
  body: string,
): Promise<{ success: true; comment: DocumentComment } | { success: false; error: string }> {
  try {
    const trimmed = (body ?? "").trim();
    if (!trimmed) return { success: false, error: "Comment cannot be empty" };
    if (trimmed.length > 2000) return { success: false, error: "Comment is too long (max 2000 chars)" };

    const caller = await resolveCaller();
    if (!caller) return { success: false, error: "Not authenticated" };
    const admin = getAdmin();

    // Reuse the view-check + conversation resolver.
    const convRes = await getOrCreateDocumentConversation(documentId);
    if (!convRes.success) return { success: false, error: convRes.error };

    const { data: inserted, error: insertError } = await admin
      .from("conversation_messages")
      .insert({
        conversation_id: convRes.conversationId,
        author_member_id: caller.memberId,
        body: trimmed,
      })
      .select("id, body, created_at, author_member_id")
      .single();
    if (insertError || !inserted) {
      return { success: false, error: insertError?.message ?? "Could not post comment" };
    }

    const { data: author } = await admin
      .from("members")
      .select("first_name, last_name")
      .eq("id", caller.memberId)
      .single();
    const authorName = `${author?.first_name ?? ""} ${author?.last_name ?? ""}`.trim() || "Unknown";

    return {
      success: true,
      comment: {
        id: inserted.id as string,
        authorMemberId: inserted.author_member_id as string,
        authorName,
        body: inserted.body as string,
        createdAt: inserted.created_at as string,
      },
    };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "An error occurred" };
  }
}

/** Merged audit + comment feed for a document, newest first (matches
 *  the previous history ordering). */
export async function getDocumentActivity(
  documentId: string,
): Promise<{ success: true; items: DocumentActivityItem[] } | { success: false; error: string }> {
  try {
    const caller = await resolveCaller();
    if (!caller) return { success: false, error: "Not authenticated" };
    const admin = getAdmin();

    const detail = await getDocumentDetail(documentId);
    if (!detail.success) return { success: false, error: detail.error };

    const [auditRes, convRow] = await Promise.all([
      admin
        .from("audit_log")
        .select("id, actor_name, action, created_at, metadata, changes")
        .eq("target_id", documentId)
        .order("created_at", { ascending: false })
        .limit(200),
      admin
        .from("conversations")
        .select("id")
        .eq("entity_type", "document")
        .eq("entity_id", documentId)
        .maybeSingle(),
    ]);
    if (auditRes.error) return { success: false, error: auditRes.error.message };

    const auditItems: DocumentActivityItem[] = (auditRes.data ?? []).map((r) => ({
      kind: "audit",
      entry: {
        id: r.id as string,
        actorName: (r.actor_name as string | null) ?? "System",
        action: r.action as string,
        createdAt: r.created_at as string,
        metadata: (r.metadata as Record<string, unknown> | null) ?? null,
        changes: (r.changes as Record<string, unknown> | null) ?? null,
      },
    }));

    let commentItems: DocumentActivityItem[] = [];
    if (convRow.data?.id) {
      const { data: msgs, error: mErr } = await admin
        .from("conversation_messages")
        .select("id, body, created_at, author_member_id, members:author_member_id(first_name, last_name)")
        .eq("conversation_id", convRow.data.id)
        .order("created_at", { ascending: false })
        .limit(200);
      if (mErr) return { success: false, error: mErr.message };
      commentItems = (msgs ?? []).map((m) => {
        const author = m.members as unknown as { first_name?: string; last_name?: string } | null;
        const authorName = `${author?.first_name ?? ""} ${author?.last_name ?? ""}`.trim() || "Unknown";
        return {
          kind: "comment" as const,
          comment: {
            id: m.id as string,
            authorMemberId: m.author_member_id as string,
            authorName,
            body: m.body as string,
            createdAt: m.created_at as string,
          },
        };
      });
    }

    // Merge, sort newest-first. Ties (rare) fall back to a stable order
    // by placing audit before comment.
    const items = [...auditItems, ...commentItems].sort((a, b) => {
      const at = a.kind === "audit" ? a.entry.createdAt : a.comment.createdAt;
      const bt = b.kind === "audit" ? b.entry.createdAt : b.comment.createdAt;
      if (at === bt) return a.kind === "audit" ? -1 : 1;
      return at < bt ? 1 : -1;
    });

    return { success: true, items };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "An error occurred" };
  }
}

// ---------------------------------------------------------------------------
// Trash list
// ---------------------------------------------------------------------------

export async function listTrashedMemberDocuments(
  memberId: string,
): Promise<{ success: boolean; error?: string; rows: TrashedMemberDocumentRow[] }> {
  try {
    const caller = await resolveCaller();
    if (!caller) return { success: false, error: "Not authenticated", rows: [] };
    if (!caller.canManageDeleted) return { success: false, error: "Forbidden", rows: [] };
    const admin = getAdmin();
    const target = await getTarget(admin, memberId, caller.organisationId);
    if (!target) return { success: false, error: "Document not found", rows: [] };
    if (!caller.canViewTarget({ memberId: target.id, teamId: target.team_id })) {
      return { success: false, error: "Document not found", rows: [] };
    }

    // disposal_queue.document_id is a soft-FK (the doc row lives until
    // permanent purge), so PostgREST can't auto-join. Two-step: pull
    // the queue rows, then hydrate the docs by id.
    const { data: queueRows, error: queueErr } = await admin
      .from("disposal_queue")
      .select("id, queued_at, queued_by, force_delete_reason, document_id")
      .eq("organisation_id", caller.organisationId)
      .order("queued_at", { ascending: false });
    if (queueErr) return { success: false, error: queueErr.message, rows: [] };
    const docIds = (queueRows ?? []).map((r) => r.document_id as string);
    if (docIds.length === 0) return { success: true, rows: [] };

    const { data: docs, error: docsErr } = await admin
      .from("document")
      .select(
        "id, file_name, file_size, content_type, type, subtype_id, expires_on, retention_class, disposal_date, uploaded_by, uploaded_at, verified_on, verified_by, next_review_on, capture_source, owner_id, document_subtype!subtype_id(name, requires_verification), members!uploaded_by(first_name, last_name)",
      )
      .eq("organisation_id", caller.organisationId)
      .eq("owner_scope", "member")
      .eq("owner_id", memberId)
      .in("id", docIds);
    if (docsErr) return { success: false, error: docsErr.message, rows: [] };

    type DRow = {
      id: string;
      file_name: string;
      file_size: number;
      content_type: string;
      type: string;
      subtype_id: string | null;
      expires_on: string | null;
      retention_class: string;
      disposal_date: string | null;
      uploaded_by: string | null;
      uploaded_at: string;
      verified_on: string | null;
      verified_by: string | null;
      next_review_on: string | null;
      capture_source: "upload" | "photo";
      owner_id: string | null;
      document_subtype: { name: string; requires_verification: boolean } | { name: string; requires_verification: boolean }[] | null;
      members: { first_name: string; last_name: string } | { first_name: string; last_name: string }[] | null;
    };
    const docsById = new Map<string, DRow>();
    for (const d of docs ?? []) docsById.set((d as unknown as DRow).id, d as unknown as DRow);

    const rows: TrashedMemberDocumentRow[] = (queueRows ?? [])
      .map((q) => {
        const d = docsById.get(q.document_id as string);
        if (!d) return null;
        const st = d.document_subtype;
        const stObj = Array.isArray(st) ? (st[0] ?? null) : st;
        const stName = stObj?.name ?? null;
        const requiresVerification = stObj?.requires_verification === true;
        const mem = d.members;
        const memPair = Array.isArray(mem) ? (mem[0] ?? null) : mem;
        const uploader = `${memPair?.first_name ?? ""} ${memPair?.last_name ?? ""}`.trim() || "Unknown";
        return {
          id: d.id,
          fileName: d.file_name,
          fileSize: d.file_size,
          contentType: d.content_type,
          type: d.type,
          subtypeId: d.subtype_id,
          subtypeName: stName,
          requiresVerification,
          verifiedOn: d.verified_on,
          verifiedBy: d.verified_by,
          nextReviewOn: d.next_review_on,
          expiresOn: d.expires_on,
          retentionClass: d.retention_class,
          disposalDate: d.disposal_date,
          uploadedBy: uploader,
          uploadedAt: d.uploaded_at,
          statuses: deriveDocumentStatuses({
            requiresVerification,
            verifiedOn: d.verified_on,
            expiresOn: d.expires_on,
            nextReviewOn: d.next_review_on,
          }),
          captureSource: (d.capture_source as "upload" | "photo") ?? "upload",
          queuedAt: q.queued_at as string,
          queuedBy: (q.queued_by as string | null) ?? null,
          forceDeleteReason: (q.force_delete_reason as string | null) ?? null,
        } satisfies TrashedMemberDocumentRow;
      })
      .filter((r): r is TrashedMemberDocumentRow => r !== null);
    return { success: true, rows };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "An error occurred", rows: [] };
  }
}

// ---------------------------------------------------------------------------
// Download
// ---------------------------------------------------------------------------

export async function getMemberDocumentSignedUrl(
  documentId: string,
  mode: "inline" | "download",
): Promise<{ success: boolean; error?: string; url?: string; fileName?: string; contentType?: string }> {
  // CLE-227 — thin cookies-auth passthrough over
  // `_getMemberDocumentSignedUrl`. Impl body lives in
  // `./document-actions-impl` and is shared with the mobile API-route
  // wrapper at /api/mobile/documents/{id}/signed-url.
  const caller = await buildDocumentsCallerFromCookies();
  if (!caller) return { success: false, error: "Not authenticated" };
  return _getMemberDocumentSignedUrl(caller, documentId, mode);
}

// ---------------------------------------------------------------------------
// Upload
// ---------------------------------------------------------------------------

export async function uploadMemberDocument(
  memberId: string,
  formData: FormData,
): Promise<{ success: boolean; error?: string; documentId?: string }> {
  // CLE-227 — thin cookies-auth passthrough over `_uploadMemberDocument`.
  // Impl body lives in `./document-actions-impl` and is shared with
  // the mobile API-route wrapper at /api/mobile/documents/upload.
  const caller = await buildDocumentsCallerFromCookies();
  if (!caller) return { success: false, error: "Not authenticated" };
  return _uploadMemberDocument(caller, memberId, formData);
}

// ---------------------------------------------------------------------------
// Replace (CLE-217) — swap the file on an unverified doc.
//
// Chris's testing wrinkle: if a Required Document upload lands the
// wrong file, the only remedy today is a Documents-tab detour to
// delete the row and re-add. Replace collapses that into a single
// operation launched from inside the Details dialog:
//
//   * validates the caller can update the target member,
//   * verifies the old doc is still unverified — once verified we
//     insist admins delete + re-upload so the audit trail keeps its
//     first-sighting chain intact,
//   * uploads the new bytes and inserts a new `document` row that
//     inherits every relevant metadata field from the old row
//     (owner, subtype, type, retention_class, expires_on,
//     next_review_on),
//   * enqueues the old doc into `disposal_queue` directly — a
//     deliberate bypass of `softDeleteMemberDocument`'s force-delete
//     gate because a Replace is legitimate for every retention class
//     (including RTW): the *content* is being superseded, not the
//     record, and the new row immediately takes over the retention
//     obligation,
//   * writes a `document.replaced` audit row on the *new* id so the
//     Activity feed on the replacement carries the swap; the
//     `metadata.replaces_document_id` back-links to the trashed row
//     for anyone chasing the chain in Trash.
// ---------------------------------------------------------------------------

export async function replaceMemberDocument(
  oldDocumentId: string,
  formData: FormData,
): Promise<{ success: boolean; error?: string; documentId?: string }> {
  try {
    const caller = await resolveCaller();
    if (!caller) return { success: false, error: "Not authenticated" };
    const admin = getAdmin();

    // Fetch the old doc — every field we need to inherit onto the
    // replacement plus the guard fields (verified_on, owner scope).
    const { data: oldDoc } = await admin
      .from("document")
      .select(
        "id, organisation_id, owner_scope, owner_id, file_name, file_size, type, subtype_id, expires_on, retention_class, next_review_on, verified_on, document_subtype!subtype_id(name)",
      )
      .eq("id", oldDocumentId)
      .single();
    if (
      !oldDoc
      || oldDoc.organisation_id !== caller.organisationId
      || oldDoc.owner_scope !== "member"
      || !oldDoc.owner_id
    ) {
      return { success: false, error: "Document not found" };
    }
    // The unverified-only gate. Verified docs are the audit "anchor"
    // for their subtype cycle — swapping the file underneath would
    // orphan the verification event, so the admin has to delete +
    // re-upload in that case.
    if (oldDoc.verified_on !== null) {
      return {
        success: false,
        error: "Verified documents can't be replaced — delete and add a new one instead.",
      };
    }

    // Validate the incoming file.
    const file = formData.get("file");
    if (!(file instanceof File)) return { success: false, error: "No file supplied" };
    if (file.size > MAX_DOCUMENT_SIZE)
      return { success: false, error: "This file is too large. The limit is 10 MB." };
    if (!ALLOWED_CONTENT_TYPES.includes(file.type as (typeof ALLOWED_CONTENT_TYPES)[number])) {
      return { success: false, error: "This file type is not accepted." };
    }

    const memberId = oldDoc.owner_id as string;
    const target = await getTarget(admin, memberId, caller.organisationId);
    if (!target) return { success: false, error: "Document not found" };
    if (!caller.canUpdateTarget({ memberId: target.id, teamId: target.team_id })) {
      return { success: false, error: "You don't have permission to replace this document." };
    }

    // Upload bytes. Same path convention as uploadMemberDocument.
    const uuid = crypto.randomUUID();
    const ext = file.name.includes(".") ? file.name.substring(file.name.lastIndexOf(".")) : "";
    const storagePath = `${caller.organisationId}/${uuid}${ext}`;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const { error: uploadError } = await admin.storage
      .from(STORAGE_BUCKET)
      .upload(storagePath, bytes, { contentType: file.type, upsert: false });
    if (uploadError) return { success: false, error: uploadError.message };

    // Insert the replacement row, inheriting every relevant column
    // from the old row so subtype/retention/expiry never drift.
    const { data: inserted, error: insertError } = await admin
      .from("document")
      .insert({
        organisation_id: caller.organisationId,
        owner_scope: "member",
        owner_id: memberId,
        storage_path: storagePath,
        file_name: file.name.substring(0, 255),
        file_size: file.size,
        content_type: file.type,
        type: oldDoc.type,
        subtype_id: oldDoc.subtype_id,
        retention_class: oldDoc.retention_class,
        expires_on: oldDoc.expires_on,
        next_review_on: oldDoc.next_review_on,
        uploaded_by: caller.memberId,
      })
      .select("id")
      .single();
    if (insertError || !inserted) {
      // Best-effort cleanup so we don't leak orphan bytes.
      await admin.storage.from(STORAGE_BUCKET).remove([storagePath]);
      return {
        success: false,
        error: insertError?.message ?? "Failed to insert replacement document",
      };
    }

    // Enqueue the old row into disposal_queue directly. Deliberate
    // bypass of softDeleteMemberDocument's PROTECTED_RETENTION_CLASSES
    // check — Replace legitimately covers RTW/contract/payroll
    // because the new active doc immediately takes over the retention
    // obligation. The wrinkle is that queue rows are unique on
    // document_id, so a second call for the same old id would fail —
    // we don't retry on error here; if it fails we roll back the new
    // row so the caller can start over cleanly.
    const { error: queueError } = await admin
      .from("disposal_queue")
      .insert({
        organisation_id: caller.organisationId,
        document_id: oldDocumentId,
        queued_by: caller.memberId,
        force_delete_reason: "Replaced by uploader",
      });
    if (queueError) {
      await admin.from("document").delete().eq("id", inserted.id as string);
      await admin.storage.from(STORAGE_BUCKET).remove([storagePath]);
      return { success: false, error: queueError.message };
    }

    const stObj = oldDoc.document_subtype as unknown as { name?: string } | { name?: string }[] | null;
    const subtypeName = Array.isArray(stObj) ? (stObj[0]?.name ?? null) : (stObj?.name ?? null);
    await logAudit({
      organisationId: caller.organisationId,
      actorId: caller.memberId,
      actorName: await callerName(admin, caller.memberId),
      action: "document.replaced",
      targetType: "member_document",
      targetId: inserted.id as string,
      targetLabel: file.name,
      changes: {
        file_name: { old: oldDoc.file_name, new: file.name },
        file_size: { old: oldDoc.file_size, new: file.size },
      },
      metadata: {
        member: memberDisplay(target),
        type_subtype: typeSubtypeLabel(oldDoc.type as string, subtypeName),
        replaces_document_id: oldDocumentId,
        // CLE-219 — file_name + file_size on every doc audit; current
        // values here reflect the new (post-replace) file.
        file_name: file.name.substring(0, 255),
        file_size: file.size,
      },
    });

    revalidatePath(`/members/${memberId}/docs`);
    return { success: true, documentId: inserted.id as string };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "An error occurred" };
  }
}

// ---------------------------------------------------------------------------
// Finalize replace via photo capture (CLE-217).
//
// The photo path can't do everything in one action — the mobile
// capture flow already inserts its own `document` row via the
// /api/mobile/capture-tasks/:id/upload endpoint, so all the web
// dialog sees is a fresh `uploaded_document_id` on the capture_task.
// This action is what the dialog calls afterwards to (a) trash the
// old doc and (b) write the same `document.replaced` audit row the
// file-upload path produces. Same guard rails: same tenant, same
// owner + subtype, old still unverified, caller can update the
// target. Idempotent — a second call for the same pair is a no-op.
// ---------------------------------------------------------------------------

export async function finalizeDocumentReplace(
  oldDocumentId: string,
  newDocumentId: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const caller = await resolveCaller();
    if (!caller) return { success: false, error: "Not authenticated" };
    const admin = getAdmin();

    const { data: rows } = await admin
      .from("document")
      .select(
        "id, organisation_id, owner_scope, owner_id, file_name, file_size, subtype_id, type, verified_on, document_subtype!subtype_id(name)",
      )
      .in("id", [oldDocumentId, newDocumentId]);
    type RowShape = {
      id: string;
      organisation_id: string;
      owner_scope: string;
      owner_id: string | null;
      file_name: string;
      file_size: number;
      subtype_id: string | null;
      type: string;
      verified_on: string | null;
      document_subtype: { name?: string } | { name?: string }[] | null;
    };
    const list = ((rows ?? []) as unknown as RowShape[]);
    const oldRow = list.find((r) => r.id === oldDocumentId);
    const newRow = list.find((r) => r.id === newDocumentId);
    if (!oldRow || !newRow) return { success: false, error: "Document not found" };
    if (
      oldRow.organisation_id !== caller.organisationId
      || newRow.organisation_id !== caller.organisationId
      || oldRow.owner_scope !== "member"
      || newRow.owner_scope !== "member"
    ) {
      return { success: false, error: "Document not found" };
    }
    if (oldRow.owner_id !== newRow.owner_id) {
      return { success: false, error: "Replacement belongs to a different member." };
    }
    if (oldRow.subtype_id !== newRow.subtype_id) {
      return { success: false, error: "Replacement belongs to a different subtype." };
    }
    if (oldRow.verified_on !== null) {
      return {
        success: false,
        error: "Verified documents can't be replaced — delete and add a new one instead.",
      };
    }

    const memberId = oldRow.owner_id as string;
    const target = await getTarget(admin, memberId, caller.organisationId);
    if (!target) return { success: false, error: "Document not found" };
    if (!caller.canUpdateTarget({ memberId: target.id, teamId: target.team_id })) {
      return { success: false, error: "You don't have permission to replace this document." };
    }

    // Idempotency — if a previous finalize already queued the old
    // row, skip both the queue insert AND the audit write so we
    // don't double-log the swap.
    const { data: existingQueue } = await admin
      .from("disposal_queue")
      .select("id")
      .eq("document_id", oldDocumentId)
      .maybeSingle();
    if (!existingQueue) {
      const { error: queueError } = await admin
        .from("disposal_queue")
        .insert({
          organisation_id: caller.organisationId,
          document_id: oldDocumentId,
          queued_by: caller.memberId,
          force_delete_reason: "Replaced by uploader",
        });
      if (queueError) return { success: false, error: queueError.message };

      const stObj = oldRow.document_subtype;
      const subtypeName = Array.isArray(stObj) ? (stObj[0]?.name ?? null) : (stObj?.name ?? null);
      await logAudit({
        organisationId: caller.organisationId,
        actorId: caller.memberId,
        actorName: await callerName(admin, caller.memberId),
        action: "document.replaced",
        targetType: "member_document",
        targetId: newDocumentId,
        targetLabel: newRow.file_name,
        changes: {
          file_name: { old: oldRow.file_name, new: newRow.file_name },
          file_size: { old: oldRow.file_size, new: newRow.file_size },
        },
        metadata: {
          member: memberDisplay(target),
          type_subtype: typeSubtypeLabel(oldRow.type, subtypeName ?? null),
          replaces_document_id: oldDocumentId,
          // CLE-219 — file_name + file_size on every doc audit; current
          // values here reflect the new (post-replace) file.
          file_name: newRow.file_name,
          file_size: newRow.file_size,
        },
      });
    }

    revalidatePath(`/members/${memberId}/docs`);
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "An error occurred" };
  }
}

// ---------------------------------------------------------------------------
// Edit metadata
// ---------------------------------------------------------------------------

export async function updateMemberDocumentMetadata(
  documentId: string,
  patch: { subtypeId?: string | null; expiresOn?: string | null; nextReviewOn?: string | null },
): Promise<{ success: boolean; error?: string }> {
  try {
    const caller = await resolveCaller();
    if (!caller) return { success: false, error: "Not authenticated" };
    const admin = getAdmin();

    const { data: doc } = await admin
      .from("document")
      .select("id, organisation_id, owner_scope, owner_id, type, subtype_id, expires_on, next_review_on, file_name, file_size, document_subtype!subtype_id(name)")
      .eq("id", documentId)
      .single();
    if (!doc || doc.organisation_id !== caller.organisationId || doc.owner_scope !== "member") {
      return { success: false, error: "Document not found" };
    }
    const target = await getTarget(admin, doc.owner_id as string, caller.organisationId);
    if (!target) return { success: false, error: "Document not found" };
    if (!caller.canUpdateTarget({ memberId: target.id, teamId: target.team_id })) {
      return { success: false, error: "You don't have permission to change this document." };
    }

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    let nextRetention: string | null = null;

    if (patch.subtypeId !== undefined) {
      if (patch.subtypeId === null) {
        updates.subtype_id = null;
      } else {
        const { data: subtype } = await admin
          .from("document_subtype")
          .select("id, type, retention_class, expiry_required")
          .eq("id", patch.subtypeId)
          .eq("organisation_id", caller.organisationId)
          .single();
        if (!subtype) return { success: false, error: "That document type is not available." };
        if (subtype.type !== doc.type) {
          return { success: false, error: "The chosen subtype does not belong to this document type." };
        }
        updates.subtype_id = subtype.id;
        nextRetention = subtype.retention_class as string;
        updates.retention_class = nextRetention;
        if (subtype.expiry_required && !(patch.expiresOn ?? doc.expires_on)) {
          return { success: false, error: "This document type needs an expiry date." };
        }
      }
    }
    if (patch.expiresOn !== undefined) {
      // Past-expiry check removed to allow the retention/status
      // sweeps to be exercised end-to-end during testing.
      updates.expires_on = patch.expiresOn;
    }
    if (patch.nextReviewOn !== undefined) {
      updates.next_review_on = patch.nextReviewOn;
    }

    if (Object.keys(updates).length === 1) {
      // Only `updated_at` — nothing changed.
      return { success: true };
    }

    const { error } = await admin
      .from("document")
      .update(updates)
      .eq("id", documentId)
      .eq("organisation_id", caller.organisationId);
    if (error) return { success: false, error: error.message };

    const changes: Record<string, { old: unknown; new: unknown }> = {};
    if (patch.subtypeId !== undefined && patch.subtypeId !== doc.subtype_id) {
      changes.subtype_id = { old: doc.subtype_id, new: patch.subtypeId };
    }
    if (patch.expiresOn !== undefined && patch.expiresOn !== doc.expires_on) {
      changes.expires_on = { old: doc.expires_on, new: patch.expiresOn };
    }
    if (patch.nextReviewOn !== undefined && patch.nextReviewOn !== doc.next_review_on) {
      changes.next_review_on = { old: doc.next_review_on, new: patch.nextReviewOn };
    }
    if (Object.keys(changes).length > 0) {
      const st = doc.document_subtype as unknown as { name?: string } | { name?: string }[] | null;
      const subtypeName = Array.isArray(st) ? (st[0]?.name ?? null) : (st?.name ?? null);
      await logAudit({
        organisationId: caller.organisationId,
        actorId: caller.memberId,
        actorName: await callerName(admin, caller.memberId),
        action: "document.metadata_updated",
        targetType: "member_document",
        targetId: documentId,
        targetLabel: (doc.file_name as string) ?? "",
        changes,
        metadata: {
          member: memberDisplay(target),
          type_subtype: typeSubtypeLabel(doc.type as string, subtypeName),
          // CLE-219 — file_name + file_size on every doc audit.
          file_name: doc.file_name as string,
          file_size: doc.file_size as number,
        },
      });
    }

    revalidatePath(`/members/${doc.owner_id}/docs`);
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "An error occurred" };
  }
}

// ---------------------------------------------------------------------------
// Soft-delete
// ---------------------------------------------------------------------------

export async function softDeleteMemberDocument(
  documentId: string,
  // CLE-226 — reason is now required on every soft-delete, not only
  // force-deletes. The `opts.reason` key is the current path; the
  // legacy `opts.forceDeleteReason` key is accepted as an alias for
  // back-compat while any in-flight callers are migrated.
  opts: { reason?: string | null; forceDeleteReason?: string | null } = {},
): Promise<{ success: boolean; error?: string }> {
  try {
    const caller = await resolveCaller();
    if (!caller) return { success: false, error: "Not authenticated" };
    const admin = getAdmin();
    const { data: doc } = await admin
      .from("document")
      .select("id, organisation_id, owner_scope, owner_id, file_name, file_size, retention_class, disposal_date, type, document_subtype!subtype_id(name)")
      .eq("id", documentId)
      .single();
    if (!doc || doc.organisation_id !== caller.organisationId || doc.owner_scope !== "member") {
      return { success: false, error: "Document not found" };
    }
    const target = await getTarget(admin, doc.owner_id as string, caller.organisationId);
    if (!target) return { success: false, error: "Document not found" };
    if (!caller.canUpdateTarget({ memberId: target.id, teamId: target.team_id })) {
      return { success: false, error: "You don't have permission to change this document." };
    }

    // CLE-226 — Reason is required on every soft-delete regardless of
    // retention class. 3-char minimum (blocks drive-by "a"), 500-char
    // cap enforced via silent truncation. The `requiresForce` gate
    // stays — it now governs *permission* to delete, not whether a
    // reason is captured.
    const rawReason = (opts.reason ?? opts.forceDeleteReason ?? "").trim();
    if (rawReason.length < 3) {
      return {
        success: false,
        error: "Please give a reason for deleting this document (at least 3 characters).",
      };
    }
    const reason = rawReason.slice(0, 500);

    // Retention block: certain classes cannot be deleted while the
    // target member is active (disposal_date IS NULL). Force-delete
    // requires can_force_delete_documents.
    const requiresForce = PROTECTED_RETENTION_CLASSES.has(doc.retention_class as string)
      && doc.disposal_date === null;
    if (requiresForce && !caller.canForceDelete) {
      return {
        success: false,
        error: `${doc.retention_class} evidence can't be deleted while the employee is still active.`,
      };
    }

    // Insert into the queue. Uniqueness on document_id prevents
    // double-queuing.
    // CLE-226 — `force_delete_reason` column now carries the reason
    // for every user-initiated delete, not only force-deletes.
    const { error } = await admin
      .from("disposal_queue")
      .insert({
        organisation_id: caller.organisationId,
        document_id: documentId,
        queued_by: caller.memberId,
        force_delete_reason: reason,
      });
    if (error) return { success: false, error: error.message };

    const stDel = doc.document_subtype as unknown as { name?: string } | { name?: string }[] | null;
    const subtypeNameDel = Array.isArray(stDel) ? (stDel[0]?.name ?? null) : (stDel?.name ?? null);
    await logAudit({
      organisationId: caller.organisationId,
      actorId: caller.memberId,
      actorName: await callerName(admin, caller.memberId),
      action: requiresForce ? "document.force_deleted" : "document.deleted",
      targetType: "member_document",
      targetId: documentId,
      targetLabel: doc.file_name as string,
      metadata: {
        member: memberDisplay(target),
        type_subtype: typeSubtypeLabel(doc.type as string, subtypeNameDel),
        // CLE-219 — file_name + file_size on every doc audit.
        file_name: doc.file_name as string,
        file_size: doc.file_size as number,
        // CLE-226 — `reason` is the new canonical metadata key for
        // both delete actions. The legacy `force_delete_reason` key
        // is kept on force-deletes so any historical consumer that
        // reads it still gets a value; new consumers should read
        // `reason` and fall back to `force_delete_reason` for
        // pre-CLE-226 audit rows.
        reason,
        ...(requiresForce ? { force_delete_reason: reason } : {}),
      },
    });

    revalidatePath(`/members/${doc.owner_id}/docs`);
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "An error occurred" };
  }
}

// ---------------------------------------------------------------------------
// Restore from trash
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Testing helper — backdate the queued_at on a disposal_queue row so
// the nightly purge sweep can be exercised without waiting 30 days.
// Gated on can_edit_org_settings.
// ---------------------------------------------------------------------------

export async function backdateDisposalQueue(
  documentId: string,
  newQueuedAt: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const caller = await resolveCaller();
    if (!caller) return { success: false, error: "Not authenticated" };
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: "Not authenticated" };
    const resolved = await getEffectiveRightsForUser(user.id);
    if (!resolved?.rights.canEditOrgSettings) {
      return { success: false, error: "Forbidden" };
    }
    const admin = getAdmin();
    const iso = new Date(newQueuedAt).toISOString();
    const { error } = await admin
      .from("disposal_queue")
      .update({ queued_at: iso })
      .eq("document_id", documentId)
      .eq("organisation_id", caller.organisationId);
    if (error) return { success: false, error: error.message };
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "An error occurred" };
  }
}

export async function restoreMemberDocument(
  documentId: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const caller = await resolveCaller();
    if (!caller) return { success: false, error: "Not authenticated" };
    if (!caller.canManageDeleted) {
      return { success: false, error: "You don't have permission to restore deleted documents." };
    }
    const admin = getAdmin();

    const { data: queued } = await admin
      .from("disposal_queue")
      .select("id, queued_at, document_id, organisation_id")
      .eq("document_id", documentId)
      .single();
    if (!queued || queued.organisation_id !== caller.organisationId) {
      return { success: false, error: "This document is not in Trash." };
    }
    // 30-day grace check. Server clock is authoritative.
    const queuedAt = new Date(queued.queued_at as string).getTime();
    const graceMs = 30 * 24 * 60 * 60 * 1000;
    if (Date.now() - queuedAt > graceMs) {
      return { success: false, error: "This document has already been permanently disposed." };
    }

    const { error } = await admin
      .from("disposal_queue")
      .delete()
      .eq("id", queued.id);
    if (error) return { success: false, error: error.message };

    const { data: doc } = await admin
      .from("document")
      .select("owner_id, file_name, file_size, type, document_subtype!subtype_id(name)")
      .eq("id", documentId)
      .single();

    const targetMember = doc?.owner_id
      ? await getTarget(admin, doc.owner_id as string, caller.organisationId)
      : null;
    const stRes = doc?.document_subtype as unknown as { name?: string } | { name?: string }[] | null;
    const subtypeNameRes = Array.isArray(stRes) ? (stRes[0]?.name ?? null) : (stRes?.name ?? null);

    await logAudit({
      organisationId: caller.organisationId,
      actorId: caller.memberId,
      actorName: await callerName(admin, caller.memberId),
      action: "document.restored",
      targetType: "member_document",
      targetId: documentId,
      targetLabel: (doc?.file_name as string) ?? "",
      metadata: {
        ...(targetMember ? { member: memberDisplay(targetMember) } : {}),
        ...(doc?.type ? { type_subtype: typeSubtypeLabel(doc.type as string, subtypeNameRes) } : {}),
        // CLE-219 — file_name + file_size on every doc audit.
        ...(doc?.file_name ? { file_name: doc.file_name as string } : {}),
        ...(doc?.file_size !== undefined && doc?.file_size !== null ? { file_size: doc.file_size as number } : {}),
      },
    });

    revalidatePath(`/members/${doc?.owner_id}/docs`);
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "An error occurred" };
  }
}

// ---------------------------------------------------------------------------
// Verify + Renew
// ---------------------------------------------------------------------------
//
// Both write to the same set of columns on the document row; the
// action names differ so the audit trail shows first-sight vs
// re-sight cadence.

async function verifyOrRenew(
  actionName: "document.verified" | "document.renewed",
  documentId: string,
  input: { verifiedOn?: string | null; verificationNotes?: string | null; nextReviewOn?: string | null } = {},
): Promise<{ success: boolean; error?: string }> {
  try {
    const caller = await resolveCaller();
    if (!caller) return { success: false, error: "Not authenticated" };
    const admin = getAdmin();
    const { data: doc } = await admin
      .from("document")
      .select("id, organisation_id, owner_scope, owner_id, type, expires_on, file_name, file_size, document_subtype!subtype_id(name, requires_verification, review_period_months)")
      .eq("id", documentId)
      .single();
    if (!doc || doc.organisation_id !== caller.organisationId || doc.owner_scope !== "member") {
      return { success: false, error: "Document not found" };
    }
    const st = doc.document_subtype as unknown as { name: string; requires_verification: boolean; review_period_months: number | null } | { name: string; requires_verification: boolean; review_period_months: number | null }[] | null;
    const stObj = Array.isArray(st) ? (st[0] ?? null) : st;
    if (!stObj?.requires_verification) {
      return { success: false, error: "This kind of document doesn't need verification." };
    }
    const target = await getTarget(admin, doc.owner_id as string, caller.organisationId);
    if (!target) return { success: false, error: "Document not found" };
    if (!caller.canUpdateTarget({ memberId: target.id, teamId: target.team_id })) {
      return { success: false, error: "You don't have permission to change this document." };
    }

    // Refuse if the disposal_queue has this doc (F20).
    const { data: queued } = await admin
      .from("disposal_queue")
      .select("id")
      .eq("document_id", documentId)
      .maybeSingle();
    if (queued) {
      return { success: false, error: "This document has been deleted. Restore it or upload a replacement first." };
    }

    const today = new Date().toISOString().slice(0, 10);
    const verifiedOn = input.verifiedOn ?? today;
    if (verifiedOn > today) {
      return { success: false, error: "The verification date can't be in the future." };
    }
    if (doc.expires_on !== null && (doc.expires_on as string) < today) {
      return { success: false, error: "This document has already expired. Upload a current one first." };
    }
    // CLE-212 follow-up — verify/renew is the moment the review cycle
    // resets. When the subtype has a `review_period_months`, always
    // recompute `next_review_on` from the new verification date; any
    // inbound value (including a stale one the dialog might resend)
    // is deliberately ignored. Subtypes with no review period leave
    // the existing `next_review_on` alone — those deadlines are
    // manually managed via the Review pencil, so verify/renew does
    // not touch the column at all.
    const updates: Record<string, unknown> = {
      verified_on: verifiedOn,
      verified_by: caller.memberId,
      verification_notes: input.verificationNotes ?? null,
      updated_at: new Date().toISOString(),
    };
    let nextReviewOn: string | null = null;
    if (stObj.review_period_months !== null) {
      const d = new Date(verifiedOn + "T00:00:00Z");
      d.setUTCMonth(d.getUTCMonth() + Number(stObj.review_period_months));
      nextReviewOn = d.toISOString().slice(0, 10);
      updates.next_review_on = nextReviewOn;
    }

    const { error } = await admin
      .from("document")
      .update(updates)
      .eq("id", documentId)
      .eq("organisation_id", caller.organisationId);
    if (error) return { success: false, error: error.message };

    await logAudit({
      organisationId: caller.organisationId,
      actorId: caller.memberId,
      actorName: await callerName(admin, caller.memberId),
      action: actionName,
      targetType: "member_document",
      targetId: documentId,
      targetLabel: (doc.file_name as string) ?? "",
      metadata: {
        member: memberDisplay(target),
        type_subtype: typeSubtypeLabel(doc.type as string, stObj.name),
        verified_on: verifiedOn,
        // Only record next_review_on when we actually touched it —
        // i.e. the subtype has a review period. Otherwise the doc's
        // manually-managed deadline is untouched by verify/renew.
        ...(nextReviewOn !== null ? { next_review_on: nextReviewOn } : {}),
        // CLE-219 — file_name + file_size on every doc audit.
        file_name: doc.file_name as string,
        file_size: doc.file_size as number,
        // verification_notes intentionally omitted — never in audit.
      },
    });

    revalidatePath(`/members/${doc.owner_id}/docs`);
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "An error occurred" };
  }
}

export async function verifyMemberDocument(
  documentId: string,
  input: { verifiedOn?: string | null; verificationNotes?: string | null; nextReviewOn?: string | null } = {},
): Promise<{ success: boolean; error?: string }> {
  return verifyOrRenew("document.verified", documentId, input);
}

export async function renewMemberDocument(
  documentId: string,
  input: { verifiedOn?: string | null; verificationNotes?: string | null; nextReviewOn?: string | null } = {},
): Promise<{ success: boolean; error?: string }> {
  return verifyOrRenew("document.renewed", documentId, input);
}

// ---------------------------------------------------------------------------
// Subtype list — thin helper for the upload dialog + metadata editor.
// ---------------------------------------------------------------------------

export async function getSubtypesForUpload(
  memberId: string,
): Promise<{
  success: boolean;
  error?: string;
  subtypes: Array<{
    id: string;
    type: string;
    name: string;
    retentionClass: string;
    expiryRequired: boolean;
    employeeCanUpload: boolean;
  }>;
}> {
  try {
    const caller = await resolveCaller();
    if (!caller) return { success: false, error: "Not authenticated", subtypes: [] };
    const admin = getAdmin();
    const target = await getTarget(admin, memberId, caller.organisationId);
    if (!target) return { success: false, error: "Member not found", subtypes: [] };
    if (!caller.canViewTarget({ memberId: target.id, teamId: target.team_id })) {
      return { success: false, error: "Member not found", subtypes: [] };
    }
    const isSelf = caller.isSelf(memberId);
    const { data, error } = await admin
      .from("document_subtype")
      .select(
        "id, type, name, retention_class, expiry_required, employee_can_upload, sort_order",
      )
      .eq("organisation_id", caller.organisationId)
      .order("type", { ascending: true })
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true });
    if (error) return { success: false, error: error.message, subtypes: [] };

    const rows = (data ?? []) as Array<{
      id: string;
      type: string;
      name: string;
      retention_class: string;
      expiry_required: boolean;
      employee_can_upload: boolean;
    }>;
    // Org-scope subtypes have their own upload surface at
    // /documents/organisation — never show them in the per-member
    // "Add Document" picker.
    const memberScoped = rows.filter((r) => r.type !== "organisation_document");
    // Self-upload restriction only applies to callers who can't
    // update anyone else's docs — i.e. `crossUserAccess = 'self'`.
    // An admin viewing their own record should see every subtype;
    // the hidden-flag semantics are about employees, not admins.
    const filtered = isSelf && caller.crossUserAccess === "self"
      ? memberScoped.filter((r) => r.employee_can_upload)
      : memberScoped;
    return {
      success: true,
      subtypes: filtered.map((r) => ({
        id: r.id,
        type: r.type,
        name: r.name,
        retentionClass: r.retention_class,
        expiryRequired: r.expiry_required,
        employeeCanUpload: r.employee_can_upload,
      })),
    };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "An error occurred", subtypes: [] };
  }
}

// ---------------------------------------------------------------------------
// CLE-213 — Required documents per member.
// ---------------------------------------------------------------------------

export interface TrackableSubtype {
  id: string;
  type: string;
  name: string;
}

/**
 * Every subtype in the caller's org with `trackable_per_member = true`.
 * Powers the Employment tab's Required Documents picker.
 *
 * CLE-215 — RTW-class subtypes (`retention_class = 'right_to_work'`)
 * are excluded here even when their trackable flag is on. RTW is
 * covered by the aggregate "Right to Work" row on the card and
 * shouldn't appear as an individually-pickable per-member item.
 */
export async function listTrackablePerMemberSubtypes(): Promise<
  { success: true; subtypes: TrackableSubtype[] } | { success: false; error: string }
> {
  try {
    const caller = await resolveCaller();
    if (!caller) return { success: false, error: "Not authenticated" };
    const admin = getAdmin();
    const { data, error } = await admin
      .from("document_subtype")
      .select("id, type, name, sort_order")
      .eq("organisation_id", caller.organisationId)
      .eq("trackable_per_member", true)
      .neq("retention_class", "right_to_work")
      .order("type", { ascending: true })
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true });
    if (error) return { success: false, error: error.message };
    const rows = (data ?? []) as Array<{ id: string; type: string; name: string }>;
    return {
      success: true,
      subtypes: rows.map((r) => ({ id: r.id, type: r.type, name: r.name })),
    };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "An error occurred" };
  }
}

/**
 * CLE-215 — Subtypes valid for satisfying RTW. Any subtype in the
 * caller's org whose `retention_class = 'right_to_work'`. Feeds the
 * restricted picker on the RTW aggregate row's "+ Add" button.
 */
export async function listRtwSubtypes(): Promise<
  { success: true; subtypes: TrackableSubtype[] } | { success: false; error: string }
> {
  try {
    const caller = await resolveCaller();
    if (!caller) return { success: false, error: "Not authenticated" };
    const admin = getAdmin();
    const { data, error } = await admin
      .from("document_subtype")
      .select("id, type, name, sort_order")
      .eq("organisation_id", caller.organisationId)
      .eq("retention_class", "right_to_work")
      .order("type", { ascending: true })
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true });
    if (error) return { success: false, error: error.message };
    const rows = (data ?? []) as Array<{ id: string; type: string; name: string }>;
    return {
      success: true,
      subtypes: rows.map((r) => ({ id: r.id, type: r.type, name: r.name })),
    };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "An error occurred" };
  }
}

/**
 * Subtype IDs currently marked as expected for a specific member.
 * Independent of the trackable_per_member flag — a subtype that used
 * to be trackable but has since had its flag turned off can still
 * appear here (existing assignments are preserved by design).
 */
export async function getMemberExpectedDocuments(
  memberId: string,
): Promise<
  { success: true; subtypeIds: string[] } | { success: false; error: string }
> {
  try {
    const caller = await resolveCaller();
    if (!caller) return { success: false, error: "Not authenticated" };
    const admin = getAdmin();
    const target = await getTarget(admin, memberId, caller.organisationId);
    if (!target) return { success: false, error: "Member not found" };
    if (!caller.canViewTarget({ memberId: target.id, teamId: target.team_id })) {
      return { success: false, error: "Member not found" };
    }
    const { data, error } = await admin
      .from("member_expected_document")
      .select("subtype_id")
      .eq("member_id", memberId)
      .eq("organisation_id", caller.organisationId);
    if (error) return { success: false, error: error.message };
    return {
      success: true,
      subtypeIds: (data ?? []).map((r) => r.subtype_id as string),
    };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "An error occurred" };
  }
}

/** CLE-215 — a single non-expired RTW-class document surfaced on
 *  the aggregate RTW row so admins can click through to it. */
export interface RtwEvidenceDoc {
  documentId: string;
  subtypeName: string;
  subtypeType: string;
  fileName: string;
  verifiedOn: string | null;
  expiresOn: string | null;
}

export interface RequiredDocumentRow {
  subtypeId: string;
  subtypeName: string;
  subtypeType: string;
  /** True when the subtype's `trackable_per_member` flag is currently
   *  on. False = legacy assignment (flag toggled off after
   *  assignment). UI can dim / mark these accordingly. */
  isTrackableNow: boolean;
  /** CLE-215 — deprecated. `expected_for_every_member` was dropped;
   *  this now always reports false and can be removed in a follow-
   *  up sweep. Kept in the shape for now so downstream consumers
   *  don't break mid-migration. */
  isOrgWideExpected: boolean;
  /** True when the row is present via `member_expected_document`
   *  (i.e. HR added it explicitly for this member). Rows that are
   *  synthetic (like the RTW aggregate) are false. Drives whether
   *  the per-row remove button shows. */
  assignedPerMember: boolean;
  /** CLE-215 — true for the synthetic "Right to Work" placeholder
   *  row emitted only when the member has zero non-expired RTW-class
   *  docs. When ≥1 non-expired RTW doc exists, RTW is expressed as
   *  individual rows (one per doc) rather than an aggregate. */
  isRtwAggregate?: boolean;
  /** Populated only on the placeholder aggregate row: newest
   *  non-expired doc per RTW-class subtype the member has. Empty
   *  when the aggregate is `not_uploaded`. Retained for the
   *  no-docs-yet render path; unused when individual rows are
   *  emitted. */
  rtwDocs?: RtwEvidenceDoc[];
  /** CLE-215-follow-up — true on RTW-evidence rows so the UI can
   *  group them at the top and mark them visually. */
  isRtwEvidence?: boolean;
  /** CLE-216 follow-up — mirror of `document_subtype.employee_can_upload`
   *  for this row's subtype. The admin Required Documents card ignores
   *  it (admins can upload anything on any member); the self-scope
   *  "My Documents" card reads it to decide whether a not-uploaded row
   *  gets a clickable "+ Add" affordance or renders as a static "HR
   *  will upload this for you" hint. Always false on the synthetic
   *  RTW aggregate row (there's no single subtype behind it). */
  employeeCanUpload: boolean;
  /** CLE-220 — true when the row's subtype has
   *  `requires_acknowledgement = true`. Consumers use this together
   *  with `isAcknowledged` to render a "Please Ack" pill on rows the
   *  caller still owes an acknowledgement on. Always false for the
   *  synthetic RTW aggregate placeholder (no subtype behind it). */
  requiresAcknowledgement: boolean;
  /** CLE-220 — true when the *caller* has an outstanding
   *  `document_acknowledgement` row on this document (superseded rows
   *  ignored). Only meaningful when both `requiresAcknowledgement` is
   *  true AND there is an actual `documentId` on the row — a
   *  not-uploaded row can't have been acked, and this flag stays
   *  false in that case. */
  isAcknowledged: boolean;
  /** True on the RTW row nominated as "primary" — the one currently
   *  providing evidence (or nearest to providing it). Priority:
   *  verified & non-expired > non-expired > expired; ties broken by
   *  the latest expiry. */
  isRtwPrimary?: boolean;
  /** Newest active document of this subtype for the member, if any.
   *  null when the member hasn't uploaded one — status will contain
   *  "not_uploaded" instead. */
  documentId: string | null;
  fileName: string | null;
  /** CLE-221 follow-up — bytes. Null on not-uploaded / synthetic
   *  aggregate rows. Consumed by the "name (size)" render in the
   *  Subtype cell of My Documents / My other documents / Org Docs
   *  so the three cards read consistently. */
  fileSize: number | null;
  verifiedOn: string | null;
  expiresOn: string | null;
  nextReviewOn: string | null;
  statuses: (DocumentStatus | "not_uploaded")[];
}

/**
 * Rich view of a member's required documents: expected subtype +
 * status derivation from the matching (newest active) doc, plus
 * flags for the UI. Powers the Required Documents card's table
 * layout. Union of per-member expectations and org-wide
 * `expected_for_every_member` — mirrors the compliance dashboard's
 * additive rule.
 */
export async function getMemberRequiredDocumentRows(
  memberId: string,
): Promise<
  { success: true; rows: RequiredDocumentRow[] } | { success: false; error: string }
> {
  // CLE-227 — thin cookies-auth passthrough over
  // `_getMemberRequiredDocumentRows`. Impl body lives in
  // `./document-actions-impl` and is shared with the mobile API-route
  // wrapper at /api/mobile/documents/required.
  const caller = await buildDocumentsCallerFromCookies();
  if (!caller) return { success: false, error: "Not authenticated" };
  return _getMemberRequiredDocumentRows(caller, memberId);
}

/**
 * Atomically replace a member's expected-doc list with the given
 * set of subtype IDs. Diffs against the current state and writes
 * per-row audit entries so HR has a trail of who changed what.
 */
export async function setMemberExpectedDocuments(
  memberId: string,
  subtypeIds: string[],
): Promise<{ success: boolean; error?: string }> {
  try {
    const caller = await resolveCaller();
    if (!caller) return { success: false, error: "Not authenticated" };
    const admin = getAdmin();

    const target = await getTarget(admin, memberId, caller.organisationId);
    if (!target) return { success: false, error: "Member not found" };
    if (!caller.canUpdateTarget({ memberId: target.id, teamId: target.team_id })) {
      return { success: false, error: "You don't have permission to change this member's documents." };
    }

    // Sanity-check that every incoming subtype belongs to the same
    // org. Also fetch the display names so the audit entries are
    // human-readable without a further lookup.
    const uniqIncoming = Array.from(new Set(subtypeIds));
    let incomingMeta: Array<{ id: string; name: string; type: string }> = [];
    if (uniqIncoming.length > 0) {
      const { data: subs, error: sErr } = await admin
        .from("document_subtype")
        .select("id, name, type")
        .eq("organisation_id", caller.organisationId)
        .in("id", uniqIncoming);
      if (sErr) return { success: false, error: sErr.message };
      incomingMeta = (subs ?? []) as Array<{ id: string; name: string; type: string }>;
      if (incomingMeta.length !== uniqIncoming.length) {
        return { success: false, error: "One or more subtypes are not available in this organisation." };
      }
    }

    // Load current set so we can diff.
    const { data: currentRows, error: cErr } = await admin
      .from("member_expected_document")
      .select("subtype_id")
      .eq("member_id", memberId)
      .eq("organisation_id", caller.organisationId);
    if (cErr) return { success: false, error: cErr.message };
    const currentSet = new Set((currentRows ?? []).map((r) => r.subtype_id as string));
    const nextSet = new Set(uniqIncoming);

    const toAdd = uniqIncoming.filter((id) => !currentSet.has(id));
    const toRemove = Array.from(currentSet).filter((id) => !nextSet.has(id));

    if (toAdd.length === 0 && toRemove.length === 0) {
      return { success: true }; // no-op
    }

    // Deletes first, then inserts, so a subtype swapped in and out
    // never fails the unique constraint mid-operation.
    if (toRemove.length > 0) {
      const { error: dErr } = await admin
        .from("member_expected_document")
        .delete()
        .eq("member_id", memberId)
        .eq("organisation_id", caller.organisationId)
        .in("subtype_id", toRemove);
      if (dErr) return { success: false, error: dErr.message };
    }
    if (toAdd.length > 0) {
      const { error: iErr } = await admin.from("member_expected_document").insert(
        toAdd.map((subtypeId) => ({
          organisation_id: caller.organisationId,
          member_id: memberId,
          subtype_id: subtypeId,
          added_by: caller.memberId,
        })),
      );
      if (iErr) return { success: false, error: iErr.message };
    }

    // Audit — one row per direction, listing the affected subtypes
    // by their type/subtype label so the audit page reads naturally.
    const nameOf = (id: string) => {
      const m = incomingMeta.find((x) => x.id === id);
      // For removals the subtype might not be in incomingMeta;
      // fall back to a stub label — the audit still records the ID.
      return m ? typeSubtypeLabel(m.type, m.name) : id;
    };
    const targetLabel = memberDisplay(target);

    if (toAdd.length > 0) {
      await logAudit({
        organisationId: caller.organisationId,
        actorId: caller.memberId,
        actorName: await callerName(admin, caller.memberId),
        action: "member.expected_documents_added",
        targetType: "member",
        targetId: memberId,
        targetLabel,
        metadata: {
          subtypes: toAdd.map(nameOf),
        },
      });
    }
    if (toRemove.length > 0) {
      // For removes, hydrate names from the DB — the removed subtypes
      // aren't in incomingMeta.
      const { data: removedMeta } = await admin
        .from("document_subtype")
        .select("id, name, type")
        .in("id", toRemove);
      const removedRows = (removedMeta ?? []) as Array<{ id: string; name: string; type: string }>;
      await logAudit({
        organisationId: caller.organisationId,
        actorId: caller.memberId,
        actorName: await callerName(admin, caller.memberId),
        action: "member.expected_documents_removed",
        targetType: "member",
        targetId: memberId,
        targetLabel,
        metadata: {
          subtypes: toRemove.map((id) => {
            const m = removedRows.find((x) => x.id === id);
            return m ? typeSubtypeLabel(m.type, m.name) : id;
          }),
        },
      });
    }

    revalidatePath(`/members/${memberId}/employment`);
    revalidatePath(`/members/${memberId}/docs`);
    revalidatePath(`/documents/compliance`);
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "An error occurred" };
  }
}
