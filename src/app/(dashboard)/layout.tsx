import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { MemberLabelProvider } from "@/contexts/member-label-context";
import { capitalize, pluralize } from "@/lib/label-utils";
import { hasPlanFeature } from "@/lib/plan-config";
import { HeaderUserMenu } from "./header-user-menu";
import { Sidebar } from "./sidebar";

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
    .select("organisation_id, role, permissions, first_name, last_name, avatar_url, organisations(name, member_label, plan, subscription_status, trial_ends_at, max_employees, require_mfa, currency_symbol, ts_max_shift_hours, ts_max_break_minutes, ts_shift_start_variance_minutes, ts_round_first_in_mins, ts_round_first_in_grace_mins, ts_round_break_out_mins, ts_round_break_out_grace_mins, ts_round_break_in_mins, ts_round_break_in_grace_mins, ts_round_last_out_mins, ts_round_last_out_grace_mins, holiday_year_start_type, holiday_year_start_day, holiday_year_start_month, bank_holiday_handling, default_work_profile_id), admin_profiles(name), employee_profiles(name)")
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
    require_mfa: boolean;
    currency_symbol: string;
    ts_max_shift_hours: number;
    ts_max_break_minutes: number;
    ts_shift_start_variance_minutes: number;
    ts_round_first_in_mins:        number | null;
    ts_round_first_in_grace_mins:  number | null;
    ts_round_break_out_mins:       number | null;
    ts_round_break_out_grace_mins: number | null;
    ts_round_break_in_mins:        number | null;
    ts_round_break_in_grace_mins:  number | null;
    ts_round_last_out_mins:        number | null;
    ts_round_last_out_grace_mins:  number | null;
    holiday_year_start_type: string;
    holiday_year_start_day: number | null;
    holiday_year_start_month: number | null;
    bank_holiday_handling: string;
    default_work_profile_id: string | null;
  };
  const memberLabel = org?.member_label || "member";

  const adminProfile = membership.admin_profiles as unknown as { name: string } | null;
  const employeeProfile = membership.employee_profiles as unknown as { name: string } | null;
  const profileName =
    membership.role === "admin" || membership.role === "owner"
      ? (adminProfile?.name ?? null)
      : (employeeProfile?.name ?? null);

  const memberPermissions = (membership.permissions as Record<string, unknown>) ?? {};
  const accessMembers = membership.role === "admin"
    ? (memberPermissions.can_manage_members as string | undefined) ?? "none"
    : null;
  const canDefineCustomFields = membership.role === "admin"
    ? (memberPermissions.can_define_custom_fields as boolean) === true
    : false;

  // Member count for header display (bypasses RLS visibility so all users see the true total)
  const { data: countResult } = await supabase
    .rpc("get_org_member_count", { org_id: membership.organisation_id });
  const memberCount = countResult ?? 0;
  const fullName = [membership.first_name, membership.last_name].filter(Boolean).join(" ");
  const initials = [membership.first_name, membership.last_name]
    .filter(Boolean)
    .map((n) => n!.charAt(0).toUpperCase())
    .join("") || user.email?.charAt(0).toUpperCase() || "U";

  // Fetch sidebar data for owners/admins
  const isOwnerOrAdmin = membership.role === "owner" || membership.role === "admin";
  const showReports = hasPlanFeature(org?.plan ?? "lite", "reports");
  let sidebarFavouriteIds: string[] = [];
  let sidebarCustomReports: { id: string; name: string }[] = [];
  let sidebarShiftDefs: { id: string; name: string }[] = [];
  if (isOwnerOrAdmin) {
    const shiftDefsPromise = supabase.from("shift_definitions").select("id, name").eq("organisation_id", membership.organisation_id).eq("active", true).order("sort_order").order("name");
    if (showReports) {
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
  }

  // Trial banner logic
  const trialEndsAt = org?.trial_ends_at ? new Date(org.trial_ends_at) : null;
  const now = new Date();
  const trialDaysLeft = trialEndsAt
    ? Math.max(0, Math.ceil((trialEndsAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)))
    : null;
  const showTrialBanner =
    membership.role === "owner" &&
    org?.subscription_status === "trialing" &&
    trialDaysLeft !== null &&
    trialDaysLeft <= 7;
  const showPastDueBanner =
    membership.role === "owner" &&
    org?.subscription_status === "past_due";

  return (
    <MemberLabelProvider memberLabel={memberLabel}>
      <div className="flex min-h-screen flex-col">
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
        <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
          <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
            <div className="flex items-baseline gap-2">
              <Link href="/employees" className="text-xl font-bold">
                {org?.name}
              </Link>
              {(membership.role === "owner" || membership.role === "admin") && (
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

            <HeaderUserMenu
              email={user.email ?? ""}
              fullName={fullName}
              initials={initials}
              avatarUrl={membership.avatar_url}
              role={membership.role}
              memberLabel={memberLabel}
              profileName={profileName}
            />
          </div>
        </header>
        <div className="flex flex-1">
          <Sidebar
            role={membership.role}
            accessMembers={accessMembers}
            memberLabel={memberLabel}
            orgName={org?.name}
            plan={org?.plan}
            requireMfa={org?.require_mfa ?? false}
            canDefineCustomFields={canDefineCustomFields}
            currencySymbol={org?.currency_symbol ?? "£"}
            tsMaxShiftHours={org?.ts_max_shift_hours ?? 14}
            tsMaxBreakMinutes={org?.ts_max_break_minutes ?? 60}
            tsShiftStartVarianceMinutes={org?.ts_shift_start_variance_minutes ?? 30}
            tsRoundFirstInMins={org?.ts_round_first_in_mins ?? null}
            tsRoundFirstInGraceMins={org?.ts_round_first_in_grace_mins ?? null}
            tsRoundBreakOutMins={org?.ts_round_break_out_mins ?? null}
            tsRoundBreakOutGraceMins={org?.ts_round_break_out_grace_mins ?? null}
            tsRoundBreakInMins={org?.ts_round_break_in_mins ?? null}
            tsRoundBreakInGraceMins={org?.ts_round_break_in_grace_mins ?? null}
            tsRoundLastOutMins={org?.ts_round_last_out_mins ?? null}
            tsRoundLastOutGraceMins={org?.ts_round_last_out_grace_mins ?? null}
            holidayYearStartType={org?.holiday_year_start_type ?? "fixed"}
            holidayYearStartDay={org?.holiday_year_start_day ?? 1}
            holidayYearStartMonth={org?.holiday_year_start_month ?? 1}
            bankHolidayHandling={org?.bank_holiday_handling ?? "additional"}
            defaultWorkProfileId={org?.default_work_profile_id ?? null}
            initialFavouriteIds={sidebarFavouriteIds}
            initialCustomReports={sidebarCustomReports}
            initialShiftDefs={sidebarShiftDefs}
          />
          <main className="flex-1">{children}</main>
        </div>
      </div>
    </MemberLabelProvider>
  );
}
