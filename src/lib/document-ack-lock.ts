// Once anyone has acknowledged a document, its file is locked: the
// bytes they read must never change underneath their acknowledgement.
// Replace is refused; a changed file has to be added as a new document
// (or, for org docs, published as a new version). Plain module — used
// by server actions and the details read.

import type { SupabaseClient } from "@supabase/supabase-js";

export const ACK_LOCKED_REPLACE_ERROR =
  "This document has been acknowledged, so its file can't be replaced. Add the new file as a new document instead.";

/** True when the document has any acknowledgement row — including ones
 *  voided by an earlier replace, since that file was read too. */
export async function hasAnyAcknowledgement(admin: SupabaseClient, documentId: string): Promise<boolean> {
  const { count } = await admin
    .from("document_acknowledgement")
    .select("id", { count: "exact", head: true })
    .eq("document_id", documentId);
  return (count ?? 0) > 0;
}
