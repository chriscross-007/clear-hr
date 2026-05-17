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

  const { data: caller } = await supabase
    .from("members")
    .select("role")
    .eq("user_id", user.id)
    .limit(1)
    .single();
  if (!caller) redirect("/organisation-setup");
  if (caller.role !== "owner") redirect("/settings");

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
