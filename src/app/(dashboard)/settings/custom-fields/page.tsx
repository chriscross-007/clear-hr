export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCustomFieldDefs } from "@/app/(dashboard)/employees/custom-field-actions";
import { getEffectiveRightsForUser } from "@/lib/rights-resolver";
import { CustomFieldsPageClient } from "./custom-fields-client";

// CLE-191 — /settings/custom-fields. Lifts the existing
// `CustomFieldsManager` into a full-page sub-route. The manager owns
// CRUD via its own server actions; we just gate access and supply the
// initial list + currency symbol.

export default async function CustomFieldsSettingsPage() {
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

  // CLE-196b-5 — Custom fields now folded under canEditOrgSettings.
  const resolved = await getEffectiveRightsForUser(user.id);
  if (!resolved?.rights.canEditOrgSettings) redirect("/dashboard");
  const canEdit = resolved.rights.canEditOrgSettings;

  const [defs, { data: org }] = await Promise.all([
    getCustomFieldDefs(),
    supabase
      .from("organisations")
      .select("currency_symbol")
      .eq("id", caller.organisation_id)
      .single(),
  ]);
  const currencySymbol = (org?.currency_symbol ?? "£") as string;

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <div>
        <h1 className="text-2xl font-bold">Custom Fields</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Define extra fields recorded against each member.
        </p>
      </div>
      <CustomFieldsPageClient initialDefs={defs} currencySymbol={currencySymbol} canEdit={canEdit} />
    </div>
  );
}
