export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { getEffectiveRightsForUser } from "@/lib/rights-resolver";
import { LookupClient, type MemberOption } from "./lookup-client";
import { getRightsProfiles } from "../actions";

// CLE-199 — Per-member lookup. Given a member, renders a plain-English
// summary of what they can do, generated from their profile. Copyable
// to clipboard so admins can paste it into support tickets.

export default async function LookupRightsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const resolved = await getEffectiveRightsForUser(user.id);
  if (!resolved?.rights.canEditRightsProfiles) redirect("/dashboard");
  const orgId = resolved.ctx.organisationId;

  // Load every member in the org with their assigned profile id. The
  // client component turns this into the summary strings when the
  // admin picks one — avoids a round-trip per selection.
  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
  const { data: memberRows } = await admin
    .from("members")
    .select("id, first_name, last_name, email, rights_profile_id")
    .eq("organisation_id", orgId)
    .order("first_name");

  const members: MemberOption[] = ((memberRows ?? []) as Array<{
    id: string;
    first_name: string;
    last_name: string;
    email: string;
    rights_profile_id: string | null;
  }>).map((m) => ({
    memberId: m.id,
    name: `${m.first_name} ${m.last_name}`,
    email: m.email,
    profileId: m.rights_profile_id,
  }));

  const profiles = await getRightsProfiles();

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <div>
        <h1 className="text-2xl font-bold">Per-member lookup</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Pick a member to see what they can and can&apos;t do, in plain English.
          Copy the summary to hand to support.
        </p>
      </div>
      <LookupClient members={members} profiles={profiles} />
    </div>
  );
}
