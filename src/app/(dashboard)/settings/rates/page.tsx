export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getRates } from "@/app/(dashboard)/rates-actions";
import { RatesPageClient } from "./rates-client";

// CLE-191 — /settings/rates. Pay-rate multipliers (overtime, weekend,
// etc.) used by Timesheet. Lifts the existing `RatesManager` straight
// from the old dialog tab — the manager already owns its own CRUD via
// server actions, we just need a server page to gate access + supply
// the initial list.

export default async function RatesSettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // CLE-196b-5 — Rates settings gated by canEditOrgSettings.
  const { getEffectiveRightsForUser } = await import("@/lib/rights-resolver");
  const resolved = await getEffectiveRightsForUser(user.id);
  if (!resolved?.rights.canEditOrgSettings) redirect("/dashboard");

  const rates = await getRates();

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <div>
        <h1 className="text-2xl font-bold">Rates</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Pay-rate multipliers used by Timesheet (overtime, weekend, etc.).
        </p>
      </div>
      <RatesPageClient initialRates={rates} />
    </div>
  );
}
