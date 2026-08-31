export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getEffectiveRightsForUser } from "@/lib/rights-resolver";
import { getDocumentSubtypes } from "./subtype-actions";
import { DocumentSubtypesClient } from "./document-subtypes-client";

// CLE-205 — /settings/documents. Landing surface for Document
// Subtypes admin. More sub-routes (Org Documents CRUD, retention
// scheduling) will land here in CLE-208 + CLE-209.

export default async function DocumentsSettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const resolved = await getEffectiveRightsForUser(user.id);
  if (!resolved?.rights.canEditOrgSettings) redirect("/dashboard");

  const subtypes = await getDocumentSubtypes();

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <div>
        <h1 className="text-2xl font-bold">Documents — Subtypes</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Configure the subtypes that classify each document (contract, evidence,
          absence attachment, etc.) and the rules that govern them — who can upload,
          whether HR must verify, expiry, retention.
        </p>
      </div>
      <DocumentSubtypesClient initialSubtypes={subtypes} />
    </div>
  );
}
