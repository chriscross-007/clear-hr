export const dynamic = "force-dynamic";

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { hasPlanFeature } from "@/lib/plan-config";
import { CustomReportsClient } from "./custom-client";

export default async function CustomReportsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: membership } = await supabase
    .from("members")
    .select("id, organisation_id, role, organisations(plan)")
    .eq("user_id", user.id)
    .limit(1)
    .single();

  if (!membership) redirect("/login");

  const org = membership.organisations as unknown as { plan: string } | null;
  const plan = org?.plan ?? "lite";

  if (!hasPlanFeature(plan, "custom_reports") || (membership.role !== "owner" && membership.role !== "admin")) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <p className="text-muted-foreground">Custom reports require a Pro or higher plan.</p>
      </div>
    );
  }

  const { data: reportsData } = await supabase
    .from("custom_reports")
    .select("id, name, based_on, shared, created_by, created_at, updated_at")
    .eq("organisation_id", membership.organisation_id)
    .order("name");

  const reports = (reportsData ?? []) as {
    id: string;
    name: string;
    based_on: string;
    shared: boolean;
    created_by: string;
    created_at: string;
    updated_at: string;
  }[];

  return (
    <CustomReportsClient
      reports={reports}
      callerMemberId={membership.id}
      callerRole={membership.role as string}
    />
  );
}
