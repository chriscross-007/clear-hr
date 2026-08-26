export const dynamic = "force-dynamic";

import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// CLE-196a — The legacy Rights Profiles UI (based on admin_profiles /
// employee_profiles + the members.permissions JSONB blob) has been
// retired. The new Rights Profiles v2 editor lands in CLE-197 at
// /settings/rights-profiles. During the transition this route shows a
// placeholder so no writes hit the old permissions system while the
// domain-batched read swaps land (CLE-196b).

export default async function RightsProfilesRetiredPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <div className="mx-auto max-w-2xl space-y-4 rounded-lg border bg-card p-6">
      <h1 className="text-xl font-semibold">Rights Profiles are being redesigned</h1>
      <p className="text-sm text-muted-foreground leading-relaxed">
        We&apos;re rolling out a new Rights Profiles system with four ranks
        (Admin, HR, Manager, Employee), a per-tab access matrix, and
        sensitive-field redaction. The new editor arrives shortly.
      </p>
      <p className="text-sm text-muted-foreground leading-relaxed">
        While the migration is in progress, this legacy editor is disabled
        so profile edits don&apos;t land in the wrong place. Everyone currently
        keeps the rights they had before. See CLE-195 for the full plan.
      </p>
      <div>
        <Link
          href="/settings"
          className="text-sm text-primary underline underline-offset-2"
        >
          Back to Settings
        </Link>
      </div>
    </div>
  );
}
