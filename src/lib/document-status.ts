// CLE-207 — Pure status derivation. Called by list responses and the
// compliance dashboard so every surface agrees on what a document's
// state is. No server-only dependencies — safe to import from client
// components that want to compute status locally on freshly-edited
// rows.
//
// Since CLE-211 follow-up: a document can carry multiple statuses
// simultaneously (an unverified passport can be both
// `pending_verification` and `expiring_soon`). `deriveDocumentStatuses`
// returns every applicable status. No priority weighting — all
// applicable statuses are equal citizens; UI decides how to stack
// their pills and the compliance dashboard filters match any row
// whose status set includes the picked filter.

export type DocumentStatus =
  | "pending_verification"
  | "verified"
  | "expiring_soon"
  | "expired"
  | "review_due_soon"
  | "overdue_review";

export interface StatusInputs {
  /** From the subtype: whether verification applies at all. */
  requiresVerification: boolean;
  /** ISO date the doc was verified (YYYY-MM-DD). */
  verifiedOn: string | null;
  /** ISO date after which the doc is no longer valid. */
  expiresOn: string | null;
  /** ISO date by which HR should re-sight the doc. */
  nextReviewOn: string | null;
  /** ISO today. Defaults to today at UTC. */
  today?: string;
}

const EXPIRING_SOON_WINDOW_DAYS = 30;

/**
 * Derive every applicable display status for a document.
 *
 * Rules:
 *   - Subtype doesn't require verification → `[]` (no pills, no
 *     attention needed).
 *   - Not yet verified → adds `pending_verification`.
 *   - `expires_on ≤ today` → adds `expired`.
 *     Else `expires_on ≤ today + 30 days` → adds `expiring_soon`.
 *   - `next_review_on ≤ today` → adds `overdue_review`.
 *     Else `next_review_on ≤ today + 30 days` → adds
 *     `review_due_soon` (kept distinct from `expiring_soon`, which
 *     is about the document's expiry date, not its review date).
 *   - If nothing above added anything, → `[verified]`.
 *
 * The returned array is ordered by "when it fired" — deterministic
 * for tests but no weighting is implied. Callers that need a single
 * label (email subject, screen reader summary) should compose from
 * the array themselves.
 */
export function deriveDocumentStatuses(inp: StatusInputs): DocumentStatus[] {
  if (!inp.requiresVerification) return [];

  const today = inp.today ?? new Date().toISOString().slice(0, 10);
  const soon = addDaysIso(today, EXPIRING_SOON_WINDOW_DAYS);
  const statuses: DocumentStatus[] = [];

  if (!inp.verifiedOn) statuses.push("pending_verification");

  if (inp.expiresOn !== null) {
    if (inp.expiresOn <= today) statuses.push("expired");
    else if (inp.expiresOn <= soon) statuses.push("expiring_soon");
  }

  if (inp.nextReviewOn !== null) {
    if (inp.nextReviewOn <= today) statuses.push("overdue_review");
    else if (inp.nextReviewOn <= soon) statuses.push("review_due_soon");
  }

  if (statuses.length === 0) statuses.push("verified");

  return statuses;
}

function addDaysIso(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export const STATUS_LABEL: Record<DocumentStatus, string> = {
  pending_verification: "Pending verification",
  verified: "Verified",
  expiring_soon: "Expiring soon",
  expired: "Expired",
  review_due_soon: "Review due soon",
  overdue_review: "Overdue review",
};

export const STATUS_TONE: Record<DocumentStatus, {
  /** Tailwind classes for the pill background + text colour. */
  className: string;
}> = {
  pending_verification: { className: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300" },
  verified: { className: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300" },
  expiring_soon: { className: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300" },
  expired: { className: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300" },
  review_due_soon: { className: "bg-sky-100 text-sky-800 dark:bg-sky-900/30 dark:text-sky-300" },
  overdue_review: { className: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300" },
};
