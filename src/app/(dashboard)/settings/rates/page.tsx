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

  const { data: caller } = await supabase
    .from("members")
    .select("role, permissions")
    .eq("user_id", user.id)
    .limit(1)
    .single();
  if (!caller) redirect("/organisation-setup");

  const perms = (caller.permissions as Record<string, unknown>) ?? {};
  const allowed =
    caller.role === "owner"
    || (caller.role === "admin" && perms.can_edit_organisation === true);
  if (!allowed) redirect("/dashboard");

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
