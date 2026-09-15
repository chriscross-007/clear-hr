export const dynamic = 'force-dynamic';

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AuditClient, type AuditEntry } from "./audit-client";

export default async function AuditPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: membership } = await supabase
    .from("members")
    .select("organisation_id")
    .eq("user_id", user.id)
    .limit(1)
    .single();

  if (!membership) redirect("/organisation-setup");

  // Only owners and admins can view audit trail
  const { getEffectiveRightsForUser } = await import("@/lib/rights-resolver");
  const resolved = await getEffectiveRightsForUser(user.id);
  if (!resolved?.rights.canViewAuditLogs) {
    redirect("/employees");
  }

  // Fetch editors (admin-rank members) for the filter
  const { data: editors } = await supabase
    .from("members")
    .select("id, first_name, last_name, rights_profiles!inner(rank)")
    .eq("organisation_id", membership.organisation_id)
    .eq("rights_profiles.rank", "admin")
    .order("first_name");

  // Fetch a large window of audit entries so the client can paginate
  // through them. PostgREST's default `db-max-rows` caps a single
  // `.select()` at 1000 rows regardless of the `.limit()` we ask for
  // — hence chunk-fetch in 1000-row pages until the batch comes back
  // short (natural end) or we hit our own 10k safety cap. If a
  // future org's rolling audit needs more we'll move to proper
  // server-side paging with URL params.
  const CHUNK = 1000;
  const MAX_ROWS = 10000;
  const entries: AuditEntry[] = [];
  for (let offset = 0; offset < MAX_ROWS; offset += CHUNK) {
    const { data: chunk } = await supabase
      .from("audit_log")
      .select("*")
      .eq("organisation_id", membership.organisation_id)
      .order("created_at", { ascending: false })
      .range(offset, offset + CHUNK - 1);
    if (!chunk || chunk.length === 0) break;
    entries.push(...(chunk as unknown as AuditEntry[]));
    if (chunk.length < CHUNK) break;
  }

  return (
    <AuditClient
      initialEntries={entries}
      editors={(editors ?? []).map((e) => ({
        id: e.id,
        name: `${e.first_name} ${e.last_name}`,
      }))}
    />
  );
}
