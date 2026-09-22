"use client";

// CLE-216 — Client wrapper that fetches the member's docs traffic
// light and renders the shared icon. Used on Member Detail (the
// per-member header block) where the surrounding page is server-
// rendered and doesn't already have the light in scope.

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getMemberDocumentsTrafficLight } from "@/app/(dashboard)/documents/compliance-actions";
import type { TrafficLight } from "@/lib/documents-traffic-light";
import { DocumentsTrafficLight } from "@/components/documents/documents-traffic-light";
import { onMemberDocsChanged } from "@/lib/member-docs-events";

export function MemberDocumentsTrafficLight({
  memberId,
  /** When set, clicking the badge routes to this path. Defaults to
   *  the member's Documents tab — where the Required Documents
   *  card lives (CLE-222) — so admins can act on whatever's driving
   *  the colour. */
  onClickHref,
}: {
  memberId: string;
  onClickHref?: string;
}) {
  const router = useRouter();
  const [light, setLight] = useState<TrafficLight | null>(null);

  const load = useCallback(async () => {
    const res = await getMemberDocumentsTrafficLight(memberId);
    if (res.success) setLight(res.light);
  }, [memberId]);

  useEffect(() => { void load(); }, [load]);

  // Also react to the RTW opt-out toggle so the badge flips
  // colour without a full page reload.
  useEffect(() => {
    function onRtwChanged(e: Event) {
      const detail = (e as CustomEvent<{ memberId?: string }>).detail;
      if (!detail || detail.memberId !== memberId) return;
      void load();
    }
    window.addEventListener("clearhr:rtw-changed", onRtwChanged);
    return () => window.removeEventListener("clearhr:rtw-changed", onRtwChanged);
  }, [memberId, load]);

  // CLE-216 — Refresh whenever anything on the page mutates this
  // member's docs (upload, verify, renew, delete, expiry/review
  // edit, expected-doc add/remove). Any client-side caller that
  // changes docs for a member should dispatch via
  // `dispatchMemberDocsChanged(memberId)` so this badge stays live.
  useEffect(() => onMemberDocsChanged(memberId, () => { void load(); }), [memberId, load]);

  if (!light) return null;
  return (
    <DocumentsTrafficLight
      light={light}
      size="md"
      onClick={onClickHref ? () => router.push(onClickHref) : undefined}
    />
  );
}
