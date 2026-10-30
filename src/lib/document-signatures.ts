// CLE-236 — Simple in-app e-signature: shared rules + PDF stamping.
//
// Plain module (not "use server") — imported by the signature action
// impl, the nightly email, the admin dashboard counts and the mobile
// routes. Callers pass the service-role client and do their own access
// checks.
//
// Spec: Spec Vault → specs/Documents/08 Document Signatures.md
//
// Rules in one place:
//   • Only PDFs can be signed (`isSignablePdf`).
//   • A subtype's `sign_off` decides Acknowledge / Sign / Neither; `sign`
//     only on Employment (contract) and Organisation documents.
//   • Member documents: HR sends a request (member / company /
//     member_then_company). One open request per document.
//   • Organisation documents set to Sign: every member the audience
//     expects (same rule as acknowledgement) signs, one evidence row each,
//     under a standing 'audience' request. While a company request is
//     open on the document, members aren't asked yet.
//   • The signed copy: original pages + a signature page with the
//     evidence trail. Member-doc requests file it as version N+1;
//     org-doc member copies are generated on download.

import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import {
  AUDIENCE_COLUMNS,
  audienceFromRow,
  isExpectedToAcknowledge,
  type AudienceDbRow,
  type OrgDocMember,
} from "@/lib/org-doc-audience";
import { MEMBER_DOCUMENTS_BUCKET, ORG_DOCUMENTS_BUCKET } from "@/lib/document-limits";

export type SignatureRole = "member" | "company";
export type SignatureRequestMode = "member" | "company" | "member_then_company" | "audience";
export type SignatureRequestStatus = "pending" | "completed" | "declined" | "cancelled";
export type SignatureStatus = "waiting" | "pending" | "signed" | "declined";

export const NOT_PDF_ERROR = "Only PDF documents can be signed. Save the file as a PDF and upload it as a new version first.";

export function bucketForScope(scope: "member" | "organisation"): string {
  return scope === "organisation" ? ORG_DOCUMENTS_BUCKET : MEMBER_DOCUMENTS_BUCKET;
}

export function isSignablePdf(contentType: string | null | undefined, fileName?: string | null): boolean {
  if (contentType === "application/pdf") return true;
  return !contentType && !!fileName && fileName.toLowerCase().endsWith(".pdf");
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Download a stored document's bytes. Null on failure. */
export async function downloadDocumentBytes(
  admin: SupabaseClient,
  storagePath: string,
  scope: "member" | "organisation",
): Promise<Uint8Array | null> {
  try {
    const { data, error } = await admin.storage.from(bucketForScope(scope)).download(storagePath);
    if (error || !data) return null;
    return new Uint8Array(await data.arrayBuffer());
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Outstanding signatures (the "N to sign" chip, admin counts, nightly email)
// ---------------------------------------------------------------------------

export interface OutstandingSignature {
  documentId: string;
  fileName: string;
  subtypeName: string;
  subtypeType: string;
  ownerScope: "member" | "organisation";
  role: SignatureRole;
  /** When this signer was asked (org docs: the document's upload time). */
  requestedAt: string;
  /** Member documents signed by the company: whose document it is. */
  ownerName: string | null;
}

type SubtypeEmbed = { name?: string; type?: string; sign_off?: string; visible_to_member?: boolean | null };
const subtypeOf = (st: SubtypeEmbed | SubtypeEmbed[] | null | undefined): SubtypeEmbed | null =>
  Array.isArray(st) ? (st[0] ?? null) : (st ?? null);

/**
 * Outstanding signatures for a SET of members in one pass. The single
 * source of "who owes a signature" — mirrors
 * `_getOutstandingAcknowledgementsForMany` for acknowledgements.
 */
export async function getOutstandingSignaturesForMany(
  admin: SupabaseClient,
  organisationId: string,
  members: OrgDocMember[],
): Promise<Map<string, OutstandingSignature[]>> {
  const byMember = new Map<string, OutstandingSignature[]>();
  if (members.length === 0) return byMember;
  const memberIds = members.map((m) => m.id);
  const push = (id: string, row: OutstandingSignature) => {
    const list = byMember.get(id) ?? [];
    list.push(row);
    byMember.set(id, list);
  };

  // 1. Sent requests: pending signature rows for these members.
  type SigRow = {
    signer_member_id: string;
    role: SignatureRole;
    sent_at: string | null;
    created_at: string;
    document_signature_request: { status: string; mode: string } | { status: string; mode: string }[] | null;
    document: {
      id: string;
      owner_scope: "member" | "organisation";
      owner_id: string | null;
      file_name: string;
      archived_at: string | null;
      document_subtype: SubtypeEmbed | SubtypeEmbed[] | null;
    } | null;
  };
  const { data: sigData } = await admin
    .from("document_signature")
    .select(
      "signer_member_id, role, sent_at, created_at, " +
        "document_signature_request!request_id(status, mode), " +
        "document!document_id(id, owner_scope, owner_id, file_name, archived_at, document_subtype!subtype_id(name, type))",
    )
    .eq("organisation_id", organisationId)
    .eq("status", "pending")
    .in("signer_member_id", memberIds);
  const sigRows = ((sigData ?? []) as unknown as SigRow[]).filter((r) => {
    const req = Array.isArray(r.document_signature_request) ? r.document_signature_request[0] : r.document_signature_request;
    return req?.status === "pending" && req.mode !== "audience" && r.document && !r.document.archived_at;
  });
  const ownerIds = Array.from(new Set(sigRows.filter((r) => r.role === "company" && r.document?.owner_id).map((r) => r.document!.owner_id!)));
  const ownerNames = new Map<string, string>();
  if (ownerIds.length > 0) {
    const { data } = await admin.from("members").select("id, first_name, last_name").in("id", ownerIds);
    for (const m of (data ?? []) as { id: string; first_name: string | null; last_name: string | null }[]) {
      ownerNames.set(m.id, `${m.first_name ?? ""} ${m.last_name ?? ""}`.trim());
    }
  }
  for (const r of sigRows) {
    const d = r.document!;
    const st = subtypeOf(d.document_subtype);
    push(r.signer_member_id, {
      documentId: d.id,
      fileName: d.file_name,
      subtypeName: st?.name ?? "—",
      subtypeType: st?.type ?? "contract",
      ownerScope: d.owner_scope,
      role: r.role,
      requestedAt: r.sent_at ?? r.created_at,
      ownerName: r.role === "company" && d.owner_id ? (ownerNames.get(d.owner_id) ?? null) : null,
    });
  }

  // 2. Organisation documents set to Sign: the audience signs.
  type OrgDoc = AudienceDbRow & {
    id: string;
    file_name: string;
    content_type: string | null;
    uploaded_at: string;
    disposal_date: string | null;
    document_subtype: SubtypeEmbed | SubtypeEmbed[] | null;
  };
  const { data: orgData } = await admin
    .from("document")
    .select(
      "id, file_name, content_type, uploaded_at, disposal_date, " + AUDIENCE_COLUMNS +
        ", document_subtype!subtype_id(name, type, sign_off)",
    )
    .eq("organisation_id", organisationId)
    .eq("owner_scope", "organisation")
    .is("archived_at", null);
  const today = new Date().toISOString().slice(0, 10);
  let orgDocs = ((orgData ?? []) as unknown as OrgDoc[]).filter(
    (d) =>
      subtypeOf(d.document_subtype)?.sign_off === "sign" &&
      isSignablePdf(d.content_type, d.file_name) &&
      !(d.disposal_date !== null && d.disposal_date <= today),
  );
  if (orgDocs.length === 0) return byMember;
  const orgDocIds = orgDocs.map((d) => d.id);
  const [{ data: queuedRows }, { data: companyOpen }, { data: signedRows }] = await Promise.all([
    admin.from("disposal_queue").select("document_id").eq("organisation_id", organisationId),
    admin
      .from("document_signature_request")
      .select("document_id")
      .eq("organisation_id", organisationId)
      .eq("status", "pending")
      .neq("mode", "audience")
      .in("document_id", orgDocIds),
    admin
      .from("document_signature")
      .select("document_id, signer_member_id")
      .eq("organisation_id", organisationId)
      .eq("status", "signed")
      .eq("role", "member")
      .in("document_id", orgDocIds)
      .in("signer_member_id", memberIds),
  ]);
  const skip = new Set<string>([
    ...((queuedRows ?? []) as { document_id: string }[]).map((r) => r.document_id),
    ...((companyOpen ?? []) as { document_id: string }[]).map((r) => r.document_id),
  ]);
  orgDocs = orgDocs.filter((d) => !skip.has(d.id));
  const signed = new Set(((signedRows ?? []) as { document_id: string; signer_member_id: string }[]).map((r) => `${r.signer_member_id}:${r.document_id}`));
  for (const m of members) {
    for (const d of orgDocs) {
      if (signed.has(`${m.id}:${d.id}`)) continue;
      if (!isExpectedToAcknowledge(audienceFromRow(d), m)) continue;
      const st = subtypeOf(d.document_subtype);
      push(m.id, {
        documentId: d.id,
        fileName: d.file_name,
        subtypeName: st?.name ?? "—",
        subtypeType: "organisation_document",
        ownerScope: "organisation",
        role: "member",
        requestedAt: d.uploaded_at,
        ownerName: null,
      });
    }
  }
  return byMember;
}

/**
 * Signature coverage for a set of documents (Compliance → Acknowledgements
 * tab, the coverage drill-down and "Remind outstanding"). Only signatures
 * under live requests count (the org audience campaign, or an open
 * send-for-signature request).
 *   • signed — doc → member → signedAt (member-role signatures)
 *   • memberRequested — member docs with an open request the owner signs
 *   • companyOpen — docs with an open request (members not asked yet on org docs)
 */
export async function loadSignatureCoverage(
  admin: SupabaseClient,
  organisationId: string,
  docIds: string[],
): Promise<{ signed: Map<string, Map<string, string>>; memberRequested: Set<string>; companyOpen: Set<string> }> {
  const signed = new Map<string, Map<string, string>>();
  const memberRequested = new Set<string>();
  const companyOpen = new Set<string>();
  if (docIds.length === 0) return { signed, memberRequested, companyOpen };
  const { data } = await admin
    .from("document_signature")
    .select("document_id, signer_member_id, role, status, signed_at, document_signature_request!request_id(status, mode)")
    .eq("organisation_id", organisationId)
    .in("document_id", docIds);
  type Row = {
    document_id: string;
    signer_member_id: string;
    role: SignatureRole;
    status: SignatureStatus;
    signed_at: string | null;
    document_signature_request: { status: string; mode: string } | { status: string; mode: string }[] | null;
  };
  for (const r of (data ?? []) as unknown as Row[]) {
    const req = Array.isArray(r.document_signature_request) ? r.document_signature_request[0] : r.document_signature_request;
    if (req?.status !== "pending") continue;
    if (req.mode !== "audience") companyOpen.add(r.document_id);
    if (r.role !== "member") continue;
    if (req.mode !== "audience") memberRequested.add(r.document_id);
    if (r.status === "signed" && r.signed_at) {
      const m = signed.get(r.document_id) ?? new Map<string, string>();
      m.set(r.signer_member_id, r.signed_at);
      signed.set(r.document_id, m);
    }
  }
  return { signed, memberRequested, companyOpen };
}

// ---------------------------------------------------------------------------
// Signature page
// ---------------------------------------------------------------------------

export interface SignatureEvidence {
  role: SignatureRole;
  signerName: string;
  markType: "typed" | "drawn";
  typedName: string | null;
  /** PNG bytes of a drawn mark. */
  markPng: Uint8Array | null;
  signedAt: string;
  ip: string | null;
  userAgent: string | null;
  documentHash: string | null;
}

export interface SignaturePageInput {
  orgName: string;
  fileName: string;
  subtypeName: string;
  /** SHA-256 of the unsigned original. */
  originalHash: string;
  requestId: string;
  /** Lines of the request history ("Sent for signature by … on …"). */
  history: string[];
  signers: SignatureEvidence[];
}

/** UK date + time for the evidence page: "30 Oct 2026, 14:05:09 GMT". */
export function fmtEvidenceTime(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: "Europe/London",
    timeZoneName: "short",
  });
}

const WIN_ANSI_EXTRA = new Set("€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ");
const TRANSLIT: Record<string, string> = { "Ł": "L", "ł": "l", "Đ": "D", "đ": "d", "ı": "i", "Ħ": "H", "ħ": "h", "ŀ": "l", "Ŀ": "L", "ß": "ss" };
/** Standard PDF fonts only cover WinAnsi; replace anything else. */
function safe(text: string): string {
  let out = "";
  for (const ch of text.normalize("NFC")) {
    const c = ch.codePointAt(0)!;
    if ((c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0xff) || WIN_ANSI_EXTRA.has(ch)) out += ch;
    else if (ch === "\n" || ch === "\t") out += " ";
    else if (TRANSLIT[ch]) out += TRANSLIT[ch];
    else {
      const stripped = ch.normalize("NFKD").replace(/[̀-ͯ]/g, "");
      out += /^[\x20-\x7e]+$/.test(stripped) ? stripped : "?";
    }
  }
  return out;
}

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = safe(text).split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const tryLine = line ? `${line} ${w}` : w;
    if (font.widthOfTextAtSize(tryLine, size) <= maxWidth) {
      line = tryLine;
      continue;
    }
    if (line) lines.push(line);
    // Hard-break very long tokens (hashes, user agents).
    let rest = w;
    while (font.widthOfTextAtSize(rest, size) > maxWidth) {
      let i = rest.length;
      while (i > 1 && font.widthOfTextAtSize(rest.slice(0, i), size) > maxWidth) i--;
      lines.push(rest.slice(0, i));
      rest = rest.slice(i);
    }
    line = rest;
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * Original pages + a signature page (evidence trail). Throws when the
 * original can't be parsed as a PDF.
 */
export async function buildSignedPdf(original: Uint8Array, input: SignaturePageInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(original, { ignoreEncryption: true, updateMetadata: false });
  const helv = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const mono = await pdf.embedFont(StandardFonts.Courier);
  const script = await pdf.embedFont(StandardFonts.TimesRomanBoldItalic);

  const W = 595.28;
  const H = 841.89;
  const M = 50;
  const maxW = W - M * 2;
  const ink = rgb(0.09, 0.09, 0.11);
  const muted = rgb(0.42, 0.45, 0.5);
  const rule = rgb(0.85, 0.85, 0.88);

  let page: PDFPage = pdf.addPage([W, H]);
  let y = H - M;
  const ensure = (h: number) => {
    if (y - h < M + 30) {
      page = pdf.addPage([W, H]);
      y = H - M;
    }
  };
  const text = (t: string, opts: { font?: PDFFont; size?: number; color?: ReturnType<typeof rgb>; x?: number; gap?: number } = {}) => {
    const font = opts.font ?? helv;
    const size = opts.size ?? 10;
    const x = opts.x ?? M;
    for (const ln of wrapText(t, font, size, maxW - (x - M))) {
      ensure(size + 4);
      page.drawText(ln, { x, y: y - size, size, font, color: opts.color ?? ink });
      y -= size + (opts.gap ?? 4);
    }
  };
  const kv = (k: string, v: string, valueFont: PDFFont = helv, size = 9) => {
    const kx = M + 12;
    const vx = M + 120;
    const lines = wrapText(v, valueFont, size, maxW - (vx - M));
    ensure((size + 4) * lines.length);
    page.drawText(safe(k), { x: kx, y: y - 9, size: 9, font: helv, color: muted });
    for (const ln of lines) {
      page.drawText(ln, { x: vx, y: y - size, size, font: valueFont, color: ink });
      y -= size + 4;
    }
  };
  const hr = () => {
    ensure(14);
    y -= 6;
    page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.6, color: rule });
    y -= 10;
  };

  text("Signature page", { font: bold, size: 18, gap: 8 });
  text(`Electronically signed in ClearHR for ${input.orgName}.`, { color: muted, size: 10, gap: 10 });
  kv("Document", input.fileName);
  kv("Kind", input.subtypeName);
  kv("Original SHA-256", input.originalHash, mono, 8);
  kv("Request reference", input.requestId, mono, 8);
  hr();

  for (const s of input.signers) {
    ensure(110);
    text(s.role === "company" ? `On behalf of ${input.orgName}` : "Signed by", { font: bold, size: 11, gap: 6 });
    // The mark
    if (s.markType === "drawn" && s.markPng) {
      try {
        const img = await pdf.embedPng(s.markPng);
        const scale = Math.min(220 / img.width, 70 / img.height, 1);
        const w = img.width * scale;
        const h = img.height * scale;
        ensure(h + 8);
        page.drawImage(img, { x: M + 12, y: y - h, width: w, height: h });
        y -= h + 4;
      } catch {
        text(`(drawn signature of ${s.signerName})`, { font: script, size: 14, x: M + 12 });
      }
    } else {
      ensure(30);
      page.drawText(safe(s.typedName || s.signerName), { x: M + 12, y: y - 24, size: 24, font: script, color: rgb(0.1, 0.15, 0.45) });
      y -= 32;
    }
    page.drawLine({ start: { x: M + 12, y: y + 2 }, end: { x: M + 250, y: y + 2 }, thickness: 0.5, color: muted });
    y -= 8;
    kv("Name", s.signerName);
    kv("Signed as", s.role === "company" ? `Company signatory for ${input.orgName}` : "Member");
    kv("Signature", s.markType === "drawn" ? "Drawn" : "Typed");
    kv("Date and time", fmtEvidenceTime(s.signedAt));
    kv("IP address", s.ip ?? "Not recorded");
    kv("Device", s.userAgent ?? "Not recorded", helv, 8);
    kv("Document SHA-256", s.documentHash ?? "Not recorded", mono, 8);
    hr();
  }

  if (input.history.length > 0) {
    text("History", { font: bold, size: 11, gap: 6 });
    for (const h of input.history) text(`• ${h}`, { size: 9, x: M + 12 });
    hr();
  }
  text(
    "The signers above signed with a simple electronic signature after signing in to ClearHR. The SHA-256 fingerprint identifies the exact file each signer saw; any change to that file changes the fingerprint.",
    { size: 8, color: muted },
  );

  return await pdf.save();
}
