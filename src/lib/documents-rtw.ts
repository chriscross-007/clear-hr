// CLE-228 — Shared helpers for the Right-to-Work aggregate.
//
// The RTW signal is the subtype's **type** (`type = 'evidence'`),
// not its retention class. The retention class is independent — it
// decides how long the doc is kept (right_to_work = 2y post-leave,
// payroll = 6y post-leave, other = 6y, …) and never changes whether
// a doc counts as RTW. This split lets an admin flag a subtype as
// RTW evidence while choosing any retention duration they want.
//
// Every RTW-signal check in the codebase must go through
// `isRtwSubtype` (in-code) or `.eq("type", "evidence")` /
// `.neq("type", "evidence")` (DB queries). Do not re-introduce
// `retention_class = 'right_to_work'` as an RTW signal — the two
// are decoupled by design (CLE-228).

/**
 * True when the subtype's `type` is `evidence`, meaning any doc
 * uploaded against it is RTW evidence (the UI already labels the
 * `evidence` type as "RTW Evidence"). Pass any row shape that
 * carries at least `{ type: string }`.
 */
export function isRtwSubtype(s: { type: string }): boolean {
  return s.type === "evidence";
}
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
