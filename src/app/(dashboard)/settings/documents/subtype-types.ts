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
  defaultExpiryMonths: number | null;
  requiresVerification: boolean;
  reviewPeriodMonths: number | null;
  expectedForEveryMember: boolean;
  trackablePerMember: boolean;
  requiresSignature: boolean;
}

export interface DocumentSubtypeWritePayload {
  type: DocumentType;
  name: string;
  employeeCanUpload: boolean;
  retentionClass: RetentionClass;
  expiryRequired: boolean;
  defaultExpiryMonths: number | null;
  requiresVerification: boolean;
  reviewPeriodMonths: number | null;
  expectedForEveryMember: boolean;
  trackablePerMember: boolean;
  requiresSignature: boolean;
}
