import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { MemberLabelProvider } from "@/contexts/member-label-context";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: membership } = await supabase
    .from("members")
    .select("organisation_id, role, organisations(name, member_label)")
    .eq("user_id", user.id)
    .limit(1)
    .single();

  if (!membership) redirect("/organisation-setup");

  const org = membership.organisations as unknown as {
    name: string;
    member_label: string;
  };
  const memberLabel = org?.member_label || "member";

  return (
    <MemberLabelProvider memberLabel={memberLabel}>
      <div className="flex min-h-screen flex-col">
        <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
          <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
            <Link href="/employees" className="text-xl font-bold">
              ClearHR
            </Link>

            <div className="flex items-center gap-2">
              <span className="hidden text-sm text-muted-foreground sm:block">
                {org?.name}
              </span>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    className="relative h-9 w-9 rounded-full"
                  >
                    <Avatar className="h-9 w-9">
                      <AvatarFallback>
                        {user.email?.charAt(0).toUpperCase() ?? "U"}
                      </AvatarFallback>
                    </Avatar>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    className="text-xs text-muted-foreground"
                    disabled
                  >
                    {user.email}
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link href="/logout">Log out</Link>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </header>
        <main className="flex-1">{children}</main>
      </div>
    </MemberLabelProvider>
  );
}
