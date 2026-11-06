export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getEffectiveRightsForUser } from "@/lib/rights-resolver";
import { getDocumentSubtypes } from "./subtype-actions";
import { DocumentSubtypesClient } from "./document-subtypes-client";
import { RunSweepButton } from "./run-sweep-button";
import { DocumentTemplatesClient } from "./document-templates-client";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

// CLE-205 — /settings/documents. Two tabs (2026-11-06):
//   • Document Definitions — subtypes + their rules, and the sweep button
//   • Document Templates   — Word templates (CLE-237) + Word panel (CLE-238)
// `?tab=templates` opens the second tab.

export default async function DocumentsSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab } = await searchParams;
  const initialTab = tab === "templates" ? "templates" : "definitions";
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
      <h1 className="text-2xl font-bold">Documents</h1>
      <Tabs defaultValue={initialTab} className="w-full">
        <TabsList>
          <TabsTrigger value="definitions">Document Definitions</TabsTrigger>
          <TabsTrigger value="templates">Document Templates</TabsTrigger>
        </TabsList>

        <TabsContent value="definitions" className="mt-4 space-y-6">
          <p className="text-sm text-muted-foreground">
            Configure the subtypes that classify each document (contract, evidence,
            absence attachment, etc.) and the rules that govern them — who can upload,
            whether HR must verify, expiry, retention.
          </p>
          <DocumentSubtypesClient initialSubtypes={subtypes} />
          <RunSweepButton />
        </TabsContent>

        <TabsContent value="templates" className="mt-4">
          {/* CLE-237 — Word templates that produce member documents. */}
          <DocumentTemplatesClient />
        </TabsContent>
      </Tabs>
    </div>
  );
}
