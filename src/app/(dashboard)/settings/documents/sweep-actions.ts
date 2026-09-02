"use server";

// CLE-209 — Manual trigger for the nightly documents sweep. Scoped
// to the caller's org so an admin can validate their own tenant
// without waiting for 02:00 UTC.

import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { getEffectiveRightsForUser } from "@/lib/rights-resolver";
import { runDocumentsSweep, type SweepResult } from "@/lib/documents/sweep";

export async function runDocumentsSweepManual(): Promise<
  { success: true; result: SweepResult } | { success: false; error: string }
> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "Not authenticated" };
  const resolved = await getEffectiveRightsForUser(user.id);
  if (!resolved) return { success: false, error: "No organisation" };
  if (!resolved.rights.canEditOrgSettings) {
    return { success: false, error: "You don't have permission to run the sweep" };
  }

  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } },
  );

  const result = await runDocumentsSweep(admin, {
    organisationId: resolved.ctx.organisationId,
  });
  return { success: true, result };
}
