import { redirect } from "next/navigation";
import Link from "next/link";
import { Settings as SettingsIcon } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { MemberLabelProvider } from "@/contexts/member-label-context";
import { capitalize, pluralize } from "@/lib/label-utils";
import { hasPlanFeature } from "@/lib/plan-config";
import { getEffectiveRightsForUser, getRightsEditorCount } from "@/lib/rights-resolver";
import { HeaderUserMenu } from "./header-user-menu";
import { Sidebar } from "./sidebar";

// CLE-196b-1 — Dashboard shell rewired onto the Rights Profiles v2
// resolver. `members.role` / `members.permissions` reads are gone;
// everything downstream (sidebar visibility, trial banner audience,
// sidebar data fetches) now derives from `rights.*` flags. Legacy
// admin_profiles / employee_profiles joins removed — the profile name
// shown in the header comes straight from the rights_profile.

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: membership } = await supabase
    .from("members")
    .select("organisation_id, first_name, last_name, avatar_url, organisations(name, member_label, plan, subscription_status, trial_ends_at, max_employees)")
    .eq("user_id", user.id)
    .limit(1)
    .single();

  if (!membership) redirect("/organisation-setup");

  const org = membership.organisations as unknown as {
    name: string;
    member_label: string;
    plan: string;
    subscription_status: string | null;
    trial_ends_at: string | null;
    max_employees: number;
  };
  const memberLabel = org?.member_label || "member";

  const resolved = await getEffectiveRightsForUser(user.id);
  if (!resolved) redirect("/organisation-setup");
  const { rights } = resolved;

  // Member count for header display (bypasses RLS visibility so all users see the true total)
  const { data: countResult } = await supabase
    .rpc("get_org_member_count", { org_id: membership.organisation_id });
  const memberCount = countResult ?? 0;
  const fullName = [membership.first_name, membership.last_name].filter(Boolean).join(" ");
  const initials = [membership.first_name, membership.last_name]
    .filter(Boolean)
    .map((n) => n!.charAt(0).toUpperCase())
    .join("") || user.email?.charAt(0).toUpperCase() || "U";

  // Sidebar data fetches — Manager+ ranks see the admin shell and need
  // shifts/reports/approvals data. Employees don't.
  const isAdminShell = rights.rank !== "employee";
  const showReports = hasPlanFeature(org?.plan ?? "lite", "reports");
  let sidebarFavouriteIds: string[] = [];
  let sidebarCustomReports: { id: string; name: string }[] = [];
  let sidebarShiftDefs: { id: string; name: string }[] = [];
  // CLE-185 — pending approvals count for the sidebar badge. Only
  // people who can approve holidays need the count.
  let sidebarPendingApprovalsCount = 0;
  if (isAdminShell) {
    const shiftDefsPromise = supabase.from("shift_definitions").select("id, name").eq("organisation_id", membership.organisation_id).eq("active", true).order("sort_order").order("name");
    if (showReports && rights.canRunReports) {
      const [{ data: shiftsData }, { data: favData }, { data: customData }] = await Promise.all([
        shiftDefsPromise,
        supabase.from("report_favourites").select("report_id").eq("user_id", user.id),
        supabase.from("custom_reports").select("id, name").eq("organisation_id", membership.organisation_id).order("name"),
      ]);
      sidebarShiftDefs    = (shiftsData ?? []) as { id: string; name: string }[];
      sidebarFavouriteIds = (favData ?? []).map((f: { report_id: string }) => f.report_id);
      sidebarCustomReports = (customData ?? []) as { id: string; name: string }[];
    } else {
      const { data: shiftsData } = await shiftDefsPromise;
      sidebarShiftDefs = (shiftsData ?? []) as { id: string; name: string }[];
    }
    if (rights.canApproveHolidays) {
      const { getPendingApprovalsCount } = await import("./approvals-actions");
      const countRes = await getPendingApprovalsCount();
      sidebarPendingApprovalsCount = countRes.success ? countRes.count : 0;
    }
  }

  // Trial banner logic — shown to users with billing rights (the ones
  // who can act on the reminder). Legacy check was `role === "owner"`.
  const trialEndsAt = org?.trial_ends_at ? new Date(org.trial_ends_at) : null;
  const now = new Date();
  const trialDaysLeft = trialEndsAt
    ? Math.max(0, Math.ceil((trialEndsAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)))
    : null;
  const showTrialBanner =
    rights.canManageBilling &&
    org?.subscription_status === "trialing" &&
    trialDaysLeft !== null &&
    trialDaysLeft <= 7;
  const showPastDueBanner =
    rights.canManageBilling &&
    org?.subscription_status === "past_due";

  // CLE-199 — Rights-editor bus-factor banner. Shown to viewers who
  // can act on the warning (i.e. those whose profile grants Edit User
  // Rights, and who can therefore promote a second person). Red at
  // ≤1, amber above 5.
  let rightsEditorBanner: "danger" | "warning" | null = null;
  let rightsEditorCount = 0;
  if (rights.canEditRightsProfiles) {
    rightsEditorCount = await getRightsEditorCount(membership.organisation_id);
    if (rightsEditorCount <= 1) rightsEditorBanner = "danger";
    else if (rightsEditorCount > 5) rightsEditorBanner = "warning";
  }
  const showRightsEditorBanner = rightsEditorBanner !== null;

  // Trial + past-due + rights-editor banners live inside the
  // top-chrome sticky wrapper so they stay visible on scroll.
  // `--top-chrome-extra` records the extra pixels the banners add
  // above the header; downstream sticky elements (StickyPageHeader,
  // DataGrid rows) shift down by that amount via
  // calc(var(--top-chrome-extra, 0px) + …). Each banner div is
  // `py-2 text-sm` → roughly 36px tall.
  const topChromeExtra =
    (showTrialBanner ? 36 : 0) +
    (showPastDueBanner ? 36 : 0) +
    (showRightsEditorBanner ? 36 : 0);

  return (
    <MemberLabelProvider memberLabel={memberLabel}>
      <div
        className="flex min-h-screen flex-col"
        style={{ ["--top-chrome-extra" as string]: `${topChromeExtra}px` }}
      >
        {/* Sticky top strip: banners + header. Fully opaque background so
            scrolling data never bleeds through. */}
        <div className="sticky top-0 z-50 border-b bg-background">
          {showTrialBanner && (
            <div className="bg-amber-500 px-4 py-2 text-center text-sm font-medium text-white">
              Your trial ends in {trialDaysLeft} day{trialDaysLeft !== 1 ? "s" : ""}.{" "}
              <Link href="/billing" className="underline">
                Subscribe now
              </Link>{" "}
              to keep using ClearHR.
            </div>
          )}
          {showPastDueBanner && (
            <div className="bg-destructive px-4 py-2 text-center text-sm font-medium text-white">
              Your payment is overdue. Please{" "}
              <Link href="/billing" className="underline">
                update your billing
              </Link>{" "}
              to avoid service interruption.
            </div>
          )}
          {showRightsEditorBanner && rightsEditorBanner === "danger" && (
            <div className="bg-destructive px-4 py-2 text-center text-sm font-medium text-white">
              {rightsEditorCount === 0
                ? "No members can edit User Rights — this shouldn't happen. "
                : "Only 1 member can edit User Rights. "}
              <Link href="/settings/rights-profiles" className="underline">
                Promote another Admin
              </Link>{" "}
              so nobody gets locked out.
            </div>
          )}
          {showRightsEditorBanner && rightsEditorBanner === "warning" && (
            <div className="bg-amber-500 px-4 py-2 text-center text-sm font-medium text-white">
              {rightsEditorCount} members can edit User Rights.{" "}
              <Link href="/settings/rights-profiles" className="underline">
                Consider trimming administrative access
              </Link>
              .
            </div>
          )}
          <header className="w-full">
            <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
            <div className="flex items-baseline gap-2">
              <Link href={isAdminShell ? "/employees" : "/dashboard"} className="text-xl font-bold">
                {org?.name}
              </Link>
              {isAdminShell && (
                <span className="text-sm text-muted-foreground">
                  ({org?.plan} plan
                  {(memberCount ?? 0) >= org?.max_employees ? (
                    <span className="text-red-600 dark:text-red-400 font-medium"> — {memberCount ?? 0}/{org?.max_employees} {capitalize(pluralize(memberLabel))}</span>
                  ) : (
                    <> — {memberCount ?? 0}/{org?.max_employees} {capitalize(pluralize(memberLabel))}</>
                  )}
                  {org?.subscription_status === "trialing" && trialEndsAt && (
                    <span className="text-red-600 dark:text-red-400 font-medium"> — Trial ends {trialEndsAt.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}</span>
                  )})
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              {rights.canEditOrgSettings && (
                <Link
                  href="/settings"
                  aria-label="Settings"
                  title="Settings"
                  className="inline-flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  <SettingsIcon className="h-5 w-5" />
                </Link>
              )}
              <HeaderUserMenu
                email={user.email ?? ""}
                fullName={fullName}
                initials={initials}
                avatarUrl={membership.avatar_url}
                rank={rights.rank}
                memberLabel={memberLabel}
                profileName={rights.profileName}
              />
            </div>
            </div>
          </header>
        </div>
        <div className="flex flex-1">
          <Sidebar
            userId={user.id}
            rank={rights.rank}
            crossUserAccess={rights.crossUserAccess}
            canEditOrgSettings={rights.canEditOrgSettings}
            canManageBilling={rights.canManageBilling}
            canViewAuditLogs={rights.canViewAuditLogs}
            canViewOrganisationDocuments={rights.canViewOrganisationDocuments}
            canRunReports={rights.canRunReports}
            canApproveHolidays={rights.canApproveHolidays}
            memberLabel={memberLabel}
            plan={org?.plan}
            initialFavouriteIds={sidebarFavouriteIds}
            initialCustomReports={sidebarCustomReports}
            initialShiftDefs={sidebarShiftDefs}
            pendingApprovalsCount={sidebarPendingApprovalsCount}
          />
          <main className="min-w-0 flex-1">{children}</main>
        </div>
      </div>
    </MemberLabelProvider>
  );
}
