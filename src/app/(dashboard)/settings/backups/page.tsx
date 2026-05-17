export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { BackupsManager } from "./backups-manager";

// CLE-191 — /settings/backups. Lifts the existing `BackupsManager`
// into a full-page sub-route. The manager owns its own actions; we
// just gate access (owner only) and supply the org name.

export default async function BackupsSettingsPage() {
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
  if (caller.role !== "owner") redirect("/dashboard");

  const { data: org } = await supabase
    .from("organisations")
    .select("name")
    .eq("id", caller.organisation_id)
    .single();
  if (!org) redirect("/organisation-setup");

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <div>
        <h1 className="text-2xl font-bold">Backups</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Create, restore, and manage organisation backups.
        </p>
      </div>
      <BackupsManager orgName={org.name} />
    </div>
  );
}
