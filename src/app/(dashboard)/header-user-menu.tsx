"use client";

import { useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
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
import { Palette, Repeat, Users } from "lucide-react";
import { useTheme } from "@/contexts/theme-context";
import { capitalize } from "@/lib/label-utils";
import {
  getSwitchableMembers,
  type SwitchableMember,
} from "./switch-account-actions";
import { setViewMode } from "./view-mode-actions";

interface HeaderUserMenuProps {
  email: string;
  fullName: string;
  initials: string;
  avatarUrl: string | null;
  // CLE-196b-1 — was `role: string`. Now the rank enum from the
  // Rights Profiles v2 resolver.
  rank: "employee" | "manager" | "hr" | "admin";
  memberLabel: string;
  profileName: string | null;
  // CLE-218 — View mode toggle. `viewMode` is the currently active
  // mode; `realProfileName` is the caller's real profile name (used
  // for the chip label when viewMode === "admin"). `canSwitchView`
  // gates the toggle button — only real admin-scope callers see it.
  viewMode: "self" | "admin";
  canSwitchView: boolean;
  realProfileName: string | null;
}

export function HeaderUserMenu({
  email,
  fullName,
  initials,
  avatarUrl,
  rank,
  memberLabel,
  profileName,
  viewMode,
  canSwitchView,
  realProfileName,
}: HeaderUserMenuProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [isSwitching, startSwitchTransition] = useTransition();
  const [switchViewError, setSwitchViewError] = useState<string | null>(null);
  const [showSwitchAccount, setShowSwitchAccount] = useState(false);
  const [switchMembers, setSwitchMembers] = useState<SwitchableMember[] | null>(null);
  const [switchLoading, setSwitchLoading] = useState(false);
  const [switchingId, setSwitchingId] = useState<string | null>(null);
  const [switchError, setSwitchError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const { theme, setTheme } = useTheme();

  // Chip label — in self mode force "Employee" (the profile shown to
  // real employees), otherwise render the caller's real profile name
  // with the same fallbacks as before.
  const chipLabel =
    viewMode === "self"
      ? "Employee"
      : (realProfileName ??
          profileName ??
          (rank === "employee"
            ? capitalize(memberLabel)
            : rank === "hr"
              ? "HR"
              : capitalize(rank)));

  function handleSwitchView() {
    setSwitchViewError(null);
    const target: "self" | "admin" = viewMode === "self" ? "admin" : "self";
    startSwitchTransition(async () => {
      const result = await setViewMode(target, pathname ?? undefined);
      if (!result.success) {
        setSwitchViewError(result.error);
        return;
      }
      const dest = result.redirectTo ?? pathname ?? "/dashboard";
      router.push(dest);
      router.refresh();
    });
  }

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
            {/* CLE-198 follow-up + CLE-218 — Show the profile name
                (what the user actually sees in Settings → User
                Rights). In "self" view mode the chip flips to
                "Employee". */}
            ({chipLabel})
          </span>
        </span>
        {canSwitchView && (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 gap-1 px-2 text-xs"
            onClick={handleSwitchView}
            disabled={isSwitching}
            title={
              viewMode === "self"
                ? "Return to Admin View"
                : "View the app as an Employee"
            }
            aria-label="Switch view"
          >
            <Repeat className="h-3.5 w-3.5" />
            <span className="hidden md:inline">
              {viewMode === "self" ? "Admin View" : "Switch View"}
            </span>
          </Button>
        )}
        {switchViewError && (
          <span
            className="hidden text-xs text-destructive sm:block"
            role="alert"
          >
            {switchViewError}
          </span>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              className="relative h-9 w-9 rounded-full"
              suppressHydrationWarning
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
              onSelect={() => setTheme(theme === "dark" ? "vibrant" : theme === "vibrant" ? "bq" : "dark")}
            >
              <Palette className="mr-2 h-4 w-4" />
              {theme === "dark" ? "Vibrant theme" : theme === "vibrant" ? "B&Q theme" : "Dark theme"}
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
                  <span className="ml-4 text-xs text-muted-foreground">
                    {m.profile_name ?? "—"}
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
