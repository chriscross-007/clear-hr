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
): Promise<string | null> {
  try {
    const { data, error } = await admin.storage.from(STORAGE_BUCKET).download(storagePath);
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

    // Fetch the doc + subtype in a single join.
    const { data: doc } = await admin
      .from("document")
      .select(
        "id, organisation_id, owner_scope, owner_id, file_name, storage_path, subtype_id, " +
        "document_subtype!subtype_id(name, requires_acknowledgement)",
      )
      .eq("id", documentId)
      .single();
    if (!doc || doc.organisation_id !== caller.organisationId) {
      return { success: false, error: "Document not found" };
    }
    const subtype = doc.document_subtype as unknown as
      | { name?: string; requires_acknowledgement?: boolean }
      | { name?: string; requires_acknowledgement?: boolean }[]
      | null;
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
    const hash = await computeDocumentVersionHash(admin, doc.storage_path as string);
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
    const { data: docs } = await admin
      .from("document")
      .select(
        "id, owner_scope, owner_id, file_name, subtype_id, created_at, " +
        "document_subtype!subtype_id(name, type, requires_acknowledgement)",
      )
      .eq("organisation_id", caller.organisationId)
      .order("created_at", { ascending: false });

    type DocJoin = {
      id: string;
      owner_scope: "member" | "organisation";
      owner_id: string | null;
      file_name: string;
      subtype_id: string;
      created_at: string;
      document_subtype: { name?: string; type?: string; requires_acknowledgement?: boolean } | Array<{ name?: string; type?: string; requires_acknowledgement?: boolean }> | null;
    };
    const rows = (docs ?? []) as unknown as DocJoin[];

    // Filter to ack-required docs the caller is expected to ack.
    const relevant = rows.filter((d) => {
      const st = Array.isArray(d.document_subtype) ? d.document_subtype[0] : d.document_subtype;
      if (!st?.requires_acknowledgement) return false;
      if (d.owner_scope === "member") return d.owner_id === caller.memberId;
      if (d.owner_scope === "organisation") return caller.canViewOrgDocs;
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
          createdAt: d.created_at,
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

    const { data: doc } = await admin
      .from("document")
      .select(
        "id, organisation_id, owner_scope, owner_id, subtype_id, " +
        "document_subtype!subtype_id(requires_acknowledgement)",
      )
      .eq("id", documentId)
      .single();
    if (!doc || doc.organisation_id !== caller.organisationId) {
      return { success: false, error: "Document not found" };
    }
    const subtype = doc.document_subtype as unknown as
      | { requires_acknowledgement?: boolean }
      | { requires_acknowledgement?: boolean }[]
      | null;
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
      const expectedIds = ((members ?? []) as Array<{
        id: string;
        rights_profiles: { can_view_organisation_documents?: boolean } | { can_view_organisation_documents?: boolean }[] | null;
      }>)
        .filter((m) => {
          const rp = Array.isArray(m.rights_profiles) ? m.rights_profiles[0] : m.rights_profiles;
          return rp?.can_view_organisation_documents === true;
        })
        .map((m) => m.id);
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
    const { data: doc } = await admin
      .from("document")
      .select(
        "id, organisation_id, owner_scope, owner_id, file_name, subtype_id, " +
        "document_subtype!subtype_id(name, requires_acknowledgement)",
      )
      .eq("id", documentId)
      .single();
    if (!doc || doc.organisation_id !== caller.organisationId) {
      return { success: false, error: "Document not found" };
    }
    const subtype = doc.document_subtype as unknown as
      | { name?: string; requires_acknowledgement?: boolean }
      | { name?: string; requires_acknowledgement?: boolean }[]
      | null;
    const subtypeRow = Array.isArray(subtype) ? subtype[0] : subtype;
    if (!subtypeRow?.requires_acknowledgement) {
      return { success: false, error: "This document does not require acknowledgement." };
    }
    const ownerScope = doc.owner_scope as "member" | "organisation";

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
