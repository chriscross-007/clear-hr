export const dynamic = "force-dynamic";

import { createClient } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ShiftsListClient } from "./shifts-list-client";

export default async function ShiftsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: membership } = await supabase
    .from("members")
    .select("id, organisation_id, role")
    .eq("user_id", user.id)
    .limit(1)
    .single();

  if (!membership) redirect("/login");
  if (membership.role !== "owner" && membership.role !== "admin") notFound();

  const { data: shiftDefs } = await supabase
    .from("shift_definitions")
    .select("id, name, is_open_shift, planned_start, planned_end, crosses_midnight, break_type, active")
    .eq("organisation_id", membership.organisation_id)
    .order("sort_order")
    .order("name");

  return (
    <div className="w-full px-4 py-8 sm:px-6 lg:px-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <p className="text-sm text-muted-foreground">Timesheets</p>
          <h1 className="text-2xl font-bold">Shift Definitions</h1>
        </div>
        <Button asChild>
          <Link href="/shifts/new">
            <Plus className="h-4 w-4 mr-1.5" />
            New Shift
          </Link>
        </Button>
      </div>

      <ShiftsListClient shiftDefs={(shiftDefs ?? []) as {
        id: string;
        name: string;
        is_open_shift: boolean;
        planned_start: string | null;
        planned_end: string | null;
        crosses_midnight: boolean;
        break_type: string;
        active: boolean;
      }[]} />
    </div>
  );
}
