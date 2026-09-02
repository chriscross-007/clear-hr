export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getEffectiveRightsForUser } from "@/lib/rights-resolver";
import { listOrgDocuments } from "@/app/(dashboard)/documents/organisation/org-document-actions";
import { OrganisationDocsClient } from "./organisation-docs-client";

// CLE-208 — Settings → Documents → Organisation Documents.

export default async function OrgDocumentsSettingsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const resolved = await getEffectiveRightsForUser(user.id);
  if (!resolved?.rights.canEditOrgSettings) redirect("/dashboard");

  const { rows } = await listOrgDocuments();

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <div>
        <h1 className="text-2xl font-bold">Documents — Organisation</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Publish policies, the handbook, procedures and any other document meant for
          all members to read. Employees with the right can view + download.
        </p>
      </div>
      <OrganisationDocsClient initialRows={rows} canEdit={true} />
    </div>
  );
}
