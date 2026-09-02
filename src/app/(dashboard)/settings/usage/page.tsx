export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getEffectiveRightsForUser } from "@/lib/rights-resolver";
import { getStorageUsage } from "./usage-actions";
import { UsageClient } from "./usage-client";

// CLE-209 follow-up — Settings → Usage. Storage bytes per bucket for
// the caller's organisation. Gate matches canEditOrgSettings.

export default async function UsagePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const resolved = await getEffectiveRightsForUser(user.id);
  if (!resolved?.rights.canEditOrgSettings) redirect("/dashboard");

  const initial = await getStorageUsage();

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <div>
        <h1 className="text-2xl font-bold">Usage</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Storage bytes held by each of ClearHR&apos;s Supabase buckets for your
          organisation. Refresh to recalculate.
        </p>
      </div>
      <UsageClient initial={initial.success ? initial.usage : null} initialError={initial.success ? null : initial.error} />
    </div>
  );
}
