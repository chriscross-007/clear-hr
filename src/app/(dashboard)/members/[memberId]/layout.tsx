import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getEffectiveRightsForUser } from "@/lib/rights-resolver";
import { TAB_KEYS, type TabKey } from "@/lib/rights-types";
import { EmployeeSidebar } from "./employee-sidebar";

export default async function EmployeeMemberLayout({
  params,
  children,
}: {
  params: Promise<{ memberId: string }>;
  children: React.ReactNode;
}) {
  const { memberId } = await params;
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: caller } = await supabase
    .from("members")
    .select("organisation_id")
    .eq("user_id", user.id)
    .limit(1)
    .single();
  if (!caller) redirect("/organisation-setup");
  // CLE-196b-2 — Directory sub-pages are the admin shell; anyone whose
  // scope is self-only bounces to /dashboard. Individual sub-pages
  // gate themselves further.
  const resolved = await getEffectiveRightsForUser(user.id);
  if (!resolved || resolved.rights.crossUserAccess === "self") redirect("/dashboard");
  const { data: member } = await supabase
    .from("members")
    .select("id, first_name, last_name, avatar_url, role, rights_profiles(name)")
    .eq("id", memberId)
    .eq("organisation_id", caller.organisation_id)
    .single();
  if (!member) notFound();

  const profileName =
    (member.rights_profiles as unknown as { name?: string } | null)?.name ?? null;

  // CLE-201c-11 — compute per-tab visibility from the resolver so the
  // sidebar only lists tabs the Caller's profile grants view on.
  const visibleTabs = {} as Record<TabKey, boolean>;
  for (const key of TAB_KEYS) {
    visibleTabs[key] = resolved.rights.tabs[key]?.view ?? false;
  }

  return (
    <div className="flex">
      <EmployeeSidebar
        userId={user.id}
        visibleTabs={visibleTabs}
        member={{
          id: member.id,
          first_name: member.first_name,
          last_name: member.last_name,
          avatar_url: member.avatar_url ?? null,
          role: member.role,
          rights_profile_name: profileName,
        }}
      />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
