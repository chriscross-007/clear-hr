export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ProfileExplainer } from "../profile-explainer";
import { ApproverProfilesClient } from "./approver-profiles-client";

// CLE-191 — Approver profiles. Owner-only list + popup CRUD over
// approval_profiles. Reuses the shared `ProfileEditor` form fields
// from `./approver-form.tsx`.

export default async function ApproverProfilesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { getEffectiveRightsForUser: _grA } = await import("@/lib/rights-resolver");
  const _rA = await _grA(user.id);
  if (!_rA) redirect("/organisation-setup");
  if (!_rA.rights.canEditOrgSettings) redirect("/settings");

  return (
    <div className="space-y-6">
      <ProfileExplainer
        kind="live"
        note="Approver lists are snapshotted onto each booking at submit time — in-flight bookings keep their existing routing if you edit a profile later."
      />
      <ApproverProfilesClient />
    </div>
  );
}
