// CLE-233 — Document versions + Archive: shared rules.
//
// Archived = "was valid, keep the record". Read-only, hidden from members
// (owners of member docs; non-managers of org docs), and never counted as
// needing attention or acknowledgement. Plain module — imported by server
// actions, impl siblings, mobile routes and the nightly job.

import type { SupabaseClient } from "@supabase/supabase-js";

/** Kinds an admin can archive. Other documents rely on Trash. */
export const ARCHIVABLE_TYPES: ReadonlySet<string> = new Set([
  "organisation_document",
  "contract",
  "certificate",
  "evidence",
]);

/** Kinds that support "Publish new version" (the old one is archived). */
export const VERSIONABLE_TYPES: ReadonlySet<string> = new Set(["organisation_document", "contract"]);

export function canArchiveType(type: string | null | undefined): boolean {
  return !!type && ARCHIVABLE_TYPES.has(type);
}

export function canVersionType(type: string | null | undefined): boolean {
  return !!type && VERSIONABLE_TYPES.has(type);
}

export const ARCHIVED_READ_ONLY_ERROR = "This document is archived. Restore it before making changes.";

/** True when the document exists and is archived. Write paths call this
 *  first and refuse with `ARCHIVED_READ_ONLY_ERROR`. */
export async function isDocumentArchived(admin: SupabaseClient, documentId: string): Promise<boolean> {
  const { data } = await admin.from("document").select("archived_at").eq("id", documentId).maybeSingle();
  return !!(data as { archived_at?: string | null } | null)?.archived_at;
}
