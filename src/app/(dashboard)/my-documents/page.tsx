export const dynamic = "force-dynamic";

// CLE-216 follow-up / CLE-220 — "My Documents" top-level page.
//
// Visible to every authenticated member regardless of shell. Resolves
// the caller's own memberId + name via the Rights Profiles v2
// resolver, then hands off to the shared <MyDocumentsClient> which
// hosts two tabs:
//   * My Documents — the caller's per-member required-docs list.
//   * Org Documents — the org-wide docs list (only visible when the
//     caller's profile grants `can_view_organisation_documents`).
//
// Tab state is URL-driven (`?tab=my|org`, default `my`).
//
// The resolver already RLS-scopes reads to the caller's own docs
// (crossUserAccess='self' passes the memberId=self check in
// `canViewTarget`), so an admin loading this page sees only their
// own documents — same UX as an employee. That's intentional: the
// route is "my documents", not "somebody's documents". Admins can
// still land here directly (or after using the view-mode toggle) and
// preview the employee-facing surface.

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { getEffectiveRightsForUser } from "@/lib/rights-resolver";
import { MyDocumentsClient } from "@/components/documents/my-documents-client";
import { listOrgDocuments, type OrgDocumentRow } from "@/app/(dashboard)/documents/organisation/org-document-actions";

export default async function MyDocumentsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const resolved = await getEffectiveRightsForUser(user.id);
  if (!resolved) redirect("/organisation-setup");

  const sp = await searchParams;
  const initialTab: "my" | "org" = sp.tab === "org" ? "org" : "my";

  // Look up the caller's display name for the New Document dialog's
  // header. Cheapest to do here with the admin client — the resolver
  // already vouched for the session so there's no security angle to
  // routing this via RLS.
  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
  const { data: me } = await admin
    .from("members")
    .select("first_name, last_name")
    .eq("id", resolved.ctx.memberId)
    .single();
  const memberName = `${me?.first_name ?? ""} ${me?.last_name ?? ""}`.trim() || "You";

  // Fetch initial org-doc rows for SSR of the Org tab. Skipped when
  // the caller can't view org docs — the tab strip in the client
  // degrades to a single "My Documents" trigger.
  const canViewOrgDocs = resolved.rights.canViewOrganisationDocuments;
  let initialOrgRows: OrgDocumentRow[] = [];
  if (canViewOrgDocs) {
    const orgRes = await listOrgDocuments();
    if (orgRes.success) initialOrgRows = orgRes.rows;
  }

  return (
    <div className="mx-auto max-w-5xl p-6">
      <MyDocumentsClient
        memberId={resolved.ctx.memberId}
        memberName={memberName}
        initialTab={initialTab}
        canViewOrgDocs={canViewOrgDocs}
        initialOrgRows={initialOrgRows}
      />
    </div>
  );
}
