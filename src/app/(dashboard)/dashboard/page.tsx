export const dynamic = 'force-dynamic';

import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getEffectiveRightsForUser } from "@/lib/rights-resolver";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Calendar, Clock, Sun, BarChart2, FileText } from "lucide-react";
import { getMyDocumentsTrafficLight } from "@/app/(dashboard)/documents/compliance-actions";
// CLE-220 follow-up — Chris reinstated the "N acks required" chip on
// the Docs card, sitting alongside the per-row "Please Ack" pills.
// Both signals are useful: the pill is per-row, the chip is a
// dashboard-level summary and a deep link. The chip links into
// whichever /my-documents tab has an outstanding ack (My preferred,
// falls back to Org).
import { getMyOutstandingAcknowledgements } from "@/app/(dashboard)/documents/acknowledgement-actions";
// Pure formatter — imported from the standalone module (not the
// "use client" component) so this server component can call it at
// render time without hitting a client-boundary reference.
import { trafficLightTooltipText } from "@/lib/traffic-light-format";

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: member } = await supabase
    .from("members")
    .select("first_name, last_name, avatar_url")
    .eq("user_id", user.id)
    .limit(1)
    .single();

  if (!member) redirect("/organisation-setup");

  // CLE-201c — anyone whose profile grants cross-user visibility
  // (team or all) belongs on the admin dashboard, not the self-scoped
  // one. Replaces the legacy `member.role !== "employee"` check.
  const resolved = await getEffectiveRightsForUser(user.id);
  if (resolved && resolved.rights.crossUserAccess !== "self") {
    redirect("/admin-dashboard");
  }

  const initials = [member.first_name, member.last_name]
    .filter(Boolean)
    .map((n) => n!.charAt(0).toUpperCase())
    .join("") || user.email?.charAt(0).toUpperCase() || "?";

  const fullName = [member.first_name, member.last_name].filter(Boolean).join(" ");

  // CLE-216 follow-up — resolve the caller's own documents traffic
  // light for the "My documents" card. Server-side, so it just
  // renders as markup below. Failure is soft: on error we render the
  // card in an "unable to load" empty state rather than blowing up
  // the whole self dashboard.
  const docsRes = await getMyDocumentsTrafficLight();
  const docsLight = docsRes.success ? docsRes.light : null;
  const docsMemberId = docsRes.success ? docsRes.memberId : null;
  const docsColour = docsLight?.colour ?? null;

  // Traffic-light → card display values. Green + red/amber use the
  // shared summary text so we're in lockstep with the tooltip on
  // the other surfaces. Null (no required docs) is its own thing.
  let docsBigText: string;
  let docsSubtext: string;
  let docsTextClass: string;
  let docsIconClass: string;
  if (docsColour === "green") {
    docsBigText = "All up to date";
    docsSubtext = "Your required documents are in order";
    docsTextClass = "text-green-600";
    docsIconClass = "text-green-500";
  } else if (docsColour === "red") {
    docsBigText = trafficLightTooltipText(docsLight!);
    docsSubtext = "See your documents";
    docsTextClass = "text-red-600";
    docsIconClass = "text-red-500";
  } else if (docsColour === "amber") {
    docsBigText = trafficLightTooltipText(docsLight!);
    docsSubtext = "See your documents";
    docsTextClass = "text-amber-600";
    docsIconClass = "text-amber-500";
  } else {
    docsBigText = "No required documents";
    docsSubtext = "Nothing to provide right now";
    docsTextClass = "text-muted-foreground";
    docsIconClass = "text-muted-foreground";
  }
  // Click-through lands on `/my-documents` (the self-scope Required
  // Documents surface with the caller-appropriate affordances). The
  // per-member `/members/{id}/docs` page is admin-oriented and not
  // the right destination from a self dashboard.
  const docsHref = docsColour && docsMemberId ? "/my-documents" : null;

  // CLE-220 follow-up — fetch outstanding acks for the chip. Split
  // by owner_scope so we can route to whichever /my-documents tab has
  // work outstanding: prefer the My Documents tab, fall back to Org
  // Documents. Failure is soft — if the fetch errors we just drop the
  // chip rather than blocking the whole dashboard.
  const acksRes = await getMyOutstandingAcknowledgements();
  const outstandingAcks = acksRes.success ? acksRes.rows : [];
  const outstandingAckCount = outstandingAcks.length;
  const hasMemberAck = outstandingAcks.some((a) => a.ownerScope === "member");
  const ackTab = hasMemberAck ? "my" : "org";
  const ackHref = outstandingAckCount > 0 ? `/my-documents?tab=${ackTab}` : null;

  // The Docs card wraps its main content in the traffic-light Link
  // and, when there are outstanding acks, sits alongside a sibling
  // "N acks required" chip (also a Link, but into a specific tab).
  // Two sibling Links avoids the nested-<Link> anti-pattern that
  // caused problems before CLE-220. When there's no traffic-light
  // signal to link, the plain header path renders instead.
  const docsCard = (
    <Card>
      {docsHref ? (
        <Link href={docsHref} className="block transition-colors hover:bg-muted/50">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">My documents</CardTitle>
            <FileText className={`h-4 w-4 ${docsIconClass}`} />
          </CardHeader>
          <CardContent>
            <p className={`text-2xl font-bold ${docsTextClass}`}>{docsBigText}</p>
            <p className="mt-1 text-xs text-muted-foreground">{docsSubtext}</p>
          </CardContent>
        </Link>
      ) : (
        <>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">My documents</CardTitle>
            <FileText className={`h-4 w-4 ${docsIconClass}`} />
          </CardHeader>
          <CardContent>
            <p className={`text-2xl font-bold ${docsTextClass}`}>{docsBigText}</p>
            <p className="mt-1 text-xs text-muted-foreground">{docsSubtext}</p>
          </CardContent>
        </>
      )}
      {ackHref && (
        <Link
          href={ackHref}
          className="mx-6 mb-4 flex items-center justify-between rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 transition-colors hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100 dark:hover:bg-amber-950/70"
        >
          <span>
            <span className="font-medium">{outstandingAckCount}</span>
            {" "}to acknowledge
          </span>
          <span className="text-xs text-amber-800/80 dark:text-amber-200/70">
            {hasMemberAck ? "My Documents" : "Org Documents"} →
          </span>
        </Link>
      )}
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
          <p className="text-sm text-muted-foreground">{user.email}</p>
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

        {/* CLE-216 follow-up + CLE-220 — the "My documents" card
            wraps its own Link internally, with a sibling "N to
            acknowledge" chip beneath it that deep-links into the
            /my-documents tab that has outstanding acks. */}
        {docsCard}
      </div>

    </div>
  );
}
