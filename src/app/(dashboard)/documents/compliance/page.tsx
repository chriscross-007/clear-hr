export const dynamic = "force-dynamic";

import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getEffectiveRightsForUser } from "@/lib/rights-resolver";
import { getComplianceRows, getSubtypesForCompliance } from "../compliance-actions";
import { ComplianceClient } from "./compliance-client";

// CLE-207 — Compliance dashboard. Aggregates every document that
// needs HR attention (expiring / expired / overdue / pending / not
// uploaded) across the scope granted by the caller's rights profile.

export default async function CompliancePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const resolved = await getEffectiveRightsForUser(user.id);
  if (!resolved || !resolved.rights.tabs.documents?.view) notFound();

  const [rowsRes, subtypesRes] = await Promise.all([
    getComplianceRows(),
    getSubtypesForCompliance(),
  ]);

  return (
    <ComplianceClient
      initialRows={rowsRes.success ? rowsRes.rows : []}
      initialError={rowsRes.success ? null : (rowsRes.error ?? null)}
      subtypes={subtypesRes.success ? subtypesRes.subtypes : []}
      crossUserAccess={resolved.rights.crossUserAccess}
    />
  );
}
