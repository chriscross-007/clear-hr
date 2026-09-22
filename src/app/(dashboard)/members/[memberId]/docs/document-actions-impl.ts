// CLE-227 — Impl-only sibling of `document-actions.ts`. Holds the
// bodies of the four Documents-mobile-wrapped actions so they can be
// called from both the "use server" action file (via the cookies
// caller) and the mobile API-route wrappers under
// /api/mobile/documents/* (via the bearer caller):
//
//   • _getMemberRequiredDocumentRows(caller, memberId)
//   • _getDocumentDetail(caller, documentId)
//   • _getMemberDocumentSignedUrl(caller, documentId, mode)
//   • _uploadMemberDocument(caller, memberId, formData)
//
// Non-`"use server"` on purpose — exports here are regular module
// functions, not Server Actions, so they can be imported from either
// auth path without exposing an unauthenticated action to the client.
//
// The other exports of `document-actions.ts` (listMemberDocuments,
// verify/replace, trash, restore, acks-related helpers) stay in the
// action file — they aren't wrapped by mobile Tier 1.

import { revalidatePath } from "next/cache";
import { logAudit } from "@/lib/audit";
import { deriveDocumentStatuses, type DocumentStatus } from "@/lib/document-status";
import {
  ALLOWED_CONTENT_TYPES,
  MAX_DOCUMENT_SIZE,
  STORAGE_BUCKET,
  type MemberDocumentRow,
} from "./document-types";
import type { DocumentsCaller } from "@/lib/documents-caller";
import type { RequiredDocumentRow, DocumentDetailContext, RtwEvidenceDoc } from "./document-actions";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type TargetRow = { id: string; team_id: string | null; first_name: string; last_name: string };

async function getTarget(
  admin: DocumentsCaller["admin"],
  memberId: string,
  organisationId: string,
): Promise<TargetRow | null> {
  const { data } = await admin
    .from("members")
    .select("id, team_id, first_name, last_name")
    .eq("id", memberId)
    .eq("organisation_id", organisationId)
    .single();
  return data as TargetRow | null;
}

async function callerNameFrom(
  admin: DocumentsCaller["admin"],
  memberId: string,
): Promise<string> {
  const { data } = await admin
    .from("members")
    .select("first_name, last_name")
    .eq("id", memberId)
    .single();
  return `${data?.first_name ?? ""} ${data?.last_name ?? ""}`.trim() || "Unknown";
}

// Inline replacements for the `caller.canViewTarget` / `canUpdateTarget`
// / `isSelf` methods on the local CallerCtx in `document-actions.ts`.
// Mobile always talks to self, so these evaluate to the caller's own
// documents.view / documents.update flags — but the checks are still
// enforced for correctness (and to keep the impl symmetric with the
// web-facing caller).
function isSelf(caller: DocumentsCaller, targetMemberId: string): boolean {
  return targetMemberId === caller.memberId;
}
function canViewTarget(
  caller: DocumentsCaller,
  target: { memberId: string; teamId: string | null },
): boolean {
  if (target.memberId === caller.memberId) return true;
  const view = caller.rights.tabs.documents?.view === true;
  if (caller.rights.crossUserAccess === "all") return view;
  if (caller.rights.crossUserAccess === "team")
    return target.teamId !== null && target.teamId === caller.teamId && view;
  return false;
}
function canUpdateTarget(
  caller: DocumentsCaller,
  target: { memberId: string; teamId: string | null },
): boolean {
  const update = caller.rights.tabs.documents?.update === true;
  if (target.memberId === caller.memberId) return update;
  if (caller.rights.crossUserAccess === "all") return update;
  if (caller.rights.crossUserAccess === "team")
    return target.teamId !== null && target.teamId === caller.teamId && update;
  return false;
}

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
// _getDocumentDetail
// ---------------------------------------------------------------------------

export async function _getDocumentDetail(
  caller: DocumentsCaller,
  documentId: string,
): Promise<{ success: true; detail: DocumentDetailContext } | { success: false; error: string }> {
  try {
    const { admin, organisationId } = caller;
    const canViewOrgDocs = caller.rights.canViewOrganisationDocuments;

    const { data: doc } = await admin
      .from("document")
      .select(
        "id, organisation_id, owner_scope, owner_id, file_name, file_size, content_type, type, subtype_id, expires_on, retention_class, disposal_date, uploaded_by, uploaded_at, verified_on, verified_by, next_review_on, capture_source, verification_notes, document_subtype!subtype_id(name, requires_verification)",
      )
      .eq("id", documentId)
      .single();
    if (!doc || doc.organisation_id !== organisationId) {
      return { success: false, error: "Document not found" };
    }

    let target: TargetRow | null = null;
    if (doc.owner_scope === "member") {
      if (!doc.owner_id) return { success: false, error: "Document not found" };
      target = await getTarget(admin, doc.owner_id as string, organisationId);
      if (!target) return { success: false, error: "Document not found" };
      if (!canViewTarget(caller, { memberId: target.id, teamId: target.team_id })) {
        return { success: false, error: "Document not found" };
      }
    } else if (doc.owner_scope === "organisation") {
      if (!canViewOrgDocs) {
        return { success: false, error: "Document not found" };
      }
      target = {
        id: caller.memberId,
        team_id: null,
        first_name: "Organisation",
        last_name: "",
      };
    } else {
      return { success: false, error: "Document not found" };
    }

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

    const st = doc.document_subtype as unknown as
      | { name?: string; requires_verification?: boolean }
      | { name?: string; requires_verification?: boolean }[]
      | null;
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
        isSelf: isSelf(caller, target.id),
      },
    };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "An error occurred" };
  }
}

// ---------------------------------------------------------------------------
// _getMemberDocumentSignedUrl
// ---------------------------------------------------------------------------

export async function _getMemberDocumentSignedUrl(
  caller: DocumentsCaller,
  documentId: string,
  mode: "inline" | "download",
): Promise<{ success: boolean; error?: string; url?: string; fileName?: string; contentType?: string }> {
  try {
    const { admin, organisationId } = caller;
    const canViewOrgDocs = caller.rights.canViewOrganisationDocuments;

    const { data: doc } = await admin
      .from("document")
      .select("id, organisation_id, owner_scope, owner_id, storage_path, file_name, file_size, content_type, disposal_date, type, document_subtype!subtype_id(name)")
      .eq("id", documentId)
      .single();
    if (!doc || doc.organisation_id !== organisationId) {
      return { success: false, error: "Document not found" };
    }
    const today = new Date().toISOString().slice(0, 10);
    if (doc.disposal_date && doc.disposal_date <= today) {
      return { success: false, error: "Document not found" };
    }

    let target: TargetRow | null = null;
    if (doc.owner_scope === "member") {
      if (!doc.owner_id) return { success: false, error: "Document not found" };
      target = await getTarget(admin, doc.owner_id as string, organisationId);
      if (!target) return { success: false, error: "Document not found" };
      if (!canViewTarget(caller, { memberId: target.id, teamId: target.team_id })) {
        return { success: false, error: "Document not found" };
      }
    } else if (doc.owner_scope === "organisation") {
      if (!canViewOrgDocs) {
        return { success: false, error: "Document not found" };
      }
      target = { id: caller.memberId, team_id: null, first_name: "Organisation", last_name: "" };
    } else {
      return { success: false, error: "Document not found" };
    }

    const bucket = doc.owner_scope === "organisation" ? "org-documents" : STORAGE_BUCKET;
    const { data: signed, error } = await admin.storage
      .from(bucket)
      .createSignedUrl(
        doc.storage_path as string,
        120,
        mode === "download" ? { download: doc.file_name as string } : undefined,
      );
    if (error || !signed?.signedUrl) {
      return { success: false, error: error?.message ?? "Failed to create signed URL" };
    }

    const subtypeName = (doc.document_subtype as unknown as { name?: string } | { name?: string }[] | null);
    const subtypeNameStr = Array.isArray(subtypeName)
      ? (subtypeName[0]?.name ?? null)
      : (subtypeName?.name ?? null);
    await logAudit({
      organisationId,
      actorId: caller.memberId,
      actorName: await callerNameFrom(admin, caller.memberId),
      action: mode === "download" ? "document.downloaded" : "document.viewed",
      targetType: "member_document",
      targetId: doc.id as string,
      targetLabel: doc.file_name as string,
      metadata: {
        member: target ? memberDisplay(target) : "Organisation",
        type_subtype: typeSubtypeLabel(doc.type as string, subtypeNameStr),
        file_name: doc.file_name as string,
        file_size: doc.file_size as number,
      },
    });

    return {
      success: true,
      url: signed.signedUrl,
      fileName: doc.file_name as string,
      contentType: doc.content_type as string,
    };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "An error occurred" };
  }
}

// ---------------------------------------------------------------------------
// _uploadMemberDocument
// ---------------------------------------------------------------------------

export async function _uploadMemberDocument(
  caller: DocumentsCaller,
  memberId: string,
  formData: FormData,
): Promise<{ success: boolean; error?: string; documentId?: string }> {
  try {
    const { admin, organisationId } = caller;
    const target = await getTarget(admin, memberId, organisationId);
    if (!target) return { success: false, error: "Document not found" };

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

    const { data: subtype } = await admin
      .from("document_subtype")
      .select(
        "id, type, name, retention_class, expiry_required, employee_can_upload",
      )
      .eq("id", subtypeId)
      .eq("organisation_id", organisationId)
      .single();
    if (!subtype) return { success: false, error: "That document type is not available." };

    const selfPath = isSelf(caller, memberId);
    if (selfPath && caller.rights.crossUserAccess === "self" && !subtype.employee_can_upload) {
      return {
        success: false,
        error: "You can't upload documents of this kind against your own record. Ask HR to upload it.",
      };
    }
    if (!selfPath && !canUpdateTarget(caller, { memberId: target.id, teamId: target.team_id })) {
      return { success: false, error: "You don't have permission to add documents for this member." };
    }

    const uuid = crypto.randomUUID();
    const ext = file.name.includes(".") ? file.name.substring(file.name.lastIndexOf(".")) : "";
    const storagePath = `${organisationId}/${uuid}${ext}`;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const { error: uploadError } = await admin.storage
      .from(STORAGE_BUCKET)
      .upload(storagePath, bytes, { contentType: file.type, upsert: false });
    if (uploadError) return { success: false, error: uploadError.message };

    const { data: inserted, error: insertError } = await admin
      .from("document")
      .insert({
        organisation_id: organisationId,
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
      await admin.storage.from(STORAGE_BUCKET).remove([storagePath]);
      return { success: false, error: insertError?.message ?? "Failed to insert document" };
    }

    await logAudit({
      organisationId,
      actorId: caller.memberId,
      actorName: await callerNameFrom(admin, caller.memberId),
      action: "document.uploaded",
      targetType: "member_document",
      targetId: inserted.id as string,
      targetLabel: file.name,
      metadata: {
        member: memberDisplay(target),
        type_subtype: typeSubtypeLabel(subtype.type as string, subtype.name as string),
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
// _getMemberRequiredDocumentRows
// ---------------------------------------------------------------------------

export async function _getMemberRequiredDocumentRows(
  caller: DocumentsCaller,
  memberId: string,
): Promise<
  { success: true; rows: RequiredDocumentRow[] } | { success: false; error: string }
> {
  try {
    const { admin, organisationId } = caller;
    const target = await getTarget(admin, memberId, organisationId);
    if (!target) return { success: false, error: "Member not found" };
    if (!canViewTarget(caller, { memberId: target.id, teamId: target.team_id })) {
      return { success: false, error: "Member not found" };
    }

    const { data: expectedRows, error: eErr } = await admin
      .from("member_expected_document")
      .select("subtype_id")
      .eq("member_id", memberId)
      .eq("organisation_id", organisationId);
    if (eErr) return { success: false, error: eErr.message };
    const perMemberIds = new Set<string>(
      ((expectedRows ?? []) as { subtype_id: string }[]).map((r) => r.subtype_id),
    );

    const { data: subtypeRows, error: sErr } = await admin
      .from("document_subtype")
      .select(
        "id, type, name, retention_class, requires_verification, trackable_per_member, employee_can_upload, requires_acknowledgement",
      )
      .eq("organisation_id", organisationId);
    if (sErr) return { success: false, error: sErr.message };
    type SubtypeRow = {
      id: string;
      type: string;
      name: string;
      retention_class: string;
      requires_verification: boolean;
      trackable_per_member: boolean;
      employee_can_upload: boolean;
      requires_acknowledgement: boolean;
    };
    const subtypes = (subtypeRows ?? []) as unknown as SubtypeRow[];
    const subtypeById = new Map(subtypes.map((s) => [s.id, s]));

    const effectiveIds = new Set<string>();
    for (const id of perMemberIds) {
      const s = subtypeById.get(id);
      if (s && s.retention_class === "right_to_work") continue;
      effectiveIds.add(id);
    }
    const { data: memberRow } = await admin
      .from("members")
      .select("rtw_not_required")
      .eq("id", memberId)
      .eq("organisation_id", organisationId)
      .single();
    const rtwOptedOut = ((memberRow as { rtw_not_required?: boolean } | null)?.rtw_not_required) === true;

    const { data: docRows } = await admin
      .from("document")
      .select("id, subtype_id, file_name, file_size, uploaded_at, expires_on, next_review_on, verified_on, disposal_date")
      .eq("organisation_id", organisationId)
      .eq("owner_scope", "member")
      .eq("owner_id", memberId);
    type Doc = {
      id: string;
      subtype_id: string | null;
      file_name: string;
      file_size: number;
      uploaded_at: string;
      expires_on: string | null;
      next_review_on: string | null;
      verified_on: string | null;
      disposal_date: string | null;
    };
    const docs = ((docRows ?? []) as unknown as Doc[]);
    const { data: queuedRows } = await admin
      .from("disposal_queue")
      .select("document_id")
      .eq("organisation_id", organisationId);
    const queued = new Set<string>(((queuedRows ?? []) as { document_id: string }[]).map((r) => r.document_id));
    const today = new Date().toISOString().slice(0, 10);
    const activeDocs = docs
      .filter((d) => !queued.has(d.id))
      .filter((d) => d.disposal_date === null || d.disposal_date > today);

    const ackedDocIds = new Set<string>();
    if (activeDocs.length > 0) {
      const { data: acks } = await admin
        .from("document_acknowledgement")
        .select("document_id")
        .eq("member_id", memberId)
        .is("superseded_by_replace_at", null)
        .in("document_id", activeDocs.map((d) => d.id));
      for (const r of ((acks ?? []) as { document_id: string }[])) {
        ackedDocIds.add(r.document_id);
      }
    }

    const bySubtype: Map<string, Doc[]> = new Map();
    for (const d of activeDocs) {
      if (!d.subtype_id) continue;
      const list = bySubtype.get(d.subtype_id) ?? [];
      list.push(d);
      bySubtype.set(d.subtype_id, list);
    }
    for (const list of bySubtype.values()) {
      list.sort((a, b) => (a.uploaded_at < b.uploaded_at ? 1 : -1));
    }

    const rows: RequiredDocumentRow[] = [];
    for (const subtypeId of effectiveIds) {
      const s = subtypeById.get(subtypeId);
      if (!s) continue;
      const newest = bySubtype.get(subtypeId)?.[0] ?? null;
      const statuses = newest
        ? (deriveDocumentStatuses({
            requiresVerification: s.requires_verification === true,
            verifiedOn: newest.verified_on,
            expiresOn: newest.expires_on,
            nextReviewOn: newest.next_review_on,
          }) as (DocumentStatus | "not_uploaded")[])
        : (["not_uploaded"] as (DocumentStatus | "not_uploaded")[]);
      rows.push({
        subtypeId: s.id,
        subtypeName: s.name,
        subtypeType: s.type,
        isTrackableNow: s.trackable_per_member,
        isOrgWideExpected: false,
        assignedPerMember: perMemberIds.has(s.id),
        employeeCanUpload: s.employee_can_upload,
        requiresAcknowledgement: s.requires_acknowledgement === true,
        isAcknowledged: newest ? ackedDocIds.has(newest.id) : false,
        documentId: newest?.id ?? null,
        fileName: newest?.file_name ?? null,
        fileSize: newest?.file_size ?? null,
        verifiedOn: newest?.verified_on ?? null,
        expiresOn: newest?.expires_on ?? null,
        nextReviewOn: newest?.next_review_on ?? null,
        statuses,
      });
    }

    rows.sort((a, b) => {
      if (a.subtypeType !== b.subtypeType) return a.subtypeType < b.subtypeType ? -1 : 1;
      return a.subtypeName.localeCompare(b.subtypeName);
    });

    if (!rtwOptedOut) {
      const rtwRows: RequiredDocumentRow[] = [];
      for (const s of subtypes) {
        if (s.retention_class !== "right_to_work") continue;
        const list = bySubtype.get(s.id) ?? [];
        const newest = list[0];
        if (!newest) continue;
        const statuses = deriveDocumentStatuses({
          requiresVerification: s.requires_verification === true,
          verifiedOn: newest.verified_on,
          expiresOn: newest.expires_on,
          nextReviewOn: newest.next_review_on,
        }) as (DocumentStatus | "not_uploaded")[];
        rtwRows.push({
          subtypeId: s.id,
          subtypeName: s.name,
          subtypeType: s.type,
          isTrackableNow: s.trackable_per_member,
          isOrgWideExpected: false,
          assignedPerMember: false,
          isRtwEvidence: true,
          employeeCanUpload: s.employee_can_upload,
          requiresAcknowledgement: s.requires_acknowledgement === true,
          isAcknowledged: ackedDocIds.has(newest.id),
          documentId: newest.id,
          fileName: newest.file_name,
          fileSize: newest.file_size,
          verifiedOn: newest.verified_on,
          expiresOn: newest.expires_on,
          nextReviewOn: newest.next_review_on,
          statuses,
        });
      }

      if (rtwRows.length === 0) {
        const emptyRtwDocs: RtwEvidenceDoc[] = [];
        rows.unshift({
          subtypeId: "rtw-aggregate",
          subtypeName: "Right to Work evidence",
          subtypeType: "evidence",
          isTrackableNow: false,
          isOrgWideExpected: true,
          assignedPerMember: false,
          isRtwAggregate: true,
          employeeCanUpload: false,
          requiresAcknowledgement: false,
          isAcknowledged: false,
          rtwDocs: emptyRtwDocs,
          documentId: null,
          fileName: null,
          fileSize: null,
          verifiedOn: null,
          expiresOn: null,
          nextReviewOn: null,
          statuses: ["not_uploaded"],
        });
      } else {
        function score(r: RequiredDocumentRow): number {
          const expired = r.expiresOn !== null && r.expiresOn <= today;
          const verified = r.verifiedOn !== null;
          if (verified && !expired) return 3;
          if (!expired) return 2;
          return 1;
        }
        rtwRows.sort((a, b) => {
          const s = score(b) - score(a);
          if (s !== 0) return s;
          const aNull = a.expiresOn === null;
          const bNull = b.expiresOn === null;
          if (aNull !== bNull) return aNull ? -1 : 1;
          if (a.expiresOn !== null && b.expiresOn !== null) {
            return a.expiresOn < b.expiresOn ? 1 : a.expiresOn > b.expiresOn ? -1 : 0;
          }
          return 0;
        });
        rtwRows[0].isRtwPrimary = true;
        rows.unshift(...rtwRows);
      }
    }

    return { success: true, rows };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "An error occurred" };
  }
}
