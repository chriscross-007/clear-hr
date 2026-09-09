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
import { deriveDocumentStatuses } from "@/lib/document-status";

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
  evidence: "Evidence",
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
  try {
    const caller = await resolveCaller();
    if (!caller) return { success: false, error: "Not authenticated" };
    const admin = getAdmin();

    const { data: doc } = await admin
      .from("document")
      .select(
        "id, organisation_id, owner_scope, owner_id, file_name, file_size, content_type, type, subtype_id, expires_on, retention_class, disposal_date, uploaded_by, uploaded_at, verified_on, verified_by, next_review_on, capture_source, verification_notes, document_subtype!subtype_id(name, requires_verification)",
      )
      .eq("id", documentId)
      .single();
    if (!doc || doc.organisation_id !== caller.organisationId || doc.owner_scope !== "member" || !doc.owner_id) {
      return { success: false, error: "Document not found" };
    }
    const target = await getTarget(admin, doc.owner_id as string, caller.organisationId);
    if (!target) return { success: false, error: "Document not found" };
    if (!caller.canViewTarget({ memberId: target.id, teamId: target.team_id })) {
      return { success: false, error: "Document not found" };
    }

    // Two-step hydration for uploader + verifier names.
    const ids = new Set<string>();
    if (doc.uploaded_by) ids.add(doc.uploaded_by as string);
    if (doc.verified_by) ids.add(doc.verified_by as string);
    let uploaderName: string | null = null;
    let verifierName: string | null = null;
    if (ids.size > 0) {
      const { data: people } = await admin
        .from("members")
        .select("id, first_name, last_name")
        .in("id", Array.from(ids));
      const nameOf = (id: string | null) => {
        if (!id) return null;
        const p = (people ?? []).find((r) => r.id === id) as { first_name?: string; last_name?: string } | undefined;
        if (!p) return null;
        const n = `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim();
        return n || null;
      };
      uploaderName = nameOf(doc.uploaded_by as string | null);
      verifierName = nameOf(doc.verified_by as string | null);
    }

    const st = doc.document_subtype as unknown as { name?: string; requires_verification?: boolean } | { name?: string; requires_verification?: boolean }[] | null;
    const stObj = Array.isArray(st) ? (st[0] ?? null) : st;
    const requiresVerification = stObj?.requires_verification === true;

    const row: MemberDocumentRow = {
      id: doc.id as string,
      fileName: doc.file_name as string,
      fileSize: doc.file_size as number,
      contentType: doc.content_type as string,
      type: doc.type as string,
      subtypeId: (doc.subtype_id as string | null) ?? null,
      subtypeName: stObj?.name ?? null,
      requiresVerification,
      verifiedOn: (doc.verified_on as string | null) ?? null,
      verifiedBy: (doc.verified_by as string | null) ?? null,
      nextReviewOn: (doc.next_review_on as string | null) ?? null,
      expiresOn: (doc.expires_on as string | null) ?? null,
      retentionClass: (doc.retention_class as string) ?? "other",
      disposalDate: (doc.disposal_date as string | null) ?? null,
      uploadedBy: uploaderName ?? "Unknown",
      uploadedAt: doc.uploaded_at as string,
      statuses: deriveDocumentStatuses({
        requiresVerification,
        verifiedOn: (doc.verified_on as string | null) ?? null,
        expiresOn: (doc.expires_on as string | null) ?? null,
        nextReviewOn: (doc.next_review_on as string | null) ?? null,
      }),
      captureSource: ((doc.capture_source as "upload" | "photo" | null) ?? "upload"),
    };

    return {
      success: true,
      detail: {
        row,
        targetMemberId: target.id,
        targetMemberName: `${target.first_name ?? ""} ${target.last_name ?? ""}`.trim() || "Unknown",
        uploadedByName: uploaderName,
        verifiedByName: verifierName,
        verificationNotes: (doc.verification_notes as string | null) ?? null,
        isSelf: caller.isSelf(target.id),
      },
    };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "An error occurred" };
  }
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
  try {
    const caller = await resolveCaller();
    if (!caller) return { success: false, error: "Not authenticated" };
    const admin = getAdmin();

    const { data: doc } = await admin
      .from("document")
      .select("id, organisation_id, owner_scope, owner_id, storage_path, file_name, content_type, disposal_date, type, document_subtype!subtype_id(name)")
      .eq("id", documentId)
      .single();
    if (!doc || doc.organisation_id !== caller.organisationId || doc.owner_scope !== "member") {
      return { success: false, error: "Document not found" };
    }
    // Disposal date check.
    const today = new Date().toISOString().slice(0, 10);
    if (doc.disposal_date && doc.disposal_date <= today) {
      return { success: false, error: "Document not found" };
    }

    const target = await getTarget(admin, doc.owner_id as string, caller.organisationId);
    if (!target) return { success: false, error: "Document not found" };
    if (!caller.canViewTarget({ memberId: target.id, teamId: target.team_id })) {
      return { success: false, error: "Document not found" };
    }

    const { data: signed, error } = await admin.storage
      .from(STORAGE_BUCKET)
      .createSignedUrl(
        doc.storage_path,
        120,
        mode === "download" ? { download: doc.file_name } : undefined,
      );
    if (error || !signed?.signedUrl) {
      return { success: false, error: error?.message ?? "Failed to create signed URL" };
    }

    const subtypeName = (doc.document_subtype as unknown as { name?: string } | { name?: string }[] | null);
    const subtypeNameStr = Array.isArray(subtypeName)
      ? (subtypeName[0]?.name ?? null)
      : (subtypeName?.name ?? null);
    await logAudit({
      organisationId: caller.organisationId,
      actorId: caller.memberId,
      actorName: await callerName(admin, caller.memberId),
      // CLE-208 follow-up — inline access = viewed, download = downloaded.
      // Two distinct events read more naturally in the audit trail.
      action: mode === "download" ? "document.downloaded" : "document.viewed",
      targetType: "member_document",
      targetId: doc.id,
      targetLabel: doc.file_name,
      metadata: {
        member: memberDisplay(target),
        type_subtype: typeSubtypeLabel(doc.type as string, subtypeNameStr),
      },
    });

    return {
      success: true,
      url: signed.signedUrl,
      fileName: doc.file_name,
      contentType: doc.content_type,
    };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "An error occurred" };
  }
}

// ---------------------------------------------------------------------------
// Upload
// ---------------------------------------------------------------------------

export async function uploadMemberDocument(
  memberId: string,
  formData: FormData,
): Promise<{ success: boolean; error?: string; documentId?: string }> {
  try {
    const caller = await resolveCaller();
    if (!caller) return { success: false, error: "Not authenticated" };
    const admin = getAdmin();
    const target = await getTarget(admin, memberId, caller.organisationId);
    if (!target) return { success: false, error: "Document not found" };

    // Read + validate form fields.
    const file = formData.get("file");
    if (!(file instanceof File)) return { success: false, error: "No file supplied" };
    if (file.size > MAX_DOCUMENT_SIZE)
      return { success: false, error: "This file is too large. The limit is 10 MB." };
    if (!ALLOWED_CONTENT_TYPES.includes(file.type as (typeof ALLOWED_CONTENT_TYPES)[number])) {
      return { success: false, error: "This file type is not accepted." };
    }
    const subtypeId = formData.get("subtypeId");
    if (typeof subtypeId !== "string" || !subtypeId) {
      return { success: false, error: "Choose a document subtype." };
    }
    const expiresOnRaw = formData.get("expiresOn");
    const expiresOn = typeof expiresOnRaw === "string" && expiresOnRaw ? expiresOnRaw : null;

    // Load the subtype and check tenant scope + flags.
    const { data: subtype } = await admin
      .from("document_subtype")
      .select(
        "id, type, name, retention_class, expiry_required, employee_can_upload",
      )
      .eq("id", subtypeId)
      .eq("organisation_id", caller.organisationId)
      .single();
    if (!subtype) return { success: false, error: "That document type is not available." };
    if (subtype.expiry_required && !expiresOn) {
      return { success: false, error: "This document type needs an expiry date." };
    }
    // Past-expiry check removed to allow the retention/status sweeps
    // to be exercised end-to-end during testing.
    // Self-upload check — only enforced for callers whose scope is
    // 'self' (employees). Admins uploading against their own record
    // pass through unaffected.
    const isSelf = caller.isSelf(memberId);
    if (isSelf && caller.crossUserAccess === "self" && !subtype.employee_can_upload) {
      return {
        success: false,
        error: "You can't upload documents of this kind against your own record. Ask HR to upload it.",
      };
    }
    // Cross-user write permission on the target.
    if (!isSelf && !caller.canUpdateTarget({ memberId: target.id, teamId: target.team_id })) {
      return { success: false, error: "You don't have permission to add documents for this member." };
    }

    // Upload bytes to storage. Path convention: {tenant_id}/{uuid}.{ext}.
    const uuid = crypto.randomUUID();
    const ext = file.name.includes(".") ? file.name.substring(file.name.lastIndexOf(".")) : "";
    const storagePath = `${caller.organisationId}/${uuid}${ext}`;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const { error: uploadError } = await admin.storage
      .from(STORAGE_BUCKET)
      .upload(storagePath, bytes, { contentType: file.type, upsert: false });
    if (uploadError) return { success: false, error: uploadError.message };

    // Insert row. `disposal_date` stays NULL — member is active.
    // CLE-209 will stamp it on off-boarding.
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
        type: subtype.type,
        subtype_id: subtype.id,
        expires_on: expiresOn,
        retention_class: subtype.retention_class,
        uploaded_by: caller.memberId,
      })
      .select("id")
      .single();
    if (insertError || !inserted) {
      // Best-effort cleanup so we don't leak orphaned bytes.
      await admin.storage.from(STORAGE_BUCKET).remove([storagePath]);
      return { success: false, error: insertError?.message ?? "Failed to insert document" };
    }

    await logAudit({
      organisationId: caller.organisationId,
      actorId: caller.memberId,
      actorName: await callerName(admin, caller.memberId),
      action: "document.uploaded",
      targetType: "member_document",
      targetId: inserted.id,
      targetLabel: file.name,
      metadata: {
        member: memberDisplay(target),
        type_subtype: typeSubtypeLabel(subtype.type, subtype.name),
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
      .select("id, organisation_id, owner_scope, owner_id, type, subtype_id, expires_on, next_review_on, file_name, document_subtype!subtype_id(name)")
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
  opts: { forceDeleteReason?: string | null } = {},
): Promise<{ success: boolean; error?: string }> {
  try {
    const caller = await resolveCaller();
    if (!caller) return { success: false, error: "Not authenticated" };
    const admin = getAdmin();
    const { data: doc } = await admin
      .from("document")
      .select("id, organisation_id, owner_scope, owner_id, file_name, retention_class, disposal_date, type, document_subtype!subtype_id(name)")
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

    // Retention block: certain classes cannot be deleted while the
    // target member is active (disposal_date IS NULL). Force-delete
    // requires can_force_delete_documents + a reason.
    const requiresForce = PROTECTED_RETENTION_CLASSES.has(doc.retention_class as string)
      && doc.disposal_date === null;
    const reason = (opts.forceDeleteReason ?? "").trim();
    if (requiresForce) {
      if (!caller.canForceDelete) {
        return {
          success: false,
          error: `${doc.retention_class} evidence can't be deleted while the employee is still active.`,
        };
      }
      if (!reason) {
        return { success: false, error: "Please give a reason for force-deleting this document." };
      }
    }

    // Insert into the queue. Uniqueness on document_id prevents
    // double-queuing.
    const { error } = await admin
      .from("disposal_queue")
      .insert({
        organisation_id: caller.organisationId,
        document_id: documentId,
        queued_by: caller.memberId,
        force_delete_reason: requiresForce ? reason : null,
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
      .select("owner_id, file_name, type, document_subtype!subtype_id(name)")
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
      .select("id, organisation_id, owner_scope, owner_id, type, expires_on, file_name, document_subtype!subtype_id(name, requires_verification, review_period_months)")
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
    let nextReviewOn: string | null = input.nextReviewOn ?? null;
    if (nextReviewOn === null && stObj.review_period_months !== null) {
      const d = new Date(verifiedOn + "T00:00:00Z");
      d.setUTCMonth(d.getUTCMonth() + Number(stObj.review_period_months));
      nextReviewOn = d.toISOString().slice(0, 10);
    }
    if (nextReviewOn !== null && nextReviewOn < today) {
      return { success: false, error: "The next-review date can't be in the past." };
    }

    const { error } = await admin
      .from("document")
      .update({
        verified_on: verifiedOn,
        verified_by: caller.memberId,
        verification_notes: input.verificationNotes ?? null,
        next_review_on: nextReviewOn,
        updated_at: new Date().toISOString(),
      })
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
        next_review_on: nextReviewOn,
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
    defaultExpiryMonths: number | null;
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
        "id, type, name, retention_class, expiry_required, default_expiry_months, employee_can_upload, sort_order",
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
      default_expiry_months: number | null;
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
        defaultExpiryMonths: r.default_expiry_months,
        employeeCanUpload: r.employee_can_upload,
      })),
    };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "An error occurred", subtypes: [] };
  }
}
