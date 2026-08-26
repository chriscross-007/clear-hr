export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AdminDashboardClient } from "./admin-dashboard-client";

export default async function AdminDashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: member } = await supabase
    .from("members")
    .select("role")
    .eq("user_id", user.id)
    .limit(1)
    .single();

  if (!member) redirect("/organisation-setup");

  // Only admins and owners
  const { getEffectiveRightsForUser } = await import("@/lib/rights-resolver");
  const resolved = await getEffectiveRightsForUser(user.id);
  if (!resolved || resolved.rights.rank === "employee") {
    redirect("/dashboard");
  }

  return <AdminDashboardClient />;
}
