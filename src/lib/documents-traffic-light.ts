// CLE-227 — Shared traffic-light types + compute helper.
//
// Extracted from `(dashboard)/documents/compliance-actions.ts` so the
// mobile API-route impl at `.../compliance-actions-impl.ts` and the
// existing web server actions can both call `computeTrafficLightsForMembers`.
// The action file itself would export it as a Server Action if it
// stayed there (every `"use server"` export becomes one) — hence the
// move to a non-`"use server"` shared module.
//
// Downstream type consumers (Employees Directory column, member
// header badge, traffic-light-format helper) still import `TrafficLight`
// / `TrafficLightCounts` from `compliance-actions.ts`, which re-exports
// them from here.

import { createClient as createAdminClient, type SupabaseClient } from "@supabase/supabase-js";
import { deriveDocumentStatuses } from "@/lib/document-status";

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

export const EMPTY_COUNTS: TrafficLightCounts = {
  missing: 0,
  expired: 0,
  pendingVerification: 0,
  expiringSoon: 0,
  reviewDueSoon: 0,
  overdueReview: 0,
  verified: 0,
};

export function colourFromCounts(c: TrafficLightCounts): TrafficLight["colour"] {
  const total =
    c.missing + c.expired + c.pendingVerification +
    c.expiringSoon + c.reviewDueSoon + c.overdueReview + c.verified;
  if (total === 0) return null;
  if (
    c.missing > 0 ||
    c.expired > 0 ||
    c.pendingVerification > 0 ||
    c.overdueReview > 0
  ) return "red";
  if (c.expiringSoon > 0 || c.reviewDueSoon > 0) return "amber";
  return "green";
}

function getAdmin(): SupabaseClient {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

/**
 * Compute traffic-light aggregates for a set of members using a
 * single batch of queries. Returns a Map keyed by member id. Members
 * with no required docs (e.g. RTW-opted-out with nothing else
 * expected) are still included but with `colour: null`.
 */
export async function computeTrafficLightsForMembers(
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
  const queued = new Set<string>(((queuedRows ?? []) as { document_id: string }[]).map((r) => r.document_id));
  const active = docs
    .filter((d) => !queued.has(d.id))
    .filter((d) => d.disposal_date === null || d.disposal_date > today);

  const bucket = new Map<string, Doc[]>();
  for (const d of active) {
    if (!d.subtype_id) continue;
    const key = `${d.owner_id}:${d.subtype_id}`;
    const list = bucket.get(key) ?? [];
    list.push(d);
    bucket.set(key, list);
  }
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

    if (!m.rtw_not_required && rtwSubtypeIds.length > 0) {
      let anyValid = false;
      let anyPending = false;
      let anyExpiringSoon = false;
      for (const sid of rtwSubtypeIds) {
        const list = bucket.get(`${m.id}:${sid}`);
        if (!list || list.length === 0) continue;
        const newest = list[0];
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

    const expected = perMemberExpected.get(m.id);
    if (expected) {
      for (const sid of expected) {
        const s = subtypeById.get(sid);
        if (!s) continue;
        if (s.retention_class === "right_to_work") continue;
        const list = bucket.get(`${m.id}:${sid}`);
        const newest = list?.[0] ?? null;
        if (!newest) { counts.missing += 1; continue; }
        const statuses = deriveDocumentStatuses({
          requiresVerification: s.requires_verification === true,
          verifiedOn: newest.verified_on,
          expiresOn: newest.expires_on,
          nextReviewOn: newest.next_review_on,
        });
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
