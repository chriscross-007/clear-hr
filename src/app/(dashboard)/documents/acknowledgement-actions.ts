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
import { Resend } from "resend";
import { getEffectiveRightsForUser } from "@/lib/rights-resolver";
import { logAudit } from "@/lib/audit";

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

export interface OutstandingAcknowledgement {
  documentId: string;
  fileName: string;
  subtypeId: string;
  subtypeName: string;
  subtypeType: string;
  ownerScope: "member" | "organisation";
  /** When the doc landed — used to sort newest-first and to render a
   *  "published" or "uploaded on" line in the outstanding list. */
  createdAt: string;
}

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
  try {
    const caller = await resolveCaller();
    if (!caller) return { success: false, error: "Not authenticated" };
    const admin = getAdmin();

    // Fetch the doc + subtype in a single join. Result is cast
    // explicitly — Supabase's TS inference degrades to
    // `GenericStringError` on some FK-join SELECT shapes, and the
    // rest of the codebase's convention is to declare the local shape
    // at the boundary rather than rely on inference.
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
    if (!doc || doc.organisation_id !== caller.organisationId) {
      return { success: false, error: "Document not found" };
    }
    const subtype = doc.document_subtype;
    const subtypeRow = Array.isArray(subtype) ? subtype[0] : subtype;
    if (!subtypeRow?.requires_acknowledgement) {
      return { success: false, error: "This document does not require acknowledgement." };
    }

    // Expectation check.
    const ownerScope = doc.owner_scope as "member" | "organisation";
    if (ownerScope === "member") {
      if (doc.owner_id !== caller.memberId) {
        return {
          success: false,
          error: "Only this document's owner can acknowledge it.",
        };
      }
    } else if (ownerScope === "organisation") {
      if (!caller.canViewOrgDocs) {
        return {
          success: false,
          error: "You don't have access to acknowledge organisation documents.",
        };
      }
    }

    // Idempotency check — was already there?
    const { data: existing } = await admin
      .from("document_acknowledgement")
      .select("id")
      .eq("document_id", documentId)
      .eq("member_id", caller.memberId)
      .maybeSingle();
    if (existing) return { success: true, alreadyAcknowledged: true };

    // Compute the version hash. Non-fatal on failure — null is
    // deliberately in the schema for exactly this case.
    const hash = await computeDocumentVersionHash(admin, doc.storage_path as string, ownerScope);
    const ip = await readClientIp();
    const userAgent = await readUserAgent();

    const { error: insertError } = await admin
      .from("document_acknowledgement")
      .insert({
        organisation_id: caller.organisationId,
        document_id: documentId,
        member_id: caller.memberId,
        acknowledged_at: new Date().toISOString(),
        ip,
        user_agent: userAgent,
        document_version_hash: hash,
        document_file_name: doc.file_name as string,
        document_subtype_name: subtypeRow.name ?? "—",
      });
    if (insertError) return { success: false, error: insertError.message };

    await logAudit({
      organisationId: caller.organisationId,
      actorId: caller.memberId,
      actorName: await callerName(admin, caller.memberId),
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
        // CLE-219 — file_name + file_size on every doc audit.
        file_name: doc.file_name,
        file_size: doc.file_size,
      },
    });

    // Refresh the surfaces that render outstanding-ack counts.
    revalidatePath("/dashboard");
    revalidatePath("/my-documents");
    revalidatePath("/documents/compliance");

    return { success: true, alreadyAcknowledged: false };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "An error occurred" };
  }
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
  try {
    const caller = await resolveCaller();
    if (!caller) return { success: false, error: "Not authenticated" };
    const admin = getAdmin();

    // Every ack-required doc in scope for this caller. Excludes
    // soft-deleted (via disposal_queue) as the compliance dashboard
    // does — but Ticket B doesn't need to walk that yet since the ack
    // list is a separate concern. The `document` RLS + our app filter
    // handle scope.
    // The `document` table's timestamp column is `uploaded_at` (not
    // `created_at`). Same shape as the reads in
    // `members/[memberId]/docs/document-actions.ts`.
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
      .eq("organisation_id", caller.organisationId)
      .order("uploaded_at", { ascending: false });
    const rows = (docsQuery.data ?? []) as unknown as DocJoin[];

    // CLE-224 — Org-scope docs hidden from the caller are not part
    // of "expected to acknowledge". Load once, subtract below.
    const { data: hiddenRows } = await admin
      .from("member_org_document_hidden")
      .select("document_id")
      .eq("member_id", caller.memberId);
    const hiddenFromCaller = new Set<string>(
      ((hiddenRows ?? []) as { document_id: string }[]).map((r) => r.document_id),
    );

    // Filter to ack-required docs the caller is expected to ack.
    const relevant = rows.filter((d) => {
      const st = Array.isArray(d.document_subtype) ? d.document_subtype[0] : d.document_subtype;
      if (!st?.requires_acknowledgement) return false;
      if (d.owner_scope === "member") return d.owner_id === caller.memberId;
      if (d.owner_scope === "organisation") {
        if (!caller.canViewOrgDocs) return false;
        // CLE-224 — hidden org docs drop out of the caller's list.
        if (hiddenFromCaller.has(d.id)) return false;
        return true;
      }
      return false;
    });
    if (relevant.length === 0) return { success: true, rows: [] };

    // Which of those has the caller already acked?
    const docIds = relevant.map((d) => d.id);
    const { data: acked } = await admin
      .from("document_acknowledgement")
      .select("document_id")
      .eq("member_id", caller.memberId)
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
// 3. getDocumentAcknowledgementStatus — Details dialog helper
// ---------------------------------------------------------------------------

/** Lightweight per-doc summary consumed by the Document Details
 *  dialog's Acknowledgement section. Returns whether the doc's subtype
 *  requires acknowledgement, whether the caller has already ack'd, and
 *  (for admins viewing an org doc) a compact coverage summary suitable
 *  for the read-only admin panel. Full drill-down uses
 *  `getDocumentCoverage` above. */
export interface DocumentAcknowledgementStatus {
  requiresAcknowledgement: boolean;
  /** True when the caller is one of the Members expected to ack this
   *  doc (owner for member-scope; view-rights holder for org-scope). */
  isCallerExpectedToAcknowledge: boolean;
  /** The caller's own ack row, if they've acknowledged. */
  callerAcknowledgement: {
    acknowledgedAt: string;
    ip: string | null;
  } | null;
  /** Populated only for org-scope docs and only for callers with
   *  `can_view_organisation_documents`. Member-scope docs and non-
   *  privileged callers get null here — the caller's own ack state
   *  is enough for them. */
  coverageSummary: {
    totalExpected: number;
    totalAcknowledged: number;
    outstanding: number;
  } | null;
}

export async function getDocumentAcknowledgementStatus(
  documentId: string,
): Promise<
  | { success: true; status: DocumentAcknowledgementStatus }
  | { success: false; error: string }
> {
  try {
    const caller = await resolveCaller();
    if (!caller) return { success: false, error: "Not authenticated" };
    const admin = getAdmin();

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
    if (!doc || doc.organisation_id !== caller.organisationId) {
      return { success: false, error: "Document not found" };
    }
    const subtype = doc.document_subtype;
    const subtypeRow = Array.isArray(subtype) ? subtype[0] : subtype;
    const requiresAcknowledgement = subtypeRow?.requires_acknowledgement === true;

    // Short-circuit: no section renders if subtype doesn't require ack.
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
        ? doc.owner_id === caller.memberId
        : caller.canViewOrgDocs;

    // Caller's own ack row.
    const { data: ownAck } = await admin
      .from("document_acknowledgement")
      .select("acknowledged_at, ip")
      .eq("document_id", documentId)
      .eq("member_id", caller.memberId)
      .is("superseded_by_replace_at", null)
      .maybeSingle();
    const callerAcknowledgement = ownAck
      ? { acknowledgedAt: (ownAck as { acknowledged_at: string }).acknowledged_at, ip: (ownAck as { ip: string | null }).ip ?? null }
      : null;

    // Coverage summary for admin org-doc view. Skipped for member
    // docs (where the coverage is trivially 0/1 or 1/1) and for
    // callers without org-doc view rights.
    let coverageSummary: DocumentAcknowledgementStatus["coverageSummary"] = null;
    if (ownerScope === "organisation" && caller.canViewOrgDocs) {
      const { data: members } = await admin
        .from("members")
        .select("id, rights_profiles(can_view_organisation_documents)")
        .eq("organisation_id", caller.organisationId)
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
      // CLE-224 — mirrors `getDocumentCoverage`: hidden members drop
      // out of the denominator.
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
    type DocRow = {
      id: string;
      organisation_id: string;
      owner_scope: "member" | "organisation";
      owner_id: string | null;
      file_name: string;
      subtype_id: string;
      document_subtype:
        | { name?: string; requires_acknowledgement?: boolean }
        | { name?: string; requires_acknowledgement?: boolean }[]
        | null;
    };
    const docQuery = await admin
      .from("document")
      .select(
        "id, organisation_id, owner_scope, owner_id, file_name, subtype_id, " +
        "document_subtype!subtype_id(name, requires_acknowledgement)",
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
      expectedIds = doc.owner_id ? [doc.owner_id as string] : [];
    } else {
      // Org-scope: every member in the org whose rights_profile grants
      // can_view_organisation_documents. See §Lifecycle note above.
      const { data: members } = await admin
        .from("members")
        .select("id, rights_profile_id, rights_profiles(can_view_organisation_documents)")
        .eq("organisation_id", caller.organisationId)
        .not("user_id", "is", null);
      expectedIds = ((members ?? []) as Array<{
        id: string;
        rights_profiles: { can_view_organisation_documents?: boolean } | { can_view_organisation_documents?: boolean }[] | null;
      }>)
        .filter((m) => {
          const rp = Array.isArray(m.rights_profiles) ? m.rights_profiles[0] : m.rights_profiles;
          return rp?.can_view_organisation_documents === true;
        })
        .map((m) => m.id);

      // CLE-224 — Subtract members explicitly hidden from THIS doc.
      // Hidden pairs drop out of both the denominator and the
      // outstanding list — they're not expected to ack.
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
    type DocRow = {
      id: string;
      file_name: string;
      subtype_id: string;
      owner_scope: "member" | "organisation";
      owner_id: string | null;
      uploaded_at: string;
      reminders_last_sent_at: string | null;
      disposal_date: string | null;
      document_subtype:
        | { name?: string; type?: string; requires_acknowledgement?: boolean }
        | Array<{ name?: string; type?: string; requires_acknowledgement?: boolean }>
        | null;
    };
    const docsQuery = await admin
      .from("document")
      .select(
        "id, file_name, subtype_id, owner_scope, owner_id, uploaded_at, reminders_last_sent_at, disposal_date, " +
        "document_subtype!subtype_id(name, type, requires_acknowledgement)",
      )
      .eq("organisation_id", caller.organisationId)
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

    // Denominator for org-scope docs: base = Live members whose
    // rights profile grants `can_view_organisation_documents`.
    //
    // CLE-224 — the denominator is no longer sharable across docs.
    // Each doc has its own per-member "hidden" set, so the base
    // eligible set must be trimmed per-doc. We batch the hidden-rows
    // read once and group by document_id in memory to keep this O(1)
    // in query count regardless of doc-count.
    //
    // NOTE — see the twin comment on `getDocumentCoverage`: when the
    // Member Lifecycle capability ships, add `AND lifecycle_status =
    // 'live'` to the denominator query below.
    let baseOrgEligibleIds: string[] = [];
    const hiddenByDoc = new Map<string, Set<string>>();
    const anyOrgScope = relevant.some((d) => d.owner_scope === "organisation");
    if (anyOrgScope) {
      const { data: members } = await admin
        .from("members")
        .select("id, rights_profiles(can_view_organisation_documents)")
        .eq("organisation_id", caller.organisationId)
        .not("user_id", "is", null);
      baseOrgEligibleIds = ((members ?? []) as Array<{
        id: string;
        rights_profiles: { can_view_organisation_documents?: boolean } | { can_view_organisation_documents?: boolean }[] | null;
      }>)
        .filter((m) => {
          const rp = Array.isArray(m.rights_profiles) ? m.rights_profiles[0] : m.rights_profiles;
          return rp?.can_view_organisation_documents === true;
        })
        .map((m) => m.id);

      // CLE-224 — Load every per-member hide row for the org-scope
      // docs in this batch, group by document_id. One round-trip.
      const orgDocIds = relevant.filter((d) => d.owner_scope === "organisation").map((d) => d.id);
      if (orgDocIds.length > 0) {
        const { data: hides } = await admin
          .from("member_org_document_hidden")
          .select("document_id, member_id")
          .in("document_id", orgDocIds);
        for (const h of ((hides ?? []) as { document_id: string; member_id: string }[])) {
          let set = hiddenByDoc.get(h.document_id);
          if (!set) {
            set = new Set<string>();
            hiddenByDoc.set(h.document_id, set);
          }
          set.add(h.member_id);
        }
      }
    }

    // Batch-load ack rows for every relevant doc. One query, group in
    // memory so we don't hit N.
    const docIds = relevant.map((d) => d.id);
    const { data: acks } = await admin
      .from("document_acknowledgement")
      .select("document_id")
      .in("document_id", docIds)
      .is("superseded_by_replace_at", null);
    const ackedByDoc = new Map<string, number>();
    for (const r of ((acks ?? []) as { document_id: string }[])) {
      ackedByDoc.set(r.document_id, (ackedByDoc.get(r.document_id) ?? 0) + 1);
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

    const rows: AcknowledgementCoverageRow[] = relevant.map((d) => {
      const st = Array.isArray(d.document_subtype) ? d.document_subtype[0] : d.document_subtype;
      // CLE-224 — per-doc denominator: base eligible set minus this
      // doc's hidden set. Member-scope docs are unaffected (always 1).
      let totalExpected: number;
      if (d.owner_scope === "member") {
        totalExpected = d.owner_id ? 1 : 0;
      } else {
        const hides = hiddenByDoc.get(d.id);
        if (!hides || hides.size === 0) {
          totalExpected = baseOrgEligibleIds.length;
        } else {
          totalExpected = baseOrgEligibleIds.filter((id) => !hides.has(id)).length;
        }
      }
      const totalAcknowledged = ackedByDoc.get(d.id) ?? 0;
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
    type DocRow = {
      id: string;
      organisation_id: string;
      file_name: string;
      file_size: number;
      owner_scope: "member" | "organisation";
      owner_id: string | null;
      reminders_last_sent_at: string | null;
      document_subtype:
        | { name?: string; requires_acknowledgement?: boolean }
        | Array<{ name?: string; requires_acknowledgement?: boolean }>
        | null;
    };
    const docQuery = await admin
      .from("document")
      .select(
        "id, organisation_id, file_name, file_size, owner_scope, owner_id, reminders_last_sent_at, " +
        "document_subtype!subtype_id(name, requires_acknowledgement)",
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
      expectedIds = doc.owner_id ? [doc.owner_id] : [];
    } else {
      const { data: members } = await admin
        .from("members")
        .select("id, rights_profiles(can_view_organisation_documents)")
        .eq("organisation_id", caller.organisationId)
        .not("user_id", "is", null);
      expectedIds = ((members ?? []) as Array<{
        id: string;
        rights_profiles: { can_view_organisation_documents?: boolean } | { can_view_organisation_documents?: boolean }[] | null;
      }>)
        .filter((m) => {
          const rp = Array.isArray(m.rights_profiles) ? m.rights_profiles[0] : m.rights_profiles;
          return rp?.can_view_organisation_documents === true;
        })
        .map((m) => m.id);
      // CLE-224 — Never remind a member about a doc they've been
      // hidden from — the pair isn't expected to ack.
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

      const apiKey = process.env.RESEND_API_KEY;
      const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://app.clear-hr.com";
      const resend = apiKey ? new Resend(apiKey) : null;

      for (const r of rows) {
        if (!r.email) continue;
        const orgRel = Array.isArray(r.organisations) ? r.organisations[0] : r.organisations;
        const orgName = orgRel?.name ?? "your organisation";
        const first = r.first_name ?? "there";
        const subtypeName = subtypeRow.name ?? "document";

        // Fire-and-forget per Member. Failure of one email doesn't
        // block the rest — we still stamp the throttle either way,
        // per the "throttle behaves correctly even before email is
        // fully wired" guidance in Ticket D.
        if (resend) {
          try {
            await resend.emails.send({
              from: "ClearHR <noreply@contacts.clear-hr.com>",
              to: r.email,
              subject: `Reminder: acknowledge ${subtypeName}`,
              html: `
                <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto;padding:24px">
                  <div style="margin-bottom:24px"><strong style="font-size:18px;color:#18181b">ClearHR</strong></div>
                  <h2 style="margin:0 0 16px;color:#18181b">Reminder: document to acknowledge</h2>
                  <p>Hi ${first},</p>
                  <p>You have an outstanding <strong>${subtypeName}</strong> that needs your acknowledgement.</p>
                  <p><a href="${baseUrl}/login?next=${encodeURIComponent("/my-documents")}" style="display:inline-block;padding:12px 24px;background:#18181b;color:#fff;text-decoration:none;border-radius:6px">Review &amp; acknowledge</a></p>
                  <div style="margin-top:32px;padding-top:16px;border-top:1px solid #e5e7eb;color:#9ca3af;font-size:12px">You are receiving this because you are a member of ${orgName} on ClearHR.</div>
                </div>
              `,
            });
          } catch (e) {
            console.error("[remindOutstanding] send failed for", r.email, e);
          }
        } else {
          // TODO: wire Resend template — RESEND_API_KEY not set in
          // this environment. Stamp the throttle anyway so behaviour
          // is deterministic.
          console.warn("[remindOutstanding] RESEND_API_KEY not set — email skipped");
        }
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
