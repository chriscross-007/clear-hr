import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { EmployeesClient } from "./employees-client";

export default async function EmployeesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: members } = await supabase.rpc("get_org_members");

  const { data: membership } = await supabase
    .from("members")
    .select("role, permissions")
    .eq("user_id", user.id)
    .limit(1)
    .single();

  const canManage =
    membership?.role === "owner" ||
    (membership?.role === "admin" &&
      (membership?.permissions as Record<string, boolean>)
        ?.can_manage_members === true);

  return (
    <EmployeesClient initialMembers={members ?? []} canManage={canManage} />
  );
}
