"use server";

// CLE-236 — Simple in-app e-signature: web server actions. Thin
// cookies-auth wrappers over `signature-actions-impl.ts` (shared with
// the mobile routes). Types live in the impl / `@/lib/document-signatures`
// — import them from there (never re-export types from a "use server"
// file; Turbopack's production build breaks on it).

import { buildDocumentsCallerFromCookies } from "@/lib/documents-caller";
import { loadOrgDocMember, loadOrgDocMembers } from "@/lib/org-doc-audience";
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

/** One outstanding signature, for the admin dashboard drill-down. */
export interface SignatureSummaryItem {
  bucket: "mine" | "members" | "company";
  documentId: string;
  fileName: string;
  subtypeName: string;
  ownerScope: "member" | "organisation";
  /** Whose document (member docs) — null for org docs. */
  ownerId: string | null;
  ownerName: string | null;
  signerId: string;
  signerName: string;
  signerRole: "member" | "company";
}

/** One "awaiting signature" line on the admin dashboard Documents card. */
export interface SignatureSummaryLine {
  /** Signatures outstanding. */
  outstanding: number;
  /** Distinct members the documents belong to (or who must sign them). */
  members: number;
}

/** Admin dashboard Documents card — outstanding signatures split by who
 *  must sign (2026-11-04): the caller ("awaiting your signature"),
 *  members ("awaiting {member} signature") and other company signatories
 *  ("awaiting company signature"). Same scope as the acknowledgement
 *  summary (self + Documents-tab view with team / all reach). */
export async function getOrgOutstandingSignatureSummary(): Promise<
  | {
      success: true;
      totalOutstanding: number;
      mine: SignatureSummaryLine;
      members: SignatureSummaryLine;
      company: SignatureSummaryLine;
      items: SignatureSummaryItem[];
    }
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
    const acc = {
      mine: { n: 0, who: new Set<string>() },
      members: { n: 0, who: new Set<string>() },
      company: { n: 0, who: new Set<string>() },
    };
    const raw: Omit<SignatureSummaryItem, "ownerName" | "signerName">[] = [];
    for (const [signerId, rows] of byMember) {
      for (const r of rows) {
        const key: SignatureSummaryItem["bucket"] = signerId === caller.memberId ? "mine" : r.role === "company" ? "company" : "members";
        raw.push({
          bucket: key,
          documentId: r.documentId,
          fileName: r.fileName,
          subtypeName: r.subtypeName,
          ownerScope: r.ownerScope,
          ownerId: r.ownerId,
          signerId,
          signerRole: r.role,
        });
        const bucket = acc[key];
        bucket.n++;
        // The member the document concerns: its owner, or (org documents)
        // the member asked to sign it.
        const who = r.ownerId ?? (r.role === "member" ? signerId : null);
        if (who) bucket.who.add(who);
      }
    }
    const line = (b: { n: number; who: Set<string> }): SignatureSummaryLine => ({ outstanding: b.n, members: b.who.size });
    const nameIds = Array.from(new Set(raw.flatMap((r) => [r.signerId, r.ownerId ?? ""]).filter(Boolean)));
    const nameOf = new Map<string, string>();
    if (nameIds.length > 0) {
      const { data } = await admin.from("members").select("id, first_name, last_name").eq("organisation_id", organisationId).in("id", nameIds);
      for (const m of (data ?? []) as { id: string; first_name: string | null; last_name: string | null }[]) {
        nameOf.set(m.id, `${m.first_name ?? ""} ${m.last_name ?? ""}`.trim() || "Unknown");
      }
    }
    const order = { mine: 0, members: 1, company: 2 } as const;
    const items: SignatureSummaryItem[] = raw
      .map((r) => ({ ...r, ownerName: r.ownerId ? (nameOf.get(r.ownerId) ?? null) : null, signerName: nameOf.get(r.signerId) ?? "Unknown" }))
      .sort((a, b) => order[a.bucket] - order[b.bucket] || (a.ownerName ?? a.signerName).localeCompare(b.ownerName ?? b.signerName));
    return {
      items,
      success: true,
      totalOutstanding: acc.mine.n + acc.members.n + acc.company.n,
      mine: line(acc.mine),
      members: line(acc.members),
      company: line(acc.company),
    };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "An error occurred" };
  }
}

export async function getSignatureBadges(documentIds: string[]) {
  const caller = await buildDocumentsCallerFromCookies();
  if (!caller) return NOT_AUTH;
  return _getSignatureBadges(caller, documentIds);
}

/** Admin view of a member's dashboard: documents waiting for THIS
 *  member's signature. Same access rule as the acknowledgement chip
 *  (self, or Documents-tab view with team / all reach). */
export async function getOutstandingSignaturesForMember(memberId: string) {
  try {
    const caller = await buildDocumentsCallerFromCookies();
    if (!caller) return NOT_AUTH;
    const target = await loadOrgDocMember(caller.admin, caller.organisationId, memberId);
    if (!target) return { success: false as const, error: "Member not found" };
    if (target.id !== caller.memberId) {
      const view = caller.rights.tabs.documents?.view === true;
      const reach =
        caller.rights.crossUserAccess === "all" ||
        (caller.rights.crossUserAccess === "team" && target.teamId !== null && target.teamId === caller.teamId);
      if (!view || !reach) return { success: false as const, error: "Member not found" };
    }
    const byMember = await getOutstandingSignaturesForMany(caller.admin, caller.organisationId, [target]);
    return { success: true as const, rows: byMember.get(target.id) ?? [] };
  } catch (e) {
    return { success: false as const, error: e instanceof Error ? e.message : "An error occurred" };
  }
}
