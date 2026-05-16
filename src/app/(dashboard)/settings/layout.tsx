import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { coerceAccess } from "@/lib/rights-config";
import { SettingsSidebar } from "./settings-sidebar";

// CLE-191 — Settings shell. Layout-level permission gate ensures the
// whole section is invisible to anyone who can't touch *any* setting.
// Individual sub-routes gate further (e.g. /settings/profiles is owner
// only, /settings/custom-fields lets admins with can_define_custom_fields
// in, etc.). The sidebar itself uses the same broad gate so the link
// only appears for viewers with at least one settings-related right.

export default async function SettingsLayout({
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
    .select("organisation_id, role, permissions")
    .eq("user_id", user.id)
    .limit(1)
    .single();
  if (!caller) redirect("/organisation-setup");

  const perms = (caller.permissions as Record<string, unknown>) ?? {};
  const canEditOrganisation = perms.can_edit_organisation === true;
  // Tri-state: "none" | "read" | "write". Any non-none access gates page
  // visibility; "write" is checked separately in the action layer.
  const canDefineCustomFields = coerceAccess(perms.can_define_custom_fields) !== "none";
  const canAddMembers = perms.can_add_members === true;

  const allowed =
    caller.role === "owner"
    || (caller.role === "admin"
      && (canEditOrganisation || canDefineCustomFields || canAddMembers));
  if (!allowed) redirect("/dashboard");

  return (
    <div className="flex">
      <SettingsSidebar
        role={caller.role}
        canEditOrganisation={canEditOrganisation}
        canDefineCustomFields={canDefineCustomFields}
        canAddMembers={canAddMembers}
      />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
