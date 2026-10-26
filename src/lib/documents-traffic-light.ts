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
import { computeMemberDocAttention } from "@/lib/documents-attention";

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
 * Compute traffic-light aggregates for a set of members. Built on the
 * shared attention rule (`computeMemberDocAttention`, 2026-10-25) so the
 * admin dashboard, Employees Directory column, member badge and the
 * member's own card count exactly what the Compliance page lists and
 * the nightly email reports.
 *
 * Per item, the worst status wins: missing (`not_uploaded`) → expired →
 * pending verification → overdue review → expiring soon → review due
 * soon. Required items with nothing outstanding count as `verified`
 * (green). Members with no items get `colour: null`.
 *
 * `excludeHiddenFromOwner` — the member's own view: HR-only Employment
 * documents don't count (they can't see them).
 */
export async function computeTrafficLightsForMembers(
  organisationId: string,
  members: Array<{ id: string; rtw_not_required: boolean }>,
  opts?: { excludeHiddenFromOwner?: boolean },
): Promise<Map<string, TrafficLight>> {
  const map = new Map<string, TrafficLight>();
  for (const m of members) map.set(m.id, { colour: null, counts: { ...EMPTY_COUNTS } });
  if (members.length === 0) return map;

  const itemsByMember = await computeMemberDocAttention(getAdmin(), organisationId, members);
  for (const m of members) {
    const counts: TrafficLightCounts = { ...EMPTY_COUNTS };
    for (const it of itemsByMember.get(m.id) ?? []) {
      if (opts?.excludeHiddenFromOwner && it.hiddenFromOwner) continue;
      const s = it.statuses;
      if (s.includes("not_uploaded")) counts.missing += 1;
      else if (s.includes("expired")) counts.expired += 1;
      else if (s.includes("pending_verification")) counts.pendingVerification += 1;
      else if (s.includes("overdue_review")) counts.overdueReview += 1;
      else if (s.includes("expiring_soon")) counts.expiringSoon += 1;
      else if (s.includes("review_due_soon")) counts.reviewDueSoon += 1;
      else if (it.required) counts.verified += 1;
    }
    map.set(m.id, { colour: colourFromCounts(counts), counts });
  }
  return map;
}
