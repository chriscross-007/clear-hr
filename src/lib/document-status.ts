// CLE-207 — Pure status derivation. Called by list responses and
// the compliance dashboard so callers see a single truth. No
// server-only dependencies — safe to import from client components
// that want to compute status locally on freshly-edited rows.

export type DocumentStatus =
  | "not_applicable"
  | "pending_verification"
  | "verified"
  | "expiring_soon"
  | "expired"
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
 * Derive the display status of a document. Order of precedence:
 *   1. Subtype doesn't require verification → not_applicable.
 *   2. Not yet verified → pending_verification.
 *   3. expires_on ≤ today → expired.
 *   4. next_review_on ≤ today → overdue_review.
 *   5. Either expires_on or next_review_on within 30 days → expiring_soon.
 *   6. Otherwise → verified.
 */
export function deriveDocumentStatus(inp: StatusInputs): DocumentStatus {
  if (!inp.requiresVerification) return "not_applicable";
  const today = inp.today ?? new Date().toISOString().slice(0, 10);

  if (!inp.verifiedOn) return "pending_verification";

  if (inp.expiresOn !== null && inp.expiresOn <= today) return "expired";
  if (inp.nextReviewOn !== null && inp.nextReviewOn <= today) return "overdue_review";

  const soon = addDaysIso(today, EXPIRING_SOON_WINDOW_DAYS);
  if (inp.expiresOn !== null && inp.expiresOn <= soon) return "expiring_soon";
  if (inp.nextReviewOn !== null && inp.nextReviewOn <= soon) return "expiring_soon";

  return "verified";
}

function addDaysIso(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export const STATUS_LABEL: Record<DocumentStatus, string> = {
  not_applicable: "N/A",
  pending_verification: "Pending verification",
  verified: "Verified",
  expiring_soon: "Expiring soon",
  expired: "Expired",
  overdue_review: "Overdue review",
};

export const STATUS_TONE: Record<DocumentStatus, {
  /** Tailwind classes for the pill background + text colour. */
  className: string;
}> = {
  not_applicable: { className: "bg-muted text-muted-foreground" },
  pending_verification: { className: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300" },
  verified: { className: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300" },
  expiring_soon: { className: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300" },
  expired: { className: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300" },
  overdue_review: { className: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300" },
};
