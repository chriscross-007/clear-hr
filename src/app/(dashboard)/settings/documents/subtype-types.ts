// CLE-205 — Sibling to `subtype-actions.ts`. Every export in a
// "use server" file must be an async function, so the enum arrays and
// DTO types live here so clients can import them without pulling in
// the server-only action bodies.

export const DOCUMENT_TYPES = [
  "contract",
  "certificate",
  "evidence",
  "policy",
  "handbook",
  "attachment",
  "other",
] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

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
  requiresSignature: boolean;
}
