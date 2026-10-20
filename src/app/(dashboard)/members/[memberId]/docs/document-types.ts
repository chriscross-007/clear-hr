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
  /** Derived per-row statuses (possibly multiple — CLE-211 follow-up).
   *  Empty array means "no verification workflow applies". Consumers
   *  should not recompute — treat this as the single source of truth. */
  statuses: DocumentStatus[];
  /** Where the file came from — 'upload' via web file-picker or
   *  'photo' via the mobile camera flow (either web-queued or
   *  mobile-initiated ad-hoc). Drives the Source column icon. */
  captureSource: "upload" | "photo";
  /** CLE-231 — false when the subtype is an HR-only Employment kind
   *  (`document_subtype.visible_to_member = false`). Owners never
   *  receive such rows; admin lists use it to mark them "HR only". */
  visibleToMember: boolean;
}

export interface TrashedMemberDocumentRow extends MemberDocumentRow {
  queuedAt: string;
  queuedBy: string | null;
  forceDeleteReason: string | null;
}

// Upload limits + MIME allow-lists live in `@/lib/document-limits`.
// Re-exported here under the names existing member-doc callers use.
import {
  ALLOWED_DOCUMENT_CONTENT_TYPES,
  MAX_DOCUMENT_SIZE as _MAX_DOCUMENT_SIZE,
  MEMBER_DOCUMENTS_BUCKET,
} from "@/lib/document-limits";

export const ALLOWED_CONTENT_TYPES = ALLOWED_DOCUMENT_CONTENT_TYPES;
export const MAX_DOCUMENT_SIZE = _MAX_DOCUMENT_SIZE;
export const STORAGE_BUCKET = MEMBER_DOCUMENTS_BUCKET;
