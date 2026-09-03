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

  // Only admins and owners
  const { getEffectiveRightsForUser } = await import("@/lib/rights-resolver");
  const resolved = await getEffectiveRightsForUser(user.id);
  if (!resolved) redirect("/organisation-setup");
  if (resolved.rights.rank === "employee") {
    redirect("/dashboard");
  }

  return <AdminDashboardClient />;
}
