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
import { deriveDocumentStatuses, type DocumentStatus } from "@/lib/document-status";

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
  statuses: (DocumentStatus | "not_uploaded")[];
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
  "review_due_soon",
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
    // CLE-215 — `expected_for_every_member` dropped; per-member
    // expectations now come solely from `member_expected_document`,
    // and RTW-class subtypes are aggregated into a single per-member
    // "Right to Work evidence" row (below).
    const { data: subtypeRows } = await admin
      .from("document_subtype")
      .select("id, type, name, retention_class, requires_verification")
      .eq("organisation_id", ctx.organisationId);
    type SubtypeRow = {
      id: string;
      type: string;
      name: string;
      retention_class: string;
      requires_verification: boolean;
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
    //
    // CLE-215 — RTW-class docs are hidden from the per-doc listing.
    // They're rolled up into one aggregate "Right to Work evidence"
    // row per member (below) so a member with Passport + Visa
    // appears as a single RTW row, not two separate rows.
    for (const d of activeDocs) {
      const member = memberById.get(d.owner_id);
      if (!member) continue;
      const subtype = d.subtype_id ? subtypeById.get(d.subtype_id) : null;
      if (subtype?.retention_class === "right_to_work") continue;
      const statuses = deriveDocumentStatuses({
        requiresVerification: subtype?.requires_verification === true,
        verifiedOn: d.verified_on,
        expiresOn: d.expires_on,
        nextReviewOn: d.next_review_on,
      }) as (DocumentStatus | "not_uploaded")[];
      rows.push({
        key: `doc:${d.id}`,
        memberId: member.id,
        memberName: `${member.first_name} ${member.last_name}`.trim() || "—",
        memberTeamId: member.team_id,
        subtypeId: d.subtype_id,
        subtypeName: subtype?.name ?? "—",
        subtypeType: d.type,
        retentionClass: subtype?.retention_class ?? "other",
        statuses,
        documentId: d.id,
        fileName: d.file_name,
        verifiedOn: d.verified_on,
        expiresOn: d.expires_on,
        nextReviewOn: d.next_review_on,
      });
    }

    // Synthetic not_uploaded rows.
    //
    // CLE-215 — expectations now come solely from
    // `member_expected_document` (org-wide `expected_for_every_member`
    // was dropped in the same migration; if anyone relied on it,
    // per-member rows were backfilled). RTW-class subtypes are
    // filtered out here — they surface via the RTW aggregate row.
    const perMemberExpected: Map<string, Set<string>> = new Map();
    if (memberIds.length > 0) {
      const { data: expectedRows } = await admin
        .from("member_expected_document")
        .select("member_id, subtype_id")
        .eq("organisation_id", ctx.organisationId)
        .in("member_id", memberIds);
      for (const r of (expectedRows ?? []) as Array<{ member_id: string; subtype_id: string }>) {
        let set = perMemberExpected.get(r.member_id);
        if (!set) { set = new Set(); perMemberExpected.set(r.member_id, set); }
        set.add(r.subtype_id);
      }
    }

    for (const m of members) {
      const expectedIds = perMemberExpected.get(m.id);
      if (!expectedIds || expectedIds.size === 0) continue;

      for (const subtypeId of expectedIds) {
        const s = subtypeById.get(subtypeId);
        if (!s) continue;
        // RTW-class subtypes are aggregated via the RTW row below.
        if (s.retention_class === "right_to_work") continue;
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
          statuses: ["not_uploaded"],
          documentId: null,
          fileName: null,
          verifiedOn: null,
          expiresOn: null,
          nextReviewOn: null,
        });
      }
    }

    // CLE-215 — RTW aggregate rows.
    //
    // One per non-opted-out member. Status derivation matches
    // getMemberRequiredDocumentRows: `not_uploaded` when no non-
    // expired RTW-class doc exists; otherwise `pending_verification`
    // if any newest qualifying doc is unverified, `expiring_soon` if
    // any expires within 30 days, `verified` when all are clean.
    const rtwSubtypeIdSet = new Set(
      subtypes.filter((s) => s.retention_class === "right_to_work").map((s) => s.id),
    );
    const soonIso = (() => {
      const d = new Date(today + "T00:00:00Z");
      d.setUTCDate(d.getUTCDate() + 30);
      return d.toISOString().slice(0, 10);
    })();
    for (const m of members) {
      if (m.rtw_not_required) continue;
      // Newest non-expired doc per RTW-class subtype for this member.
      const perSubtypeNewest: Map<string, typeof activeDocs[number]> = new Map();
      for (const d of activeDocs) {
        if (d.owner_id !== m.id) continue;
        if (!d.subtype_id || !rtwSubtypeIdSet.has(d.subtype_id)) continue;
        if (d.expires_on !== null && d.expires_on <= today) continue;
        const prior = perSubtypeNewest.get(d.subtype_id);
        // activeDocs isn't ordered by upload time here; pick the row
        // with the newest verified_on || expires_on || any ordering
        // proxy. Simpler and stable: pick the largest doc id
        // lexicographically, which is close enough for the aggregate.
        // Compliance rows are read-only; the Required Documents card
        // is where users actually click through.
        if (!prior || (prior.id < d.id)) perSubtypeNewest.set(d.subtype_id, d);
      }
      let anyPending = false;
      let anyExpiring = false;
      for (const d of perSubtypeNewest.values()) {
        if (!d.verified_on) anyPending = true;
        if (d.expires_on !== null && d.expires_on <= soonIso) anyExpiring = true;
      }
      const rtwStatuses: (DocumentStatus | "not_uploaded")[] = [];
      if (perSubtypeNewest.size === 0) {
        rtwStatuses.push("not_uploaded");
      } else {
        if (anyPending) rtwStatuses.push("pending_verification");
        if (anyExpiring) rtwStatuses.push("expiring_soon");
        if (!anyPending && !anyExpiring) rtwStatuses.push("verified");
      }
      rows.push({
        key: `rtw:${m.id}`,
        memberId: m.id,
        memberName: `${m.first_name} ${m.last_name}`.trim() || "—",
        memberTeamId: m.team_id,
        // No individual subtype — this is the RTW aggregate.
        subtypeId: null,
        subtypeName: "Right to Work evidence",
        subtypeType: "evidence",
        retentionClass: "right_to_work",
        statuses: rtwStatuses,
        documentId: null,
        fileName: null,
        verifiedOn: null,
        expiresOn: null,
        nextReviewOn: null,
      });
    }

    // Apply filters.
    let filtered = rows;
    if (filters?.subtypeId) {
      filtered = filtered.filter((r) => r.subtypeId === filters.subtypeId);
    }
    const wanted = filters?.status ?? (filters?.includeAllStatuses ? null : ATTENTION_STATUSES);
    if (wanted) {
      const set = new Set(wanted);
      // Row matches if ANY of its statuses is in the wanted set.
      filtered = filtered.filter((r) => r.statuses.some((s) => set.has(s)));
    }

    // Sort by the row's most-severe status. Row without any status
    // (e.g. subtype without verification) sorts last.
    const order: Record<string, number> = {
      expired: 1, overdue_review: 2, expiring_soon: 3,
      pending_verification: 4, not_uploaded: 5, verified: 6,
    };
    function rowRank(r: ComplianceRow): number {
      let best = 9;
      for (const s of r.statuses) {
        const rank = order[s] ?? 9;
        if (rank < best) best = rank;
      }
      return best;
    }
    filtered.sort((a, b) => rowRank(a) - rowRank(b)
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
      // CLE-215 — audit records the diff in the positive form
      // ("RTW required") to match the UI toggle. Column storage is
      // still `rtw_not_required`; the invert happens at the audit
      // boundary. Reason stays as "opt-out reason" — it's only
      // captured when opting out.
      await logAudit({
        organisationId: resolved.ctx.organisationId,
        actorId: resolved.ctx.memberId,
        actorName,
        action: "member.rtw_not_required_changed",
        targetType: "member",
        targetId: memberId,
        targetLabel: `${before.first_name ?? ""} ${before.last_name ?? ""}`.trim() || memberId,
        changes: {
          rtw_required: {
            old: !before.rtw_not_required,
            new: !input.rtwNotRequired,
          },
          rtw_opt_out_reason: {
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

// ---------------------------------------------------------------------------
// CLE-216 — Member documents traffic light.
//
// Rolls a member's required-doc set into a single red / amber / green
// signal for the Employees Directory column and the Member Detail
// sticky-header badge. See spec §7b.16.
// ---------------------------------------------------------------------------

export interface TrafficLightCounts {
  missing: number;
  expired: number;
  pendingVerification: number;
  expiringSoon: number;
  reviewDueSoon: number;
  overdueReview: number;
  verified: number;
}

export interface TrafficLight {
  colour: "red" | "amber" | "green" | null;
  counts: TrafficLightCounts;
}

const EMPTY_COUNTS: TrafficLightCounts = {
  missing: 0,
  expired: 0,
  pendingVerification: 0,
  expiringSoon: 0,
  reviewDueSoon: 0,
  overdueReview: 0,
  verified: 0,
};

function colourFromCounts(c: TrafficLightCounts): TrafficLight["colour"] {
  const total =
    c.missing + c.expired + c.pendingVerification +
    c.expiringSoon + c.reviewDueSoon + c.overdueReview + c.verified;
  if (total === 0) return null;
  // Red — missing / expired / unverified. See spec §7b.16.
  if (c.missing > 0 || c.expired > 0 || c.pendingVerification > 0) return "red";
  // Amber — attention within the current cycle.
  if (c.expiringSoon > 0 || c.reviewDueSoon > 0 || c.overdueReview > 0) return "amber";
  return "green";
}

/**
 * Compute traffic-light aggregates for a set of members using a
 * single batch of queries. Returns a Map keyed by member id. Members
 * with no required docs (e.g. RTW-opted-out with nothing else
 * expected) are still included but with `colour: null`.
 *
 * Shared internal — the two public actions below both call this.
 */
async function computeTrafficLightsForMembers(
  organisationId: string,
  members: Array<{ id: string; rtw_not_required: boolean }>,
): Promise<Map<string, TrafficLight>> {
  const admin = getAdmin();
  const memberIds = members.map((m) => m.id);
  const map = new Map<string, TrafficLight>();
  for (const m of members) map.set(m.id, { colour: null, counts: { ...EMPTY_COUNTS } });
  if (memberIds.length === 0) return map;

  const today = new Date().toISOString().slice(0, 10);
  const soonIso = (() => {
    const d = new Date(today + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + 30);
    return d.toISOString().slice(0, 10);
  })();

  // Subtypes for the tenant.
  const { data: subtypeRows } = await admin
    .from("document_subtype")
    .select("id, type, name, retention_class, requires_verification")
    .eq("organisation_id", organisationId);
  type Sub = {
    id: string; type: string; name: string;
    retention_class: string; requires_verification: boolean;
  };
  const subtypes = ((subtypeRows ?? []) as unknown as Sub[]);
  const subtypeById = new Map(subtypes.map((s) => [s.id, s]));

  // Per-member expected subtypes.
  const { data: expectedRows } = await admin
    .from("member_expected_document")
    .select("member_id, subtype_id")
    .eq("organisation_id", organisationId)
    .in("member_id", memberIds);
  const perMemberExpected = new Map<string, Set<string>>();
  for (const r of (expectedRows ?? []) as Array<{ member_id: string; subtype_id: string }>) {
    let s = perMemberExpected.get(r.member_id);
    if (!s) { s = new Set(); perMemberExpected.set(r.member_id, s); }
    s.add(r.subtype_id);
  }

  // Active docs for the in-scope members. Exclude trashed and
  // past-disposal ones — same rules as everywhere else.
  const { data: docRows } = await admin
    .from("document")
    .select("id, owner_id, subtype_id, expires_on, next_review_on, verified_on, disposal_date")
    .eq("organisation_id", organisationId)
    .eq("owner_scope", "member")
    .in("owner_id", memberIds);
  type Doc = {
    id: string; owner_id: string; subtype_id: string | null;
    expires_on: string | null; next_review_on: string | null;
    verified_on: string | null; disposal_date: string | null;
  };
  const docs = ((docRows ?? []) as unknown as Doc[]);
  const { data: queuedRows } = await admin
    .from("disposal_queue")
    .select("document_id")
    .eq("organisation_id", organisationId);
  const queued = new Set<string>((queuedRows ?? []).map((r) => r.document_id as string));
  const active = docs
    .filter((d) => !queued.has(d.id))
    .filter((d) => d.disposal_date === null || d.disposal_date > today);

  // Bucket active docs: (memberId, subtypeId) → newest doc first.
  const bucket = new Map<string, Doc[]>();
  for (const d of active) {
    if (!d.subtype_id) continue;
    const key = `${d.owner_id}:${d.subtype_id}`;
    const list = bucket.get(key) ?? [];
    list.push(d);
    bucket.set(key, list);
  }
  // Sort each list newest-first (by verified_on desc, then by any
  // stable proxy — id is fine as tiebreak).
  for (const list of bucket.values()) {
    list.sort((a, b) => {
      const av = a.verified_on ?? "";
      const bv = b.verified_on ?? "";
      if (av !== bv) return av < bv ? 1 : -1;
      return a.id < b.id ? 1 : -1;
    });
  }

  const rtwSubtypeIds = subtypes
    .filter((s) => s.retention_class === "right_to_work")
    .map((s) => s.id);

  for (const m of members) {
    const counts: TrafficLightCounts = { ...EMPTY_COUNTS };

    // ---- RTW aggregate (unless opted out) ----
    if (!m.rtw_not_required && rtwSubtypeIds.length > 0) {
      let anyValid = false;
      let anyPending = false;
      let anyExpiringSoon = false;
      for (const sid of rtwSubtypeIds) {
        const list = bucket.get(`${m.id}:${sid}`);
        if (!list || list.length === 0) continue;
        const newest = list[0];
        // Expired doc doesn't count as evidence.
        if (newest.expires_on !== null && newest.expires_on <= today) continue;
        anyValid = true;
        const s = subtypeById.get(sid);
        const requiresV = s?.requires_verification === true;
        if (requiresV && !newest.verified_on) anyPending = true;
        if (newest.expires_on !== null && newest.expires_on <= soonIso) anyExpiringSoon = true;
      }
      if (!anyValid) {
        counts.missing += 1;
      } else if (anyPending) {
        counts.pendingVerification += 1;
      } else if (anyExpiringSoon) {
        counts.expiringSoon += 1;
      } else {
        counts.verified += 1;
      }
    }

    // ---- Non-RTW per-member expected subtypes ----
    const expected = perMemberExpected.get(m.id);
    if (expected) {
      for (const sid of expected) {
        const s = subtypeById.get(sid);
        if (!s) continue;
        if (s.retention_class === "right_to_work") continue; // covered above
        const list = bucket.get(`${m.id}:${sid}`);
        const newest = list?.[0] ?? null;
        if (!newest) { counts.missing += 1; continue; }
        // Derive statuses from the newest doc for that subtype.
        const statuses = deriveDocumentStatuses({
          requiresVerification: s.requires_verification === true,
          verifiedOn: newest.verified_on,
          expiresOn: newest.expires_on,
          nextReviewOn: newest.next_review_on,
        });
        // Rank the doc against the traffic-light tiers. A doc can
        // carry multiple statuses; walk in severity order.
        if (statuses.includes("expired")) counts.expired += 1;
        else if (statuses.includes("pending_verification")) counts.pendingVerification += 1;
        else if (statuses.includes("overdue_review")) counts.overdueReview += 1;
        else if (statuses.includes("expiring_soon")) counts.expiringSoon += 1;
        else if (statuses.includes("review_due_soon")) counts.reviewDueSoon += 1;
        else counts.verified += 1;
      }
    }

    map.set(m.id, { colour: colourFromCounts(counts), counts });
  }
  return map;
}

/**
 * Traffic light for a single member. Returns null colour + zero
 * counts when the member has no required docs (RTW-opted-out and
 * nothing per-member).
 */
export async function getMemberDocumentsTrafficLight(
  memberId: string,
): Promise<{ success: true; light: TrafficLight } | { success: false; error: string }> {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: "Not authenticated" };
    const resolved = await getEffectiveRightsForUser(user.id);
    if (!resolved) return { success: false, error: "No organisation" };

    const admin = getAdmin();
    const { data: memberRow } = await admin
      .from("members")
      .select("id, rtw_not_required")
      .eq("id", memberId)
      .eq("organisation_id", resolved.ctx.organisationId)
      .single();
    if (!memberRow) return { success: false, error: "Member not found" };

    const map = await computeTrafficLightsForMembers(
      resolved.ctx.organisationId,
      [{ id: memberRow.id as string, rtw_not_required: (memberRow as { rtw_not_required?: boolean }).rtw_not_required === true }],
    );
    const light = map.get(memberId) ?? { colour: null, counts: { ...EMPTY_COUNTS } };
    return { success: true, light };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "An error occurred" };
  }
}

/**
 * Batch traffic lights for every member the caller can see, scoped
 * to their `cross_user_access`. Powers the Employees Directory
 * Docs column. Returns a plain object (JSON-safe for the client)
 * keyed by memberId.
 */
export async function getOrgDocumentsTrafficLights(): Promise<
  { success: true; lights: Record<string, TrafficLight> }
  | { success: false; error: string }
> {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: "Not authenticated" };
    const resolved = await getEffectiveRightsForUser(user.id);
    if (!resolved) return { success: false, error: "No organisation" };
    const { rights, ctx } = resolved;

    const admin = getAdmin();
    let q = admin
      .from("members")
      .select("id, rtw_not_required, team_id")
      .eq("organisation_id", ctx.organisationId);
    if (rights.crossUserAccess === "self") {
      q = q.eq("id", ctx.memberId);
    } else if (rights.crossUserAccess === "team") {
      if (ctx.teamId === null) q = q.eq("id", ctx.memberId);
      else q = q.eq("team_id", ctx.teamId);
    }
    const { data: memberRows, error } = await q;
    if (error) return { success: false, error: error.message };
    const members = ((memberRows ?? []) as unknown as Array<{
      id: string; rtw_not_required: boolean; team_id: string | null;
    }>);

    const map = await computeTrafficLightsForMembers(ctx.organisationId, members);
    const out: Record<string, TrafficLight> = {};
    for (const [k, v] of map.entries()) out[k] = v;
    return { success: true, lights: out };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "An error occurred" };
  }
}
