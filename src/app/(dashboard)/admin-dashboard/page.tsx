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
  if (member.role !== "admin" && member.role !== "owner") {
    redirect("/dashboard");
  }

  return <AdminDashboardClient />;
}
