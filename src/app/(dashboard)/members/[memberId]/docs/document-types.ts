// CLE-206 — Types shared between the server actions and the client.

import type { DocumentStatus } from "@/lib/document-status";

export interface MemberDocumentRow {
  id: string;
  fileName: string;
  fileSize: number;
  contentType: string;
  type: string;
  subtypeId: string | null;
  subtypeName: string | null;
  /** Whether the subtype requires HR to sign off. Drives status +
   *  whether the Verify/Renew UI shows on this row. */
  requiresVerification: boolean;
  /** ISO date the doc was verified. NULL when subtype requires
   *  verification but nobody's signed off yet. */
  verifiedOn: string | null;
  verifiedBy: string | null;
  nextReviewOn: string | null;
  expiresOn: string | null;
  retentionClass: string;
  disposalDate: string | null;
  uploadedBy: string;
  uploadedAt: string;
  /** Derived per-row status. Consumers should not recompute. */
  status: DocumentStatus;
}

export interface TrashedMemberDocumentRow extends MemberDocumentRow {
  queuedAt: string;
  queuedBy: string | null;
  forceDeleteReason: string | null;
}

export const ALLOWED_CONTENT_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain",
] as const;

export const MAX_DOCUMENT_SIZE = 10 * 1024 * 1024; // 10 MB

export const STORAGE_BUCKET = "member-documents";
