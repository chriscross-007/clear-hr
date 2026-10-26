// CLE-231 — Employment subtypes can be hidden from the member they
// belong to (`document_subtype.visible_to_member = false`, e.g.
// disciplinary investigation notes). One rule, one place:
//
//   A member-scope document is hidden from a caller when the caller IS
//   the member it belongs to AND its subtype has visible_to_member =
//   false. Everyone else (HR / managers with documents.view on the
//   target) sees it as normal.
//
// The rule applies to the owner regardless of their rights profile —
// an HR admin cannot read HR-only notes held on their own record.
// Every self-facing reader (lists, detail, signed URL, activity,
// acknowledgements) and every write path that takes a document id must
// apply it. A hidden doc reads as "Document not found".
//
// Plain module (not "use server") — imported by action files, impl
// siblings and mobile routes alike.

import type { SupabaseClient } from "@supabase/supabase-js";

type SubtypeEmbed =
  | { visible_to_member?: boolean | null }
  | { visible_to_member?: boolean | null }[]
  | null
  | undefined;

/** True when a subtype embed carries `visible_to_member = false`. */
export function subtypeHiddenFromMember(st: SubtypeEmbed): boolean {
  const obj = Array.isArray(st) ? (st[0] ?? null) : st;
  return obj?.visible_to_member === false;
}

/** Pure check for rows already in hand. CLE-233 — an archived document
 *  is hidden from its owner too (pass `archived_at` in the row). */
export function isHiddenFromCaller(
  doc: { owner_scope?: string | null; owner_id?: string | null; document_subtype?: SubtypeEmbed; archived_at?: string | null },
  callerMemberId: string,
): boolean {
  return (
    doc.owner_scope === "member" &&
    doc.owner_id === callerMemberId &&
    (subtypeHiddenFromMember(doc.document_subtype) || !!doc.archived_at)
  );
}

/** Fetching check for write paths that only hold a document id. */
export async function isDocumentHiddenFromCaller(
  admin: SupabaseClient,
  documentId: string,
  callerMemberId: string,
): Promise<boolean> {
  const { data } = await admin
    .from("document")
    .select("owner_scope, owner_id, archived_at, document_subtype!subtype_id(visible_to_member)")
    .eq("id", documentId)
    .maybeSingle();
  if (!data) return false;
  return isHiddenFromCaller(
    data as unknown as {
      owner_scope: string | null;
      owner_id: string | null;
      archived_at: string | null;
      document_subtype: SubtypeEmbed;
    },
    callerMemberId,
  );
}
