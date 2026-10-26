"use server";

// CLE-219 — Document Acknowledgement server actions (Ticket B).
//
// See spec: C:\Lifeboat\Halo\Spec Vault\specs\Documents\Document Acknowledgement.md
//
// Three exports:
//   - acknowledgeDocument(documentId)    → self-only insert of a
//     `document_acknowledgement` row + audit. RLS enforces the identity
//     invariant; this action layers the "is the caller expected to
//     acknowledge?" check on top and stamps the denormalised name +
//     version hash the spec calls for.
//   - getMyOutstandingAcknowledgements() → the caller's own list of
//     docs still needing their ack. Drives the Employee Self Dashboard
//     chip + the /my-documents outstanding list.
//   - getDocumentCoverage(documentId)    → per-doc "N of M acknowledged
//     + who's outstanding" for the HR Compliance dashboard's
//     Acknowledgements tab.
//
// This file deliberately lives at (dashboard)/documents/ alongside
// compliance-actions.ts rather than inside members/[memberId]/docs/
// or organisation/, because acknowledgement is a cross-cutting concern
// that spans both scopes. Member-scope and org-scope docs share one
// table (`document_acknowledgement`) and one action surface.

import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { createHash } from "node:crypto";
import { sendAckReminderEmail } from "@/lib/email";
import { subtypeHiddenFromMember } from "@/lib/documents-member-visibility";
import { isDocumentArchived } from "@/lib/document-archive";
import { getEffectiveRightsForUser } from "@/lib/rights-resolver";
import { logAudit } from "@/lib/audit";
import { buildDocumentsCallerFromCookies } from "@/lib/documents-caller";
import {
  _acknowledgeDocument,
  _getMyOutstandingAcknowledgements,
  _getDocumentAcknowledgementStatus,
  _getOutstandingAcknowledgementsFor,
  _getOutstandingAcknowledgementsForMany,
} from "./acknowledgement-actions-impl";
import {
  AUDIENCE_COLUMNS,
  audienceFromRow,
  expectedAcknowledgerIds,
  loadMemberInvited,
  loadOrgDocMember,
  loadOrgDocMembers,
  type AudienceDbRow,
  type OrgDocMember,
} from "@/lib/org-doc-audience";

// ---------------------------------------------------------------------------
// Constants / helpers
// ---------------------------------------------------------------------------

const STORAGE_BUCKET = "member-documents";

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
  teamId: string | null;
  crossUserAccess: "self" | "team" | "all";
  canViewOrgDocs: boolean;
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
    teamId: ctx.teamId,
    crossUserAccess: rights.crossUserAccess,
    canViewOrgDocs: rights.canViewOrganisationDocuments,
  };
}

/** Best-effort IP extraction from the request headers.
 *  Vercel forwards the client IP in `x-forwarded-for`. Trust chain is
 *  the platform's problem, not ours — we don't try to prove which hop
 *  is genuine, just capture what the platform passed. NULL when nothing
 *  in the header. */
async function readClientIp(): Promise<string | null> {
  const h = await headers();
  const xff = h.get("x-forwarded-for");
  if (!xff) return h.get("x-real-ip") ?? null;
  // xff may be a comma-separated chain — the first entry is the client.
  const first = xff.split(",")[0]?.trim();
  return first && first.length > 0 ? first : null;
}

async function readUserAgent(): Promise<string | null> {
  const h = await headers();
  const ua = h.get("user-agent");
  if (!ua) return null;
  // The DB check constraint caps at 500 chars; truncate defensively.
  return ua.length > 500 ? ua.slice(0, 500) : ua;
}

async function callerName(admin: ReturnType<typeof getAdmin>, callerMemberId: string): Promise<string> {
  const { data } = await admin
    .from("members")
    .select("first_name, last_name")
    .eq("id", callerMemberId)
    .single();
  return `${data?.first_name ?? ""} ${data?.last_name ?? ""}`.trim() || "Unknown";
}

/** SHA-256 of the doc's stored bytes. Used as `document_version_hash`
 *  on the ack row so a future Replace can tell whether the ack still
 *  relates to the current file. Returns null when the download fails
 *  — we don't want a transient storage hiccup to block an
 *  acknowledgement, and a null hash on the row is the honest signal. */
async function computeDocumentVersionHash(
  admin: ReturnType<typeof getAdmin>,
  storagePath: string,
  ownerScope: "member" | "organisation",
): Promise<string | null> {
  try {
    // CLE-219 — bucket routes by scope. Member docs → member-documents,
    // org docs → org-documents.
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
// DTOs
// ---------------------------------------------------------------------------

// CLE-227 — `OutstandingAcknowledgement` moved to
// `./acknowledgement-actions-impl` so the mobile route wrapper can
// import it. Downstream consumers now import the type directly from
// the impl sibling — Turbopack's production build treats `export type`
// re-exports from a `"use server"` file as Server-Action forwarders
// and fails to resolve them (types have no runtime binding).
import type { OutstandingAcknowledgement } from "./acknowledgement-actions-impl";

export interface DocumentCoverageRow {
  memberId: string;
  memberName: string;
  teamName: string | null;
  acknowledgedAt: string | null;
}

export interface DocumentCoverage {
  documentId: string;
  fileName: string;
  subtypeName: string;
  ownerScope: "member" | "organisation";
  totalExpected: number;
  totalAcknowledged: number;
  outstanding: number;
  /** Non-acknowledged Members expected to ack, sorted alphabetic. */
  outstandingMembers: DocumentCoverageRow[];
  /** Acknowledged rows, sorted most-recent-first. */
  acknowledgedMembers: DocumentCoverageRow[];
}

// ---------------------------------------------------------------------------
// 1. acknowledgeDocument
// ---------------------------------------------------------------------------

/**
 * Records the caller's acknowledgement of a document.
 *
 * Preconditions checked by the app layer (RLS enforces the identity
 * invariant regardless):
 *   • Caller is authenticated + has a member row in the tenant.
 *   • Doc exists in the caller's tenant.
 *   • Doc's subtype has `requires_acknowledgement = true`.
 *   • Caller is expected to acknowledge this doc:
 *       - For member-scope docs: caller IS the doc's owner (no cross-
 *         Member ack, ever — see spec §Access & Security invariant #3).
 *       - For org-scope docs: caller has `can_view_organisation_documents`
 *         and lifecycle is live (implied by having any effective
 *         rights at all).
 *
 * Ack row is idempotent on `(document_id, member_id)`. A duplicate call
 * returns success with `alreadyAcknowledged: true`; no new row, no new
 * audit entry.
 */
export async function acknowledgeDocument(
  documentId: string,
): Promise<
  | { success: true; alreadyAcknowledged: boolean }
  | { success: false; error: string }
> {
  // CLE-227 — thin cookies-auth passthrough over `_acknowledgeDocument`.
  // Impl body lives in `./acknowledgement-actions-impl` and is shared
  // with the mobile API-route wrapper at
  // /api/mobile/documents/{id}/acknowledge.
  const caller = await buildDocumentsCallerFromCookies();
  if (!caller) return { success: false, error: "Not authenticated" };
  return _acknowledgeDocument(caller, documentId);
}

// ---------------------------------------------------------------------------
// 2. getMyOutstandingAcknowledgements
// ---------------------------------------------------------------------------

/**
 * Returns the caller's own outstanding-acknowledgement list. Two
 * sources unioned:
 *   • Member-scope docs where the caller is the owner AND subtype
 *     requires acknowledgement AND no non-superseded ack row exists.
 *   • Org-scope docs where subtype requires acknowledgement AND the
 *     caller has `can_view_organisation_documents` AND no non-
 *     superseded ack row exists for the caller.
 *
 * Sorted newest-first (by `created_at` desc) so the freshest
 * requirement sits at the top of the outstanding list.
 */
export async function getMyOutstandingAcknowledgements(): Promise<
  | { success: true; rows: OutstandingAcknowledgement[] }
  | { success: false; error: string }
> {
  // CLE-227 — thin cookies-auth passthrough over
  // `_getMyOutstandingAcknowledgements`. Impl body lives in
  // `./acknowledgement-actions-impl` and is shared with the mobile
  // API-route wrapper at /api/mobile/documents/outstanding-acks.
  const caller = await buildDocumentsCallerFromCookies();
  if (!caller) return { success: false, error: "Not authenticated" };
  return _getMyOutstandingAcknowledgements(caller);
}

/**
 * Outstanding acknowledgements for a TARGET member — powers the admin
 * view of a member's dashboard, so it shows the same "N to acknowledge"
 * chip the member sees on their own dashboard. Same access rule as the
 * member's Documents tab: own record, or Documents-tab view rights with
 * cross-user reach to the target (team scope = same team).
 */
export async function getOutstandingAcknowledgementsForMember(
  memberId: string,
): Promise<
  | { success: true; rows: OutstandingAcknowledgement[] }
  | { success: false; error: string }
> {
  try {
    const caller = await buildDocumentsCallerFromCookies();
    if (!caller) return { success: false, error: "Not authenticated" };
    const target = await loadOrgDocMember(caller.admin, caller.organisationId, memberId);
    if (!target) return { success: false, error: "Member not found" };
    if (target.id !== caller.memberId) {
      const view = caller.rights.tabs.documents?.view === true;
      const reach =
        caller.rights.crossUserAccess === "all" ||
        (caller.rights.crossUserAccess === "team" && target.teamId !== null && target.teamId === caller.teamId);
      if (!view || !reach) return { success: false, error: "Member not found" };
    }
    return _getOutstandingAcknowledgementsFor(caller.admin, caller.organisationId, target);
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "An error occurred" };
  }
}

/**
 * CLE-231 follow-up — org-wide "awaiting acknowledgement" summary for
 * the admin dashboard's Documents card. Counts outstanding acks across
 * every member the caller can reach (same scope rule as the member
 * Documents tab: Documents-tab view + cross_user_access team/all), using
 * the same per-member rule as the member dashboard chip. Self-scope
 * callers (or no Documents view) get their own record only.
 */
export interface OrgAckSummaryMember {
  memberId: string;
  name: string;
  outstanding: number;
  /** `/members/{id}/docs` tab holding their first outstanding ack —
   *  same routing as the member dashboard chip. */
  tab: "certifications" | "employment" | "other" | "org";
}

export async function getOrgOutstandingAcknowledgementSummary(): Promise<
  | { success: true; totalOutstanding: number; members: OrgAckSummaryMember[] }
  | { success: false; error: string }
> {
  try {
    const caller = await buildDocumentsCallerFromCookies();
    if (!caller) return { success: false, error: "Not authenticated" };
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

    const res = await _getOutstandingAcknowledgementsForMany(admin, organisationId, inScope);
    if (!res.success) return res;
    if (res.byMember.size === 0) return { success: true, totalOutstanding: 0, members: [] };

    const ids = Array.from(res.byMember.keys());
    const { data: names } = await admin
      .from("members")
      .select("id, first_name, last_name")
      .eq("organisation_id", organisationId)
      .in("id", ids);
    const nameOf = new Map(
      ((names ?? []) as { id: string; first_name: string | null; last_name: string | null }[]).map((r) => [
        r.id,
        `${r.first_name ?? ""} ${r.last_name ?? ""}`.trim() || "Unknown",
      ]),
    );

    const members: OrgAckSummaryMember[] = ids
      .map((id) => {
        const rows = res.byMember.get(id)!;
        const firstMember = rows.find((r) => r.ownerScope === "member");
        const tab: OrgAckSummaryMember["tab"] = !firstMember
          ? "org"
          : firstMember.subtypeType === "contract"
            ? "employment"
            : firstMember.subtypeType === "attachment"
              ? "other"
              : "certifications";
        return { memberId: id, name: nameOf.get(id) ?? "Unknown", outstanding: rows.length, tab };
      })
      .sort((a, b) => b.outstanding - a.outstanding || a.name.localeCompare(b.name));
    const totalOutstanding = members.reduce((n, m) => n + m.outstanding, 0);
    return { success: true, totalOutstanding, members };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "An error occurred" };
  }
}

// ---------------------------------------------------------------------------
// 3. getDocumentAcknowledgementStatus — Details dialog helper
// ---------------------------------------------------------------------------

/** Lightweight per-doc summary consumed by the Document Details
 *  dialog's Acknowledgement section. Returns whether the doc's subtype
 *  requires acknowledgement, whether the caller has already ack'd, and
 *  (for admins viewing an org doc) a compact coverage summary suitable
 *  for the read-only admin panel. Full drill-down uses
 *  `getDocumentCoverage` above. */
// CLE-227 — `DocumentAcknowledgementStatus` moved to
// `./acknowledgement-actions-impl`. Consumers import it directly from
// the impl sibling (see note on `OutstandingAcknowledgement` above).
import type { DocumentAcknowledgementStatus } from "./acknowledgement-actions-impl";

export async function getDocumentAcknowledgementStatus(
  documentId: string,
): Promise<
  | { success: true; status: DocumentAcknowledgementStatus }
  | { success: false; error: string }
> {
  // CLE-227 — thin cookies-auth passthrough over
  // `_getDocumentAcknowledgementStatus`. Impl body lives in
  // `./acknowledgement-actions-impl` and is shared with the mobile
  // API-route wrapper at /api/mobile/documents/{id}/ack-status.
  const caller = await buildDocumentsCallerFromCookies();
  if (!caller) return { success: false, error: "Not authenticated" };
  return _getDocumentAcknowledgementStatus(caller, documentId);
}

// ---------------------------------------------------------------------------
// 4. getDocumentCoverage
// ---------------------------------------------------------------------------

/**
 * Per-doc coverage view. Consumers:
 *   • Compliance dashboard "Acknowledgements" tab (Ticket D).
 *   • Details dialog admin panel (Ticket C).
 *
 * Denominator (M) is computed live from `members` + `rights_profiles`
 * — the spec §Coverage math. Numerator (N) is the ack rows on the doc
 * whose `superseded_by_replace_at IS NULL`.
 *
 * NOTE — Lifecycle status: the [[Member Lifecycle & Off-Boarding]]
 * capability adds a `lifecycle_status` column to `members` and shifts
 * "expected to acknowledge" to Live-only. That capability hasn't
 * shipped yet, so this action treats every non-null user_id member as
 * Live. When Lifecycle ships, add `AND lifecycle_status = 'live'` to
 * the denominator query below.
 */
export async function getDocumentCoverage(
  documentId: string,
): Promise<
  | { success: true; coverage: DocumentCoverage }
  | { success: false; error: string }
> {
  try {
    const caller = await resolveCaller();
    if (!caller) return { success: false, error: "Not authenticated" };
    const admin = getAdmin();

    // Doc + subtype.
    type DocRow = AudienceDbRow & {
      id: string;
      organisation_id: string;
      owner_scope: "member" | "organisation";
      owner_id: string | null;
      file_name: string;
      subtype_id: string;
      document_subtype:
        | { name?: string; requires_acknowledgement?: boolean; visible_to_member?: boolean }
        | { name?: string; requires_acknowledgement?: boolean; visible_to_member?: boolean }[]
        | null;
    };
    const docQuery = await admin
      .from("document")
      .select(
        "id, organisation_id, owner_scope, owner_id, file_name, subtype_id, " +
        AUDIENCE_COLUMNS + ", " +
        "document_subtype!subtype_id(name, requires_acknowledgement, visible_to_member)",
      )
      .eq("id", documentId)
      .single();
    const doc = docQuery.data as unknown as DocRow | null;
    if (!doc || doc.organisation_id !== caller.organisationId) {
      return { success: false, error: "Document not found" };
    }
    const subtype = doc.document_subtype;
    const subtypeRow = Array.isArray(subtype) ? subtype[0] : subtype;
    if (!subtypeRow?.requires_acknowledgement) {
      return { success: false, error: "This document does not require acknowledgement." };
    }
    const ownerScope = doc.owner_scope;

    // Denominator: expected-to-ack member set.
    let expectedIds: string[] = [];
    if (ownerScope === "member") {
      // Same rule as the outstanding-ack core (dashboard + emails): the
      // owner is expected only when invited and the doc isn't HR-only.
      expectedIds =
        doc.owner_id &&
        !subtypeHiddenFromMember(doc.document_subtype) &&
        (await loadMemberInvited(admin, caller.organisationId, doc.owner_id))
          ? [doc.owner_id as string]
          : [];
    } else {
      // CLE-230 — signed-in members in the doc's audience.
      expectedIds = expectedAcknowledgerIds(
        audienceFromRow(doc),
        await loadOrgDocMembers(admin, caller.organisationId),
      );
    }

    // Numerator: the ack rows.
    const { data: acks } = await admin
      .from("document_acknowledgement")
      .select("member_id, acknowledged_at")
      .eq("document_id", documentId)
      .is("superseded_by_replace_at", null);
    const ackedMap = new Map<string, string>();
    for (const r of ((acks ?? []) as { member_id: string; acknowledged_at: string }[])) {
      ackedMap.set(r.member_id, r.acknowledged_at);
    }

    // Names + team labels for the drill-down. One query for the
    // union of expected + acked (the latter can include members no
    // longer in `expectedIds`, e.g. rights profile changed since).
    const namesNeeded = Array.from(new Set([...expectedIds, ...ackedMap.keys()]));
    const nameById = new Map<string, { name: string; teamName: string | null }>();
    if (namesNeeded.length > 0) {
      const { data: rows } = await admin
        .from("members")
        .select("id, first_name, last_name, teams(name)")
        .in("id", namesNeeded);
      for (const r of ((rows ?? []) as Array<{ id: string; first_name: string; last_name: string; teams: { name?: string } | { name?: string }[] | null }>)) {
        const teamRel = Array.isArray(r.teams) ? r.teams[0] : r.teams;
        nameById.set(r.id, {
          name: `${r.first_name ?? ""} ${r.last_name ?? ""}`.trim() || "—",
          teamName: teamRel?.name ?? null,
        });
      }
    }

    const outstandingMembers: DocumentCoverageRow[] = expectedIds
      .filter((id) => !ackedMap.has(id))
      .map((id) => ({
        memberId: id,
        memberName: nameById.get(id)?.name ?? "—",
        teamName: nameById.get(id)?.teamName ?? null,
        acknowledgedAt: null,
      }))
      .sort((a, b) => a.memberName.localeCompare(b.memberName));

    const acknowledgedMembers: DocumentCoverageRow[] = Array.from(ackedMap.entries())
      .map(([id, at]) => ({
        memberId: id,
        memberName: nameById.get(id)?.name ?? "—",
        teamName: nameById.get(id)?.teamName ?? null,
        acknowledgedAt: at,
      }))
      .sort((a, b) => (b.acknowledgedAt ?? "").localeCompare(a.acknowledgedAt ?? ""));

    const totalExpected = expectedIds.length;
    const totalAcknowledged = expectedIds.filter((id) => ackedMap.has(id)).length;

    return {
      success: true,
      coverage: {
        documentId,
        fileName: doc.file_name as string,
        subtypeName: subtypeRow.name ?? "—",
        ownerScope,
        totalExpected,
        totalAcknowledged,
        outstanding: totalExpected - totalAcknowledged,
        outstandingMembers,
        acknowledgedMembers,
      },
    };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "An error occurred" };
  }
}

// ---------------------------------------------------------------------------
// 5. getOrgAcknowledgementCoverage — Compliance dashboard Acknowledgements tab
// ---------------------------------------------------------------------------

/**
 * Per-doc coverage rows for every ack-required document in the
 * caller's tenant. One row per doc (never per Member). Drives Ticket D
 * — the Compliance dashboard's "Acknowledgements" tab.
 *
 * The compute is org-wide even for a team-scope caller: the dashboard
 * itself is gated on `rights.tabs.documents.view`, and any caller who
 * lands here is expected to see the full org coverage. If we later
 * decide team-scope callers should only see their own team's docs,
 * gate here.
 *
 * NOTE — Lifecycle status: the [[Member Lifecycle & Off-Boarding]]
 * capability adds `lifecycle_status` to `members`; when it ships, add
 * `AND lifecycle_status = 'live'` to the denominator query below. See
 * the twin comment on `getDocumentCoverage`.
 */
export interface AcknowledgementCoverageRow {
  documentId: string;
  fileName: string;
  subtypeId: string;
  subtypeName: string;
  subtypeType: string;
  ownerScope: "member" | "organisation";
  ownerMemberId: string | null;
  ownerMemberName: string | null;
  uploadedAt: string;
  totalExpected: number;
  totalAcknowledged: number;
  outstanding: number;
  /** Set to a timestamp when a "Remind outstanding" bulk email was
   *  last fired from the compliance tab. Consumed by the throttle
   *  check on the client + server. Nullable — never reminded. */
  lastRemindedAt: string | null;
}

export async function getOrgAcknowledgementCoverage(): Promise<
  | { success: true; rows: AcknowledgementCoverageRow[] }
  | { success: false; error: string }
> {
  try {
    const caller = await resolveCaller();
    if (!caller) return { success: false, error: "Not authenticated" };
    const admin = getAdmin();

    // Every doc in the tenant whose subtype requires acknowledgement.
    type DocRow = AudienceDbRow & {
      id: string;
      file_name: string;
      subtype_id: string;
      owner_scope: "member" | "organisation";
      owner_id: string | null;
      uploaded_at: string;
      reminders_last_sent_at: string | null;
      disposal_date: string | null;
      document_subtype:
        | { name?: string; type?: string; requires_acknowledgement?: boolean; visible_to_member?: boolean }
        | Array<{ name?: string; type?: string; requires_acknowledgement?: boolean; visible_to_member?: boolean }>
        | null;
    };
    const docsQuery = await admin
      .from("document")
      .select(
        "id, file_name, subtype_id, owner_scope, owner_id, uploaded_at, reminders_last_sent_at, disposal_date, " +
        AUDIENCE_COLUMNS + ", " +
        "document_subtype!subtype_id(name, type, requires_acknowledgement, visible_to_member)",
      )
      .eq("organisation_id", caller.organisationId)
      .is("archived_at", null) // CLE-233
      .order("uploaded_at", { ascending: false });
    const docs = (docsQuery.data ?? []) as unknown as DocRow[];

    // Exclude soft-deleted / queued for disposal.
    const { data: queuedRows } = await admin
      .from("disposal_queue")
      .select("document_id")
      .eq("organisation_id", caller.organisationId);
    const queued = new Set<string>(((queuedRows ?? []) as { document_id: string }[]).map((r) => r.document_id));
    const today = new Date().toISOString().slice(0, 10);

    const relevant = docs.filter((d) => {
      const st = Array.isArray(d.document_subtype) ? d.document_subtype[0] : d.document_subtype;
      if (!st?.requires_acknowledgement) return false;
      if (queued.has(d.id)) return false;
      if (d.disposal_date !== null && d.disposal_date <= today) return false;
      return true;
    });
    if (relevant.length === 0) return { success: true, rows: [] };

    // CLE-230 — org-scope denominator is per-doc: signed-in members in
    // that doc's audience. Load the org's members once, evaluate per doc.
    //
    // NOTE — see the twin comment on `getDocumentCoverage`: when the
    // Member Lifecycle capability ships, exclude non-live members.
    // Also used for member-scope docs: the owner only counts when invited.
    const orgMembers: OrgDocMember[] = await loadOrgDocMembers(admin, caller.organisationId);
    const invitedIds = new Set(orgMembers.filter((m) => m.invited).map((m) => m.id));

    // 2026-10-26 — expected set per doc, same rule as the outstanding-ack
    // core behind the admin dashboard and emails: org docs → audience;
    // member docs → the owner, only when invited and not HR-only.
    const expectedByDoc = new Map<string, string[]>();
    for (const d of relevant) {
      expectedByDoc.set(
        d.id,
        d.owner_scope === "member"
          ? d.owner_id && invitedIds.has(d.owner_id) && !subtypeHiddenFromMember(d.document_subtype)
            ? [d.owner_id]
            : []
          : expectedAcknowledgerIds(audienceFromRow(d), orgMembers),
      );
    }

    // Batch-load ack rows for every relevant doc. One query, group in
    // memory so we don't hit N.
    const docIds = relevant.map((d) => d.id);
    const { data: acks } = await admin
      .from("document_acknowledgement")
      .select("document_id, member_id")
      .in("document_id", docIds)
      .is("superseded_by_replace_at", null);
    const ackedByDoc = new Map<string, Set<string>>();
    for (const r of ((acks ?? []) as { document_id: string; member_id: string }[])) {
      const set = ackedByDoc.get(r.document_id) ?? new Set<string>();
      set.add(r.member_id);
      ackedByDoc.set(r.document_id, set);
    }

    // Owner-name hydration for member-scope docs.
    const ownerIds = Array.from(
      new Set(
        relevant
          .filter((d) => d.owner_scope === "member" && d.owner_id)
          .map((d) => d.owner_id as string),
      ),
    );
    const nameByOwner = new Map<string, string>();
    if (ownerIds.length > 0) {
      const { data: memRows } = await admin
        .from("members")
        .select("id, first_name, last_name")
        .in("id", ownerIds);
      for (const r of ((memRows ?? []) as Array<{ id: string; first_name: string | null; last_name: string | null }>)) {
        const full = `${r.first_name ?? ""} ${r.last_name ?? ""}`.trim();
        nameByOwner.set(r.id, full || "—");
      }
    }

    // A member doc nobody is expected to acknowledge (owner not invited,
    // or HR-only) isn't listed.
    const listed = relevant.filter((d) => d.owner_scope !== "member" || (expectedByDoc.get(d.id) ?? []).length > 0);
    const rows: AcknowledgementCoverageRow[] = listed.map((d) => {
      const st = Array.isArray(d.document_subtype) ? d.document_subtype[0] : d.document_subtype;
      const expected = expectedByDoc.get(d.id) ?? [];
      const acked = ackedByDoc.get(d.id) ?? new Set<string>();
      const totalExpected = expected.length;
      const totalAcknowledged = expected.filter((id) => acked.has(id)).length;
      return {
        documentId: d.id,
        fileName: d.file_name,
        subtypeId: d.subtype_id,
        subtypeName: st?.name ?? "—",
        subtypeType: st?.type ?? "attachment",
        ownerScope: d.owner_scope,
        ownerMemberId: d.owner_scope === "member" ? d.owner_id : null,
        ownerMemberName: d.owner_scope === "member" && d.owner_id ? (nameByOwner.get(d.owner_id) ?? null) : null,
        uploadedAt: d.uploaded_at,
        totalExpected,
        totalAcknowledged: Math.min(totalAcknowledged, totalExpected),
        outstanding: Math.max(0, totalExpected - totalAcknowledged),
        lastRemindedAt: d.reminders_last_sent_at,
      };
    });

    return { success: true, rows };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "An error occurred" };
  }
}

// ---------------------------------------------------------------------------
// 6. remindOutstanding — bulk "Remind outstanding" per doc
// ---------------------------------------------------------------------------

const REMIND_THROTTLE_MS = 24 * 60 * 60 * 1000; // 24 hours per doc

/**
 * Fires a reminder email to every Member on the doc's outstanding
 * list. Rate-limited to once per doc per 24 hours (per spec §7 +
 * §7b.10). Returns the count of emails dispatched.
 *
 * Access — reminding is an admin action. Gated on the caller having
 * `documents` tab update rights (proxy for "can manage documents in
 * this tenant"). The self-only ack invariant is unaffected: this
 * action pushes reminders, it doesn't insert ack rows on behalf of
 * others.
 */
export async function remindOutstanding(
  documentId: string,
): Promise<
  | { success: true; sentCount: number }
  | { success: false; error: string; retryAfterSeconds?: number }
> {
  try {
    const caller = await resolveCaller();
    if (!caller) return { success: false, error: "Not authenticated" };
    const admin = getAdmin();

    // Re-resolve the caller's full rights so we can gate on
    // `tabs.documents.update`. resolveCaller() only carried the
    // canViewOrgDocs bit; a second read here is cheaper than
    // widening the shared cache.
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: "Not authenticated" };
    const resolved = await getEffectiveRightsForUser(user.id);
    const canUpdateDocs = resolved?.rights.tabs.documents?.update === true;
    if (!canUpdateDocs) {
      return { success: false, error: "Only admins with document write access can send reminders." };
    }

    // Fetch doc + subtype + last-reminded timestamp.
    type DocRow = AudienceDbRow & {
      id: string;
      organisation_id: string;
      file_name: string;
      file_size: number;
      owner_scope: "member" | "organisation";
      owner_id: string | null;
      reminders_last_sent_at: string | null;
      document_subtype:
        | { name?: string; requires_acknowledgement?: boolean; visible_to_member?: boolean }
        | Array<{ name?: string; requires_acknowledgement?: boolean; visible_to_member?: boolean }>
        | null;
    };
    const docQuery = await admin
      .from("document")
      .select(
        "id, organisation_id, file_name, file_size, owner_scope, owner_id, reminders_last_sent_at, " +
        AUDIENCE_COLUMNS + ", " +
        "document_subtype!subtype_id(name, requires_acknowledgement, visible_to_member)",
      )
      .eq("id", documentId)
      .single();
    const doc = docQuery.data as unknown as DocRow | null;
    if (!doc || doc.organisation_id !== caller.organisationId) {
      return { success: false, error: "Document not found" };
    }
    const subtype = doc.document_subtype;
    const subtypeRow = Array.isArray(subtype) ? subtype[0] : subtype;
    if (!subtypeRow?.requires_acknowledgement) {
      return { success: false, error: "This document does not require acknowledgement." };
    }
    // CLE-233 — archived documents ask nobody to acknowledge.
    if (await isDocumentArchived(admin, documentId)) {
      return { success: false, error: "This document has been archived." };
    }

    // 24-hour throttle.
    if (doc.reminders_last_sent_at) {
      const last = new Date(doc.reminders_last_sent_at).getTime();
      const now = Date.now();
      const elapsed = now - last;
      if (elapsed < REMIND_THROTTLE_MS) {
        return {
          success: false,
          error: "Reminded within last 24h",
          retryAfterSeconds: Math.ceil((REMIND_THROTTLE_MS - elapsed) / 1000),
        };
      }
    }

    // Compute the outstanding-Members list. Same math as
    // getDocumentCoverage but we only need ids + email; no need to
    // hydrate teams here.
    let expectedIds: string[] = [];
    if (doc.owner_scope === "member") {
      // Same rule as the dashboard: owner only when invited, never HR-only.
      expectedIds =
        doc.owner_id &&
        !subtypeHiddenFromMember(doc.document_subtype) &&
        (await loadMemberInvited(admin, caller.organisationId, doc.owner_id))
          ? [doc.owner_id]
          : [];
    } else {
      // CLE-230 — only remind members in the doc's audience.
      expectedIds = expectedAcknowledgerIds(
        audienceFromRow(doc),
        await loadOrgDocMembers(admin, caller.organisationId),
      );
    }
    if (expectedIds.length === 0) {
      // No one expected — nothing to do, but still stamp so we don't
      // let a caller re-invoke to force an audit-log spam.
      await admin
        .from("document")
        .update({ reminders_last_sent_at: new Date().toISOString() })
        .eq("id", documentId);
      return { success: true, sentCount: 0 };
    }

    // Subtract already-acked.
    const { data: acks } = await admin
      .from("document_acknowledgement")
      .select("member_id")
      .eq("document_id", documentId)
      .is("superseded_by_replace_at", null);
    const ackedSet = new Set(((acks ?? []) as { member_id: string }[]).map((r) => r.member_id));
    const outstandingIds = expectedIds.filter((id) => !ackedSet.has(id));

    // Load emails + org name for the outstanding set.
    let sentCount = 0;
    if (outstandingIds.length > 0) {
      const { data: memRows } = await admin
        .from("members")
        .select("id, email, first_name, organisations(name)")
        .in("id", outstandingIds);
      const rows = (memRows ?? []) as unknown as Array<{
        id: string;
        email: string | null;
        first_name: string | null;
        organisations: { name?: string } | { name?: string }[] | null;
      }>;

      const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://app.clear-hr.com";

      for (const r of rows) {
        if (!r.email) continue;
        const orgRel = Array.isArray(r.organisations) ? r.organisations[0] : r.organisations;
        // One failed send doesn't block the rest; the throttle is
        // stamped either way. CLE-235 — shared template in email.ts.
        await sendAckReminderEmail({
          to: r.email,
          firstName: r.first_name ?? "there",
          orgName: orgRel?.name ?? "your organisation",
          subtypeName: subtypeRow.name ?? "document",
          fileName: doc.file_name,
          baseUrl,
        });
        sentCount += 1;
      }
    }

    // Stamp the throttle timestamp.
    await admin
      .from("document")
      .update({ reminders_last_sent_at: new Date().toISOString() })
      .eq("id", documentId);

    // Audit.
    await logAudit({
      organisationId: caller.organisationId,
      actorId: caller.memberId,
      actorName: await callerName(admin, caller.memberId),
      action: "document.remind_sent",
      targetType: "document",
      targetId: documentId,
      targetLabel: doc.file_name,
      metadata: {
        sent_count: sentCount,
        subtype_name: subtypeRow.name ?? null,
        // CLE-219 — file_name + file_size on every doc audit.
        file_name: doc.file_name,
        file_size: doc.file_size,
      },
    });

    revalidatePath("/documents/compliance");

    return { success: true, sentCount };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "An error occurred" };
  }
}
