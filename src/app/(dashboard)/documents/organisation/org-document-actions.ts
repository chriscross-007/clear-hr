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

const ALLOWED_CONTENT_TYPES = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
] as const;
const MAX_SIZE = 10 * 1024 * 1024;
const BUCKET = "org-documents";

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
  /** CLE-225 — false when a row exists in member_org_document_hidden
   *  for this pair. Drives the "Viewable" checkbox on the admin's
   *  per-member Org Docs tab. When false, the target does not see
   *  the doc on `/my-documents` and it is not counted for the target
   *  in ack coverage denominators. */
  viewable: boolean;
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
        "id, file_name, file_size, content_type, type, subtype_id, expires_on, uploaded_by, uploaded_at, document_subtype!subtype_id(name, requires_acknowledgement), members!uploaded_by(first_name, last_name)",
      )
      .eq("organisation_id", c.organisationId)
      .eq("owner_scope", "organisation")
      .order("uploaded_at", { ascending: false });
    if (error) return { success: false, error: error.message };

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

    // CLE-225 — Target's hidden set. Presence of a row in
    // `member_org_document_hidden` means the doc is hidden from the
    // target. Powers the Viewable checkbox on the admin's per-member
    // Org Docs tab. Deliberately fetched even when the target has no
    // acks so the initial paint is truthful.
    const targetHiddenSet = new Set<string>();
    if (visibleRows.length > 0) {
      const { data: hidden } = await admin
        .from("member_org_document_hidden")
        .select("document_id")
        .eq("member_id", memberId)
        .in("document_id", visibleRows.map((r) => r.id));
      for (const h of ((hidden ?? []) as { document_id: string }[])) {
        targetHiddenSet.add(h.document_id);
      }
    }

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
        uploadedBy: `${memPair?.first_name ?? ""} ${memPair?.last_name ?? ""}`.trim() || "Unknown",
        uploadedAt: r.uploaded_at,
        requiresAcknowledgement,
        // The `isAcknowledged` field on the base row reflects the
        // *caller* — kept only so the shape matches OrgDocumentRow;
        // admin surfaces should read `isAcknowledgedByTarget`.
        isAcknowledged: false,
        isAcknowledgedByTarget,
        // CLE-225 — Row present in `member_org_document_hidden` means
        // hidden from the target; absence means visible (the default).
        viewable: !targetHiddenSet.has(r.id),
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

    const { data: doc } = await admin
      .from("document")
      .select("id, organisation_id, owner_scope, storage_path, file_name, file_size, content_type, type, document_subtype!subtype_id(name)")
      .eq("id", documentId)
      .single();
    if (!doc || doc.organisation_id !== c.organisationId || doc.owner_scope !== "organisation") {
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
      .select("id, type, name, retention_class, expiry_required")
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
// Edit metadata / delete
// ---------------------------------------------------------------------------

export async function updateOrgDocumentMetadata(
  documentId: string,
  patch: { subtypeId?: string | null; expiresOn?: string | null },
): Promise<{ success: boolean; error?: string }> {
  try {
    const c = await ctx();
    if (!c) return { success: false, error: "Not authenticated" };
    if (!c.canEdit) return { success: false, error: "You don't have permission to change organisation documents." };
    const admin = getAdmin();

    const { data: doc } = await admin
      .from("document")
      .select("id, organisation_id, owner_scope, type, subtype_id, expires_on, file_name, file_size, document_subtype!subtype_id(name)")
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
// Per-member visibility toggle (CLE-225)
// ---------------------------------------------------------------------------

/**
 * CLE-225 — Toggle whether a specific org-scope document is visible
 * to a specific target member.
 *
 * `viewable=true`  → DELETE any row in `member_org_document_hidden`
 *                    for the pair. Idempotent: a no-op when no row
 *                    exists.
 * `viewable=false` → INSERT with `ON CONFLICT DO NOTHING`. Idempotent:
 *                    a no-op when a row already exists.
 *
 * Effects when a doc is hidden from a member:
 *   • The doc does not appear in the caller's `/my-documents` Org
 *     Documents tab (filter in `listOrgDocuments`).
 *   • The doc does not appear in the caller's outstanding-ack chip
 *     (filter in `getMyOutstandingAcknowledgements`).
 *   • The doc does not count for that member in coverage denominators
 *     (filters in `getDocumentCoverage`, `getOrgAcknowledgementCoverage`).
 *   • Any existing `document_acknowledgement` row for the pair is
 *     preserved (audit trail) but becomes moot.
 *
 * Access — caller must have `can_manage_organisation_documents` AND
 * the target must be in the caller's org AND the doc must exist with
 * `owner_scope='organisation'`.
 */
export async function setMemberOrgDocumentVisibility(
  memberId: string,
  documentId: string,
  viewable: boolean,
): Promise<{ success: true } | { success: false; error: string }> {
  try {
    const c = await ctx();
    if (!c) return { success: false, error: "Not authenticated" };
    if (!c.canEdit) {
      return { success: false, error: "You don't have permission to change organisation documents." };
    }
    const admin = getAdmin();

    // Target sanity: must belong to caller's org.
    const { data: target } = await admin
      .from("members")
      .select("id, organisation_id, first_name, last_name")
      .eq("id", memberId)
      .maybeSingle();
    if (!target || target.organisation_id !== c.organisationId) {
      return { success: false, error: "Not authorised" };
    }

    // Doc sanity: must exist, be in caller's org, and be org-scope.
    const { data: doc } = await admin
      .from("document")
      .select("id, organisation_id, owner_scope, file_name, file_size")
      .eq("id", documentId)
      .maybeSingle();
    if (
      !doc ||
      doc.organisation_id !== c.organisationId ||
      doc.owner_scope !== "organisation"
    ) {
      return { success: false, error: "Document not found" };
    }

    if (viewable) {
      const { error } = await admin
        .from("member_org_document_hidden")
        .delete()
        .eq("member_id", memberId)
        .eq("document_id", documentId);
      if (error) return { success: false, error: error.message };
    } else {
      // ON CONFLICT DO NOTHING via upsert on the composite PK.
      const { error } = await admin
        .from("member_org_document_hidden")
        .upsert(
          {
            organisation_id: c.organisationId,
            member_id: memberId,
            document_id: documentId,
            hidden_by_member_id: c.memberId,
          },
          { onConflict: "member_id,document_id", ignoreDuplicates: true },
        );
      if (error) return { success: false, error: error.message };
    }

    const memberName =
      `${target.first_name ?? ""} ${target.last_name ?? ""}`.trim() || "—";
    await logAudit({
      organisationId: c.organisationId,
      actorId: c.memberId,
      actorName: await callerName(admin, c.memberId),
      // CLE-225 — a distinct audit action from doc.metadata_updated so
      // the visibility log is filterable on its own in the audit page.
      action: "document.visibility_changed",
      targetType: "document",
      targetId: documentId,
      targetLabel: doc.file_name as string,
      metadata: {
        member_id: memberId,
        member_name: memberName,
        viewable,
        // CLE-219 — file_name + file_size on every doc audit.
        file_name: doc.file_name as string,
        file_size: doc.file_size as number,
      },
    });

    // Compliance coverage denominators depend on the hidden set, so
    // the compliance dashboard needs a refresh after any toggle.
    revalidatePath("/documents/compliance");
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
