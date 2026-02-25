"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Info, Plus, Trash2 } from "lucide-react";
import { updateOrganisation } from "./organisation-actions";
import { getTeams, createTeam, deleteTeam, renameTeams } from "./employees/team-actions";
import { getProfiles } from "./employees/profile-actions";
import type { Profile } from "./employees/profile-actions";
import { ADMIN_RIGHTS, EMPLOYEE_RIGHTS } from "@/lib/rights-config";
import { ProfileManager } from "./organisation-edit-dialog-profiles";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface OrganisationEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orgName: string;
  memberLabel: string;
  plan: string;
  requireMfa: boolean;
}

export function OrganisationEditDialog({
  open,
  onOpenChange,
  orgName,
  memberLabel,
  plan,
  requireMfa,
}: OrganisationEditDialogProps) {
  const [name, setName] = useState(orgName);
  const [label, setLabel] = useState(memberLabel);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [teams, setTeams] = useState<{ id: string; name: string }[]>([]);
  const [originalTeams, setOriginalTeams] = useState<{ id: string; name: string }[]>([]);
  const [newTeamName, setNewTeamName] = useState("");
  const [teamLoading, setTeamLoading] = useState(false);
  const [teamError, setTeamError] = useState<string | null>(null);
  const [editingTeamId, setEditingTeamId] = useState<string | null>(null);
  const [editingTeamName, setEditingTeamName] = useState("");
  const [mfaRequired, setMfaRequired] = useState(requireMfa);
  const [adminProfiles, setAdminProfiles] = useState<Profile[]>([]);
  const [employeeProfiles, setEmployeeProfiles] = useState<Profile[]>([]);
  const router = useRouter();

  useEffect(() => {
    if (open) {
      setName(orgName);
      setLabel(memberLabel);
      setError(null);
      setTeamError(null);
      setNewTeamName("");
      setEditingTeamId(null);
      setEditingTeamName("");
      setMfaRequired(requireMfa);
      // Load teams
      getTeams().then((result) => {
        if (result.success && result.teams) {
          setTeams(result.teams);
          setOriginalTeams(result.teams);
        }
      });
      // Load profiles
      getProfiles("admin").then((result) => {
        if (result.success && result.profiles) setAdminProfiles(result.profiles);
      });
      getProfiles("employee").then((result) => {
        if (result.success && result.profiles) setEmployeeProfiles(result.profiles);
      });
    }
  }, [open, orgName, memberLabel, requireMfa]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    // Save any pending team renames
    const pendingRenames = teams
      .filter((t) => {
        const orig = originalTeams.find((o) => o.id === t.id);
        return orig && orig.name !== t.name;
      })
      .map((t) => ({ id: t.id, newName: t.name }));

    if (pendingRenames.length > 0) {
      const renameResult = await renameTeams(pendingRenames);
      if (!renameResult.success) {
        setTeamError(renameResult.error ?? "Failed to rename teams");
        setLoading(false);
        return;
      }
    }

    const result = await updateOrganisation({
      name,
      memberLabel: label,
      requireMfa: mfaRequired,
    });

    if (!result.success) {
      setError(result.error ?? "Failed to update organisation");
      setLoading(false);
    } else {
      setLoading(false);
      onOpenChange(false);
      router.refresh();
    }
  }

  async function handleAddTeam() {
    if (!newTeamName.trim()) return;
    setTeamLoading(true);
    setTeamError(null);

    const result = await createTeam(newTeamName.trim());

    if (!result.success) {
      setTeamError(result.error ?? "Failed to create team");
    } else if (result.team) {
      setTeams((prev) => [...prev, result.team!].sort((a, b) => a.name.localeCompare(b.name)));
      setNewTeamName("");
    }
    setTeamLoading(false);
  }

  async function handleDeleteTeam(teamId: string) {
    setTeamError(null);
    const result = await deleteTeam(teamId);

    if (!result.success) {
      setTeamError(result.error ?? "Failed to delete team");
    } else {
      setTeams((prev) => prev.filter((t) => t.id !== teamId));
    }
  }

  function startEditingTeam(team: { id: string; name: string }) {
    setEditingTeamId(team.id);
    setEditingTeamName(team.name);
    setTeamError(null);
  }

  function handleRenameTeam(teamId: string) {
    const trimmed = editingTeamName.trim();
    if (!trimmed) {
      // Revert to current name if empty
      setEditingTeamId(null);
      return;
    }
    setTeams((prev) =>
      prev
        .map((t) => (t.id === teamId ? { ...t, name: trimmed } : t))
        .sort((a, b) => a.name.localeCompare(b.name))
    );
    setEditingTeamId(null);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Organisation Settings</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <Tabs defaultValue="general" className="w-full">
            <TabsList className="w-full">
              <TabsTrigger value="general" className="flex-1">General</TabsTrigger>
              <TabsTrigger value="teams" className="flex-1">Teams</TabsTrigger>
              <TabsTrigger value="admin-profiles" className="flex-1">Admin Profiles</TabsTrigger>
              <TabsTrigger value="employee-profiles" className="flex-1">Employee Profiles</TabsTrigger>
            </TabsList>

            {/* General tab */}
            <TabsContent value="general" className="space-y-4 mt-4">
              {error && (
                <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                  {error}
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="org-name">Organisation Name</Label>
                <Input
                  id="org-name"
                  type="text"
                  maxLength={50}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-1.5">
                  <Label htmlFor="org-member-label">Member Type</Label>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Info className="h-4 w-4 text-muted-foreground cursor-help" />
                    </TooltipTrigger>
                    <TooltipContent side="right" className="max-w-xs">
                      <p>
                        How you refer to employees e.g. colleague, employee, member
                        etc. This word will be used throughout the app.
                      </p>
                    </TooltipContent>
                  </Tooltip>
                </div>
                <Input
                  id="org-member-label"
                  type="text"
                  placeholder="e.g. employee, colleague, member"
                  maxLength={50}
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                />
              </div>
              <div className="flex items-center justify-between rounded-md border px-3 py-3">
                <div className="space-y-0.5">
                  <Label htmlFor="org-require-mfa">Require Two-Factor Authentication</Label>
                  <p className="text-xs text-muted-foreground">
                    All members must verify with an authenticator app when signing in
                  </p>
                </div>
                <Switch
                  id="org-require-mfa"
                  checked={mfaRequired}
                  onCheckedChange={setMfaRequired}
                />
              </div>
              <div className="space-y-2">
                <Label>Plan</Label>
                <div className="flex items-center justify-between rounded-md border px-3 py-2">
                  <span className="text-sm">{plan} plan</span>
                  <Link
                    href="/billing"
                    className="text-sm text-primary underline-offset-4 hover:underline"
                    onClick={() => onOpenChange(false)}
                  >
                    Manage billing
                  </Link>
                </div>
              </div>
            </TabsContent>

            {/* Teams tab */}
            <TabsContent value="teams" className="space-y-3 mt-4">
              {teamError && (
                <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                  {teamError}
                </div>
              )}
              {teams.length === 0 && (
                <p className="text-sm text-muted-foreground">No teams yet</p>
              )}
              {teams.map((team) => (
                <div
                  key={team.id}
                  className={`flex items-center justify-between rounded-md border px-3 py-1.5 ${editingTeamId !== team.id ? "cursor-pointer hover:bg-muted/50" : ""}`}
                  onClick={() => editingTeamId !== team.id && startEditingTeam(team)}
                >
                  {editingTeamId === team.id ? (
                    <Input
                      type="text"
                      maxLength={50}
                      value={editingTeamName}
                      onChange={(e) => setEditingTeamName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          handleRenameTeam(team.id);
                        }
                        if (e.key === "Escape") {
                          setEditingTeamId(null);
                        }
                      }}
                      onBlur={() => handleRenameTeam(team.id)}
                      autoFocus
                      className="h-7 text-sm"
                    />
                  ) : (
                    <span className="text-sm">{team.name}</span>
                  )}
                  <div className="flex items-center shrink-0 ml-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteTeam(team.id);
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  </div>
                </div>
              ))}
              <div className="flex gap-2">
                <Input
                  type="text"
                  placeholder="New team name"
                  maxLength={50}
                  value={newTeamName}
                  onChange={(e) => setNewTeamName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleAddTeam();
                    }
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={handleAddTeam}
                  disabled={teamLoading || !newTeamName.trim()}
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
            </TabsContent>

            {/* Admin Profiles tab */}
            <TabsContent value="admin-profiles" className="mt-4">
              <ProfileManager
                type="admin"
                rightDefs={ADMIN_RIGHTS}
                profiles={adminProfiles}
                onProfilesChange={setAdminProfiles}
              />
            </TabsContent>

            {/* Employee Profiles tab */}
            <TabsContent value="employee-profiles" className="mt-4">
              <ProfileManager
                type="employee"
                rightDefs={EMPLOYEE_RIGHTS}
                profiles={employeeProfiles}
                onProfilesChange={setEmployeeProfiles}
              />
            </TabsContent>
          </Tabs>

          <DialogFooter className="mt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? "Saving..." : "Save changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
