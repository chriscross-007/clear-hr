export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getNoticePeriodRules } from "@/app/(dashboard)/notice-period-actions";
import { ProfileExplainer } from "../profile-explainer";
import { NoticePeriodClient } from "./notice-period-client";

// CLE-191 — Notice Period profiles (Phase 1 — single "Default" profile).
//
// The current model stores notice rules as a flat list on
// `notice_period_rules` keyed only by organisation_id. Phase 3 (the
// Org → Team → Member cascade) will introduce a real `notice_profiles`
// entity with profile-level overrides; for now there's exactly one
// profile per org (the "Default") and editing it edits the underlying
// rules directly.
//
// The list + popup CRUD pattern is in place so the UI doesn't change
// when Phase 3 lands — just more rows in the list.

export default async function NoticePeriodProfilesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: caller } = await supabase
    .from("members")
    .select("organisation_id, role")
    .eq("user_id", user.id)
    .limit(1)
    .single();
  if (!caller) redirect("/organisation-setup");
  if (caller.role !== "owner") redirect("/settings");

  const [rulesRes, { data: org }] = await Promise.all([
    getNoticePeriodRules(),
    supabase
      .from("organisations")
      .select("notice_rules_block_requests")
      .eq("id", caller.organisation_id)
      .single(),
  ]);

  const initialRules = rulesRes.success
    ? (rulesRes.rules ?? []).map((r) => ({
        id: r.id,
        min_booking_days: r.min_booking_days,
        notice_days: r.notice_days,
      }))
    : [];
  const initialBlockRequests = !!org?.notice_rules_block_requests;

  return (
    <div className="space-y-6">
      <ProfileExplainer
        kind="live"
        note="The block-or-warn flag also affects the cover rule — the same flag governs both."
      />
      <NoticePeriodClient
        initialRules={initialRules}
        initialBlockRequests={initialBlockRequests}
      />
    </div>
  );
}
