export const dynamic = "force-dynamic";

import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getEffectiveRightsForUser } from "@/lib/rights-resolver";
import { DocsClient } from "./docs-client";

// CLE-206 — Per-Member Documents. Reads/writes now go through the
// `document` table via the action layer in ./document-actions.ts. The
// legacy `member_documents`-backed viewer this replaced was
// absence-attachment-only.

export default async function DocsPage({
  params,
}: {
  params: Promise<{ memberId: string }>;
}) {
  const { memberId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const resolved = await getEffectiveRightsForUser(user.id);
  if (!resolved || !resolved.rights.tabs.documents?.view) notFound();
  const canUpdate = resolved.rights.tabs.documents?.update === true;

  return (
    <DocsClient
      memberId={memberId}
      canUpdate={canUpdate}
      // Per-member Trash follows documents.update — anyone who can
      // delete a member's docs can also restore them.
      canManageDeleted={canUpdate}
      canForceDelete={resolved.rights.canForceDeleteDocuments}
    />
  );
}
