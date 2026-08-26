export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getEffectiveRightsForUser } from "@/lib/rights-resolver";
import { getRightsProfiles } from "./actions";
import { RightsProfilesClient } from "./rights-profiles-client";

// CLE-197 — /settings/rights-profiles.
// Owner-only surface for managing the four ranks (Admin/HR/Manager/
// Employee) and any additional per-rank profiles. Reads live from
// `rights_profiles` via server actions; saves apply immediately to
// every member on the affected profile.

export default async function RightsProfilesSettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const resolved = await getEffectiveRightsForUser(user.id);
  if (!resolved?.rights.canEditRightsProfiles) redirect("/dashboard");

  const profiles = await getRightsProfiles();

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <div>
        <h1 className="text-2xl font-bold">Rights Profiles</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Four ranks control who can act on whom. Add extra profiles at any rank for
          finer-grained access. Changes apply immediately to every member on the
          affected profile.
        </p>
      </div>
      <RightsProfilesClient initialProfiles={profiles} />
    </div>
  );
}
