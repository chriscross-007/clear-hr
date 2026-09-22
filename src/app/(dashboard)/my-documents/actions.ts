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

// CLE-227 — `OtherMemberDocumentRow` moved to `./actions-impl`;
// consumers import the type from the impl sibling. Not re-exported
// here because Turbopack's production build fails on `export type`
// from a `"use server"` file.

export async function getMyOtherMemberDocuments(): Promise<
  { success: true; rows: OtherMemberDocumentRow[] } | { success: false; error: string }
> {
  const caller = await buildDocumentsCallerFromCookies();
  if (!caller) return { success: false, error: "Not authenticated" };
  return _getMyOtherMemberDocuments(caller);
}
