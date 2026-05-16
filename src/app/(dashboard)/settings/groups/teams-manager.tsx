"use client";

// CLE-191 — Teams manager for the new Groups sub-route. Lifted from
// the dialog's Teams tab and made per-row auto-save (no global save).
// Add/Delete fire immediately; rename commits on blur/Enter; min cover
// and approver commit on change.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import {
  createTeam,
  deleteTeam,
  renameTeams,
  updateTeamMinCover,
  updateTeamApprover,
  updateTeamBlockCover,
} from "@/app/(dashboard)/employees/team-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Team = {
  id: string;
  name: string;
  min_cover: number | null;
  approver_id: string | null;
  block_cover_violations: boolean;
};

type ApproverMember = { id: string; name: string };

interface TeamsManagerProps {
  initialTeams: Team[];
  approverMembers: ApproverMember[];
}

export function TeamsManager({ initialTeams, approverMembers }: TeamsManagerProps) {
  const router = useRouter();
  const [teams, setTeams] = useState<Team[]>(initialTeams);
  const [newTeamName, setNewTeamName] = useState("");
  const [editingTeamId, setEditingTeamId] = useState<string | null>(null);
  const [editingTeamName, setEditingTeamName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAdd() {
    const name = newTeamName.trim();
    if (!name) return;
    setLoading(true);
    setError(null);
    const result = await createTeam(name);
    setLoading(false);
    if (!result.success || !result.team) {
      setError(result.error ?? "Failed to create team");
      return;
    }
    setTeams((prev) =>
      [
        ...prev,
        { ...result.team!, min_cover: null, approver_id: null, block_cover_violations: false },
      ].sort((a, b) => a.name.localeCompare(b.name)),
    );
    setNewTeamName("");
    router.refresh();
  }

  async function handleDelete(teamId: string) {
    setError(null);
    const result = await deleteTeam(teamId);
    if (!result.success) {
      setError(result.error ?? "Failed to delete team");
      return;
    }
    setTeams((prev) => prev.filter((t) => t.id !== teamId));
    router.refresh();
  }

  async function commitRename(teamId: string) {
    const trimmed = editingTeamName.trim();
    setEditingTeamId(null);
    if (!trimmed) return;
    const current = teams.find((t) => t.id === teamId);
    if (!current || current.name === trimmed) return;
    const next = teams
      .map((t) => (t.id === teamId ? { ...t, name: trimmed } : t))
      .sort((a, b) => a.name.localeCompare(b.name));
    setTeams(next);
    const result = await renameTeams([{ id: teamId, newName: trimmed }]);
    if (!result.success) {
      setError(result.error ?? "Failed to rename team");
      // Revert on failure.
      setTeams((prev) => prev.map((t) => (t.id === teamId ? current : t)));
    }
  }

  async function commitMinCover(teamId: string, value: number | null) {
    const current = teams.find((t) => t.id === teamId);
    if (!current) return;
    setTeams((prev) => prev.map((t) => (t.id === teamId ? { ...t, min_cover: value } : t)));
    const result = await updateTeamMinCover(teamId, value);
    if (!result.success) {
      setError(result.error ?? "Failed to update min cover");
      setTeams((prev) => prev.map((t) => (t.id === teamId ? current : t)));
    }
  }

  async function commitApprover(teamId: string, approverId: string | null) {
    const current = teams.find((t) => t.id === teamId);
    if (!current) return;
    setTeams((prev) => prev.map((t) => (t.id === teamId ? { ...t, approver_id: approverId } : t)));
    const result = await updateTeamApprover(teamId, approverId);
    if (!result.success) {
      setError(result.error ?? "Failed to update approver");
      setTeams((prev) => prev.map((t) => (t.id === teamId ? current : t)));
    }
  }

  async function commitBlockCover(teamId: string, blockCover: boolean) {
    const current = teams.find((t) => t.id === teamId);
    if (!current) return;
    setTeams((prev) => prev.map((t) => (t.id === teamId ? { ...t, block_cover_violations: blockCover } : t)));
    const result = await updateTeamBlockCover(teamId, blockCover);
    if (!result.success) {
      setError(result.error ?? "Failed to update cover block flag");
      setTeams((prev) => prev.map((t) => (t.id === teamId ? current : t)));
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Teams</CardTitle>
        <p className="text-xs text-muted-foreground">
          Changes save automatically. Click a row to rename; the approver dropdown and min-cover input commit on change.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {error && (
          <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div>
        )}

        {teams.length === 0 && (
          <p className="text-sm text-muted-foreground">No teams yet.</p>
        )}

        {teams.length > 0 && (
          <div className="flex items-center px-3 gap-2">
            <span className="text-xs text-muted-foreground font-medium flex-1">Team name</span>
            <span className="text-xs text-muted-foreground font-medium w-36">Holiday approver</span>
            <span className="text-xs text-muted-foreground font-medium w-20">Min cover</span>
            <span
              className="text-xs text-muted-foreground font-medium w-24 text-center"
              title="When ON, requests that would drop the team below Min cover are blocked. When OFF the booking goes through with a cover warning."
            >
              Block on cover
            </span>
            <span className="w-7" />
          </div>
        )}

        {teams.map((team) => (
          <div
            key={team.id}
            className={`flex items-center rounded-md border px-3 py-1.5 gap-2 ${editingTeamId !== team.id ? "cursor-pointer hover:bg-muted/50" : ""}`}
            onClick={() => {
              if (editingTeamId !== team.id) {
                setEditingTeamId(team.id);
                setEditingTeamName(team.name);
              }
            }}
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
                    commitRename(team.id);
                  }
                  if (e.key === "Escape") {
                    setEditingTeamId(null);
                  }
                }}
                onBlur={() => commitRename(team.id)}
                autoFocus
                className="h-7 text-sm flex-1"
              />
            ) : (
              <span className="text-sm flex-1">{team.name}</span>
            )}
            <div className="flex items-center shrink-0 ml-2 gap-1">
              <select
                className="h-7 w-36 rounded-md border border-input bg-background px-2 text-xs"
                value={team.approver_id ?? "__none__"}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => {
                  const val = e.target.value === "__none__" ? null : e.target.value;
                  commitApprover(team.id, val);
                }}
              >
                <option value="__none__">No approver</option>
                {approverMembers.map((m) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
              <Input
                type="number"
                min={0}
                placeholder="No min"
                className="w-20 h-7 text-xs"
                title="Minimum team cover"
                value={team.min_cover ?? ""}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => {
                  const v = e.target.value;
                  // Update local immediately for snappy typing, commit on blur.
                  const next = v === "" ? null : parseInt(v, 10);
                  setTeams((prev) => prev.map((t) => (t.id === team.id ? { ...t, min_cover: next } : t)));
                }}
                onBlur={() => commitMinCover(team.id, team.min_cover)}
              />
              <div
                className="w-24 flex justify-center"
                onClick={(e) => e.stopPropagation()}
                title="When ON, requests breaching min cover are hard-blocked. When OFF a warning is shown but the booking can proceed."
              >
                <Switch
                  checked={team.block_cover_violations}
                  onCheckedChange={(checked) => commitBlockCover(team.id, checked)}
                />
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={(e) => {
                  e.stopPropagation();
                  handleDelete(team.id);
                }}
              >
                <Trash2 className="h-3.5 w-3.5 text-destructive" />
              </Button>
            </div>
          </div>
        ))}

        <div className="flex gap-2 pt-2">
          <Input
            type="text"
            placeholder="New team name"
            maxLength={50}
            value={newTeamName}
            onChange={(e) => setNewTeamName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleAdd();
              }
            }}
          />
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={handleAdd}
            disabled={loading || !newTeamName.trim()}
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
