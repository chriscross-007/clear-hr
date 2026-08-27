export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getEffectiveRightsForUser } from "@/lib/rights-resolver";
import { getRightsProfiles } from "../actions";
import { CompareClient } from "./compare-client";

// CLE-199 — Comparison view. Renders every User Rights profile as a
// column and every right as a row so admins can spot differences at
// a glance. Filter toggle collapses to rows-where-profiles-differ.

export default async function CompareRightsProfilesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const resolved = await getEffectiveRightsForUser(user.id);
  if (!resolved?.rights.canEditRightsProfiles) redirect("/dashboard");

  const profiles = await getRightsProfiles();

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Compare profiles</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Every right, every profile, side by side. Toggle &ldquo;Only
            differences&rdquo; to hide rows where all profiles agree.
          </p>
        </div>
      </div>
      <CompareClient profiles={profiles} />
    </div>
  );
}
