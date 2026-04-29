import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { EmployeeSidebar } from "./employee-sidebar";

export default async function EmployeeMemberLayout({
  params,
  children,
}: {
  params: Promise<{ memberId: string }>;
  children: React.ReactNode;
}) {
  const { memberId } = await params;
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: caller } = await supabase
    .from("members")
    .select("organisation_id, role")
    .eq("user_id", user.id)
    .limit(1)
    .single();
  if (!caller) redirect("/organisation-setup");
  // Directory sub-pages are admin/owner only. Individual sub-pages also gate themselves;
  // this short-circuits employees at the layout boundary so they don't even see the shell.
  if (caller.role === "employee") redirect("/dashboard");
  const { data: member } = await supabase
    .from("members")
    .select("id, first_name, last_name, avatar_url, role")
    .eq("id", memberId)
    .eq("organisation_id", caller.organisation_id)
    .single();
  if (!member) notFound();

  return (
    <div className="flex">
      <EmployeeSidebar
        userId={user.id}
        member={{
          id: member.id,
          first_name: member.first_name,
          last_name: member.last_name,
          avatar_url: member.avatar_url ?? null,
          role: member.role,
        }}
      />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
