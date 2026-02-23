"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Info, Plus, Trash2 } from "lucide-react";
import { updateOrganisation } from "./organisation-actions";
import { getTeams, createTeam, deleteTeam } from "./employees/team-actions";
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
  const [newTeamName, setNewTeamName] = useState("");
  const [teamLoading, setTeamLoading] = useState(false);
  const [teamError, setTeamError] = useState<string | null>(null);
  const [mfaRequired, setMfaRequired] = useState(requireMfa);
  const router = useRouter();

  useEffect(() => {
    if (open) {
      setName(orgName);
      setLabel(memberLabel);
      setError(null);
      setTeamError(null);
      setNewTeamName("");
      setMfaRequired(requireMfa);
      // Load teams
      getTeams().then((result) => {
        if (result.success && result.teams) {
          setTeams(result.teams);
        }
      });
    }
  }, [open, orgName, memberLabel, requireMfa]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Organisation Settings</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
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
          <div className="space-y-2">
            <Label>Teams</Label>
            {teamError && (
              <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                {teamError}
              </div>
            )}
            <div className="rounded-md border p-3 space-y-2">
              {teams.length === 0 && (
                <p className="text-sm text-muted-foreground">No teams yet</p>
              )}
              {teams.map((team) => (
                <div
                  key={team.id}
                  className="flex items-center justify-between rounded-md border px-3 py-1.5"
                >
                  <span className="text-sm">{team.name}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => handleDeleteTeam(team.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
                  </Button>
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
            </div>
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
          <DialogFooter>
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
