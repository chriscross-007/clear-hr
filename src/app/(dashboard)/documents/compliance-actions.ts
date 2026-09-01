"use server";

// CLE-207 — Compliance dashboard server layer.
//
// Reads the caller's in-scope members + their active documents +
// tenant subtype config, computes status for each doc, and
// synthesises `not_uploaded` rows for subtypes flagged
// `expected_for_every_member = true` when a member is missing one.
//
// RLS ensures we never see rows from other tenants; the app layer
// narrows further by cross_user_access.

import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { getEffectiveRightsForUser } from "@/lib/rights-resolver";
import { logAudit } from "@/lib/audit";
import { deriveDocumentStatus, type DocumentStatus } from "@/lib/document-status";

function getAdmin() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

export interface ComplianceRow {
  /** Unique key. For a real doc, `doc:{documentId}`; for a synthetic
   *  missing-doc row, `missing:{memberId}:{subtypeId}`. */
  key: string;
  memberId: string;
  memberName: string;
  memberTeamId: string | null;
  subtypeId: string | null;
  subtypeName: string;
  subtypeType: string;
  retentionClass: string;
  status: DocumentStatus | "not_uploaded";
  /** Present when the row is backed by a real document. */
  documentId: string | null;
  fileName: string | null;
  verifiedOn: string | null;
  expiresOn: string | null;
  nextReviewOn: string | null;
}

const ATTENTION_STATUSES: (DocumentStatus | "not_uploaded")[] = [
  "not_uploaded",
  "pending_verification",
  "expired",
  "expiring_soon",
  "overdue_review",
];

/**
 * Fetch the compliance dashboard rows. Filters applied server-side.
 *
 * Defaults return every row whose status is in the "attention" set —
 * verified rows are excluded unless the caller passes an explicit
 * status filter that includes "verified".
 */
export async function getComplianceRows(filters?: {
  subtypeId?: string;
  status?: (DocumentStatus | "not_uploaded")[];
  includeAllStatuses?: boolean;
}): Promise<{ success: boolean; error?: string; rows: ComplianceRow[] }> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { success: false, error: "Not authenticated", rows: [] };
    const resolved = await getEffectiveRightsForUser(user.id);
    if (!resolved) return { success: false, error: "No organisation", rows: [] };
    if (!resolved.rights.tabs.documents?.view) {
      return { success: false, error: "Forbidden", rows: [] };
    }

    const { rights, ctx } = resolved;
    const admin = getAdmin();

    // Members in scope.
    let memberQ = admin
      .from("members")
      .select("id, first_name, last_name, team_id, rtw_not_required")
      .eq("organisation_id", ctx.organisationId);
    if (rights.crossUserAccess === "self") {
      memberQ = memberQ.eq("id", ctx.memberId);
    } else if (rights.crossUserAccess === "team") {
      if (ctx.teamId === null) {
        memberQ = memberQ.eq("id", ctx.memberId);
      } else {
        memberQ = memberQ.eq("team_id", ctx.teamId);
      }
    }
    const { data: memberRows, error: memberErr } = await memberQ;
    if (memberErr) return { success: false, error: memberErr.message, rows: [] };
    type MemberRow = { id: string; first_name: string; last_name: string; team_id: string | null; rtw_not_required: boolean };
    const members = (memberRows ?? []) as unknown as MemberRow[];
    const memberById = new Map(members.map((m) => [m.id, m]));

    // Subtype config for the tenant.
    const { data: subtypeRows } = await admin
      .from("document_subtype")
      .select("id, type, name, retention_class, requires_verification, expected_for_every_member")
      .eq("organisation_id", ctx.organisationId);
    type SubtypeRow = {
      id: string;
      type: string;
      name: string;
      retention_class: string;
      requires_verification: boolean;
      expected_for_every_member: boolean;
    };
    const subtypes = (subtypeRows ?? []) as unknown as SubtypeRow[];
    const subtypeById = new Map(subtypes.map((s) => [s.id, s]));

    // Active documents for those members.
    const memberIds = members.map((m) => m.id);
    let docs: Array<{
      id: string;
      owner_id: string;
      subtype_id: string | null;
      file_name: string;
      type: string;
      expires_on: string | null;
      next_review_on: string | null;
      verified_on: string | null;
      disposal_date: string | null;
    }> = [];
    if (memberIds.length > 0) {
      const { data: docRows } = await admin
        .from("document")
        .select("id, owner_id, subtype_id, file_name, type, expires_on, next_review_on, verified_on, disposal_date")
        .eq("organisation_id", ctx.organisationId)
        .eq("owner_scope", "member")
        .in("owner_id", memberIds);
      docs = (docRows ?? []) as unknown as typeof docs;
    }

    // Exclude queued rows.
    const { data: queuedRows } = await admin
      .from("disposal_queue")
      .select("document_id")
      .eq("organisation_id", ctx.organisationId);
    const queued = new Set<string>((queuedRows ?? []).map((r) => r.document_id as string));

    const today = new Date().toISOString().slice(0, 10);
    const activeDocs = docs.filter((d) => !queued.has(d.id))
      .filter((d) => d.disposal_date === null || d.disposal_date > today);

    const rows: ComplianceRow[] = [];

    // Real doc rows.
    for (const d of activeDocs) {
      const member = memberById.get(d.owner_id);
      if (!member) continue;
      const subtype = d.subtype_id ? subtypeById.get(d.subtype_id) : null;
      // Exclude RTW subtypes when the member has opted out.
      if (member.rtw_not_required && subtype?.retention_class === "right_to_work") continue;
      const status = deriveDocumentStatus({
        requiresVerification: subtype?.requires_verification === true,
        verifiedOn: d.verified_on,
        expiresOn: d.expires_on,
        nextReviewOn: d.next_review_on,
      });
      rows.push({
        key: `doc:${d.id}`,
        memberId: member.id,
        memberName: `${member.first_name} ${member.last_name}`.trim() || "—",
        memberTeamId: member.team_id,
        subtypeId: d.subtype_id,
        subtypeName: subtype?.name ?? "—",
        subtypeType: d.type,
        retentionClass: subtype?.retention_class ?? "other",
        status,
        documentId: d.id,
        fileName: d.file_name,
        verifiedOn: d.verified_on,
        expiresOn: d.expires_on,
        nextReviewOn: d.next_review_on,
      });
    }

    // Synthetic not_uploaded rows for expected-for-every-member subtypes.
    const expectedSubtypes = subtypes.filter((s) => s.expected_for_every_member);
    for (const s of expectedSubtypes) {
      for (const m of members) {
        // RTW opt-out for RTW subtypes.
        if (m.rtw_not_required && s.retention_class === "right_to_work") continue;
        // Does this member have any active doc of this subtype?
        const has = activeDocs.some((d) => d.owner_id === m.id && d.subtype_id === s.id);
        if (has) continue;
        rows.push({
          key: `missing:${m.id}:${s.id}`,
          memberId: m.id,
          memberName: `${m.first_name} ${m.last_name}`.trim() || "—",
          memberTeamId: m.team_id,
          subtypeId: s.id,
          subtypeName: s.name,
          subtypeType: s.type,
          retentionClass: s.retention_class,
          status: "not_uploaded",
          documentId: null,
          fileName: null,
          verifiedOn: null,
          expiresOn: null,
          nextReviewOn: null,
        });
      }
    }

    // Apply filters.
    let filtered = rows;
    if (filters?.subtypeId) {
      filtered = filtered.filter((r) => r.subtypeId === filters.subtypeId);
    }
    const wanted = filters?.status ?? (filters?.includeAllStatuses ? null : ATTENTION_STATUSES);
    if (wanted) {
      const set = new Set(wanted);
      filtered = filtered.filter((r) => set.has(r.status));
    }

    // Sort: expired first, then overdue, then expiring, then pending, then not_uploaded, then verified.
    const order: Record<string, number> = {
      expired: 1, overdue_review: 2, expiring_soon: 3,
      pending_verification: 4, not_uploaded: 5, verified: 6, not_applicable: 7,
    };
    filtered.sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9)
      || a.memberName.localeCompare(b.memberName)
      || a.subtypeName.localeCompare(b.subtypeName));

    return { success: true, rows: filtered };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "An error occurred", rows: [] };
  }
}

export async function getSubtypesForCompliance(): Promise<{
  success: boolean;
  error?: string;
  subtypes: Array<{ id: string; type: string; name: string; retentionClass: string }>;
}> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "Not authenticated", subtypes: [] };
  const resolved = await getEffectiveRightsForUser(user.id);
  if (!resolved) return { success: false, error: "No organisation", subtypes: [] };

  const admin = getAdmin();
  const { data } = await admin
    .from("document_subtype")
    .select("id, type, name, retention_class, sort_order")
    .eq("organisation_id", resolved.ctx.organisationId)
    .order("type", { ascending: true })
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  return {
    success: true,
    subtypes: (data ?? []).map((r) => ({
      id: r.id as string,
      type: r.type as string,
      name: r.name as string,
      retentionClass: r.retention_class as string,
    })),
  };
}

// ---------------------------------------------------------------------------
// rtw_not_required toggle
// ---------------------------------------------------------------------------

export async function setRtwNotRequired(
  memberId: string,
  input: { rtwNotRequired: boolean; reason: string | null },
): Promise<{ success: boolean; error?: string }> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { success: false, error: "Not authenticated" };
    const resolved = await getEffectiveRightsForUser(user.id);
    if (!resolved) return { success: false, error: "No organisation" };
    // Gate on employment tab update — this belongs to Employee Records.
    if (resolved.rights.tabs.employment?.update !== true) {
      return { success: false, error: "You don't have permission to edit this employee." };
    }
    const admin = getAdmin();

    const { data: before } = await admin
      .from("members")
      .select("id, first_name, last_name, rtw_not_required, rtw_not_required_reason")
      .eq("id", memberId)
      .eq("organisation_id", resolved.ctx.organisationId)
      .single();
    if (!before) return { success: false, error: "Member not found" };

    if (input.rtwNotRequired && !(input.reason ?? "").trim()) {
      return { success: false, error: "Please give a reason for opting this member out of Right-to-Work checks." };
    }

    const { error } = await admin
      .from("members")
      .update({
        rtw_not_required: input.rtwNotRequired,
        rtw_not_required_reason: input.rtwNotRequired ? (input.reason?.trim() ?? null) : null,
      })
      .eq("id", memberId)
      .eq("organisation_id", resolved.ctx.organisationId);
    if (error) return { success: false, error: error.message };

    const { data: callerRow } = await admin
      .from("members")
      .select("first_name, last_name")
      .eq("id", resolved.ctx.memberId)
      .single();
    const actorName = `${callerRow?.first_name ?? ""} ${callerRow?.last_name ?? ""}`.trim() || "Unknown";

    const changed = before.rtw_not_required !== input.rtwNotRequired
      || (before.rtw_not_required_reason ?? null) !== (input.rtwNotRequired ? (input.reason?.trim() ?? null) : null);
    if (changed) {
      await logAudit({
        organisationId: resolved.ctx.organisationId,
        actorId: resolved.ctx.memberId,
        actorName,
        action: "member.rtw_not_required_changed",
        targetType: "member",
        targetId: memberId,
        targetLabel: `${before.first_name ?? ""} ${before.last_name ?? ""}`.trim() || memberId,
        changes: {
          rtw_not_required: {
            old: before.rtw_not_required,
            new: input.rtwNotRequired,
          },
          rtw_not_required_reason: {
            old: before.rtw_not_required_reason,
            new: input.rtwNotRequired ? (input.reason?.trim() ?? null) : null,
          },
        },
      });
    }

    revalidatePath(`/members/${memberId}/employment`);
    revalidatePath("/documents/compliance");
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "An error occurred" };
  }
}
