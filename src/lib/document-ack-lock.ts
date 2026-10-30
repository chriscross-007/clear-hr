// Once anyone has acknowledged a document, its file is locked: the
// bytes they read must never change underneath their acknowledgement.
// Replace is refused; a changed file has to be added as a new document
// (or, for org docs, published as a new version). Plain module — used
// by server actions and the details read.
//
// CLE-236 — the same lock applies once a document is out for signature,
// has been signed by anyone, or is itself a signed copy.

import type { SupabaseClient } from "@supabase/supabase-js";

export const ACK_LOCKED_REPLACE_ERROR =
  "This document has been acknowledged or signed (or is waiting for a signature), so its file can't be replaced. Add the new file as a new document or publish a new version instead.";

/** True when the document's file must not change: it has any
 *  acknowledgement row (including ones voided by an earlier replace,
 *  since that file was read too), any signature request (open or
 *  finished) or is a signed copy. */
export async function hasAnyAcknowledgement(admin: SupabaseClient, documentId: string): Promise<boolean> {
  const [{ count: acks }, { count: requests }, { data: doc }] = await Promise.all([
    admin
      .from("document_acknowledgement")
      .select("id", { count: "exact", head: true })
      .eq("document_id", documentId),
    admin
      .from("document_signature_request")
      .select("id", { count: "exact", head: true })
      .eq("document_id", documentId)
      .in("status", ["pending", "completed"]),
    admin.from("document").select("signed_request_id").eq("id", documentId).maybeSingle(),
  ]);
  if ((acks ?? 0) > 0) return true;
  if ((requests ?? 0) > 0) {
    // An 'audience' request only locks once somebody has actually signed.
    const { count: sigs } = await admin
      .from("document_signature")
      .select("id", { count: "exact", head: true })
      .eq("document_id", documentId)
      .eq("status", "signed");
    const { count: openSends } = await admin
      .from("document_signature_request")
      .select("id", { count: "exact", head: true })
      .eq("document_id", documentId)
      .neq("mode", "audience")
      .in("status", ["pending", "completed"]);
    if ((sigs ?? 0) > 0 || (openSends ?? 0) > 0) return true;
  }
  return !!(doc as { signed_request_id?: string | null } | null)?.signed_request_id;
}
