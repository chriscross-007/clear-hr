export const dynamic = "force-dynamic";

import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { hasPlanFeature } from "@/lib/plan-config";
import { ALL_STANDARD_REPORTS } from "../definitions";
import Link from "next/link";
import { Star } from "lucide-react";

export default async function FavouritesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: membership } = await supabase
    .from("members")
    .select("organisation_id, role, organisations(plan)")
    .eq("user_id", user.id)
    .limit(1)
    .single();

  if (!membership) redirect("/login");

  const org = membership.organisations as unknown as { plan: string } | null;
  const plan = org?.plan ?? "lite";

  if (!hasPlanFeature(plan, "reports") || (membership.role !== "owner" && membership.role !== "admin")) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <p className="text-muted-foreground">Reports require a Pro or higher plan.</p>
      </div>
    );
  }

  const [{ data: favouritesData }, { data: customReportsData }] = await Promise.all([
    supabase.from("report_favourites").select("report_id").eq("user_id", user.id),
    supabase.from("custom_reports").select("id, name, based_on, shared, created_by").eq("organisation_id", membership.organisation_id),
  ]);

  const favouriteIds = new Set((favouritesData ?? []).map((f: { report_id: string }) => f.report_id));
  const customReports = (customReportsData ?? []) as { id: string; name: string; based_on: string; shared: boolean; created_by: string }[];

  type FavItem = {
    id: string;
    name: string;
    description: string;
    href: string;
    group: string;
  };

  const favouriteItems: FavItem[] = [];

  for (const id of favouriteIds) {
    const standard = ALL_STANDARD_REPORTS.find((r) => r.id === id);
    if (standard) {
      favouriteItems.push({
        id: standard.id,
        name: standard.name,
        description: standard.description,
        href: `/reports/${standard.id}`,
        group: standard.groupLabel,
      });
      continue;
    }
    const custom = customReports.find((r) => r.id === id);
    if (custom) {
      const base = ALL_STANDARD_REPORTS.find((r) => r.id === custom.based_on);
      favouriteItems.push({
        id: custom.id,
        name: custom.name,
        description: `Custom · based on ${base?.name ?? custom.based_on}`,
        href: `/reports/custom/${custom.id}`,
        group: "Custom",
      });
    }
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <h1 className="text-2xl font-bold mb-6 flex items-center gap-2">
        <Star className="h-6 w-6 text-amber-500 fill-amber-500" />
        Favourite Reports
      </h1>
      {favouriteItems.length === 0 ? (
        <p className="text-muted-foreground">
          No favourites yet. Star a report to add it here.
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {favouriteItems.map((item) => (
            <Link
              key={item.id}
              href={item.href}
              className="flex flex-col gap-1 rounded-lg border bg-card p-4 hover:bg-muted/50 transition-colors"
            >
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">{item.group}</span>
              </div>
              <p className="font-semibold">{item.name}</p>
              <p className="text-sm text-muted-foreground">{item.description}</p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
