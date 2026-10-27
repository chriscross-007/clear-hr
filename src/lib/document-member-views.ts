// "{Member} viewed" — when a member last opened each of a set of documents.
//
// Opening a document (web dialog preview, download, mobile) goes through the
// signed-URL actions, which write a `document.viewed` / `document.downloaded`
// audit row with actor_id = the caller. So the member's last view of a
// document is the newest such audit row where actor_id is that member.
// Used by the admin grids on a member's Documents page (Certifications,
// Employment, Other, Organisation). Plain module, no "use server".

import type { SupabaseClient } from "@supabase/supabase-js";

const VIEW_ACTIONS = ["document.viewed", "document.downloaded"];
const CHUNK = 100;
const PAGE = 1000;

/** Map of documentId → ISO timestamp of the member's latest view. Documents
 *  the member has never opened are absent. */
export async function loadMemberLastViewed(
  admin: SupabaseClient,
  organisationId: string,
  memberId: string,
  documentIds: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const ids = Array.from(new Set(documentIds));
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await admin
        .from("audit_log")
        .select("target_id, created_at")
        .eq("organisation_id", organisationId)
        .eq("actor_id", memberId)
        .in("action", VIEW_ACTIONS)
        .in("target_id", chunk)
        .order("created_at", { ascending: false })
        .range(from, from + PAGE - 1);
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as { target_id: string; created_at: string }[];
      for (const r of rows) {
        if (!out.has(r.target_id)) out.set(r.target_id, r.created_at);
      }
      if (rows.length < PAGE) break;
    }
  }
  return out;
}
