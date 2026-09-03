import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ProfileTypeNav } from "./profile-type-nav";
import { ProfilesHeading } from "./profiles-heading";

// CLE-191 — Profiles section is owner-only because every profile type
// (Rights, Working Pattern, Notice Period, Approver, Holiday) governs
// member-treatment rules. Sub-routes are tabs along the top of the
// section; the layout enforces the gate once and renders the nav.

export default async function ProfilesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Resolver handles both "am I in an org" and "can I edit settings"
  // in one call — no need to hit members directly (and no `role`
  // column exists any more since CLE-203).
  const { getEffectiveRightsForUser } = await import("@/lib/rights-resolver");
  const resolved = await getEffectiveRightsForUser(user.id);
  if (!resolved) redirect("/organisation-setup");
  if (!resolved.rights.canEditOrgSettings) redirect("/settings");

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
      <ProfilesHeading />
      <ProfileTypeNav />
      <div className="mt-6">{children}</div>
    </div>
  );
}
