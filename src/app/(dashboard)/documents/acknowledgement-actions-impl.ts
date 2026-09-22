// CLE-227 — Impl-only sibling of `acknowledgement-actions.ts`. Holds
// the bodies of the three Documents-mobile-wrapped acknowledgement
// actions:
//   • _acknowledgeDocument(caller, documentId)
//   • _getMyOutstandingAcknowledgements(caller)
//   • _getDocumentAcknowledgementStatus(caller, documentId)
// so they can be called from both the "use server" action file (via
// the cookies caller) and the mobile API-route wrappers under
// /api/mobile/documents/* (via the bearer caller).
//
// Non-`"use server"` on purpose — exports here are regular module
// functions, not Server Actions, so they can be imported from either
// auth path without exposing an unauthenticated action to the client.
//
// getDocumentCoverage + the reminder actions stay in the action file
// — they aren't wrapped by mobile Tier 1.

import { revalidatePath } from "next/cache";
import { createHash } from "node:crypto";
import { logAudit } from "@/lib/audit";
import type { DocumentsCaller } from "@/lib/documents-caller";

const STORAGE_BUCKET = "member-documents";

export interface OutstandingAcknowledgement {
  documentId: string;
  fileName: string;
  subtypeId: string;
  subtypeName: string;
  subtypeType: string;
  ownerScope: "member" | "organisation";
  createdAt: string;
}

export interface DocumentAcknowledgementStatus {
  requiresAcknowledgement: boolean;
  isCallerExpectedToAcknowledge: boolean;
  callerAcknowledgement: {
    acknowledgedAt: string;
    ip: string | null;
  } | null;
  coverageSummary: {
    totalExpected: number;
    totalAcknowledged: number;
    outstanding: number;
  } | null;
}

async function callerNameFrom(admin: DocumentsCaller["admin"], memberId: string): Promise<string> {
  const { data } = await admin
    .from("members")
    .select("first_name, last_name")
    .eq("id", memberId)
    .single();
  return `${data?.first_name ?? ""} ${data?.last_name ?? ""}`.trim() || "Unknown";
}

/** SHA-256 of the doc's stored bytes. Null on download failure —
 *  matches the "we don't block ack on a storage hiccup" contract in
 *  the original action. */
async function computeDocumentVersionHash(
  admin: DocumentsCaller["admin"],
  storagePath: string,
  ownerScope: "member" | "organisation",
): Promise<string | null> {
  try {
    const bucket = ownerScope === "organisation" ? "org-documents" : STORAGE_BUCKET;
    const { data, error } = await admin.storage.from(bucket).download(storagePath);
    if (error || !data) return null;
    const buf = Buffer.from(await data.arrayBuffer());
    return createHash("sha256").update(buf).digest("hex");
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// _acknowledgeDocument
// ---------------------------------------------------------------------------

export async function _acknowledgeDocument(
  caller: DocumentsCaller,
  documentId: string,
): Promise<
  | { success: true; alreadyAcknowledged: boolean }
  | { success: false; error: string }
> {
  try {
    const { admin, memberId, organisationId, ip, userAgent } = caller;
    const canViewOrgDocs = caller.rights.canViewOrganisationDocuments;

    type DocRow = {
      id: string;
      organisation_id: string;
      owner_scope: "member" | "organisation";
      owner_id: string | null;
      file_name: string;
      file_size: number;
      storage_path: string;
      subtype_id: string;
      document_subtype:
        | { name?: string; requires_acknowledgement?: boolean }
        | { name?: string; requires_acknowledgement?: boolean }[]
        | null;
    };
    const docQuery = await admin
      .from("document")
      .select(
        "id, organisation_id, owner_scope, owner_id, file_name, file_size, storage_path, subtype_id, " +
        "document_subtype!subtype_id(name, requires_acknowledgement)",
      )
      .eq("id", documentId)
      .single();
    const doc = docQuery.data as unknown as DocRow | null;
    if (!doc || doc.organisation_id !== organisationId) {
      return { success: false, error: "Document not found" };
    }
    const subtype = doc.document_subtype;
    const subtypeRow = Array.isArray(subtype) ? subtype[0] : subtype;
    if (!subtypeRow?.requires_acknowledgement) {
      return { success: false, error: "This document does not require acknowledgement." };
    }

    const ownerScope = doc.owner_scope as "member" | "organisation";
    if (ownerScope === "member") {
      if (doc.owner_id !== memberId) {
        return {
          success: false,
          error: "Only this document's owner can acknowledge it.",
        };
      }
    } else if (ownerScope === "organisation") {
      if (!canViewOrgDocs) {
        return {
          success: false,
          error: "You don't have access to acknowledge organisation documents.",
        };
      }
    }

    const { data: existing } = await admin
      .from("document_acknowledgement")
      .select("id")
      .eq("document_id", documentId)
      .eq("member_id", memberId)
      .maybeSingle();
    if (existing) return { success: true, alreadyAcknowledged: true };

    const hash = await computeDocumentVersionHash(admin, doc.storage_path as string, ownerScope);

    const { error: insertError } = await admin
      .from("document_acknowledgement")
      .insert({
        organisation_id: organisationId,
        document_id: documentId,
        member_id: memberId,
        acknowledged_at: new Date().toISOString(),
        ip,
        user_agent: userAgent,
        document_version_hash: hash,
        document_file_name: doc.file_name as string,
        document_subtype_name: subtypeRow.name ?? "—",
      });
    if (insertError) return { success: false, error: insertError.message };

    await logAudit({
      organisationId,
      actorId: memberId,
      actorName: await callerNameFrom(admin, memberId),
      action: "document.acknowledged",
      targetType: "document",
      targetId: documentId,
      targetLabel: doc.file_name as string,
      metadata: {
        subtype_name: subtypeRow.name ?? null,
        owner_scope: ownerScope,
        document_version_hash: hash,
        ip,
        user_agent: userAgent,
        file_name: doc.file_name,
        file_size: doc.file_size,
      },
    });

    // Web-side cache invalidation. No-op when called from a mobile
    // route handler; still worth calling so the shared impl behaves
    // identically for both paths.
    revalidatePath("/dashboard");
    revalidatePath("/my-documents");
    revalidatePath("/documents/compliance");

    return { success: true, alreadyAcknowledged: false };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "An error occurred" };
  }
}

// ---------------------------------------------------------------------------
// _getMyOutstandingAcknowledgements
// ---------------------------------------------------------------------------

export async function _getMyOutstandingAcknowledgements(
  caller: DocumentsCaller,
): Promise<
  | { success: true; rows: OutstandingAcknowledgement[] }
  | { success: false; error: string }
> {
  try {
    const { admin, memberId, organisationId } = caller;
    const canViewOrgDocs = caller.rights.canViewOrganisationDocuments;

    type DocJoin = {
      id: string;
      owner_scope: "member" | "organisation";
      owner_id: string | null;
      file_name: string;
      subtype_id: string;
      uploaded_at: string;
      document_subtype: { name?: string; type?: string; requires_acknowledgement?: boolean } | Array<{ name?: string; type?: string; requires_acknowledgement?: boolean }> | null;
    };
    const docsQuery = await admin
      .from("document")
      .select(
        "id, owner_scope, owner_id, file_name, subtype_id, uploaded_at, " +
        "document_subtype!subtype_id(name, type, requires_acknowledgement)",
      )
      .eq("organisation_id", organisationId)
      .order("uploaded_at", { ascending: false });
    const rows = (docsQuery.data ?? []) as unknown as DocJoin[];

    const { data: hiddenRows } = await admin
      .from("member_org_document_hidden")
      .select("document_id")
      .eq("member_id", memberId);
    const hiddenFromCaller = new Set<string>(
      ((hiddenRows ?? []) as { document_id: string }[]).map((r) => r.document_id),
    );

    const relevant = rows.filter((d) => {
      const st = Array.isArray(d.document_subtype) ? d.document_subtype[0] : d.document_subtype;
      if (!st?.requires_acknowledgement) return false;
      if (d.owner_scope === "member") return d.owner_id === memberId;
      if (d.owner_scope === "organisation") {
        if (!canViewOrgDocs) return false;
        if (hiddenFromCaller.has(d.id)) return false;
        return true;
      }
      return false;
    });
    if (relevant.length === 0) return { success: true, rows: [] };

    const docIds = relevant.map((d) => d.id);
    const { data: acked } = await admin
      .from("document_acknowledgement")
      .select("document_id")
      .eq("member_id", memberId)
      .is("superseded_by_replace_at", null)
      .in("document_id", docIds);
    const ackedSet = new Set(((acked ?? []) as { document_id: string }[]).map((r) => r.document_id));

    const out: OutstandingAcknowledgement[] = relevant
      .filter((d) => !ackedSet.has(d.id))
      .map((d) => {
        const st = Array.isArray(d.document_subtype) ? d.document_subtype[0] : d.document_subtype;
        return {
          documentId: d.id,
          fileName: d.file_name,
          subtypeId: d.subtype_id,
          subtypeName: st?.name ?? "—",
          subtypeType: st?.type ?? "attachment",
          ownerScope: d.owner_scope,
          createdAt: d.uploaded_at,
        };
      });

    return { success: true, rows: out };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "An error occurred" };
  }
}

// ---------------------------------------------------------------------------
// _getDocumentAcknowledgementStatus
// ---------------------------------------------------------------------------

export async function _getDocumentAcknowledgementStatus(
  caller: DocumentsCaller,
  documentId: string,
): Promise<
  | { success: true; status: DocumentAcknowledgementStatus }
  | { success: false; error: string }
> {
  try {
    const { admin, memberId, organisationId } = caller;
    const canViewOrgDocs = caller.rights.canViewOrganisationDocuments;

    type DocRow = {
      id: string;
      organisation_id: string;
      owner_scope: "member" | "organisation";
      owner_id: string | null;
      subtype_id: string;
      document_subtype:
        | { requires_acknowledgement?: boolean }
        | { requires_acknowledgement?: boolean }[]
        | null;
    };
    const docQuery = await admin
      .from("document")
      .select(
        "id, organisation_id, owner_scope, owner_id, subtype_id, " +
        "document_subtype!subtype_id(requires_acknowledgement)",
      )
      .eq("id", documentId)
      .single();
    const doc = docQuery.data as unknown as DocRow | null;
    if (!doc || doc.organisation_id !== organisationId) {
      return { success: false, error: "Document not found" };
    }
    const subtype = doc.document_subtype;
    const subtypeRow = Array.isArray(subtype) ? subtype[0] : subtype;
    const requiresAcknowledgement = subtypeRow?.requires_acknowledgement === true;

    if (!requiresAcknowledgement) {
      return {
        success: true,
        status: {
          requiresAcknowledgement: false,
          isCallerExpectedToAcknowledge: false,
          callerAcknowledgement: null,
          coverageSummary: null,
        },
      };
    }

    const ownerScope = doc.owner_scope as "member" | "organisation";
    const isCallerExpectedToAcknowledge =
      ownerScope === "member"
        ? doc.owner_id === memberId
        : canViewOrgDocs;

    const { data: ownAck } = await admin
      .from("document_acknowledgement")
      .select("acknowledged_at, ip")
      .eq("document_id", documentId)
      .eq("member_id", memberId)
      .is("superseded_by_replace_at", null)
      .maybeSingle();
    const callerAcknowledgement = ownAck
      ? {
          acknowledgedAt: (ownAck as { acknowledged_at: string }).acknowledged_at,
          ip: (ownAck as { ip: string | null }).ip ?? null,
        }
      : null;

    let coverageSummary: DocumentAcknowledgementStatus["coverageSummary"] = null;
    if (ownerScope === "organisation" && canViewOrgDocs) {
      const { data: members } = await admin
        .from("members")
        .select("id, rights_profiles(can_view_organisation_documents)")
        .eq("organisation_id", organisationId)
        .not("user_id", "is", null);
      let expectedIds = ((members ?? []) as Array<{
        id: string;
        rights_profiles: { can_view_organisation_documents?: boolean } | { can_view_organisation_documents?: boolean }[] | null;
      }>)
        .filter((m) => {
          const rp = Array.isArray(m.rights_profiles) ? m.rights_profiles[0] : m.rights_profiles;
          return rp?.can_view_organisation_documents === true;
        })
        .map((m) => m.id);
      const { data: hiddenForDoc } = await admin
        .from("member_org_document_hidden")
        .select("member_id")
        .eq("document_id", documentId);
      const hiddenSet = new Set<string>(
        ((hiddenForDoc ?? []) as { member_id: string }[]).map((r) => r.member_id),
      );
      if (hiddenSet.size > 0) {
        expectedIds = expectedIds.filter((id) => !hiddenSet.has(id));
      }
      const { data: acks } = await admin
        .from("document_acknowledgement")
        .select("member_id")
        .eq("document_id", documentId)
        .is("superseded_by_replace_at", null);
      const ackedSet = new Set(((acks ?? []) as { member_id: string }[]).map((r) => r.member_id));
      const totalAcknowledged = expectedIds.filter((id) => ackedSet.has(id)).length;
      coverageSummary = {
        totalExpected: expectedIds.length,
        totalAcknowledged,
        outstanding: expectedIds.length - totalAcknowledged,
      };
    }

    return {
      success: true,
      status: {
        requiresAcknowledgement: true,
        isCallerExpectedToAcknowledge,
        callerAcknowledgement,
        coverageSummary,
      },
    };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "An error occurred" };
  }
}
