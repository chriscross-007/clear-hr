// CLE-227 — Impl-only sibling of `compliance-actions.ts` holding the
// mobile-wrapped `_getMyDocumentsTrafficLight(caller)`. Non-`"use server"`
// so it can be imported from both the action file (via cookies) and
// the mobile API-route wrapper at /api/mobile/documents/traffic-light
// (via bearer).

import {
  EMPTY_COUNTS,
  computeTrafficLightsForMembers,
  type TrafficLight,
} from "@/lib/documents-traffic-light";
import type { DocumentsCaller } from "@/lib/documents-caller";

export async function _getMyDocumentsTrafficLight(
  caller: DocumentsCaller,
): Promise<
  { success: true; memberId: string; light: TrafficLight }
  | { success: false; error: string }
> {
  try {
    const { admin, memberId, organisationId } = caller;
    const { data: memberRow } = await admin
      .from("members")
      .select("id, rtw_not_required")
      .eq("id", memberId)
      .eq("organisation_id", organisationId)
      .single();
    if (!memberRow) return { success: false, error: "Member not found" };

    const map = await computeTrafficLightsForMembers(
      organisationId,
      [{
        id: memberRow.id as string,
        rtw_not_required: (memberRow as { rtw_not_required?: boolean }).rtw_not_required === true,
      }],
    );
    const light = map.get(memberId) ?? { colour: null, counts: { ...EMPTY_COUNTS } };
    return { success: true, memberId, light };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "An error occurred" };
  }
}
