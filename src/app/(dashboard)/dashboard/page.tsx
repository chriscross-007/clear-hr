export const dynamic = 'force-dynamic';

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Calendar, Clock, Sun, BarChart2 } from "lucide-react";

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: member } = await supabase
    .from("members")
    .select("first_name, last_name, avatar_url, role")
    .eq("user_id", user.id)
    .limit(1)
    .single();

  if (!member) redirect("/organisation-setup");

  // Owners and admins don't belong here
  if (member.role !== "employee") redirect("/admin-dashboard");

  const initials = [member.first_name, member.last_name]
    .filter(Boolean)
    .map((n) => n!.charAt(0).toUpperCase())
    .join("") || user.email?.charAt(0).toUpperCase() || "?";

  const fullName = [member.first_name, member.last_name].filter(Boolean).join(" ");

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
      </div>

    </div>
  );
}
