"use server";

// CLE-208 — Org Documents server actions. Same `document` table as
// per-member documents, but `owner_scope = 'organisation'` and
// `owner_id IS NULL`. Files live in the `org-documents` storage
// bucket. Writes gated on can_edit_org_settings; reads gated on
// can_view_organisation_documents.

import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { getEffectiveRightsForUser } from "@/lib/rights-resolver";
import { logAudit } from "@/lib/audit";
import { buildDocumentsCallerFromCookies } from "@/lib/documents-caller";
import { _listOrgDocuments } from "./org-document-actions-impl";
import {
  AUDIENCE_COLUMNS,
  audienceFromRow,
  canSeeOrgDoc,
  isExpectedToAcknowledge,
  loadOrgDocMember,
  loadOrgDocMembers,
  type AudienceDbRow,
  type OrgDocAudience,
} from "@/lib/org-doc-audience";
import { ACK_LOCKED_REPLACE_ERROR, hasAnyAcknowledgement } from "@/lib/document-ack-lock";
import { deriveDocumentStatuses, nextReviewAfterReview, seedNextReviewOn } from "@/lib/document-status";
import {
  ALLOWED_DOCUMENT_CONTENT_TYPES as ALLOWED_CONTENT_TYPES,
  MAX_DOCUMENT_SIZE as MAX_SIZE,
  ORG_DOCUMENTS_BUCKET as BUCKET,
} from "@/lib/document-limits";

// Only these types make sense at the org scope. Enforced at the
// picker + upload validation (the DB doesn't constrain — a tenant
// could theoretically stash any type but the UI won't offer it).
// CLE-210 — one org-scope type, `organisation_document`. The three
// legacy types (policy / handbook / other) were migrated into it by
// migration 20260904000001.
const ORG_TYPES = new Set(["organisation_document"]);

// CLE-227 — `OrgDocumentRow` moved to `./org-document-actions-impl`.
// Locally imported so `OrgDocumentRowForMember extends OrgDocumentRow`
// still resolves, but NOT re-exported — Turbopack's production build
// fails on `export type` from a `"use server"` file. Consumers import
// `OrgDocumentRow` directly from `./org-document-actions-impl`.
import type { OrgDocumentRow } from "./org-document-actions-impl";

function getAdmin() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

type Ctx = {
  memberId: string;
  organisationId: string;
  teamId: string | null;
  rightsProfileId: string | null;
  canEdit: boolean;
  canView: boolean;
};
async function ctx(): Promise<Ctx | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const resolved = await getEffectiveRightsForUser(user.id);
  if (!resolved) return null;
  return {
    memberId: resolved.ctx.memberId,
    organisationId: resolved.ctx.organisationId,
    teamId: resolved.ctx.teamId,
    rightsProfileId: resolved.rights.profileId,
    canEdit: resolved.rights.canManageOrganisationDocuments,
    canView: resolved.rights.canViewOrganisationDocuments,
  };
}

async function callerName(admin: ReturnType<typeof getAdmin>, memberId: string): Promise<string> {
  const { data } = await admin
    .from("members")
    .select("first_name, last_name")
    .eq("id", memberId)
    .single();
  return `${data?.first_name ?? ""} ${data?.last_name ?? ""}`.trim() || "Unknown";
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

// CLE-227 — thin cookies-auth passthrough over `_listOrgDocuments`.
// Impl body lives in `./org-document-actions-impl` and is shared with
// the mobile API-route wrapper at /api/mobile/documents/org.
export async function listOrgDocuments(): Promise<{
  success: boolean;
  error?: string;
  rows: OrgDocumentRow[];
}> {
  const caller = await buildDocumentsCallerFromCookies();
  if (!caller) return { success: false, error: "Not authenticated", rows: [] };
  return _listOrgDocuments(caller);
}

// CLE-234 — Org documents needing HR attention (expired / expiring soon
// / overdue review / review due soon). Counted once per document on the
// admin dashboard's Documents card. Managers only.
export interface OrgDocAttentionRow {
  id: string;
  name: string;
  fileName: string;
  statuses: OrgDocumentRow["statuses"];
}

export async function getOrgDocumentsNeedingAttention(): Promise<{
  success: boolean;
  error?: string;
  rows: OrgDocAttentionRow[];
}> {
  const caller = await buildDocumentsCallerFromCookies();
  if (!caller) return { success: false, error: "Not authenticated", rows: [] };
  if (!caller.rights.canManageOrganisationDocuments) return { success: true, rows: [] };
  const res = await _listOrgDocuments(caller);
  if (!res.success) return { success: false, error: res.error, rows: [] };
  const rank = (st: OrgDocumentRow["statuses"]) =>
    st.includes("expired") ? 0 : st.includes("overdue_review") ? 1 : st.includes("expiring_soon") ? 2 : 3;
  const rows = res.rows
    .filter((r) => r.statuses.length > 0)
    .map((r) => ({ id: r.id, name: r.subtypeName ?? r.fileName, fileName: r.fileName, statuses: r.statuses }))
    .sort((a, b) => rank(a.statuses) - rank(b.statuses) || a.name.localeCompare(b.name));
  return { success: true, rows };
}

// ---------------------------------------------------------------------------
// List for a target member (CLE-224)
// ---------------------------------------------------------------------------

// CLE-224 — Same OrgDocumentRow shape as `listOrgDocuments` but the
// per-row ack state is scoped to the target member rather than the
// caller. Powers the "Org Documents" tab on the admin's per-member
// docs surface (`/members/[memberId]/docs`), so an admin can see
// which organisation-wide docs a specific employee has or hasn't
// acknowledged.
export interface OrgDocumentRowForMember extends OrgDocumentRow {
  /** True when the target member has an outstanding
   *  `document_acknowledgement` row (superseded rows ignored). */
  isAcknowledgedByTarget: boolean;
  /** CLE-230 — true when the target member can see this doc (the
   *  doc's audience includes them, or they manage org docs). The
   *  per-member Org Docs tab lists only viewable rows. */
  viewable: boolean;
  /** CLE-230 — true when the target is in the doc's audience and so is
   *  expected to acknowledge it. Drives the "Awaiting Ack" pill. */
  expectedByTarget: boolean;
}

/**
 * List every org-scope document in the caller's tenant with ack
 * state resolved against a specific *target* member (not the caller).
 *
 * Access — caller must EITHER have `can_view_organisation_documents`
 * OR have admin-scope reach to the target (`crossUserAccess !==
 * "self"` and target is in the caller's org). A self-scope caller
 * looking at their own docs already has `/my-documents` for this
 * data, so we don't route them through here.
 *
 * The `isAcknowledged` flag inherited from `OrgDocumentRow` is set
 * from the *caller's* ack state (mirrors `listOrgDocuments`);
 * consumers should read `isAcknowledgedByTarget` instead. Callers
 * that render the admin-viewing-employee UI ignore `isAcknowledged`.
 */
export async function getOrgDocumentsForMember(
  memberId: string,
): Promise<
  | { success: true; rows: OrgDocumentRowForMember[] }
  | { success: false; error: string }
> {
  try {
    const c = await ctx();
    if (!c) return { success: false, error: "Not authenticated" };
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: "Not authenticated" };
    const resolved = await getEffectiveRightsForUser(user.id);
    if (!resolved) return { success: false, error: "Not authenticated" };

    const admin = getAdmin();

    // Verify target is in the caller's org — a caller may never
    // reach across tenants regardless of their crossUserAccess.
    const { data: target } = await admin
      .from("members")
      .select("id, organisation_id")
      .eq("id", memberId)
      .maybeSingle();
    if (!target || target.organisation_id !== c.organisationId) {
      return { success: false, error: "Not authorised" };
    }

    const hasAdminReach = resolved.rights.crossUserAccess !== "self";
    if (!c.canView && !hasAdminReach) {
      return { success: false, error: "Not authorised" };
    }

    // Skip queued rows (soft-deleted) — mirrors listOrgDocuments.
    const { data: queued } = await admin
      .from("disposal_queue")
      .select("document_id")
      .eq("organisation_id", c.organisationId);
    const queuedIds = new Set<string>((queued ?? []).map((r) => r.document_id as string));

    const { data, error } = await admin
      .from("document")
      .select(
        "id, file_name, file_size, content_type, type, subtype_id, expires_on, next_review_on, uploaded_by, uploaded_at, " +
        AUDIENCE_COLUMNS +
        ", document_subtype!subtype_id(name, requires_acknowledgement), members!uploaded_by(first_name, last_name)",
      )
      .eq("organisation_id", c.organisationId)
      .eq("owner_scope", "organisation")
      .order("uploaded_at", { ascending: false });
    if (error) return { success: false, error: error.message };

    type Row = AudienceDbRow & {
      id: string;
      file_name: string;
      file_size: number;
      content_type: string;
      type: string;
      subtype_id: string | null;
      expires_on: string | null;
      next_review_on: string | null;
      uploaded_by: string | null;
      uploaded_at: string;
      document_subtype:
        | { name: string; requires_acknowledgement?: boolean }
        | { name: string; requires_acknowledgement?: boolean }[]
        | null;
      members:
        | { first_name: string; last_name: string }
        | { first_name: string; last_name: string }[]
        | null;
    };
    const visibleRows = (data ?? [])
      .map((r) => r as unknown as Row)
      .filter((r) => !queuedIds.has(r.id));

    // Target's ack rows across the visible set. One batch read.
    const targetAckedSet = new Set<string>();
    if (visibleRows.length > 0) {
      const { data: acks } = await admin
        .from("document_acknowledgement")
        .select("document_id")
        .eq("member_id", memberId)
        .is("superseded_by_replace_at", null)
        .in("document_id", visibleRows.map((r) => r.id));
      for (const a of ((acks ?? []) as { document_id: string }[])) {
        targetAckedSet.add(a.document_id);
      }
    }

    // CLE-230 — evaluate each doc's audience against the target.
    const targetMember = await loadOrgDocMember(admin, c.organisationId, memberId);

    const rows: OrgDocumentRowForMember[] = visibleRows.map((r) => {
      const st = r.document_subtype;
      const stObj = Array.isArray(st) ? (st[0] ?? null) : st;
      const mem = r.members;
      const memPair = Array.isArray(mem) ? (mem[0] ?? null) : mem;
      const requiresAcknowledgement = stObj?.requires_acknowledgement === true;
      const isAcknowledgedByTarget = targetAckedSet.has(r.id);
      return {
        id: r.id,
        fileName: r.file_name,
        fileSize: r.file_size,
        contentType: r.content_type,
        type: r.type,
        subtypeId: r.subtype_id,
        subtypeName: stObj?.name ?? null,
        expiresOn: r.expires_on,
        nextReviewOn: r.next_review_on,
        statuses: deriveDocumentStatuses({
          requiresVerification: false,
          verifiedOn: null,
          expiresOn: r.expires_on,
          nextReviewOn: r.next_review_on,
        }),
        uploadedBy: `${memPair?.first_name ?? ""} ${memPair?.last_name ?? ""}`.trim() || "Unknown",
        uploadedAt: r.uploaded_at,
        requiresAcknowledgement,
        // The `isAcknowledged` field on the base row reflects the
        // *caller* — kept only so the shape matches OrgDocumentRow;
        // admin surfaces should read `isAcknowledgedByTarget`.
        isAcknowledged: false,
        acknowledgedAt: null,
        isAcknowledgedByTarget,
        audienceMode: audienceFromRow(r).mode,
        audienceCount: null,
        viewable: targetMember ? canSeeOrgDoc(audienceFromRow(r), targetMember) : false,
        expectedByTarget: targetMember ? isExpectedToAcknowledge(audienceFromRow(r), targetMember) : false,
      };
    });
    return { success: true, rows };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "An error occurred" };
  }
}

// ---------------------------------------------------------------------------
// Signed URL
// ---------------------------------------------------------------------------

export async function getOrgDocumentSignedUrl(
  documentId: string,
  mode: "inline" | "download",
): Promise<{ success: boolean; error?: string; url?: string; fileName?: string; contentType?: string }> {
  try {
    const c = await ctx();
    if (!c) return { success: false, error: "Not authenticated" };
    if (!c.canView) return { success: false, error: "Document not found" };
    const admin = getAdmin();

    const { data: docRaw } = await admin
      .from("document")
      .select("id, organisation_id, owner_scope, storage_path, file_name, file_size, content_type, type, " + AUDIENCE_COLUMNS + ", document_subtype!subtype_id(name)")
      .eq("id", documentId)
      .single();
    const doc = docRaw as unknown as (AudienceDbRow & {
      id: string; organisation_id: string; owner_scope: string; storage_path: string;
      file_name: string; file_size: number; content_type: string; type: string;
      document_subtype: unknown;
    }) | null;
    if (!doc || doc.organisation_id !== c.organisationId || doc.owner_scope !== "organisation") {
      return { success: false, error: "Document not found" };
    }
    // CLE-230 — outside the doc's audience → not found (never leak existence).
    if (!canSeeOrgDoc(audienceFromRow(doc), {
      id: c.memberId, teamId: c.teamId, rightsProfileId: c.rightsProfileId,
      signedIn: true, invited: true, canView: c.canView, canManage: c.canEdit,
    })) {
      return { success: false, error: "Document not found" };
    }

    const { data: signed, error } = await admin.storage
      .from(BUCKET)
      .createSignedUrl(
        doc.storage_path,
        120,
        mode === "download" ? { download: doc.file_name } : undefined,
      );
    if (error || !signed?.signedUrl) {
      return { success: false, error: error?.message ?? "Failed to create signed URL" };
    }

    const stAny = doc.document_subtype as unknown as { name?: string } | { name?: string }[] | null;
    const subtypeName = Array.isArray(stAny) ? (stAny[0]?.name ?? null) : (stAny?.name ?? null);
    await logAudit({
      organisationId: c.organisationId,
      actorId: c.memberId,
      actorName: await callerName(admin, c.memberId),
      // CLE-208 follow-up — split View from Download in the audit trail.
      action: mode === "download" ? "document.downloaded" : "document.viewed",
      targetType: "org_document",
      targetId: doc.id,
      targetLabel: doc.file_name,
      metadata: {
        type_subtype: subtypeName ? `${doc.type} / ${subtypeName}` : doc.type,
        // CLE-219 — file_name + file_size on every doc audit.
        file_name: doc.file_name as string,
        file_size: doc.file_size as number,
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

export async function uploadOrgDocument(
  formData: FormData,
): Promise<{ success: boolean; error?: string; documentId?: string }> {
  try {
    const c = await ctx();
    if (!c) return { success: false, error: "Not authenticated" };
    if (!c.canEdit) return { success: false, error: "You don't have permission to publish organisation documents." };
    const admin = getAdmin();

    const file = formData.get("file");
    if (!(file instanceof File)) return { success: false, error: "No file supplied" };
    if (file.size > MAX_SIZE) return { success: false, error: "This file is too large. The limit is 10 MB." };
    if (!ALLOWED_CONTENT_TYPES.includes(file.type as (typeof ALLOWED_CONTENT_TYPES)[number])) {
      return { success: false, error: "This file type is not accepted." };
    }
    const subtypeId = formData.get("subtypeId");
    if (typeof subtypeId !== "string" || !subtypeId) {
      return { success: false, error: "Choose a document subtype." };
    }
    const expiresOnRaw = formData.get("expiresOn");
    const expiresOn = typeof expiresOnRaw === "string" && expiresOnRaw ? expiresOnRaw : null;

    const { data: subtype } = await admin
      .from("document_subtype")
      .select("id, type, name, retention_class, expiry_required, review_period_months")
      .eq("id", subtypeId)
      .eq("organisation_id", c.organisationId)
      .single();
    if (!subtype) return { success: false, error: "That document type is not available." };
    if (!ORG_TYPES.has(subtype.type as string)) {
      return { success: false, error: "This subtype isn't allowed for organisation documents." };
    }
    if (subtype.expiry_required && !expiresOn) {
      return { success: false, error: "This document type needs an expiry date." };
    }
    // Past-expiry check intentionally omitted to allow the
    // retention/status sweeps to be tested end-to-end.

    const uuid = crypto.randomUUID();
    const ext = file.name.includes(".") ? file.name.substring(file.name.lastIndexOf(".")) : "";
    const storagePath = `${c.organisationId}/${uuid}${ext}`;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const { error: uploadError } = await admin.storage
      .from(BUCKET)
      .upload(storagePath, bytes, { contentType: file.type, upsert: false });
    if (uploadError) return { success: false, error: uploadError.message };

    const { data: inserted, error: insertError } = await admin
      .from("document")
      .insert({
        organisation_id: c.organisationId,
        owner_scope: "organisation",
        owner_id: null,
        storage_path: storagePath,
        file_name: file.name.substring(0, 255),
        file_size: file.size,
        content_type: file.type,
        type: subtype.type,
        subtype_id: subtype.id,
        expires_on: expiresOn,
        retention_class: subtype.retention_class,
        // CLE-234 — Next review date seeded from the subtype's interval.
        next_review_on: seedNextReviewOn(subtype.review_period_months as number | null),
        uploaded_by: c.memberId,
      })
      .select("id")
      .single();
    if (insertError || !inserted) {
      await admin.storage.from(BUCKET).remove([storagePath]);
      return { success: false, error: insertError?.message ?? "Failed to insert document" };
    }

    await logAudit({
      organisationId: c.organisationId,
      actorId: c.memberId,
      actorName: await callerName(admin, c.memberId),
      action: "document.uploaded",
      targetType: "org_document",
      targetId: inserted.id,
      targetLabel: file.name,
      metadata: {
        type_subtype: `${subtype.type} / ${subtype.name}`,
        // CLE-219 — file_name + file_size on every doc audit.
        file_name: file.name.substring(0, 255),
        file_size: file.size,
      },
    });

    revalidatePath("/settings/documents/organisation");
    revalidatePath("/documents/organisation");
    return { success: true, documentId: inserted.id as string };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "An error occurred" };
  }
}

// ---------------------------------------------------------------------------
// Replace file (org-scope counterpart of replaceMemberDocument)
//
// Same rules as the member path: only while the document is unverified
// and nobody has acknowledged it. Inserts a new row that inherits the
// old one's subtype, expiry, retention and audience, moves the old row
// to Trash (disposal_queue), and writes `document.replaced` on the new
// id with `replaces_document_id` pointing back.
// ---------------------------------------------------------------------------

export async function replaceOrgDocument(
  oldDocumentId: string,
  formData: FormData,
): Promise<{ success: boolean; error?: string; documentId?: string }> {
  try {
    const c = await ctx();
    if (!c) return { success: false, error: "Not authenticated" };
    if (!c.canEdit) return { success: false, error: "You don't have permission to change organisation documents." };
    const admin = getAdmin();

    const { data: oldDoc } = await admin
      .from("document")
      .select(
        "id, organisation_id, owner_scope, file_name, file_size, type, subtype_id, expires_on, retention_class, next_review_on, verified_on, " +
          AUDIENCE_COLUMNS +
          ", document_subtype!subtype_id(name)",
      )
      .eq("id", oldDocumentId)
      .single();
    const old = oldDoc as unknown as
      | (AudienceDbRow & {
          id: string;
          organisation_id: string;
          owner_scope: string;
          file_name: string;
          file_size: number;
          type: string;
          subtype_id: string | null;
          expires_on: string | null;
          retention_class: string | null;
          next_review_on: string | null;
          verified_on: string | null;
          document_subtype: { name?: string } | { name?: string }[] | null;
        })
      | null;
    if (!old || old.organisation_id !== c.organisationId || old.owner_scope !== "organisation") {
      return { success: false, error: "Document not found" };
    }
    if (old.verified_on !== null) {
      return {
        success: false,
        error: "Verified documents can't be replaced — delete and add a new one instead.",
      };
    }
    if (await hasAnyAcknowledgement(admin, oldDocumentId)) {
      return { success: false, error: ACK_LOCKED_REPLACE_ERROR };
    }
    const { data: queued } = await admin
      .from("disposal_queue")
      .select("id")
      .eq("document_id", oldDocumentId)
      .maybeSingle();
    if (queued) return { success: false, error: "This document is in Trash." };

    const file = formData.get("file");
    if (!(file instanceof File)) return { success: false, error: "No file supplied" };
    if (file.size > MAX_SIZE) return { success: false, error: "This file is too large. The limit is 10 MB." };
    if (!ALLOWED_CONTENT_TYPES.includes(file.type as (typeof ALLOWED_CONTENT_TYPES)[number])) {
      return { success: false, error: "This file type is not accepted." };
    }

    const uuid = crypto.randomUUID();
    const ext = file.name.includes(".") ? file.name.substring(file.name.lastIndexOf(".")) : "";
    const storagePath = `${c.organisationId}/${uuid}${ext}`;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const { error: uploadError } = await admin.storage
      .from(BUCKET)
      .upload(storagePath, bytes, { contentType: file.type, upsert: false });
    if (uploadError) return { success: false, error: uploadError.message };

    const { data: inserted, error: insertError } = await admin
      .from("document")
      .insert({
        organisation_id: c.organisationId,
        owner_scope: "organisation",
        owner_id: null,
        storage_path: storagePath,
        file_name: file.name.substring(0, 255),
        file_size: file.size,
        content_type: file.type,
        type: old.type,
        subtype_id: old.subtype_id,
        expires_on: old.expires_on,
        retention_class: old.retention_class,
        next_review_on: old.next_review_on,
        audience_mode: old.audience_mode ?? "all",
        audience_team_ids: old.audience_team_ids ?? [],
        audience_rights_profile_ids: old.audience_rights_profile_ids ?? [],
        audience_include_member_ids: old.audience_include_member_ids ?? [],
        uploaded_by: c.memberId,
      })
      .select("id")
      .single();
    if (insertError || !inserted) {
      await admin.storage.from(BUCKET).remove([storagePath]);
      return { success: false, error: insertError?.message ?? "Failed to insert replacement document" };
    }

    const { error: queueError } = await admin.from("disposal_queue").insert({
      organisation_id: c.organisationId,
      document_id: oldDocumentId,
      queued_by: c.memberId,
      force_delete_reason: "Replaced by uploader",
    });
    if (queueError) {
      await admin.from("document").delete().eq("id", inserted.id as string);
      await admin.storage.from(BUCKET).remove([storagePath]);
      return { success: false, error: queueError.message };
    }

    const st = old.document_subtype;
    const subtypeName = Array.isArray(st) ? (st[0]?.name ?? null) : (st?.name ?? null);
    await logAudit({
      organisationId: c.organisationId,
      actorId: c.memberId,
      actorName: await callerName(admin, c.memberId),
      action: "document.replaced",
      targetType: "org_document",
      targetId: inserted.id as string,
      targetLabel: file.name,
      changes: {
        file_name: { old: old.file_name, new: file.name },
        file_size: { old: old.file_size, new: file.size },
      },
      metadata: {
        type_subtype: subtypeName ? `${old.type} / ${subtypeName}` : old.type,
        replaces_document_id: oldDocumentId,
        file_name: file.name.substring(0, 255),
        file_size: file.size,
      },
    });

    revalidatePath("/settings/documents/organisation");
    revalidatePath("/documents/organisation");
    return { success: true, documentId: inserted.id as string };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "An error occurred" };
  }
}

// ---------------------------------------------------------------------------
// Edit metadata / delete
// ---------------------------------------------------------------------------

export async function updateOrgDocumentMetadata(
  documentId: string,
  patch: { subtypeId?: string | null; expiresOn?: string | null; nextReviewOn?: string | null },
): Promise<{ success: boolean; error?: string }> {
  try {
    const c = await ctx();
    if (!c) return { success: false, error: "Not authenticated" };
    if (!c.canEdit) return { success: false, error: "You don't have permission to change organisation documents." };
    const admin = getAdmin();

    const { data: doc } = await admin
      .from("document")
      .select("id, organisation_id, owner_scope, type, subtype_id, expires_on, next_review_on, file_name, file_size, document_subtype!subtype_id(name)")
      .eq("id", documentId)
      .single();
    if (!doc || doc.organisation_id !== c.organisationId || doc.owner_scope !== "organisation") {
      return { success: false, error: "Document not found" };
    }

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (patch.subtypeId !== undefined) {
      if (patch.subtypeId === null) {
        updates.subtype_id = null;
      } else {
        const { data: subtype } = await admin
          .from("document_subtype")
          .select("id, type, retention_class, expiry_required")
          .eq("id", patch.subtypeId)
          .eq("organisation_id", c.organisationId)
          .single();
        if (!subtype) return { success: false, error: "That document type is not available." };
        if (subtype.type !== doc.type) {
          return { success: false, error: "The chosen subtype does not belong to this document type." };
        }
        updates.subtype_id = subtype.id;
        updates.retention_class = subtype.retention_class;
        if (subtype.expiry_required && !(patch.expiresOn ?? doc.expires_on)) {
          return { success: false, error: "This document type needs an expiry date." };
        }
      }
    }
    if (patch.expiresOn !== undefined) {
      updates.expires_on = patch.expiresOn;
    }
    if (patch.nextReviewOn !== undefined) {
      updates.next_review_on = patch.nextReviewOn;
    }
    if (Object.keys(updates).length === 1) return { success: true };

    const { error } = await admin
      .from("document")
      .update(updates)
      .eq("id", documentId)
      .eq("organisation_id", c.organisationId);
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
      const stAny = doc.document_subtype as unknown as { name?: string } | { name?: string }[] | null;
      const subtypeName = Array.isArray(stAny) ? (stAny[0]?.name ?? null) : (stAny?.name ?? null);
      await logAudit({
        organisationId: c.organisationId,
        actorId: c.memberId,
        actorName: await callerName(admin, c.memberId),
        action: "document.metadata_updated",
        targetType: "org_document",
        targetId: documentId,
        targetLabel: (doc.file_name as string) ?? "",
        changes,
        metadata: {
          type_subtype: subtypeName ? `${doc.type} / ${subtypeName}` : (doc.type as string),
          // CLE-219 — file_name + file_size on every doc audit.
          file_name: doc.file_name as string,
          file_size: doc.file_size as number,
        },
      });
    }

    revalidatePath("/settings/documents/organisation");
    revalidatePath("/documents/organisation");
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "An error occurred" };
  }
}

// CLE-234 — Mark as reviewed (org scope). Same rule as member docs:
// Next review date = today + the subtype's interval, or cleared when the
// interval is None. Audited only when the date actually changes.
export async function markOrgDocumentReviewed(
  documentId: string,
): Promise<{ success: boolean; error?: string; nextReviewOn?: string | null; changed?: boolean }> {
  try {
    const c = await ctx();
    if (!c) return { success: false, error: "Not authenticated" };
    if (!c.canEdit) return { success: false, error: "You don't have permission to change organisation documents." };
    const admin = getAdmin();

    const { data: doc } = await admin
      .from("document")
      .select("id, organisation_id, owner_scope, type, next_review_on, file_name, file_size, document_subtype!subtype_id(name, review_period_months)")
      .eq("id", documentId)
      .single();
    if (!doc || doc.organisation_id !== c.organisationId || doc.owner_scope !== "organisation") {
      return { success: false, error: "Document not found" };
    }
    const st = doc.document_subtype as unknown as { name?: string; review_period_months?: number | null } | { name?: string; review_period_months?: number | null }[] | null;
    const stObj = Array.isArray(st) ? (st[0] ?? null) : st;

    const oldDate = (doc.next_review_on as string | null) ?? null;
    const newDate = nextReviewAfterReview(stObj?.review_period_months ?? null);
    if (newDate === oldDate) return { success: true, nextReviewOn: oldDate, changed: false };

    const { error } = await admin
      .from("document")
      .update({ next_review_on: newDate, updated_at: new Date().toISOString() })
      .eq("id", documentId)
      .eq("organisation_id", c.organisationId);
    if (error) return { success: false, error: error.message };

    await logAudit({
      organisationId: c.organisationId,
      actorId: c.memberId,
      actorName: await callerName(admin, c.memberId),
      action: "document.reviewed",
      targetType: "org_document",
      targetId: documentId,
      targetLabel: (doc.file_name as string) ?? "",
      changes: { next_review_on: { old: oldDate, new: newDate } },
      metadata: {
        type_subtype: stObj?.name ? `${doc.type} / ${stObj.name}` : (doc.type as string),
        file_name: doc.file_name as string,
        file_size: doc.file_size as number,
      },
    });

    revalidatePath("/documents/organisation");
    return { success: true, nextReviewOn: newDate, changed: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "An error occurred" };
  }
}

export async function softDeleteOrgDocument(
  documentId: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const c = await ctx();
    if (!c) return { success: false, error: "Not authenticated" };
    if (!c.canEdit) return { success: false, error: "You don't have permission to delete organisation documents." };
    const admin = getAdmin();

    const { data: doc } = await admin
      .from("document")
      .select("id, organisation_id, owner_scope, file_name, file_size, type, document_subtype!subtype_id(name)")
      .eq("id", documentId)
      .single();
    if (!doc || doc.organisation_id !== c.organisationId || doc.owner_scope !== "organisation") {
      return { success: false, error: "Document not found" };
    }

    const { error } = await admin
      .from("disposal_queue")
      .insert({
        organisation_id: c.organisationId,
        document_id: documentId,
        queued_by: c.memberId,
      });
    if (error) return { success: false, error: error.message };

    const stAny = doc.document_subtype as unknown as { name?: string } | { name?: string }[] | null;
    const subtypeName = Array.isArray(stAny) ? (stAny[0]?.name ?? null) : (stAny?.name ?? null);
    await logAudit({
      organisationId: c.organisationId,
      actorId: c.memberId,
      actorName: await callerName(admin, c.memberId),
      action: "document.deleted",
      targetType: "org_document",
      targetId: documentId,
      targetLabel: doc.file_name as string,
      metadata: {
        type_subtype: subtypeName ? `${doc.type} / ${subtypeName}` : (doc.type as string),
        // CLE-219 — file_name + file_size on every doc audit.
        file_name: doc.file_name as string,
        file_size: doc.file_size as number,
      },
    });

    revalidatePath("/settings/documents/organisation");
    revalidatePath("/documents/organisation");
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "An error occurred" };
  }
}

// ---------------------------------------------------------------------------
// Per-document audience (CLE-230)
// ---------------------------------------------------------------------------
//
// Replaces the per-member Viewable toggle (CLE-225, removed). Each org
// doc carries its own audience — see src/lib/org-doc-audience.ts for
// the rules.

export interface AudienceOptionTeam { id: string; name: string }
export interface AudienceOptionProfile { id: string; name: string }
export interface AudienceOptionMember {
  id: string;
  name: string;
  teamId: string | null;
  rightsProfileId: string | null;
  /** Profile grants can_view_organisation_documents. Members without it
   *  can never see org docs, whatever the audience. */
  canView: boolean;
}

export async function getOrgDocumentAudience(documentId: string): Promise<
  | {
      success: true;
      audience: OrgDocAudience;
      teams: AudienceOptionTeam[];
      profiles: AudienceOptionProfile[];
      members: AudienceOptionMember[];
    }
  | { success: false; error: string }
> {
  try {
    const c = await ctx();
    if (!c) return { success: false, error: "Not authenticated" };
    if (!c.canEdit) return { success: false, error: "You don't have permission to change organisation documents." };
    const admin = getAdmin();

    const { data: doc } = await admin
      .from("document")
      .select("id, organisation_id, owner_scope, " + AUDIENCE_COLUMNS)
      .eq("id", documentId)
      .maybeSingle();
    const d = doc as unknown as (AudienceDbRow & { organisation_id: string; owner_scope: string }) | null;
    if (!d || d.organisation_id !== c.organisationId || d.owner_scope !== "organisation") {
      return { success: false, error: "Document not found" };
    }

    const [{ data: teams }, { data: profiles }, { data: members }] = await Promise.all([
      admin.from("teams").select("id, name").eq("organisation_id", c.organisationId).order("name"),
      admin.from("rights_profiles").select("id, name, sort_order").eq("organisation_id", c.organisationId)
        .order("sort_order", { ascending: true }).order("name", { ascending: true }),
      admin.from("members")
        .select("id, first_name, last_name, team_id, rights_profile_id, rights_profiles(can_view_organisation_documents)")
        .eq("organisation_id", c.organisationId)
        .order("first_name", { ascending: true }),
    ]);

    type M = {
      id: string; first_name: string | null; last_name: string | null;
      team_id: string | null; rights_profile_id: string | null;
      rights_profiles: { can_view_organisation_documents?: boolean } | { can_view_organisation_documents?: boolean }[] | null;
    };
    return {
      success: true,
      audience: audienceFromRow(d),
      teams: ((teams ?? []) as { id: string; name: string }[]).map((t) => ({ id: t.id, name: t.name })),
      profiles: ((profiles ?? []) as { id: string; name: string }[]).map((p) => ({ id: p.id, name: p.name })),
      members: ((members ?? []) as unknown as M[]).map((m) => {
        const rp = Array.isArray(m.rights_profiles) ? m.rights_profiles[0] : m.rights_profiles;
        return {
          id: m.id,
          name: `${m.first_name ?? ""} ${m.last_name ?? ""}`.trim() || "—",
          teamId: m.team_id,
          rightsProfileId: m.rights_profile_id,
          canView: rp?.can_view_organisation_documents === true,
        };
      }),
    };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "An error occurred" };
  }
}

export async function setOrgDocumentAudience(
  documentId: string,
  audience: OrgDocAudience,
): Promise<{ success: true } | { success: false; error: string }> {
  try {
    const c = await ctx();
    if (!c) return { success: false, error: "Not authenticated" };
    if (!c.canEdit) return { success: false, error: "You don't have permission to change organisation documents." };
    const admin = getAdmin();

    const { data: doc } = await admin
      .from("document")
      .select("id, organisation_id, owner_scope, file_name, file_size, " + AUDIENCE_COLUMNS)
      .eq("id", documentId)
      .maybeSingle();
    const d = doc as unknown as (AudienceDbRow & {
      id: string; organisation_id: string; owner_scope: string; file_name: string; file_size: number;
    }) | null;
    if (!d || d.organisation_id !== c.organisationId || d.owner_scope !== "organisation") {
      return { success: false, error: "Document not found" };
    }

    const mode = audience.mode === "selected" ? "selected" : "all";
    const uniq = (xs: string[]) => Array.from(new Set(xs.filter((x) => typeof x === "string" && x)));
    let teamIds = mode === "selected" ? uniq(audience.teamIds) : [];
    let profileIds = mode === "selected" ? uniq(audience.rightsProfileIds) : [];
    let includeIds = mode === "selected" ? uniq(audience.includeMemberIds) : [];

    // Never trust client ids — keep only ones that belong to this org.
    const [{ data: tRows }, { data: pRows }, { data: mRows }] = await Promise.all([
      teamIds.length ? admin.from("teams").select("id, name").eq("organisation_id", c.organisationId).in("id", teamIds) : Promise.resolve({ data: [] }),
      profileIds.length ? admin.from("rights_profiles").select("id, name").eq("organisation_id", c.organisationId).in("id", profileIds) : Promise.resolve({ data: [] }),
      includeIds.length ? admin.from("members").select("id, first_name, last_name").eq("organisation_id", c.organisationId).in("id", includeIds) : Promise.resolve({ data: [] }),
    ]);
    const teamsOk = (tRows ?? []) as { id: string; name: string }[];
    const profilesOk = (pRows ?? []) as { id: string; name: string }[];
    const membersOk = (mRows ?? []) as { id: string; first_name: string | null; last_name: string | null }[];
    teamIds = teamsOk.map((t) => t.id);
    profileIds = profilesOk.map((p) => p.id);
    includeIds = membersOk.map((m) => m.id);

    if (mode === "selected" && teamIds.length === 0 && profileIds.length === 0 && includeIds.length === 0) {
      return { success: false, error: "Choose at least one team, User Rights profile or person — or switch back to Everyone." };
    }

    const before = audienceFromRow(d);
    const { error } = await admin
      .from("document")
      .update({
        audience_mode: mode,
        audience_team_ids: teamIds,
        audience_rights_profile_ids: profileIds,
        audience_include_member_ids: includeIds,
        updated_at: new Date().toISOString(),
      })
      .eq("id", documentId)
      .eq("organisation_id", c.organisationId);
    if (error) return { success: false, error: error.message };

    const after: OrgDocAudience = { mode, teamIds, rightsProfileIds: profileIds, includeMemberIds: includeIds };
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      const members = await loadOrgDocMembers(admin, c.organisationId);
      const audienceSize = members.filter((m) => isExpectedToAcknowledge(after, m)).length;
      await logAudit({
        organisationId: c.organisationId,
        actorId: c.memberId,
        actorName: await callerName(admin, c.memberId),
        action: "document.audience_changed",
        targetType: "org_document",
        targetId: documentId,
        targetLabel: d.file_name,
        changes: {
          audience_mode: {
            old: before.mode === "all" ? "Everyone" : "Selected members",
            new: mode === "all" ? "Everyone" : "Selected members",
          },
        },
        metadata: {
          audience_teams: teamsOk.map((t) => t.name).join(", ") || null,
          audience_profiles: profilesOk.map((p) => p.name).join(", ") || null,
          audience_always_include: membersOk
            .map((m) => `${m.first_name ?? ""} ${m.last_name ?? ""}`.trim())
            .join(", ") || null,
          audience_size: audienceSize,
          file_name: d.file_name,
          file_size: d.file_size,
        },
      });
    }

    revalidatePath("/documents/organisation");
    revalidatePath("/documents/compliance");
    revalidatePath("/my-documents");
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "An error occurred" };
  }
}

// ---------------------------------------------------------------------------
// Subtype list for the upload picker.
// ---------------------------------------------------------------------------

export async function getOrgUploadSubtypes(): Promise<{
  success: boolean;
  error?: string;
  subtypes: Array<{
    id: string;
    type: string;
    name: string;
    retentionClass: string;
    expiryRequired: boolean;
  }>;
}> {
  try {
    const c = await ctx();
    if (!c) return { success: false, error: "Not authenticated", subtypes: [] };
    const admin = getAdmin();
    const { data, error } = await admin
      .from("document_subtype")
      .select("id, type, name, retention_class, expiry_required, sort_order")
      .eq("organisation_id", c.organisationId)
      .in("type", Array.from(ORG_TYPES))
      .order("type", { ascending: true })
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true });
    if (error) return { success: false, error: error.message, subtypes: [] };
    return {
      success: true,
      subtypes: (data ?? []).map((r) => ({
        id: r.id as string,
        type: r.type as string,
        name: r.name as string,
        retentionClass: r.retention_class as string,
        expiryRequired: r.expiry_required as boolean,
      })),
    };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "An error occurred", subtypes: [] };
  }
}
