"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Palette } from "lucide-react";
import { OrganisationEditDialog } from "./organisation-edit-dialog";
import { useTheme } from "@/contexts/theme-context";
import { capitalize, pluralize } from "@/lib/label-utils";

interface HeaderUserMenuProps {
  email: string;
  fullName: string;
  initials: string;
  avatarUrl: string | null;
  role: string;
  orgName: string;
  memberLabel: string;
  plan: string;
  requireMfa: boolean;
}

export function HeaderUserMenu({
  email,
  fullName,
  initials,
  avatarUrl,
  role,
  orgName,
  memberLabel,
  plan,
  requireMfa,
}: HeaderUserMenuProps) {
  const [showOrgEdit, setShowOrgEdit] = useState(false);
  const { theme, setTheme } = useTheme();

  return (
    <>
      <div className="flex items-center gap-3">
        <span className="hidden text-sm text-muted-foreground sm:block">
          {fullName}{" "}
          <span className="text-xs">({role === "employee" ? capitalize(memberLabel) : role})</span>
        </span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              className="relative h-9 w-9 rounded-full"
            >
              <Avatar className="h-9 w-9">
                {avatarUrl && (
                  <AvatarImage src={avatarUrl} alt={fullName} />
                )}
                <AvatarFallback>{initials}</AvatarFallback>
              </Avatar>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              className="text-xs text-muted-foreground"
              disabled
            >
              {email}
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/employees">{capitalize(pluralize(memberLabel))} Directory</Link>
            </DropdownMenuItem>
            {role === "owner" && (
              <DropdownMenuItem onSelect={() => setShowOrgEdit(true)}>
                Organisation Settings
              </DropdownMenuItem>
            )}
            {role === "owner" && (
              <DropdownMenuItem asChild>
                <Link href="/billing">Billing</Link>
              </DropdownMenuItem>
            )}
            {(role === "owner" || role === "admin") && (
              <DropdownMenuItem asChild>
                <Link href="/audit">Audit Trail</Link>
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => setTheme(theme === "dark" ? "vibrant" : "dark")}
            >
              <Palette className="mr-2 h-4 w-4" />
              {theme === "dark" ? "Vibrant theme" : "Dark theme"}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/logout">Log out</Link>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {role === "owner" && (
        <OrganisationEditDialog
          open={showOrgEdit}
          onOpenChange={setShowOrgEdit}
          orgName={orgName}
          memberLabel={memberLabel}
          plan={plan}
          requireMfa={requireMfa}
        />
      )}
    </>
  );
}
