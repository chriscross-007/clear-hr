// CLE-228 — Shared helper for the Right-to-Work aggregate's
// "presented on Required" set. Called from both the per-member
// Required-documents compute (admin + employee view) and the
// employee self "Other documents" compute, so the two surfaces
// agree about which RTW docs belong on which card.
//
// RTW semantics: the member needs AT LEAST ONE non-expired piece
// of RTW evidence. Once one exists, the other RTW docs (expired,
// or superseded within their subtype) are not required and move
// to Other. If every RTW doc is expired, all of them stay on
// Required so the admin can see what's lapsed and decide which
// to renew.

export interface RtwDocLike {
  id: string;
  subtype_id: string | null;
  expires_on: string | null;
  uploaded_at: string;
}

/**
 * Returns the set of RTW doc IDs that should be shown on the
 * Required-documents card. All other evidence-type docs belong
 * on Other documents.
 *
 * Rule:
 *   1. Keep only the newest doc per subtype (older docs within the
 *      same subtype are superseded and belong on Other).
 *   2. If any of those newest-per-subtype docs is non-expired,
 *      presented = all the non-expired ones.
 *   3. Otherwise (every RTW doc expired), presented = all of them.
 *
 * Pass only RTW/evidence-type active docs — queued/disposal-expired
 * rows are the caller's responsibility to filter upstream.
 */
export function selectPresentedRtwDocIds(
  rtwDocs: readonly RtwDocLike[],
  today: string,
): Set<string> {
  const bySubtype = new Map<string, RtwDocLike[]>();
  for (const d of rtwDocs) {
    if (!d.subtype_id) continue;
    const list = bySubtype.get(d.subtype_id) ?? [];
    list.push(d);
    bySubtype.set(d.subtype_id, list);
  }
  const newestPerSubtype: RtwDocLike[] = [];
  for (const list of bySubtype.values()) {
    list.sort((a, b) => (a.uploaded_at < b.uploaded_at ? 1 : -1));
    newestPerSubtype.push(list[0]);
  }
  const isExpired = (d: RtwDocLike): boolean =>
    d.expires_on !== null && d.expires_on <= today;
  const anyNotExpired = newestPerSubtype.some((d) => !isExpired(d));
  const presented = anyNotExpired
    ? newestPerSubtype.filter((d) => !isExpired(d))
    : newestPerSubtype;
  return new Set(presented.map((d) => d.id));
}
