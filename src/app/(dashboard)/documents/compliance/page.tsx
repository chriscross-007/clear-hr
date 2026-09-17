export const dynamic = "force-dynamic";

import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getEffectiveRightsForUser } from "@/lib/rights-resolver";
import { getComplianceRows, getSubtypesForCompliance } from "../compliance-actions";
import { getOrgAcknowledgementCoverage } from "../acknowledgement-actions";
import { ComplianceClient } from "./compliance-client";
import { AcknowledgementsClient } from "./acknowledgements-client";

// CLE-207 — Compliance dashboard. Aggregates every document that
// needs HR attention (expiring / expired / overdue / pending / not
// uploaded) across the scope granted by the caller's rights profile.
//
// CLE-219 (Ticket D) — the page is now tabbed: "Management" (the
// original attention list) and "Acknowledgements" (per-doc coverage
// of ack-required subtypes). Tab is URL-driven via `?tab=…`; both
// tabs' data is fetched server-side up front so switching is snappy.

export default async function CompliancePage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const resolved = await getEffectiveRightsForUser(user.id);
  if (!resolved || !resolved.rights.tabs.documents?.view) notFound();

  const { tab } = await searchParams;
  const activeTab: "management" | "acknowledgements" =
    tab === "acknowledgements" ? "acknowledgements" : "management";

  const [rowsRes, subtypesRes, ackRes] = await Promise.all([
    getComplianceRows(),
    getSubtypesForCompliance(),
    getOrgAcknowledgementCoverage(),
  ]);

  if (activeTab === "acknowledgements") {
    return (
      <AcknowledgementsClient
        initialRows={ackRes.success ? ackRes.rows : []}
        initialError={ackRes.success ? null : (ackRes.error ?? null)}
        subtypes={subtypesRes.success ? subtypesRes.subtypes : []}
        crossUserAccess={resolved.rights.crossUserAccess}
        canUpdateDocs={resolved.rights.tabs.documents?.update === true}
      />
    );
  }

  return (
    <ComplianceClient
      initialRows={rowsRes.success ? rowsRes.rows : []}
      initialError={rowsRes.success ? null : (rowsRes.error ?? null)}
      subtypes={subtypesRes.success ? subtypesRes.subtypes : []}
      crossUserAccess={resolved.rights.crossUserAccess}
    />
  );
}
