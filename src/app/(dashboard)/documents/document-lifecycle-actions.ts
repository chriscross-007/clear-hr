"use server";

// CLE-233 — Document versions + Archive.
//
//   archiveDocument(id)            — organisation, Employment, Certificate
//                                    and RTW evidence documents.
//   restoreArchivedDocument(id)    — undo an archive.
//   publishNewDocumentVersion(id)  — organisation, Employment, Certificate
//                                    and RTW evidence documents: upload a
//                                    new file as a new document (version + 1,
//                                    no acknowledgements, unverified) and
//                                    archive the old one, linked both ways.
//
// Permissions: organisation documents need can_manage_organisation_documents;
// member documents need Documents-tab update with team / all reach over the
// owner (an admin action — self-scope callers can't archive their own).

import { revalidatePath } from "next/cache";
import { logAudit } from "@/lib/audit";
import { buildDocumentsCallerFromCookies, type DocumentsCaller } from "@/lib/documents-caller";
import { AUDIENCE_COLUMNS, type AudienceDbRow } from "@/lib/org-doc-audience";
import { canArchiveType, canVersionType } from "@/lib/document-archive";
import {
  ALLOWED_DOCUMENT_CONTENT_TYPES,
  MAX_DOCUMENT_SIZE,
  MEMBER_DOCUMENTS_BUCKET as MEMBER_BUCKET,
  ORG_DOCUMENTS_BUCKET,
} from "@/lib/document-limits";
import { seedNextReviewOn, seedNextReviewOnUpload } from "@/lib/document-status";

const TYPE_DISPLAY: Record<string, string> = {
  contract: "Employment",
  certificate: "Certificate",
  evidence: "RTW Evidence",
  attachment: "Attachment",
  organisation_document: "Organisation document",
};

type SubtypeEmbed = {
  name?: string;
  review_period_months?: number | null;
  requires_verification?: boolean | null;
  expiry_required?: boolean | null;
};

type LifecycleDoc = AudienceDbRow & {
  id: string;
  organisation_id: string;
  owner_scope: "member" | "organisation";
  owner_id: string | null;
  type: string;
  subtype_id: string | null;
  file_name: string;
  file_size: number;
  retention_class: string | null;
  archived_at: string | null;
  version_number: number | null;
  document_subtype: SubtypeEmbed | SubtypeEmbed[] | null;
};

type Result = { success: boolean; error?: string; documentId?: string };

function subtypeOf(d: LifecycleDoc): SubtypeEmbed | null {
  return Array.isArray(d.document_subtype) ? (d.document_subtype[0] ?? null) : d.document_subtype;
}

function typeSubtype(d: LifecycleDoc): string {
  const t = TYPE_DISPLAY[d.type] ?? d.type;
  const s = subtypeOf(d)?.name;
  return s ? `${t} / ${s}` : t;
}

async function loadDoc(caller: DocumentsCaller, documentId: string): Promise<LifecycleDoc | null> {
  const { data } = await caller.admin
    .from("document")
    .select(
      "id, organisation_id, owner_scope, owner_id, type, subtype_id, file_name, file_size, retention_class, archived_at, version_number, " +
        AUDIENCE_COLUMNS +
        ", document_subtype!subtype_id(name, review_period_months, requires_verification, expiry_required)",
    )
    .eq("id", documentId)
    .maybeSingle();
  const doc = data as unknown as LifecycleDoc | null;
  if (!doc || doc.organisation_id !== caller.organisationId) return null;
  return doc;
}

/** Owner name for member docs (audit metadata); null for org docs. */
async function ownerName(caller: DocumentsCaller, doc: LifecycleDoc): Promise<{ name: string | null; teamId: string | null } | null> {
  if (doc.owner_scope !== "member" || !doc.owner_id) return { name: null, teamId: null };
  const { data } = await caller.admin
    .from("members")
    .select("id, first_name, last_name, team_id")
    .eq("id", doc.owner_id)
    .eq("organisation_id", caller.organisationId)
    .maybeSingle();
  if (!data) return null;
  const m = data as { first_name: string | null; last_name: string | null; team_id: string | null };
  return { name: `${m.first_name ?? ""} ${m.last_name ?? ""}`.trim() || "Unknown", teamId: m.team_id };
}

function canManage(caller: DocumentsCaller, doc: LifecycleDoc, ownerTeamId: string | null): boolean {
  if (doc.owner_scope === "organisation") return caller.rights.canManageOrganisationDocuments === true;
  if (caller.rights.tabs.documents?.update !== true) return false;
  if (caller.rights.crossUserAccess === "all") return true;
  if (caller.rights.crossUserAccess === "team") return ownerTeamId !== null && ownerTeamId === caller.teamId;
  return false;
}

async function inTrash(caller: DocumentsCaller, documentId: string): Promise<boolean> {
  const { data } = await caller.admin.from("disposal_queue").select("id").eq("document_id", documentId).maybeSingle();
  return !!data;
}

async function actorName(caller: DocumentsCaller): Promise<string> {
  const { data } = await caller.admin
    .from("members")
    .select("first_name, last_name")
    .eq("id", caller.memberId)
    .maybeSingle();
  const m = data as { first_name?: string; last_name?: string } | null;
  return `${m?.first_name ?? ""} ${m?.last_name ?? ""}`.trim() || "Unknown";
}

function revalidateFor(doc: LifecycleDoc) {
  if (doc.owner_scope === "organisation") {
    revalidatePath("/documents/organisation");
  } else if (doc.owner_id) {
    revalidatePath(`/members/${doc.owner_id}/docs`);
  }
  revalidatePath("/documents/compliance");
  revalidatePath("/my-documents");
  revalidatePath("/admin-dashboard");
}

/** Shared guard: loads the doc, checks the caller may manage it. */
async function prepare(
  documentId: string,
): Promise<
  | { ok: true; caller: DocumentsCaller; doc: LifecycleDoc; owner: { name: string | null; teamId: string | null } }
  | { ok: false; error: string }
> {
  const caller = await buildDocumentsCallerFromCookies();
  if (!caller) return { ok: false, error: "Not authenticated" };
  const doc = await loadDoc(caller, documentId);
  if (!doc) return { ok: false, error: "Document not found" };
  const owner = await ownerName(caller, doc);
  if (!owner) return { ok: false, error: "Document not found" };
  if (!canManage(caller, doc, owner.teamId)) {
    return { ok: false, error: "You don't have permission to change this document." };
  }
  return { ok: true, caller, doc, owner };
}

// ---------------------------------------------------------------------------
// Archive / restore
// ---------------------------------------------------------------------------

export async function archiveDocument(documentId: string): Promise<Result> {
  try {
    const p = await prepare(documentId);
    if (!p.ok) return { success: false, error: p.error };
    const { caller, doc, owner } = p;
    if (!canArchiveType(doc.type)) return { success: false, error: "This kind of document can't be archived — move it to Trash instead." };
    if (doc.archived_at) return { success: false, error: "This document is already archived." };
    if (await inTrash(caller, documentId)) return { success: false, error: "This document is in Trash." };

    const { error } = await caller.admin
      .from("document")
      .update({ archived_at: new Date().toISOString(), archived_by: caller.memberId, updated_at: new Date().toISOString() })
      .eq("id", documentId)
      .eq("organisation_id", caller.organisationId);
    if (error) return { success: false, error: error.message };

    await logAudit({
      organisationId: caller.organisationId,
      actorId: caller.memberId,
      actorName: await actorName(caller),
      action: "document.archived",
      targetType: doc.owner_scope === "organisation" ? "org_document" : "member_document",
      targetId: documentId,
      targetLabel: doc.file_name,
      metadata: {
        ...(owner.name ? { member: owner.name } : {}),
        type_subtype: typeSubtype(doc),
        version_number: doc.version_number ?? 1,
        file_name: doc.file_name,
        file_size: doc.file_size,
      },
    });

    revalidateFor(doc);
    return { success: true, documentId };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "An error occurred" };
  }
}

export async function restoreArchivedDocument(documentId: string): Promise<Result> {
  try {
    const p = await prepare(documentId);
    if (!p.ok) return { success: false, error: p.error };
    const { caller, doc, owner } = p;
    if (!doc.archived_at) return { success: false, error: "This document isn't archived." };

    const { error } = await caller.admin
      .from("document")
      .update({ archived_at: null, archived_by: null, updated_at: new Date().toISOString() })
      .eq("id", documentId)
      .eq("organisation_id", caller.organisationId);
    if (error) return { success: false, error: error.message };

    await logAudit({
      organisationId: caller.organisationId,
      actorId: caller.memberId,
      actorName: await actorName(caller),
      action: "document.unarchived",
      targetType: doc.owner_scope === "organisation" ? "org_document" : "member_document",
      targetId: documentId,
      targetLabel: doc.file_name,
      metadata: {
        ...(owner.name ? { member: owner.name } : {}),
        type_subtype: typeSubtype(doc),
        version_number: doc.version_number ?? 1,
        file_name: doc.file_name,
        file_size: doc.file_size,
      },
    });

    revalidateFor(doc);
    return { success: true, documentId };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "An error occurred" };
  }
}

// ---------------------------------------------------------------------------
// Publish new version
// ---------------------------------------------------------------------------

export async function publishNewDocumentVersion(oldDocumentId: string, formData: FormData): Promise<Result> {
  try {
    const p = await prepare(oldDocumentId);
    if (!p.ok) return { success: false, error: p.error };
    const { caller, doc: old, owner } = p;
    if (!canVersionType(old.type)) return { success: false, error: "This kind of document doesn't have versions — move it to Trash instead." };
    if (old.archived_at) return { success: false, error: "This version is archived. Publish from the current version instead." };
    if (await inTrash(caller, oldDocumentId)) return { success: false, error: "This document is in Trash." };

    const file = formData.get("file");
    if (!(file instanceof File)) return { success: false, error: "No file supplied" };
    if (file.size > MAX_DOCUMENT_SIZE) return { success: false, error: "This file is too large. The limit is 10 MB." };
    if (!ALLOWED_DOCUMENT_CONTENT_TYPES.includes(file.type as (typeof ALLOWED_DOCUMENT_CONTENT_TYPES)[number])) {
      return { success: false, error: "This file type is not accepted." };
    }

    // Certificates / RTW evidence: a renewed document brings its own
    // expiry date. Required when the subtype requires expiry.
    const subtype = subtypeOf(old);
    const rawExpiry = formData.get("expiresOn");
    const expiresOn = typeof rawExpiry === "string" && rawExpiry.trim() ? rawExpiry.trim() : null;
    if (expiresOn && !/^\d{4}-\d{2}-\d{2}$/.test(expiresOn)) return { success: false, error: "Enter a valid expiry date." };
    if (!expiresOn && subtype?.expiry_required === true && old.owner_scope === "member") {
      return { success: false, error: "Enter the new document's expiry date." };
    }

    const bucket = old.owner_scope === "organisation" ? ORG_DOCUMENTS_BUCKET : MEMBER_BUCKET;
    const ext = file.name.includes(".") ? file.name.substring(file.name.lastIndexOf(".")) : "";
    const storagePath = `${caller.organisationId}/${crypto.randomUUID()}${ext}`;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const { error: uploadError } = await caller.admin.storage
      .from(bucket)
      .upload(storagePath, bytes, { contentType: file.type, upsert: false });
    if (uploadError) return { success: false, error: uploadError.message };

    const versionNumber = (old.version_number ?? 1) + 1;
    const now = new Date().toISOString();
    // Same type, subtype, retention and (org docs) audience. Expiry is not
    // carried over — a new file has its own (entered with the upload, or
    // set afterwards); the review clock starts now (member docs that need
    // verification start it on Verify instead). Never verified.
    const { data: inserted, error: insertError } = await caller.admin
      .from("document")
      .insert({
        organisation_id: caller.organisationId,
        owner_scope: old.owner_scope,
        owner_id: old.owner_id,
        storage_path: storagePath,
        file_name: file.name.substring(0, 255),
        file_size: file.size,
        content_type: file.type,
        type: old.type,
        subtype_id: old.subtype_id,
        retention_class: old.retention_class,
        expires_on: expiresOn,
        next_review_on:
          old.owner_scope === "member"
            ? seedNextReviewOnUpload({
                type: old.type,
                requires_verification: subtype?.requires_verification ?? null,
                review_period_months: subtype?.review_period_months ?? null,
              })
            : seedNextReviewOn(subtype?.review_period_months ?? null),
        uploaded_by: caller.memberId,
        version_number: versionNumber,
        supersedes_document_id: old.id,
        ...(old.owner_scope === "organisation"
          ? {
              audience_mode: old.audience_mode ?? "all",
              audience_team_ids: old.audience_team_ids ?? [],
              audience_rights_profile_ids: old.audience_rights_profile_ids ?? [],
              audience_include_member_ids: old.audience_include_member_ids ?? [],
            }
          : {}),
      })
      .select("id")
      .single();
    if (insertError || !inserted) {
      await caller.admin.storage.from(bucket).remove([storagePath]);
      return { success: false, error: insertError?.message ?? "Failed to publish the new version" };
    }
    const newId = inserted.id as string;

    const { error: archiveError } = await caller.admin
      .from("document")
      .update({ archived_at: now, archived_by: caller.memberId, updated_at: now })
      .eq("id", old.id)
      .eq("organisation_id", caller.organisationId);
    if (archiveError) {
      await caller.admin.from("document").delete().eq("id", newId);
      await caller.admin.storage.from(bucket).remove([storagePath]);
      return { success: false, error: archiveError.message };
    }

    const actor = await actorName(caller);
    const targetType = old.owner_scope === "organisation" ? "org_document" : "member_document";
    await logAudit({
      organisationId: caller.organisationId,
      actorId: caller.memberId,
      actorName: actor,
      action: "document.version_published",
      targetType,
      targetId: newId,
      targetLabel: file.name,
      metadata: {
        ...(owner.name ? { member: owner.name } : {}),
        type_subtype: typeSubtype(old),
        version_number: versionNumber,
        previous_file_name: old.file_name,
        file_name: file.name.substring(0, 255),
        file_size: file.size,
      },
    });
    await logAudit({
      organisationId: caller.organisationId,
      actorId: caller.memberId,
      actorName: actor,
      action: "document.archived",
      targetType,
      targetId: old.id,
      targetLabel: old.file_name,
      metadata: {
        ...(owner.name ? { member: owner.name } : {}),
        type_subtype: typeSubtype(old),
        version_number: old.version_number ?? 1,
        archive_reason: `Replaced by version ${versionNumber}`,
        file_name: old.file_name,
        file_size: old.file_size,
      },
    });

    revalidateFor(old);
    return { success: true, documentId: newId };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "An error occurred" };
  }
}
