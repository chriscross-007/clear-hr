export const dynamic = 'force-dynamic';

import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getEffectiveRightsForUser } from "@/lib/rights-resolver";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Calendar, Clock, Sun, BarChart2, FileText } from "lucide-react";
import { getMemberDocumentsTrafficLight } from "@/app/(dashboard)/documents/compliance-actions";
import { trafficLightTooltipText } from "@/lib/traffic-light-format";

export default async function EmployeeDashboardPage({
  params,
}: {
  params: Promise<{ memberId: string }>;
}) {
  const { memberId } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // CLE-201c-12 — page-level tab-matrix gate.
  const resolved = await getEffectiveRightsForUser(user.id);
  if (!resolved || !resolved.rights.tabs.dashboard?.view) notFound();

  // Caller must be in the admin shell (Manager+)
  const { data: caller } = await supabase
    .from("members")
    .select("organisation_id, rights_profiles(rank)")
    .eq("user_id", user.id)
    .limit(1)
    .single();

  const callerRank = (caller?.rights_profiles as unknown as { rank?: string } | null)?.rank ?? "employee";
  if (!caller || callerRank === "employee") redirect("/dashboard");

  // Target member must be in the same org
  const { data: member } = await supabase
    .from("members")
    .select("first_name, last_name, avatar_url, email")
    .eq("id", memberId)
    .eq("organisation_id", caller.organisation_id)
    .single();

  if (!member) redirect("/employees");

  const initials = [member.first_name, member.last_name]
    .filter(Boolean)
    .map((n) => n!.charAt(0).toUpperCase())
    .join("") || member.email?.charAt(0).toUpperCase() || "?";

  const fullName = [member.first_name, member.last_name].filter(Boolean).join(" ");

  // CLE-216 follow-up — Documents traffic light for the member the
  // admin is viewing. Mirrors the "My documents" card on the Employee
  // Self Dashboard, but points at this member's own Docs page.
  const docsRes = await getMemberDocumentsTrafficLight(memberId);
  const docsLight = docsRes.success ? docsRes.light : null;
  const docsColour = docsLight?.colour ?? null;
  let docsBigText: string;
  let docsSubtext: string;
  let docsTextClass: string;
  let docsIconClass: string;
  if (docsColour === "green") {
    docsBigText = "All up to date";
    docsSubtext = "Required documents are in order";
    docsTextClass = "text-green-600";
    docsIconClass = "text-green-500";
  } else if (docsColour === "red") {
    docsBigText = trafficLightTooltipText(docsLight!);
    docsSubtext = "See documents";
    docsTextClass = "text-red-600";
    docsIconClass = "text-red-500";
  } else if (docsColour === "amber") {
    docsBigText = trafficLightTooltipText(docsLight!);
    docsSubtext = "See documents";
    docsTextClass = "text-amber-600";
    docsIconClass = "text-amber-500";
  } else {
    docsBigText = "No required documents";
    docsSubtext = "Nothing to provide right now";
    docsTextClass = "text-muted-foreground";
    docsIconClass = "text-muted-foreground";
  }
  const docsHref = docsColour ? `/members/${memberId}/docs` : null;
  const docsCard = (
    <Card className={docsHref ? "transition-colors hover:bg-muted/50" : undefined}>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium">Documents</CardTitle>
        <FileText className={`h-4 w-4 ${docsIconClass}`} />
      </CardHeader>
      <CardContent>
        <p className={`text-2xl font-bold ${docsTextClass}`}>{docsBigText}</p>
        <p className="mt-1 text-xs text-muted-foreground">{docsSubtext}</p>
      </CardContent>
    </Card>
  );

  return (
    <div className="mx-auto max-w-4xl space-y-8 p-6">

      {/* Profile header */}
      <div className="flex items-center gap-5">
        <Avatar className="h-16 w-16 text-lg">
          {member.avatar_url && (
            <AvatarImage src={member.avatar_url} alt={fullName} />
          )}
          <AvatarFallback>{initials}</AvatarFallback>
        </Avatar>
        <div>
          <h1 className="text-2xl font-bold">{fullName}</h1>
          <p className="text-sm text-muted-foreground">{member.email}</p>
        </div>
      </div>

      {/* Placeholder cards */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Holiday Allowance</CardTitle>
            <Sun className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">—</p>
            <p className="mt-1 text-xs text-muted-foreground">Days remaining this year</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Upcoming Leave</CardTitle>
            <Calendar className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">—</p>
            <p className="mt-1 text-xs text-muted-foreground">Approved requests</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Hours This Week</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">—</p>
            <p className="mt-1 text-xs text-muted-foreground">Logged hours</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Activity</CardTitle>
            <BarChart2 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">—</p>
            <p className="mt-1 text-xs text-muted-foreground">Recent actions</p>
          </CardContent>
        </Card>

        {/* CLE-216 follow-up — Documents traffic light for this
            member. Route to their /docs tab when a light exists;
            null (no required docs) renders as a non-linked card. */}
        {docsHref ? (
          <Link href={docsHref} className="block">
            {docsCard}
          </Link>
        ) : (
          docsCard
        )}
      </div>

    </div>
  );
}
