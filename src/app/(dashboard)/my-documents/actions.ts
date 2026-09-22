"use server";

// CLE-221 — Server action powering the "My other documents" card on
// the /my-documents "My Documents" tab. Full-behaviour docstring +
// inclusion rules moved to `actions-impl.ts` alongside the impl.
//
// CLE-227 — This file is now a thin cookies-auth passthrough over
// `_getMyOtherMemberDocuments` in the impl sibling. The impl is
// shared with the mobile API-route wrapper at
// `/api/mobile/documents/other`, which uses the bearer-auth builder.

import { buildDocumentsCallerFromCookies } from "@/lib/documents-caller";
import {
  _getMyOtherMemberDocuments,
  type OtherMemberDocumentRow,
} from "./actions-impl";

// Re-export the DTO type so downstream consumers can keep importing
// from `@/app/(dashboard)/my-documents/actions` — the migration to
// the impl sibling is invisible to them.
export type { OtherMemberDocumentRow };

export async function getMyOtherMemberDocuments(): Promise<
  { success: true; rows: OtherMemberDocumentRow[] } | { success: false; error: string }
> {
  const caller = await buildDocumentsCallerFromCookies();
  if (!caller) return { success: false, error: "Not authenticated" };
  return _getMyOtherMemberDocuments(caller);
}
