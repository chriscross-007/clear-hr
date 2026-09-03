export const dynamic = 'force-dynamic';

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AuditClient } from "./audit-client";

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

  // Fetch initial audit log entries (most recent 50)
  const { data: entries } = await supabase
    .from("audit_log")
    .select("*")
    .eq("organisation_id", membership.organisation_id)
    .order("created_at", { ascending: false })
    .limit(50);

  return (
    <AuditClient
      initialEntries={entries ?? []}
      editors={(editors ?? []).map((e) => ({
        id: e.id,
        name: `${e.first_name} ${e.last_name}`,
      }))}
    />
  );
}
