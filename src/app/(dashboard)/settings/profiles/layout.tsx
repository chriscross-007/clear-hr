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

  const { data: caller } = await supabase
    .from("members")
    .select("role")
    .eq("user_id", user.id)
    .limit(1)
    .single();
  if (!caller) redirect("/organisation-setup");
  if (caller.role !== "owner") redirect("/settings");

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
      <ProfilesHeading />
      <ProfileTypeNav />
      <div className="mt-6">{children}</div>
    </div>
  );
}
