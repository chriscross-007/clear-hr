export const dynamic = "force-dynamic";

// CLE-216 follow-up — "My Documents" top-level page.
//
// Visible to every authenticated member regardless of shell. Resolves
// the caller's own memberId + name via the Rights Profiles v2
// resolver, then hands that off to the shared <MyDocumentsCard>. The
// card mirrors the admin Required Documents card's display shape but
// omits every admin-only affordance (see the component header for
// specifics).
//
// The resolver already RLS-scopes reads to the caller's own docs
// (crossUserAccess='self' passes the memberId=self check in
// `canViewTarget`), so an admin loading this page sees only their
// own documents — same UX as an employee. That's intentional: the
// route is "my documents", not "somebody's documents".

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { getEffectiveRightsForUser } from "@/lib/rights-resolver";
import { MyDocumentsCard } from "@/components/documents/my-documents-card";

export default async function MyDocumentsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const resolved = await getEffectiveRightsForUser(user.id);
  if (!resolved) redirect("/organisation-setup");

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

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <h1 className="text-2xl font-semibold">My Documents</h1>
      <MyDocumentsCard memberId={resolved.ctx.memberId} memberName={memberName} />
    </div>
  );
}
