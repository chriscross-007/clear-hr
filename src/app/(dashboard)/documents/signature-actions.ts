"use server";

// CLE-236 — Simple in-app e-signature: web server actions. Thin
// cookies-auth wrappers over `signature-actions-impl.ts` (shared with
// the mobile routes). Types live in the impl / `@/lib/document-signatures`
// — import them from there (never re-export types from a "use server"
// file; Turbopack's production build breaks on it).

import { buildDocumentsCallerFromCookies } from "@/lib/documents-caller";
import { loadOrgDocMembers } from "@/lib/org-doc-audience";
import { getOutstandingSignaturesForMany } from "@/lib/document-signatures";
import {
  _cancelSignatureRequest,
  _declineSignature,
  _getDocumentSignatureState,
  _getMyOutstandingSignatures,
  _getOrgDocumentSigners,
  _getOrgSignedCopyUrl,
  _getSigningView,
  _getSignatureBadges,
  _listCompanySignatories,
  _sendForSignature,
  _signDocument,
  type SendableMode,
  type SignInput,
} from "./signature-actions-impl";

const NOT_AUTH = { success: false as const, error: "Not authenticated" };

export async function getDocumentSignatureState(documentId: string) {
  const caller = await buildDocumentsCallerFromCookies();
  if (!caller) return NOT_AUTH;
  return _getDocumentSignatureState(caller, documentId);
}

export async function listCompanySignatories() {
  const caller = await buildDocumentsCallerFromCookies();
  if (!caller) return NOT_AUTH;
  return _listCompanySignatories(caller);
}

export async function getMyOutstandingSignatures() {
  const caller = await buildDocumentsCallerFromCookies();
  if (!caller) return NOT_AUTH;
  return _getMyOutstandingSignatures(caller);
}

export async function getSigningView(documentId: string) {
  const caller = await buildDocumentsCallerFromCookies();
  if (!caller) return NOT_AUTH;
  return _getSigningView(caller, documentId);
}

export async function sendForSignature(
  documentId: string,
  input: { mode: SendableMode; signatoryMemberId?: string | null; message?: string | null },
) {
  const caller = await buildDocumentsCallerFromCookies();
  if (!caller) return NOT_AUTH;
  return _sendForSignature(caller, documentId, input);
}

export async function cancelSignatureRequest(documentId: string) {
  const caller = await buildDocumentsCallerFromCookies();
  if (!caller) return NOT_AUTH;
  return _cancelSignatureRequest(caller, documentId);
}

export async function signDocument(documentId: string, input: SignInput) {
  const caller = await buildDocumentsCallerFromCookies();
  if (!caller) return NOT_AUTH;
  return _signDocument(caller, documentId, input);
}

export async function declineSignature(documentId: string, reason: string) {
  const caller = await buildDocumentsCallerFromCookies();
  if (!caller) return NOT_AUTH;
  return _declineSignature(caller, documentId, reason);
}

export async function getOrgSignedCopyUrl(documentId: string, memberId?: string | null) {
  const caller = await buildDocumentsCallerFromCookies();
  if (!caller) return NOT_AUTH;
  return _getOrgSignedCopyUrl(caller, documentId, memberId);
}

export async function getOrgDocumentSigners(documentId: string) {
  const caller = await buildDocumentsCallerFromCookies();
  if (!caller) return NOT_AUTH;
  return _getOrgDocumentSigners(caller, documentId);
}

/** Admin dashboard Documents card: "N awaiting signature" — same scope
 *  as the acknowledgement summary (self + Documents-tab view with team /
 *  all reach). */
export async function getOrgOutstandingSignatureSummary(): Promise<
  | { success: true; totalOutstanding: number; members: { memberId: string; name: string; outstanding: number; tab: "employment" | "org" }[] }
  | { success: false; error: string }
> {
  try {
    const caller = await buildDocumentsCallerFromCookies();
    if (!caller) return NOT_AUTH;
    const { admin, organisationId } = caller;
    const all = await loadOrgDocMembers(admin, organisationId);
    const view = caller.rights.tabs.documents?.view === true;
    const scope = caller.rights.crossUserAccess;
    const inScope = all.filter((m) => {
      if (m.id === caller.memberId) return true;
      if (!view) return false;
      if (scope === "all") return true;
      if (scope === "team") return caller.teamId !== null && m.teamId === caller.teamId;
      return false;
    });
    const byMember = await getOutstandingSignaturesForMany(admin, organisationId, inScope);
    if (byMember.size === 0) return { success: true, totalOutstanding: 0, members: [] };
    const ids = Array.from(byMember.keys());
    const { data: names } = await admin.from("members").select("id, first_name, last_name").eq("organisation_id", organisationId).in("id", ids);
    const nameOf = new Map(
      ((names ?? []) as { id: string; first_name: string | null; last_name: string | null }[]).map((r) => [r.id, `${r.first_name ?? ""} ${r.last_name ?? ""}`.trim() || "Unknown"]),
    );
    const members = ids
      .map((id) => {
        const rows = byMember.get(id)!;
        const tab: "employment" | "org" = rows.some((r) => r.ownerScope === "member" && r.role === "member") ? "employment" : "org";
        return { memberId: id, name: nameOf.get(id) ?? "Unknown", outstanding: rows.length, tab };
      })
      .sort((a, b) => b.outstanding - a.outstanding || a.name.localeCompare(b.name));
    return { success: true, totalOutstanding: members.reduce((n, m) => n + m.outstanding, 0), members };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "An error occurred" };
  }
}

export async function getSignatureBadges(documentIds: string[]) {
  const caller = await buildDocumentsCallerFromCookies();
  if (!caller) return NOT_AUTH;
  return _getSignatureBadges(caller, documentIds);
}
