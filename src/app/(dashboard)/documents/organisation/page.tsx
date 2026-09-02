export const dynamic = "force-dynamic";

import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getEffectiveRightsForUser } from "@/lib/rights-resolver";
import { listOrgDocuments } from "./org-document-actions";
import { OrganisationDocsClient } from "@/app/(dashboard)/settings/documents/organisation/organisation-docs-client";

// CLE-208 — Employee-visible Organisation Documents read view.
// Reuses the admin client with `canEdit={false}` — same list + view
// / download UI, no upload / edit / delete affordances.

export default async function OrganisationDocumentsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const resolved = await getEffectiveRightsForUser(user.id);
  if (!resolved?.rights.canViewOrganisationDocuments) notFound();

  const { rows } = await listOrgDocuments();

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <div>
        <h1 className="text-2xl font-bold">Organisation Documents</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Policies, handbook and procedures. Click a document to preview or download.
        </p>
      </div>
      <OrganisationDocsClient initialRows={rows} canEdit={false} />
    </div>
  );
}
