// CLE — Shared upload limits + MIME allow-lists.
//
// Collapses the ~six copies that previously lived next to each
// upload call site. There are three semantically-distinct allow-
// lists (document stores, conversation attachments, camera captures)
// and one shared size cap. Keep this file the single source of
// truth; any new upload path should import from here rather than
// re-declaring.

export const MAX_DOCUMENT_SIZE = 10 * 1024 * 1024; // 10 MB

/**
 * The one "document" MIME set — used everywhere a user uploads a
 * file: member documents, organisation documents, and conversation
 * attachments. Covers images (JPEG/PNG/WebP/GIF), PDF, Word, Excel
 * and plain text. CSV is deliberately excluded; it's just text with
 * commas, and anyone who needs to attach one can rename it to `.txt`
 * (or paste it inline).
 */
export const ALLOWED_DOCUMENT_CONTENT_TYPES = [
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
export type AllowedDocumentContentType = (typeof ALLOWED_DOCUMENT_CONTENT_TYPES)[number];

/**
 * Camera capture flows (ad-hoc mobile upload + capture_task queue).
 * Deliberately narrow: a phone camera emits JPEG, PNG, or HEIC —
 * no reason to accept anything else here. Rejecting non-camera
 * types at the API boundary prevents a client bug from stashing an
 * arbitrary file through a camera-only endpoint.
 */
export const ALLOWED_CAMERA_CAPTURE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/heic",
] as const;
export type AllowedCameraCaptureType = (typeof ALLOWED_CAMERA_CAPTURE_TYPES)[number];

export const MEMBER_DOCUMENTS_BUCKET = "member-documents";
export const ORG_DOCUMENTS_BUCKET = "org-documents";
