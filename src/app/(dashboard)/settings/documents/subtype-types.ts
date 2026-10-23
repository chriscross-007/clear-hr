// CLE-205 — Sibling to `subtype-actions.ts`. Every export in a
// "use server" file must be an async function, so the enum arrays and
// DTO types live here so clients can import them without pulling in
// the server-only action bodies.

export const DOCUMENT_TYPES = [
  "contract",
  "certificate",
  "evidence",
  "attachment",
  "organisation_document",
] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

/**
 * Every document type belongs to one scope.
 *   - `member` → the doc is owned by / attached to a specific member.
 *   - `organisation` → the doc is org-wide (Employee Handbook, policies,
 *     procedures). Only one type has this scope: `organisation_document`.
 *
 * The scope drives which flags are relevant in the subtype editor:
 * `employee_can_upload`, `requires_verification`, and
 * `expected_for_every_member` are meaningless at org scope and are
 * hidden + forced false when the scope is `organisation`.
 */
export type DocumentScope = "member" | "organisation";

export const SCOPE_BY_TYPE: Record<DocumentType, DocumentScope> = {
  contract: "member",
  certificate: "member",
  evidence: "member",
  attachment: "member",
  organisation_document: "organisation",
};

export function scopeForType(type: DocumentType): DocumentScope {
  return SCOPE_BY_TYPE[type];
}

/**
 * CLE-231 — User-facing names for the system types. The `contract` key
 * is kept internally (no data migration) but is shown as "Employment":
 * documents the organisation issues to a member (contract, reviews,
 * disciplinary). Use these everywhere instead of local label maps.
 */
export const DOCUMENT_TYPE_LABEL: Record<DocumentType, string> = {
  contract: "Employment",
  certificate: "Certificate",
  evidence: "RTW Evidence",
  attachment: "Attachment",
  organisation_document: "Organisation document",
};

/** CLE-231 — only certificate subtypes can be required of a member
 *  (RTW evidence is required via the member's RTW setting instead). */
export function canBeRequired(type: DocumentType | string): boolean {
  return type === "certificate";
}

/** CLE-231 — only Employment (`contract`) subtypes carry the
 *  "Visible to the member" switch; everything else is always visible
 *  to the member it belongs to. */
export function hasMemberVisibilitySwitch(type: DocumentType | string): boolean {
  return type === "contract";
}

/** CLE-234 — Verify ("this copy is genuine") only applies to documents
 *  a member can supply: Certifications (certificate + RTW evidence) and
 *  Other (attachment). Employment and Organisation documents are issued
 *  by the organisation, so there is nothing to verify. */
export function canBeVerified(type: DocumentType | string): boolean {
  return type === "certificate" || type === "evidence" || type === "attachment";
}

/** CLE-234 — Review interval choices offered in the subtype editor.
 *  `null` = None (review is ad hoc: no date seeded, an admin may set
 *  one by hand on any document). */
export const REVIEW_INTERVAL_OPTIONS: number[] = [1, 2, 3, 6, 9, 12, 18, 24, 36, 48, 60];

export function reviewIntervalLabel(months: number | null): string {
  if (months === null) return "None (ad hoc)";
  if (months % 12 === 0) {
    const y = months / 12;
    return `${months} months (${y} year${y === 1 ? "" : "s"})`;
  }
  return `${months} month${months === 1 ? "" : "s"}`;
}

export const RETENTION_CLASSES = [
  "contract",
  "certificate",
  "evidence",
  "policy",
  "handbook",
  "absence_attachment",
  "right_to_work",
  "payroll",
  "other",
] as const;
export type RetentionClass = (typeof RETENTION_CLASSES)[number];

export interface DocumentSubtypeDto {
  id: string;
  type: DocumentType;
  name: string;
  sortOrder: number;
  employeeCanUpload: boolean;
  retentionClass: RetentionClass;
  expiryRequired: boolean;
  requiresVerification: boolean;
  reviewPeriodMonths: number | null;
  trackablePerMember: boolean;
  requiresAcknowledgement: boolean;
  /** CLE-231 — Employment subtypes only; false hides docs of this
   *  subtype from the member they're about (HR-only). */
  visibleToMember: boolean;
}

export interface DocumentSubtypeWritePayload {
  type: DocumentType;
  name: string;
  employeeCanUpload: boolean;
  retentionClass: RetentionClass;
  expiryRequired: boolean;
  requiresVerification: boolean;
  reviewPeriodMonths: number | null;
  trackablePerMember: boolean;
  requiresAcknowledgement: boolean;
  /** CLE-231 — Employment subtypes only; false hides docs of this
   *  subtype from the member they're about (HR-only). */
  visibleToMember: boolean;
}
