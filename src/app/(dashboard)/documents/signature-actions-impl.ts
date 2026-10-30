// CLE-236 — Simple in-app e-signature. Impl sibling (not "use server")
// of `signature-actions.ts`, so the same bodies serve the web actions
// (cookies caller) and the mobile routes under /api/mobile/documents/*
// (bearer caller). See the impl-siblings pattern in CLAUDE.md.
//
// Spec: Spec Vault → specs/Documents/08 Document Signatures.md
// Shared rules + PDF stamping: src/lib/document-signatures.ts

import { revalidatePath } from "next/cache";
import { logAudit } from "@/lib/audit";
import type { DocumentsCaller } from "@/lib/documents-caller";
import { subtypeHiddenFromMember } from "@/lib/documents-member-visibility";
import {
  AUDIENCE_COLUMNS,
  audienceFromRow,
  canSeeOrgDoc,
  expectedAcknowledgerIds,
  isExpectedToAcknowledge,
  loadOrgDocMembers,
  type AudienceDbRow,
  type OrgDocMember,
} from "@/lib/org-doc-audience";
import {
  NOT_PDF_ERROR,
  bucketForScope,
  buildSignedPdf,
  downloadDocumentBytes,
  fmtEvidenceTime,
  getOutstandingSignaturesForMany,
  isSignablePdf,
  sha256Hex,
  type OutstandingSignature,
  type SignatureEvidence,
  type SignatureRequestMode,
  type SignatureRole,
  type SignatureStatus,
} from "@/lib/document-signatures";
import { MEMBER_DOCUMENTS_BUCKET } from "@/lib/document-limits";
import {
  sendSignatureCompletedEmail,
  sendSignatureDeclinedEmail,
  sendSignatureRequestEmail,
} from "@/lib/email";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SendableMode = "member" | "company" | "member_then_company";

export interface SignatureSignerView {
  role: SignatureRole;
  memberId: string;
  name: string;
  status: SignatureStatus;
  sentAt: string | null;
  signedAt: string | null;
  markType: "typed" | "drawn" | null;
  declinedReason: string | null;
}

export interface SignatureRequestView {
  id: string;
  mode: SignatureRequestMode;
  status: "pending" | "completed" | "declined" | "cancelled";
  message: string | null;
  createdAt: string;
  createdByName: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  signedDocumentId: string | null;
  signers: SignatureSignerView[];
}

export interface DocumentSignatureState {
  signOff: "none" | "acknowledge" | "sign";
  ownerScope: "member" | "organisation";
  isPdf: boolean;
  /** This document is the signed copy produced by a completed request. */
  signedCopyOf: SignatureRequestView | null;
  /** The open send-for-signature request (not the org audience campaign). */
  openRequest: SignatureRequestView | null;
  /** The most recent finished request on this document (declined / cancelled). */
  lastClosedRequest: SignatureRequestView | null;
  // Admin controls
  canSend: boolean;
  sendBlockedReason: string | null;
  allowedModes: SendableMode[];
  defaultMode: SendableMode;
  canCancel: boolean;
  // Signer controls
  /** The caller can sign this document now, in this role. */
  callerCanSignAs: SignatureRole | null;
  /** Org docs: the caller's own signature, if they've signed. */
  callerSignedAt: string | null;
  /** Member docs: the owner's name (for "{Name} signed on …"). */
  ownerName: string | null;
  /** Org documents set to Sign: how many of the audience have signed. */
  audience: { expected: number; signed: number; waitingForCompany: boolean } | null;
}

export interface CompanySignatory {
  memberId: string;
  name: string;
}

export interface SigningView {
  documentId: string;
  fileName: string;
  subtypeName: string;
  orgName: string;
  role: SignatureRole;
  /** Short-lived URL of the file to read before signing. */
  url: string;
  message: string | null;
  senderName: string | null;
  /** Member documents signed by the company: whose document it is. */
  ownerName: string | null;
  callerName: string;
  canDecline: boolean;
}

type Ok<T> = { success: true } & T;
type Err = { success: false; error: string };

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

type SubtypeEmbed = { name?: string; type?: string; sign_off?: string; default_signing_mode?: string; visible_to_member?: boolean | null };

type SigDoc = AudienceDbRow & {
  id: string;
  organisation_id: string;
  owner_scope: "member" | "organisation";
  owner_id: string | null;
  type: string;
  subtype_id: string | null;
  file_name: string;
  file_size: number;
  content_type: string | null;
  storage_path: string;
  retention_class: string | null;
  expires_on: string | null;
  next_review_on: string | null;
  archived_at: string | null;
  version_number: number | null;
  signed_request_id: string | null;
  document_subtype: SubtypeEmbed | SubtypeEmbed[] | null;
};

const DOC_SELECT =
  "id, organisation_id, owner_scope, owner_id, type, subtype_id, file_name, file_size, content_type, storage_path, " +
  "retention_class, expires_on, next_review_on, archived_at, version_number, signed_request_id, " +
  AUDIENCE_COLUMNS +
  ", document_subtype!subtype_id(name, type, sign_off, default_signing_mode, visible_to_member)";

function subtypeOf(d: SigDoc): SubtypeEmbed | null {
  return Array.isArray(d.document_subtype) ? (d.document_subtype[0] ?? null) : d.document_subtype;
}

async function loadDoc(caller: DocumentsCaller, documentId: string): Promise<SigDoc | null> {
  const { data } = await caller.admin.from("document").select(DOC_SELECT).eq("id", documentId).maybeSingle();
  const doc = data as unknown as SigDoc | null;
  if (!doc || doc.organisation_id !== caller.organisationId) return null;
  return doc;
}

type MemberRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  team_id: string | null;
  user_id: string | null;
  invited_at: string | null;
};

async function loadMembers(caller: DocumentsCaller, ids: string[]): Promise<Map<string, MemberRow>> {
  const out = new Map<string, MemberRow>();
  const unique = Array.from(new Set(ids.filter(Boolean)));
  if (unique.length === 0) return out;
  const { data } = await caller.admin
    .from("members")
    .select("id, first_name, last_name, email, team_id, user_id, invited_at")
    .eq("organisation_id", caller.organisationId)
    .in("id", unique);
  for (const m of (data ?? []) as MemberRow[]) out.set(m.id, m);
  return out;
}

const fullName = (m: MemberRow | undefined | null) =>
  m ? `${m.first_name ?? ""} ${m.last_name ?? ""}`.trim() || "Unknown" : "Unknown";

async function orgName(caller: DocumentsCaller): Promise<string> {
  const { data } = await caller.admin.from("organisations").select("name").eq("id", caller.organisationId).maybeSingle();
  return (data as { name?: string } | null)?.name ?? "Your organisation";
}

async function inTrash(caller: DocumentsCaller, documentId: string): Promise<boolean> {
  const { data } = await caller.admin.from("disposal_queue").select("id").eq("document_id", documentId).maybeSingle();
  return !!data;
}

type RequestRow = {
  id: string;
  document_id: string;
  mode: SignatureRequestMode;
  status: "pending" | "completed" | "declined" | "cancelled";
  message: string | null;
  document_hash: string;
  created_by: string | null;
  created_at: string;
  completed_at: string | null;
  cancelled_at: string | null;
  signed_document_id: string | null;
  document_file_name: string;
  document_subtype_name: string;
};
type SignatureRow = {
  id: string;
  request_id: string;
  document_id: string;
  role: SignatureRole;
  signer_member_id: string;
  status: SignatureStatus;
  sent_at: string | null;
  mark_type: "typed" | "drawn" | null;
  typed_name: string | null;
  mark_storage_path: string | null;
  signer_name: string | null;
  signed_at: string | null;
  ip: string | null;
  user_agent: string | null;
  document_hash: string | null;
  declined_reason: string | null;
  created_at: string;
};
const REQUEST_SELECT =
  "id, document_id, mode, status, message, document_hash, created_by, created_at, completed_at, cancelled_at, signed_document_id, document_file_name, document_subtype_name";
const SIGNATURE_SELECT =
  "id, request_id, document_id, role, signer_member_id, status, sent_at, mark_type, typed_name, mark_storage_path, signer_name, signed_at, ip, user_agent, document_hash, declined_reason, created_at";

async function loadRequestView(caller: DocumentsCaller, req: RequestRow | null): Promise<SignatureRequestView | null> {
  if (!req) return null;
  const { data } = await caller.admin
    .from("document_signature")
    .select(SIGNATURE_SELECT)
    .eq("request_id", req.id)
    .order("created_at", { ascending: true });
  const sigs = (data ?? []) as SignatureRow[];
  const members = await loadMembers(caller, [...sigs.map((s) => s.signer_member_id), req.created_by ?? ""]);
  // Member signs first.
  sigs.sort((a, b) => (a.role === b.role ? 0 : a.role === "member" ? -1 : 1));
  return {
    id: req.id,
    mode: req.mode,
    status: req.status,
    message: req.message,
    createdAt: req.created_at,
    createdByName: req.created_by ? fullName(members.get(req.created_by)) : null,
    completedAt: req.completed_at,
    cancelledAt: req.cancelled_at,
    signedDocumentId: req.signed_document_id,
    signers: sigs.map((s) => ({
      role: s.role,
      memberId: s.signer_member_id,
      name: s.signer_name ?? fullName(members.get(s.signer_member_id)),
      status: s.status,
      sentAt: s.sent_at,
      signedAt: s.signed_at,
      markType: s.mark_type,
      declinedReason: s.declined_reason,
    })),
  };
}

function callerAsOrgDocMember(caller: DocumentsCaller): OrgDocMember {
  return {
    id: caller.memberId,
    teamId: caller.teamId,
    rightsProfileId: caller.rights.profileId,
    signedIn: true,
    invited: true,
    canView: caller.rights.canViewOrganisationDocuments,
    canManage: caller.rights.canManageOrganisationDocuments,
  };
}

/** Admin reach over a member-scope document (Documents tab + team/all). */
function canReachMemberDoc(caller: DocumentsCaller, ownerTeamId: string | null, need: "view" | "update"): boolean {
  if (caller.rights.tabs.documents?.[need] !== true) return false;
  if (caller.rights.crossUserAccess === "all") return true;
  if (caller.rights.crossUserAccess === "team") return ownerTeamId !== null && ownerTeamId === caller.teamId;
  return false;
}

function canManageDoc(caller: DocumentsCaller, doc: SigDoc, owner: MemberRow | undefined): boolean {
  if (doc.owner_scope === "organisation") return caller.rights.canManageOrganisationDocuments === true;
  return canReachMemberDoc(caller, owner?.team_id ?? null, "update");
}

function revalidateAll(doc: SigDoc) {
  if (doc.owner_scope === "organisation") revalidatePath("/documents/organisation");
  else if (doc.owner_id) revalidatePath(`/members/${doc.owner_id}/docs`);
  revalidatePath("/my-documents");
  revalidatePath("/dashboard");
  revalidatePath("/admin-dashboard");
  revalidatePath("/documents/compliance");
}

function baseUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? "https://app.clear-hr.com";
}

// Audit metadata stores readable values (the audit page prints values as-is).
const MODE_LABEL: Record<string, string> = {
  member: "Member",
  company: "Company signatory",
  member_then_company: "Member, then company signatory",
  audience: "Everyone the document is visible to",
};
const ROLE_LABEL: Record<SignatureRole, string> = { member: "Member", company: "Company signatory" };
const MARK_LABEL = { typed: "Typed", drawn: "Drawn" } as const;

const signPath = (documentId: string) => `/my-documents/sign/${documentId}`;

function targetType(doc: SigDoc) {
  return doc.owner_scope === "organisation" ? "org_document" : "member_document";
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function _getDocumentSignatureState(
  caller: DocumentsCaller,
  documentId: string,
): Promise<Ok<{ state: DocumentSignatureState }> | Err> {
  try {
    const doc = await loadDoc(caller, documentId);
    if (!doc) return { success: false, error: "Document not found" };
    const st = subtypeOf(doc);
    const signOff = (st?.sign_off as DocumentSignatureState["signOff"]) ?? "none";
    const owners = await loadMembers(caller, doc.owner_id ? [doc.owner_id] : []);
    const owner = doc.owner_id ? owners.get(doc.owner_id) : undefined;

    // Requests on this document.
    const { data: reqData } = await caller.admin
      .from("document_signature_request")
      .select(REQUEST_SELECT)
      .eq("document_id", documentId)
      .order("created_at", { ascending: false });
    const requests = (reqData ?? []) as RequestRow[];
    const open = requests.find((r) => r.status === "pending" && r.mode !== "audience") ?? null;
    const lastClosed = requests.find((r) => (r.status === "declined" || r.status === "cancelled") && r.mode !== "audience") ?? null;
    const audienceReq = requests.find((r) => r.mode === "audience") ?? null;

    // Access: managers, the owner (visible docs), the org-doc audience, or a named signer.
    const isSigner = open
      ? !!(await caller.admin
          .from("document_signature")
          .select("id")
          .eq("request_id", open.id)
          .eq("signer_member_id", caller.memberId)
          .maybeSingle()).data
      : false;
    let allowed = isSigner;
    if (!allowed) {
      if (doc.owner_scope === "organisation") {
        allowed = canSeeOrgDoc(audienceFromRow(doc), callerAsOrgDocMember(caller));
      } else if (doc.owner_id === caller.memberId) {
        allowed = !subtypeHiddenFromMember(doc.document_subtype) && !doc.archived_at;
      } else {
        allowed = canReachMemberDoc(caller, owner?.team_id ?? null, "view");
      }
    }
    if (!allowed) return { success: false, error: "Document not found" };

    const manage = canManageDoc(caller, doc, owner);
    const isPdf = isSignablePdf(doc.content_type, doc.file_name);
    const hiddenFromOwner = doc.owner_scope === "member" && subtypeHiddenFromMember(doc.document_subtype);

    // Signed copy?
    let signedCopyOf: SignatureRequestView | null = null;
    if (doc.signed_request_id) {
      const { data } = await caller.admin.from("document_signature_request").select(REQUEST_SELECT).eq("id", doc.signed_request_id).maybeSingle();
      signedCopyOf = await loadRequestView(caller, data as RequestRow | null);
    }

    // Org audience coverage + caller's own signature.
    let audience: DocumentSignatureState["audience"] = null;
    let callerSignedAt: string | null = null;
    let callerCanSignAs: SignatureRole | null = null;
    if (doc.owner_scope === "organisation" && signOff === "sign" && !doc.archived_at) {
      const { data: signedRows } = audienceReq
        ? await caller.admin.from("document_signature").select("signer_member_id, signed_at").eq("request_id", audienceReq.id).eq("status", "signed")
        : { data: [] };
      const signed = (signedRows ?? []) as { signer_member_id: string; signed_at: string }[];
      callerSignedAt = signed.find((s) => s.signer_member_id === caller.memberId)?.signed_at ?? null;
      if (manage) {
        const members = await loadOrgDocMembers(caller.admin, caller.organisationId);
        const expected = new Set(expectedAcknowledgerIds(audienceFromRow(doc), members));
        audience = {
          expected: expected.size,
          signed: signed.filter((s) => expected.has(s.signer_member_id)).length,
          waitingForCompany: !!open,
        };
      }
      if (
        !open && !callerSignedAt && isPdf &&
        isExpectedToAcknowledge(audienceFromRow(doc), callerAsOrgDocMember(caller)) &&
        !(await inTrash(caller, documentId))
      ) {
        callerCanSignAs = "member";
      }
    }
    if (open && !callerCanSignAs) {
      const { data } = await caller.admin
        .from("document_signature")
        .select("role")
        .eq("request_id", open.id)
        .eq("signer_member_id", caller.memberId)
        .eq("status", "pending")
        .maybeSingle();
      callerCanSignAs = (data as { role?: SignatureRole } | null)?.role ?? null;
    }

    // Send rules.
    let sendBlockedReason: string | null = null;
    let allowedModes: SendableMode[] = [];
    if (doc.owner_scope === "organisation") allowedModes = ["company"];
    else allowedModes = hiddenFromOwner ? ["company"] : ["member", "company", "member_then_company"];
    if (!manage) sendBlockedReason = "You don't have permission to send this document for signature.";
    else if (signOff !== "sign") sendBlockedReason = "This kind of document isn't set to be signed.";
    else if (!isPdf) sendBlockedReason = NOT_PDF_ERROR;
    else if (doc.archived_at) sendBlockedReason = "Archived documents can't be sent for signature.";
    else if (doc.signed_request_id) sendBlockedReason = "This is the signed copy — it can't be signed again.";
    else if (open) sendBlockedReason = "This document is already out for signature.";
    else if (await inTrash(caller, documentId)) sendBlockedReason = "This document is in Trash.";
    else if (doc.owner_scope === "organisation" && audienceReq) {
      const { count } = await caller.admin
        .from("document_signature")
        .select("id", { count: "exact", head: true })
        .eq("request_id", audienceReq.id)
        .eq("status", "signed");
      if ((count ?? 0) > 0) sendBlockedReason = "Members have already started signing this version. Publish a new version to have it signed by the company first.";
    }
    const subtypeDefault = (st?.default_signing_mode as SendableMode | undefined) ?? "member";
    const defaultMode = allowedModes.includes(subtypeDefault) ? subtypeDefault : allowedModes[0];

    return {
      success: true,
      state: {
        signOff,
        ownerScope: doc.owner_scope,
        isPdf,
        signedCopyOf,
        openRequest: await loadRequestView(caller, open),
        lastClosedRequest: await loadRequestView(caller, lastClosed),
        canSend: sendBlockedReason === null,
        sendBlockedReason: manage ? sendBlockedReason : null,
        allowedModes,
        defaultMode,
        canCancel: manage && !!open,
        callerCanSignAs,
        callerSignedAt,
        ownerName: owner ? fullName(owner) : null,
        audience,
      },
    };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "An error occurred" };
  }
}

/** People who can sign on behalf of the organisation (signed in, flag on). */
export async function _listCompanySignatories(caller: DocumentsCaller): Promise<Ok<{ signatories: CompanySignatory[] }> | Err> {
  try {
    const { data } = await caller.admin
      .from("members")
      .select("id, first_name, last_name, user_id, rights_profiles(can_sign_for_organisation)")
      .eq("organisation_id", caller.organisationId)
      .not("user_id", "is", null);
    type Row = { id: string; first_name: string | null; last_name: string | null; rights_profiles: { can_sign_for_organisation?: boolean } | { can_sign_for_organisation?: boolean }[] | null };
    const signatories = ((data ?? []) as unknown as Row[])
      .filter((r) => {
        const rp = Array.isArray(r.rights_profiles) ? r.rights_profiles[0] : r.rights_profiles;
        return rp?.can_sign_for_organisation === true;
      })
      .map((r) => ({ memberId: r.id, name: `${r.first_name ?? ""} ${r.last_name ?? ""}`.trim() || "Unknown" }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return { success: true, signatories };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "An error occurred" };
  }
}

export async function _getMyOutstandingSignatures(caller: DocumentsCaller): Promise<Ok<{ rows: OutstandingSignature[] }> | Err> {
  try {
    const map = await getOutstandingSignaturesForMany(caller.admin, caller.organisationId, [callerAsOrgDocMember(caller)]);
    return { success: true, rows: map.get(caller.memberId) ?? [] };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "An error occurred" };
  }
}

/** Everything the signing screen needs. Only for someone who can sign now. */
export async function _getSigningView(caller: DocumentsCaller, documentId: string): Promise<Ok<{ view: SigningView }> | Err> {
  try {
    const res = await _getDocumentSignatureState(caller, documentId);
    if (!res.success) return res;
    const role = res.state.callerCanSignAs;
    if (!role) {
      if (res.state.callerSignedAt) return { success: false, error: "You've already signed this document." };
      return { success: false, error: "There's nothing for you to sign on this document." };
    }
    const doc = (await loadDoc(caller, documentId))!;
    const { data: urlData, error } = await caller.admin.storage
      .from(bucketForScope(doc.owner_scope))
      .createSignedUrl(doc.storage_path, 900);
    if (error || !urlData) return { success: false, error: "Couldn't open the document." };
    const me = (await loadMembers(caller, [caller.memberId])).get(caller.memberId);
    const open = res.state.openRequest;
    return {
      success: true,
      view: {
        documentId,
        fileName: doc.file_name,
        subtypeName: subtypeOf(doc)?.name ?? "Document",
        orgName: await orgName(caller),
        role,
        url: urlData.signedUrl,
        message: open?.message ?? null,
        senderName: open?.createdByName ?? null,
        ownerName: role === "company" && doc.owner_scope === "member" ? res.state.ownerName : null,
        callerName: fullName(me),
        canDecline: !!open,
      },
    };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "An error occurred" };
  }
}

// ---------------------------------------------------------------------------
// Send / cancel
// ---------------------------------------------------------------------------

export async function _sendForSignature(
  caller: DocumentsCaller,
  documentId: string,
  input: { mode: SendableMode; signatoryMemberId?: string | null; message?: string | null },
): Promise<Ok<{ requestId: string }> | Err> {
  try {
    const stateRes = await _getDocumentSignatureState(caller, documentId);
    if (!stateRes.success) return stateRes;
    const state = stateRes.state;
    if (!state.canSend) return { success: false, error: state.sendBlockedReason ?? "This document can't be sent for signature." };
    if (!state.allowedModes.includes(input.mode)) return { success: false, error: "That signing option isn't available for this document." };
    const doc = (await loadDoc(caller, documentId))!;
    const st = subtypeOf(doc);
    const message = input.message?.trim() ? input.message.trim().slice(0, 2000) : null;

    // Signers.
    const needsMember = input.mode === "member" || input.mode === "member_then_company";
    const needsCompany = input.mode === "company" || input.mode === "member_then_company";
    const members = await loadMembers(caller, [doc.owner_id ?? "", input.signatoryMemberId ?? "", caller.memberId]);
    const owner = doc.owner_id ? members.get(doc.owner_id) : undefined;
    if (needsMember) {
      if (!owner) return { success: false, error: "Document not found" };
      if (!owner.user_id && !owner.invited_at) {
        return { success: false, error: `${fullName(owner)} hasn't been invited to ClearHR yet, so they can't sign. Invite them first.` };
      }
    }
    let signatory: MemberRow | undefined;
    if (needsCompany) {
      if (!input.signatoryMemberId) return { success: false, error: "Choose who signs for the organisation." };
      const list = await _listCompanySignatories(caller);
      if (!list.success) return list;
      if (!list.signatories.some((s) => s.memberId === input.signatoryMemberId)) {
        return { success: false, error: "That person can't sign on behalf of the organisation." };
      }
      signatory = members.get(input.signatoryMemberId);
      if (!signatory) return { success: false, error: "That person can't sign on behalf of the organisation." };
      if (needsMember && signatory.id === doc.owner_id) {
        return { success: false, error: "The company signatory must be someone other than the member." };
      }
    }

    const bytes = await downloadDocumentBytes(caller.admin, doc.storage_path, doc.owner_scope);
    if (!bytes) return { success: false, error: "Couldn't read the document's file." };
    const hash = sha256Hex(bytes);

    const now = new Date().toISOString();
    const { data: reqIns, error: reqErr } = await caller.admin
      .from("document_signature_request")
      .insert({
        organisation_id: caller.organisationId,
        document_id: doc.id,
        mode: input.mode,
        status: "pending",
        message,
        document_hash: hash,
        created_by: caller.memberId,
        document_file_name: doc.file_name,
        document_subtype_name: st?.name ?? "—",
      })
      .select("id")
      .single();
    if (reqErr || !reqIns) {
      if (reqErr?.code === "23505") return { success: false, error: "This document is already out for signature." };
      return { success: false, error: reqErr?.message ?? "Couldn't send the document for signature." };
    }
    const requestId = (reqIns as { id: string }).id;

    const rows: Record<string, unknown>[] = [];
    if (needsMember) {
      rows.push({ organisation_id: caller.organisationId, request_id: requestId, document_id: doc.id, role: "member", signer_member_id: owner!.id, status: "pending", sent_at: now });
    }
    if (needsCompany) {
      const first = !needsMember;
      rows.push({
        organisation_id: caller.organisationId,
        request_id: requestId,
        document_id: doc.id,
        role: "company",
        signer_member_id: signatory!.id,
        status: first ? "pending" : "waiting",
        sent_at: first ? now : null,
      });
    }
    const { error: sigErr } = await caller.admin.from("document_signature").insert(rows);
    if (sigErr) {
      await caller.admin.from("document_signature_request").delete().eq("id", requestId);
      return { success: false, error: sigErr.message };
    }

    const sender = members.get(caller.memberId);
    const org = await orgName(caller);
    await logAudit({
      organisationId: caller.organisationId,
      actorId: caller.memberId,
      actorName: fullName(sender),
      action: "document.signature_requested",
      targetType: targetType(doc),
      targetId: doc.id,
      targetLabel: doc.file_name,
      metadata: {
        ...(owner ? { member: fullName(owner) } : {}),
        subtype_name: st?.name ?? null,
        signing_mode: MODE_LABEL[input.mode],
        ...(signatory ? { signatory: fullName(signatory) } : {}),
        document_version_hash: hash,
        file_name: doc.file_name,
      },
    });

    // Tell whoever signs first.
    const first = needsMember ? owner! : signatory!;
    if (first.email) {
      await sendSignatureRequestEmail({
        to: first.email,
        firstName: first.first_name ?? "",
        orgName: org,
        subtypeName: st?.name ?? "Document",
        fileName: doc.file_name,
        role: needsMember ? "member" : "company",
        message,
        senderName: fullName(sender),
        path: signPath(doc.id),
        baseUrl: baseUrl(),
      });
    }

    revalidateAll(doc);
    return { success: true, requestId };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "An error occurred" };
  }
}

export async function _cancelSignatureRequest(caller: DocumentsCaller, documentId: string): Promise<Ok<object> | Err> {
  try {
    const doc = await loadDoc(caller, documentId);
    if (!doc) return { success: false, error: "Document not found" };
    const owners = await loadMembers(caller, [doc.owner_id ?? "", caller.memberId]);
    if (!canManageDoc(caller, doc, doc.owner_id ? owners.get(doc.owner_id) : undefined)) {
      return { success: false, error: "You don't have permission to cancel this request." };
    }
    const now = new Date().toISOString();
    const { data, error } = await caller.admin
      .from("document_signature_request")
      .update({ status: "cancelled", cancelled_by: caller.memberId, cancelled_at: now })
      .eq("document_id", documentId)
      .eq("status", "pending")
      .neq("mode", "audience")
      .select("id, mode");
    if (error) return { success: false, error: error.message };
    if (!data || data.length === 0) return { success: false, error: "There's no open signature request on this document." };
    await logAudit({
      organisationId: caller.organisationId,
      actorId: caller.memberId,
      actorName: fullName(owners.get(caller.memberId)),
      action: "document.signature_cancelled",
      targetType: targetType(doc),
      targetId: doc.id,
      targetLabel: doc.file_name,
      metadata: {
        ...(doc.owner_id ? { member: fullName(owners.get(doc.owner_id)) } : {}),
        subtype_name: subtypeOf(doc)?.name ?? null,
        signing_mode: MODE_LABEL[(data[0] as { mode: string }).mode] ?? (data[0] as { mode: string }).mode,
        file_name: doc.file_name,
      },
    });
    revalidateAll(doc);
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "An error occurred" };
  }
}

// ---------------------------------------------------------------------------
// Sign / decline
// ---------------------------------------------------------------------------

export interface SignInput {
  markType: "typed" | "drawn";
  typedName?: string | null;
  /** data:image/png;base64,… of the drawn mark. */
  drawnPng?: string | null;
  agreed: boolean;
}

const MAX_MARK_BYTES = 400 * 1024;

function decodePng(dataUrl: string): Uint8Array | null {
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl.trim());
  if (!m) return null;
  const buf = Buffer.from(m[1], "base64");
  if (buf.length < 8 || buf.length > MAX_MARK_BYTES) return null;
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (!sig.every((b, i) => buf[i] === b)) return null;
  return new Uint8Array(buf);
}

export async function _signDocument(caller: DocumentsCaller, documentId: string, input: SignInput): Promise<Ok<{ completed: boolean; signedDocumentId: string | null }> | Err> {
  try {
    if (!input.agreed) return { success: false, error: "Tick the box to agree to sign electronically." };
    const typedName = input.typedName?.trim().slice(0, 200) ?? "";
    let markPng: Uint8Array | null = null;
    if (input.markType === "typed") {
      if (!typedName) return { success: false, error: "Type your name to sign." };
    } else if (input.markType === "drawn") {
      markPng = input.drawnPng ? decodePng(input.drawnPng) : null;
      if (!markPng) return { success: false, error: "Draw your signature to sign." };
    } else {
      return { success: false, error: "Choose how to sign." };
    }

    const stateRes = await _getDocumentSignatureState(caller, documentId);
    if (!stateRes.success) return stateRes;
    const role = stateRes.state.callerCanSignAs;
    if (!role) {
      if (stateRes.state.callerSignedAt) return { success: false, error: "You've already signed this document." };
      return { success: false, error: "There's nothing for you to sign on this document." };
    }
    const doc = (await loadDoc(caller, documentId))!;
    if (doc.archived_at) return { success: false, error: "This document has been archived." };

    const bytes = await downloadDocumentBytes(caller.admin, doc.storage_path, doc.owner_scope);
    if (!bytes) return { success: false, error: "Couldn't read the document's file. Please try again." };
    const hash = sha256Hex(bytes);
    const me = (await loadMembers(caller, [caller.memberId])).get(caller.memberId);
    const myName = fullName(me);
    const st = subtypeOf(doc);

    // Which request + row.
    let request: RequestRow;
    let signatureId: string;
    const open = stateRes.state.openRequest;
    if (open) {
      const { data } = await caller.admin.from("document_signature_request").select(REQUEST_SELECT).eq("id", open.id).single();
      request = data as RequestRow;
      if (request.document_hash !== hash) {
        return { success: false, error: "This document's file has changed since it was sent for signature, so it can't be signed. Ask HR to send it again." };
      }
      const { data: row } = await caller.admin
        .from("document_signature")
        .select("id")
        .eq("request_id", request.id)
        .eq("signer_member_id", caller.memberId)
        .eq("status", "pending")
        .maybeSingle();
      if (!row) return { success: false, error: "There's nothing for you to sign on this document." };
      signatureId = (row as { id: string }).id;
    } else {
      // Organisation document — the standing audience request.
      const { data: existing } = await caller.admin
        .from("document_signature_request")
        .select(REQUEST_SELECT)
        .eq("document_id", doc.id)
        .eq("mode", "audience")
        .maybeSingle();
      let req = existing as RequestRow | null;
      if (!req) {
        const { data: ins, error } = await caller.admin
          .from("document_signature_request")
          .insert({
            organisation_id: caller.organisationId,
            document_id: doc.id,
            mode: "audience",
            status: "pending",
            document_hash: hash,
            created_by: null,
            document_file_name: doc.file_name,
            document_subtype_name: st?.name ?? "—",
          })
          .select(REQUEST_SELECT)
          .single();
        if (error && error.code !== "23505") return { success: false, error: error.message };
        req = (ins as RequestRow | null) ??
          ((await caller.admin.from("document_signature_request").select(REQUEST_SELECT).eq("document_id", doc.id).eq("mode", "audience").single()).data as RequestRow);
      }
      if (req.document_hash !== hash) {
        // Nobody has signed yet → the file was legitimately replaced; adopt it.
        const { count } = await caller.admin.from("document_signature").select("id", { count: "exact", head: true }).eq("request_id", req.id).eq("status", "signed");
        if ((count ?? 0) > 0) return { success: false, error: "This document's file has changed since others signed it, so it can't be signed." };
        await caller.admin.from("document_signature_request").update({ document_hash: hash, document_file_name: doc.file_name }).eq("id", req.id);
        req = { ...req, document_hash: hash };
      }
      request = req;
      // The evidence row is inserted complete once the mark is stored.
      signatureId = crypto.randomUUID();
    }

    // Store a drawn mark.
    let markPath: string | null = null;
    if (markPng) {
      markPath = `${caller.organisationId}/signatures/${signatureId}.png`;
      const { error: upErr } = await caller.admin.storage
        .from(MEMBER_DOCUMENTS_BUCKET)
        .upload(markPath, markPng, { contentType: "image/png", upsert: true });
      if (upErr) return { success: false, error: "Couldn't save your signature. Please try again." };
    }

    const signedAt = new Date().toISOString();
    const evidence = {
      status: "signed",
      mark_type: input.markType,
      typed_name: input.markType === "typed" ? typedName : null,
      mark_storage_path: markPath,
      signer_name: myName,
      signed_at: signedAt,
      ip: caller.ip,
      user_agent: caller.userAgent,
      document_hash: hash,
    };
    if (request.mode === "audience") {
      const { error: insErr } = await caller.admin.from("document_signature").insert({
        id: signatureId,
        organisation_id: caller.organisationId,
        request_id: request.id,
        document_id: doc.id,
        role: "member",
        signer_member_id: caller.memberId,
        ...evidence,
      });
      if (insErr) {
        if (insErr.code === "23505") return { success: false, error: "You've already signed this document." };
        return { success: false, error: insErr.message };
      }
    } else {
      const { data: upd, error: updErr } = await caller.admin
        .from("document_signature")
        .update(evidence)
        .eq("id", signatureId)
        .eq("status", "pending")
        .select("id");
      if (updErr) return { success: false, error: updErr.message };
      if (!upd || upd.length === 0) return { success: false, error: "You've already signed this document." };
    }

    const owners = await loadMembers(caller, doc.owner_id ? [doc.owner_id] : []);
    const owner = doc.owner_id ? owners.get(doc.owner_id) : undefined;
    await logAudit({
      organisationId: caller.organisationId,
      actorId: caller.memberId,
      actorName: myName,
      action: "document.signed",
      targetType: targetType(doc),
      targetId: doc.id,
      targetLabel: doc.file_name,
      metadata: {
        ...(owner ? { member: fullName(owner) } : {}),
        subtype_name: st?.name ?? null,
        signer_role: ROLE_LABEL[role],
        mark_type: MARK_LABEL[input.markType],
        document_version_hash: hash,
        ip: caller.ip,
        user_agent: caller.userAgent,
        file_name: doc.file_name,
      },
    });

    revalidateAll(doc);
    if (request.mode === "audience") return { success: true, completed: false, signedDocumentId: null };

    // Next signer, or complete.
    const { data: waiting } = await caller.admin
      .from("document_signature")
      .select("id, signer_member_id, role")
      .eq("request_id", request.id)
      .eq("status", "waiting");
    const next = ((waiting ?? []) as { id: string; signer_member_id: string; role: SignatureRole }[])[0];
    if (next) {
      await caller.admin.from("document_signature").update({ status: "pending", sent_at: new Date().toISOString() }).eq("id", next.id);
      const nm = (await loadMembers(caller, [next.signer_member_id, request.created_by ?? ""]));
      const signer = nm.get(next.signer_member_id);
      if (signer?.email) {
        await sendSignatureRequestEmail({
          to: signer.email,
          firstName: signer.first_name ?? "",
          orgName: await orgName(caller),
          subtypeName: st?.name ?? "Document",
          fileName: doc.file_name,
          role: next.role,
          message: request.message,
          senderName: request.created_by ? fullName(nm.get(request.created_by)) : null,
          path: signPath(doc.id),
          baseUrl: baseUrl(),
        });
      }
      return { success: true, completed: false, signedDocumentId: null };
    }

    const done = await completeRequest(caller, doc, request, bytes);
    if (!done.success) return done;
    return { success: true, completed: true, signedDocumentId: done.signedDocumentId };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "An error occurred" };
  }
}

async function evidenceFor(caller: DocumentsCaller, sigs: SignatureRow[]): Promise<SignatureEvidence[]> {
  const out: SignatureEvidence[] = [];
  for (const s of sigs) {
    let png: Uint8Array | null = null;
    if (s.mark_type === "drawn" && s.mark_storage_path) {
      const { data } = await caller.admin.storage.from(MEMBER_DOCUMENTS_BUCKET).download(s.mark_storage_path);
      if (data) png = new Uint8Array(await data.arrayBuffer());
    }
    out.push({
      role: s.role,
      signerName: s.signer_name ?? "Unknown",
      markType: (s.mark_type ?? "typed") as "typed" | "drawn",
      typedName: s.typed_name,
      markPng: png,
      signedAt: s.signed_at ?? s.created_at,
      ip: s.ip,
      userAgent: s.user_agent,
      documentHash: s.document_hash,
    });
  }
  return out;
}

/** All signers have signed: stamp the signature page and file version N+1. */
async function completeRequest(
  caller: DocumentsCaller,
  doc: SigDoc,
  request: RequestRow,
  originalBytes: Uint8Array,
): Promise<Ok<{ signedDocumentId: string }> | Err> {
  const { data: sigData } = await caller.admin
    .from("document_signature")
    .select(SIGNATURE_SELECT)
    .eq("request_id", request.id)
    .eq("status", "signed");
  const sigs = ((sigData ?? []) as SignatureRow[]).sort((a, b) => (a.signed_at ?? "").localeCompare(b.signed_at ?? ""));
  const members = await loadMembers(caller, [request.created_by ?? "", doc.owner_id ?? ""]);
  const org = await orgName(caller);
  const st = subtypeOf(doc);
  const history = [
    `Sent for signature by ${request.created_by ? fullName(members.get(request.created_by)) : "HR"} on ${fmtEvidenceTime(request.created_at)}.`,
    ...sigs.map((s) => `Signed by ${s.signer_name ?? "Unknown"}${s.role === "company" ? ` on behalf of ${org}` : ""} on ${fmtEvidenceTime(s.signed_at ?? s.created_at)}.`),
    `Completed on ${fmtEvidenceTime(new Date().toISOString())}.`,
  ];

  let signedBytes: Uint8Array;
  try {
    signedBytes = await buildSignedPdf(originalBytes, {
      orgName: org,
      fileName: doc.file_name,
      subtypeName: st?.name ?? "Document",
      originalHash: request.document_hash,
      requestId: request.id,
      history,
      signers: await evidenceFor(caller, sigs),
    });
  } catch {
    return { success: false, error: "Your signature was saved, but the signed PDF couldn't be built from this file. HR has been told." };
  }

  const bucket = bucketForScope(doc.owner_scope);
  const storagePath = `${caller.organisationId}/${crypto.randomUUID()}.pdf`;
  const { error: upErr } = await caller.admin.storage.from(bucket).upload(storagePath, signedBytes, { contentType: "application/pdf", upsert: false });
  if (upErr) return { success: false, error: "Your signature was saved, but the signed copy couldn't be stored. Please try again." };

  const base = doc.file_name.replace(/\.pdf$/i, "");
  const fileName = `${base} (signed).pdf`.slice(0, 255);
  const versionNumber = (doc.version_number ?? 1) + 1;
  const now = new Date().toISOString();
  const { data: ins, error: insErr } = await caller.admin
    .from("document")
    .insert({
      organisation_id: caller.organisationId,
      owner_scope: doc.owner_scope,
      owner_id: doc.owner_id,
      storage_path: storagePath,
      file_name: fileName,
      file_size: signedBytes.byteLength,
      content_type: "application/pdf",
      type: doc.type,
      subtype_id: doc.subtype_id,
      retention_class: doc.retention_class,
      expires_on: doc.expires_on,
      next_review_on: doc.next_review_on,
      uploaded_by: request.created_by,
      version_number: versionNumber,
      supersedes_document_id: doc.id,
      signed_request_id: request.id,
      ...(doc.owner_scope === "organisation"
        ? {
            audience_mode: doc.audience_mode ?? "all",
            audience_team_ids: doc.audience_team_ids ?? [],
            audience_rights_profile_ids: doc.audience_rights_profile_ids ?? [],
            audience_include_member_ids: doc.audience_include_member_ids ?? [],
          }
        : {}),
    })
    .select("id")
    .single();
  if (insErr || !ins) {
    await caller.admin.storage.from(bucket).remove([storagePath]);
    return { success: false, error: insErr?.message ?? "Couldn't file the signed copy." };
  }
  const newId = (ins as { id: string }).id;

  await caller.admin.from("document").update({ archived_at: now, archived_by: request.created_by, updated_at: now }).eq("id", doc.id);
  await caller.admin
    .from("document_signature_request")
    .update({ status: "completed", completed_at: now, signed_document_id: newId })
    .eq("id", request.id);

  const owner = doc.owner_id ? members.get(doc.owner_id) : undefined;
  const meta = {
    ...(owner ? { member: fullName(owner) } : {}),
    subtype_name: st?.name ?? null,
  };
  const actor = { id: caller.memberId, name: sigs.at(-1)?.signer_name ?? "Unknown" };
  await logAudit({
    organisationId: caller.organisationId,
    actorId: actor.id,
    actorName: actor.name,
    action: "document.signature_completed",
    targetType: targetType(doc),
    targetId: newId,
    targetLabel: fileName,
    metadata: { ...meta, signing_mode: MODE_LABEL[request.mode], version_number: versionNumber, previous_file_name: doc.file_name, file_name: fileName },
  });
  await logAudit({
    organisationId: caller.organisationId,
    actorId: actor.id,
    actorName: actor.name,
    action: "document.version_published",
    targetType: targetType(doc),
    targetId: newId,
    targetLabel: fileName,
    metadata: { ...meta, version_number: versionNumber, previous_file_name: doc.file_name, file_name: fileName, file_size: signedBytes.byteLength },
  });
  await logAudit({
    organisationId: caller.organisationId,
    actorId: actor.id,
    actorName: actor.name,
    action: "document.archived",
    targetType: targetType(doc),
    targetId: doc.id,
    targetLabel: doc.file_name,
    metadata: { ...meta, version_number: doc.version_number ?? 1, archive_reason: `Signed — replaced by version ${versionNumber}`, file_name: doc.file_name, file_size: doc.file_size },
  });

  // Copy to the member (link) when the document is theirs to see.
  if (owner?.email && !subtypeHiddenFromMember(doc.document_subtype) && (owner.user_id || owner.invited_at)) {
    await sendSignatureCompletedEmail({
      to: owner.email,
      firstName: owner.first_name ?? "",
      orgName: org,
      subtypeName: st?.name ?? "Document",
      fileName,
      path: "/my-documents?tab=employment",
      baseUrl: baseUrl(),
    });
  }
  revalidateAll(doc);
  return { success: true, signedDocumentId: newId };
}

export async function _declineSignature(caller: DocumentsCaller, documentId: string, reason: string): Promise<Ok<object> | Err> {
  try {
    const why = reason.trim().slice(0, 2000);
    if (!why) return { success: false, error: "Say why you're declining." };
    const stateRes = await _getDocumentSignatureState(caller, documentId);
    if (!stateRes.success) return stateRes;
    const open = stateRes.state.openRequest;
    if (!open || !stateRes.state.callerCanSignAs) return { success: false, error: "There's nothing for you to sign on this document." };
    const doc = (await loadDoc(caller, documentId))!;
    const now = new Date().toISOString();
    const { error } = await caller.admin
      .from("document_signature")
      .update({ status: "declined", declined_reason: why, signed_at: null })
      .eq("request_id", open.id)
      .eq("signer_member_id", caller.memberId)
      .eq("status", "pending");
    if (error) return { success: false, error: error.message };
    await caller.admin.from("document_signature_request").update({ status: "declined", completed_at: now }).eq("id", open.id);

    const members = await loadMembers(caller, [caller.memberId, doc.owner_id ?? ""]);
    const { data: reqRow } = await caller.admin.from("document_signature_request").select("created_by").eq("id", open.id).single();
    const createdBy = (reqRow as { created_by: string | null } | null)?.created_by ?? null;
    const sender = createdBy ? (await loadMembers(caller, [createdBy])).get(createdBy) : undefined;
    const me = members.get(caller.memberId);
    const st = subtypeOf(doc);
    await logAudit({
      organisationId: caller.organisationId,
      actorId: caller.memberId,
      actorName: fullName(me),
      action: "document.signature_declined",
      targetType: targetType(doc),
      targetId: doc.id,
      targetLabel: doc.file_name,
      metadata: {
        ...(doc.owner_id ? { member: fullName(members.get(doc.owner_id)) } : {}),
        subtype_name: st?.name ?? null,
        signer_role: stateRes.state.callerCanSignAs ? ROLE_LABEL[stateRes.state.callerCanSignAs] : null,
        decline_reason: why,
        file_name: doc.file_name,
      },
    });
    if (sender?.email) {
      await sendSignatureDeclinedEmail({
        to: sender.email,
        firstName: sender.first_name ?? "",
        orgName: await orgName(caller),
        signerName: fullName(me),
        subtypeName: st?.name ?? "Document",
        fileName: doc.file_name,
        reason: why,
        path: doc.owner_scope === "organisation" ? "/documents/organisation" : `/members/${doc.owner_id}/docs?tab=employment`,
        baseUrl: baseUrl(),
      });
    }
    revalidateAll(doc);
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "An error occurred" };
  }
}

// ---------------------------------------------------------------------------
// Org documents: a member's signed copy (generated on download)
// ---------------------------------------------------------------------------

export async function _getOrgSignedCopyUrl(
  caller: DocumentsCaller,
  documentId: string,
  memberId?: string | null,
): Promise<Ok<{ url: string; downloadUrl: string; fileName: string }> | Err> {
  try {
    const doc = await loadDoc(caller, documentId);
    if (!doc || doc.owner_scope !== "organisation") return { success: false, error: "Document not found" };
    const target = memberId ?? caller.memberId;
    if (target !== caller.memberId && !caller.rights.canManageOrganisationDocuments) {
      return { success: false, error: "Document not found" };
    }
    if (target === caller.memberId && !canSeeOrgDoc(audienceFromRow(doc), callerAsOrgDocMember(caller))) {
      return { success: false, error: "Document not found" };
    }
    const { data: req } = await caller.admin
      .from("document_signature_request")
      .select(REQUEST_SELECT)
      .eq("document_id", doc.id)
      .eq("mode", "audience")
      .maybeSingle();
    if (!req) return { success: false, error: "This document hasn't been signed." };
    const request = req as RequestRow;
    const { data: sig } = await caller.admin
      .from("document_signature")
      .select(SIGNATURE_SELECT)
      .eq("request_id", request.id)
      .eq("signer_member_id", target)
      .eq("status", "signed")
      .maybeSingle();
    if (!sig) return { success: false, error: "This document hasn't been signed by that person." };
    const s = sig as SignatureRow;

    const bucket = bucketForScope("organisation");
    const path = `${caller.organisationId}/signed-copies/${s.id}.pdf`;
    const base = doc.file_name.replace(/\.pdf$/i, "");
    const fileName = `${base} (signed by ${s.signer_name ?? "member"}).pdf`.slice(0, 255);

    // Build once, then reuse.
    const { data: existing } = await caller.admin.storage.from(bucket).list(`${caller.organisationId}/signed-copies`, { search: `${s.id}.pdf` });
    if (!existing || existing.length === 0) {
      const bytes = await downloadDocumentBytes(caller.admin, doc.storage_path, "organisation");
      if (!bytes) return { success: false, error: "Couldn't read the document's file." };
      const org = await orgName(caller);
      const signed = await buildSignedPdf(bytes, {
        orgName: org,
        fileName: doc.file_name,
        subtypeName: subtypeOf(doc)?.name ?? "Document",
        originalHash: request.document_hash,
        requestId: request.id,
        history: [`Signed by ${s.signer_name ?? "Unknown"} on ${fmtEvidenceTime(s.signed_at ?? s.created_at)}.`],
        signers: await evidenceFor(caller, [s]),
      });
      const { error: upErr } = await caller.admin.storage.from(bucket).upload(path, signed, { contentType: "application/pdf", upsert: true });
      if (upErr) return { success: false, error: "Couldn't prepare the signed copy." };
    }
    const [view, dl] = await Promise.all([
      caller.admin.storage.from(bucket).createSignedUrl(path, 120),
      caller.admin.storage.from(bucket).createSignedUrl(path, 120, { download: fileName }),
    ]);
    if (!view.data || !dl.data) return { success: false, error: "Couldn't open the signed copy." };

    await logAudit({
      organisationId: caller.organisationId,
      actorId: caller.memberId,
      actorName: fullName((await loadMembers(caller, [caller.memberId])).get(caller.memberId)),
      action: "document.viewed",
      targetType: "org_document",
      targetId: doc.id,
      targetLabel: fileName,
      metadata: { signed_copy_of: s.signer_name ?? null, file_name: fileName },
    });
    return { success: true, url: view.data.signedUrl, downloadUrl: dl.data.signedUrl, fileName };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "An error occurred" };
  }
}

/** Org documents set to Sign: who has signed (managers only). */
export async function _getOrgDocumentSigners(
  caller: DocumentsCaller,
  documentId: string,
): Promise<Ok<{ rows: { memberId: string; name: string; signedAt: string | null }[] }> | Err> {
  try {
    if (!caller.rights.canManageOrganisationDocuments) return { success: false, error: "Document not found" };
    const doc = await loadDoc(caller, documentId);
    if (!doc || doc.owner_scope !== "organisation") return { success: false, error: "Document not found" };
    const members = await loadOrgDocMembers(caller.admin, caller.organisationId);
    const expected = expectedAcknowledgerIds(audienceFromRow(doc), members);
    const { data: req } = await caller.admin.from("document_signature_request").select("id").eq("document_id", doc.id).eq("mode", "audience").maybeSingle();
    const signedMap = new Map<string, string>();
    if (req) {
      const { data } = await caller.admin
        .from("document_signature")
        .select("signer_member_id, signed_at")
        .eq("request_id", (req as { id: string }).id)
        .eq("status", "signed");
      for (const r of (data ?? []) as { signer_member_id: string; signed_at: string }[]) signedMap.set(r.signer_member_id, r.signed_at);
    }
    const names = await loadMembers(caller, Array.from(new Set([...expected, ...signedMap.keys()])));
    const ids = Array.from(new Set([...expected, ...signedMap.keys()]));
    const rows = ids
      .map((id) => ({ memberId: id, name: fullName(names.get(id)), signedAt: signedMap.get(id) ?? null }))
      .sort((a, b) => (a.signedAt ? 1 : 0) - (b.signedAt ? 1 : 0) || a.name.localeCompare(b.name));
    return { success: true, rows };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "An error occurred" };
  }
}

// ---------------------------------------------------------------------------
// Row badges ("Please sign" / "Awaiting signature" / "Signed")
// ---------------------------------------------------------------------------

export interface SignatureBadgeSigner {
  role: SignatureRole;
  name: string;
  status: SignatureStatus;
  signedAt: string | null;
}

/**
 * One badge per document for list rows, relative to the caller:
 *   to_sign  — the caller can sign it now (`callerRole` says as whom)
 *   awaiting — out for signature (`signers` = the open request's signers)
 *   signed   — a signed copy (`signers` = who signed), or an org document
 *              the caller has signed
 *   not_sent — a member document set to Sign that hasn't been sent yet
 *              (only for callers who can send it; `defaultMode` = the
 *              subtype's default "who signs")
 * The client turns `signers` into "member / company / both" labels and a
 * tooltip. Documents the caller can't see are left out.
 */
export interface SignatureBadge {
  kind: "to_sign" | "awaiting" | "signed" | "not_sent";
  ownerScope: "member" | "organisation";
  signers: SignatureBadgeSigner[];
  callerRole: SignatureRole | null;
  defaultMode: SendableMode | null;
}

export async function _getSignatureBadges(
  caller: DocumentsCaller,
  documentIds: string[],
): Promise<Ok<{ badges: Record<string, SignatureBadge> }> | Err> {
  try {
    const ids = Array.from(new Set(documentIds)).slice(0, 500);
    const badges: Record<string, SignatureBadge> = {};
    if (ids.length === 0) return { success: true, badges };
    const { data } = await caller.admin.from("document").select(DOC_SELECT).eq("organisation_id", caller.organisationId).in("id", ids);
    const docs = (data ?? []) as unknown as SigDoc[];
    const owners = await loadMembers(caller, docs.map((d) => d.owner_id ?? ""));
    const me = callerAsOrgDocMember(caller);
    const visible = docs.filter((d) => {
      if (d.owner_scope === "organisation") return canSeeOrgDoc(audienceFromRow(d), me);
      if (d.owner_id === caller.memberId) return !subtypeHiddenFromMember(d.document_subtype);
      return canReachMemberDoc(caller, owners.get(d.owner_id ?? "")?.team_id ?? null, "view");
    });
    const visIds = visible.map((d) => d.id);
    if (visIds.length === 0) return { success: true, badges };

    // Signature rows on these documents (any request), plus the requests
    // that produced signed copies.
    const signedReqIds = visible.map((d) => d.signed_request_id).filter((x): x is string => !!x);
    const [{ data: sigData }, { data: copyData }] = await Promise.all([
      caller.admin
        .from("document_signature")
        .select("document_id, request_id, signer_member_id, signer_name, role, status, signed_at, document_signature_request!request_id(status, mode)")
        .eq("organisation_id", caller.organisationId)
        .in("document_id", visIds),
      signedReqIds.length > 0
        ? caller.admin
            .from("document_signature")
            .select("document_id, request_id, signer_member_id, signer_name, role, status, signed_at")
            .eq("organisation_id", caller.organisationId)
            .in("request_id", signedReqIds)
            .eq("status", "signed")
        : Promise.resolve({ data: [] as unknown[] }),
    ]);
    type Row = {
      document_id: string;
      request_id: string;
      signer_member_id: string;
      signer_name: string | null;
      role: SignatureRole;
      status: SignatureStatus;
      signed_at: string | null;
      document_signature_request?: { status: string; mode: string } | { status: string; mode: string }[] | null;
    };
    const rows = (sigData ?? []) as unknown as Row[];
    const copyRows = (copyData ?? []) as unknown as Row[];
    const names = await loadMembers(caller, [...rows, ...copyRows].map((r) => r.signer_member_id));
    const toSigner = (r: Row): SignatureBadgeSigner => ({
      role: r.role,
      name: r.signer_name ?? fullName(names.get(r.signer_member_id)),
      status: r.status,
      signedAt: r.signed_at,
    });
    const bySignOrder = (a: SignatureBadgeSigner, b: SignatureBadgeSigner) => (a.role === b.role ? 0 : a.role === "member" ? -1 : 1);

    const openSigners = new Map<string, SignatureBadgeSigner[]>();
    const mine = new Map<string, { status: SignatureStatus; role: SignatureRole }>();
    for (const r of rows) {
      const req = Array.isArray(r.document_signature_request) ? r.document_signature_request[0] : r.document_signature_request;
      if (req?.status !== "pending") continue;
      if (req.mode !== "audience") {
        const list = openSigners.get(r.document_id) ?? [];
        list.push(toSigner(r));
        openSigners.set(r.document_id, list);
      }
      if (r.signer_member_id === caller.memberId) {
        const prev = mine.get(r.document_id);
        if (prev?.status !== "pending") mine.set(r.document_id, { status: r.status, role: r.role });
      }
    }
    const copySigners = new Map<string, SignatureBadgeSigner[]>();
    for (const r of copyRows) {
      const list = copySigners.get(r.request_id) ?? [];
      list.push(toSigner(r));
      copySigners.set(r.request_id, list);
    }

    for (const d of visible) {
      if (d.archived_at) continue;
      const st = subtypeOf(d);
      const base = { ownerScope: d.owner_scope, callerRole: null, defaultMode: null } as const;
      const open = (openSigners.get(d.id) ?? []).sort(bySignOrder);
      const myRow = mine.get(d.id);
      const orgSign = d.owner_scope === "organisation" && st?.sign_off === "sign" && isSignablePdf(d.content_type, d.file_name);
      if (myRow?.status === "pending") {
        badges[d.id] = { ...base, kind: "to_sign", signers: open, callerRole: myRow.role };
      } else if (open.length > 0) {
        badges[d.id] = { ...base, kind: "awaiting", signers: open };
      } else if (d.signed_request_id) {
        const signers = (copySigners.get(d.signed_request_id) ?? []).sort(bySignOrder);
        // An org document signed by the company still asks the audience.
        if (orgSign && myRow?.status !== "signed" && isExpectedToAcknowledge(audienceFromRow(d), me)) {
          badges[d.id] = { ...base, kind: "to_sign", signers, callerRole: "member" };
        } else {
          badges[d.id] = { ...base, kind: "signed", signers };
        }
      } else if (orgSign) {
        if (myRow?.status === "signed") badges[d.id] = { ...base, kind: "signed", signers: [] };
        else if (isExpectedToAcknowledge(audienceFromRow(d), me)) badges[d.id] = { ...base, kind: "to_sign", signers: [], callerRole: "member" };
      } else if (
        d.owner_scope === "member" &&
        st?.sign_off === "sign" &&
        isSignablePdf(d.content_type, d.file_name) &&
        canManageDoc(caller, d, owners.get(d.owner_id ?? ""))
      ) {
        const hidden = subtypeHiddenFromMember(d.document_subtype);
        const mode = (st?.default_signing_mode as SendableMode | undefined) ?? "member";
        badges[d.id] = { ...base, kind: "not_sent", signers: [], defaultMode: hidden ? "company" : mode };
      }
    }
    return { success: true, badges };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "An error occurred" };
  }
}
