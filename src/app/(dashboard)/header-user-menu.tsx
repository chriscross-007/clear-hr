"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Palette, Users } from "lucide-react";
import { useTheme } from "@/contexts/theme-context";
import { capitalize } from "@/lib/label-utils";
import {
  getSwitchableMembers,
  type SwitchableMember,
} from "./switch-account-actions";

interface HeaderUserMenuProps {
  email: string;
  fullName: string;
  initials: string;
  avatarUrl: string | null;
  role: string;
  memberLabel: string;
  profileName: string | null;
}

export function HeaderUserMenu({
  email,
  fullName,
  initials,
  avatarUrl,
  role,
  memberLabel,
  profileName,
}: HeaderUserMenuProps) {
  const [showSwitchAccount, setShowSwitchAccount] = useState(false);
  const [switchMembers, setSwitchMembers] = useState<SwitchableMember[] | null>(null);
  const [switchLoading, setSwitchLoading] = useState(false);
  const [switchingId, setSwitchingId] = useState<string | null>(null);
  const [switchError, setSwitchError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const { theme, setTheme } = useTheme();

  async function openSwitchAccount() {
    setShowSwitchAccount(true);
    setLoadError(null);
    setSwitchError(null);
    if (switchMembers === null) {
      setSwitchLoading(true);
      try {
        const result = await getSwitchableMembers();
        if (result.success) {
          setSwitchMembers(result.members ?? []);
        } else {
          setLoadError(result.error ?? "Failed to load members");
        }
      } catch (e) {
        setLoadError(e instanceof Error ? e.message : String(e));
      } finally {
        setSwitchLoading(false);
      }
    }
  }

  function handleSwitchTo(member: SwitchableMember) {
    setSwitchingId(member.id);
    window.location.href = `/api/switch-account?memberId=${member.id}`;
  }

  return (
    <>
      <div className="flex items-center gap-3">
        <span className="hidden text-sm text-muted-foreground sm:block">
          {fullName}{" "}
          <span className="text-xs">
            ({role === "employee" ? capitalize(memberLabel) : role}
            {profileName ? ` / ${profileName}` : ""})
          </span>
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
            <DropdownMenuItem onSelect={openSwitchAccount}>
              <Users className="mr-2 h-4 w-4" />
              Switch Account
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => setTheme(theme === "dark" ? "vibrant" : "dark")}
            >
              <Palette className="mr-2 h-4 w-4" />
              {theme === "dark" ? "Vibrant theme" : "Dark theme"}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <a href="/logout">Log out</a>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <Dialog open={showSwitchAccount} onOpenChange={setShowSwitchAccount}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Switch Account</DialogTitle>
          </DialogHeader>
          {switchLoading && (
            <p className="py-4 text-center text-sm text-muted-foreground">Loading…</p>
          )}
          {loadError && (
            <p className="py-4 text-center text-sm text-destructive">{loadError}</p>
          )}
          {switchError && (
            <p className="py-2 text-center text-sm text-destructive">{switchError}</p>
          )}
          {!switchLoading && !loadError && switchMembers && (
            <div className="flex flex-col gap-1">
              {switchMembers.length === 0 && (
                <p className="py-4 text-center text-sm text-muted-foreground">No accounts found.</p>
              )}
              {switchMembers.map((m) => (
                <button
                  key={m.id}
                  disabled={switchingId === m.id}
                  className="flex items-center justify-between rounded-md px-3 py-2 text-left text-sm hover:bg-accent disabled:opacity-50 cursor-pointer"
                  onClick={() => handleSwitchTo(m)}
                >
                  <span className="font-medium">
                    {m.first_name} {m.last_name}
                  </span>
                  <span className="ml-4 text-xs capitalize text-muted-foreground">
                    {m.role}
                  </span>
                </button>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
