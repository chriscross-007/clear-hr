export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { OrganisationSettingsForm } from "./organisation-form";
import { BillingContactCard } from "./billing-contact-card";
import { getBillingContactContext } from "./billing-contact-actions";

// CLE-191 — /settings/organisation. Holds the org-identity fields that
// used to live across the dialog's General + Holiday Year tabs:
//   * Identity: name, member label, currency, country, MFA
//   * Holiday year start (it's a fact about the company, not a per-member
//     treatment — see CLE-191 spec)
//   * Bank holiday handling + colour
//
// Other Holiday Year tab pieces (default holiday cog, notice rules,
// bank-holiday seeding, default work profile) move elsewhere:
//   * Default holiday → /settings/profiles/holiday (Phase 2)
//   * Notice rules → /settings/profiles/notice-period
//   * Default work profile → /settings/profiles/working-pattern
//   * Bank-holiday seeding → kept here for now, separate card.

export default async function OrganisationSettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: caller } = await supabase
    .from("members")
    .select("organisation_id")
    .eq("user_id", user.id)
    .limit(1)
    .single();
  if (!caller) redirect("/organisation-setup");

  // CLE-196b-5 — Resolver-shaped gate.
  const { getEffectiveRightsForUser } = await import("@/lib/rights-resolver");
  const resolved = await getEffectiveRightsForUser(user.id);
  if (!resolved?.rights.canEditOrgSettings) redirect("/dashboard");

  const { data: org } = await supabase
    .from("organisations")
    .select(
      "name, member_label, currency_symbol, country_code, require_mfa, plan, holiday_year_start_type, holiday_year_start_day, holiday_year_start_month, bank_holiday_handling, bank_holiday_colour",
    )
    .eq("id", caller.organisation_id)
    .single();
  if (!org) redirect("/organisation-setup");

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <div>
        <h1 className="text-2xl font-bold">Organisation</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Identity, holiday year start, and bank-holiday handling.
        </p>
      </div>

      {/* CLE-199 — Billing contact card. Read is public to any viewer
          who can reach this Settings page; write is gated on
          canManageBilling. */}
      {await (async () => {
        const ctx = await getBillingContactContext();
        return (
          <BillingContactCard
            current={ctx.current}
            candidates={ctx.candidates}
            canManage={resolved.rights.canManageBilling}
          />
        );
      })()}

      <OrganisationSettingsForm
        initialName={org.name}
        initialMemberLabel={org.member_label}
        initialCurrencySymbol={org.currency_symbol ?? "£"}
        initialCountryCode={org.country_code ?? "england-and-wales"}
        initialRequireMfa={!!org.require_mfa}
        plan={org.plan ?? "lite"}
        initialHolidayYearStartType={org.holiday_year_start_type ?? "fixed"}
        initialHolidayYearStartDay={Number(org.holiday_year_start_day ?? 1)}
        initialHolidayYearStartMonth={Number(org.holiday_year_start_month ?? 4)}
        initialBankHolidayHandling={org.bank_holiday_handling ?? "additional"}
        initialBankHolidayColour={org.bank_holiday_colour ?? "#EF4444"}
      />
    </div>
  );
}
