"use client";

import { useState } from "react";
import { Plus, Trash2, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import type { RightDef } from "@/lib/rights-config";
import { buildDefaultRights } from "@/lib/rights-config";
import type { Profile } from "./employees/profile-actions";
import {
  createProfile,
  updateProfile,
  deleteProfile,
} from "./employees/profile-actions";

interface ProfileManagerProps {
  type: "admin" | "employee";
  rightDefs: RightDef[];
  profiles: Profile[];
  onProfilesChange: (profiles: Profile[]) => void;
  teams?: { id: string; name: string }[];
}

type TeamScope = "own" | "all" | "selected";

interface TeamAccess {
  scope: TeamScope;
  ids: string[];
}

function getTeamAccess(rights: Record<string, unknown>): TeamAccess {
  const oa = rights["object_access"] as
    | { teams?: { scope: TeamScope; ids: string[] } }
    | undefined;
  return oa?.teams ?? { scope: "own", ids: [] };
}

function teamScopeLabel(scope: TeamScope): string {
  if (scope === "all") return "All teams";
  if (scope === "own") return "Own team(s)";
  return "Selected teams";
}

export function ProfileManager({
  type,
  rightDefs,
  profiles,
  onProfilesChange,
  teams = [],
}: ProfileManagerProps) {
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formName, setFormName] = useState("");
  const [formRights, setFormRights] = useState<Record<string, unknown>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function getFormTeamAccess(): TeamAccess {
    return getTeamAccess(formRights);
  }

  function setFormTeamAccess(ta: TeamAccess) {
    const oa = (formRights["object_access"] as Record<string, unknown>) ?? {};
    setFormRights((prev) => ({
      ...prev,
      object_access: { ...oa, teams: ta },
    }));
  }

  function startAdd() {
    setAdding(true);
    setEditingId(null);
    setFormName("");
    const defaults = buildDefaultRights(rightDefs);
    if (type === "admin") {
      defaults["object_access"] = { teams: { scope: "own", ids: [] } };
    }
    setFormRights(defaults);
    setError(null);
  }

  function startEdit(profile: Profile) {
    setEditingId(profile.id);
    setAdding(false);
    setFormName(profile.name);
    const merged = { ...buildDefaultRights(rightDefs), ...profile.rights };
    if (type === "admin" && !merged["object_access"]) {
      merged["object_access"] = { teams: { scope: "own", ids: [] } };
    }
    setFormRights(merged);
    setError(null);
  }

  function cancelForm() {
    setAdding(false);
    setEditingId(null);
    setFormName("");
    setFormRights({});
    setError(null);
  }

  function toggleRight(key: string, value: unknown) {
    setFormRights((prev) => ({ ...prev, [key]: value }));
  }

  function buildSaveRights(): Record<string, unknown> {
    const rights = { ...formRights };
    if (type === "admin") {
      const ta = getTeamAccess(rights);
      rights["can_view_all_teams"] = ta.scope === "all";
    }
    return rights;
  }

  async function handleSaveNew() {
    if (!formName.trim()) {
      setError("Profile name is required");
      return;
    }
    setLoading(true);
    setError(null);

    const result = await createProfile(type, formName.trim(), buildSaveRights());

    if (!result.success) {
      setError(result.error ?? "Failed to create profile");
      setLoading(false);
      return;
    }

    if (result.profile) {
      onProfilesChange(
        [...profiles, result.profile].sort((a, b) =>
          a.name.localeCompare(b.name)
        )
      );
    }
    cancelForm();
    setLoading(false);
  }

  async function handleSaveEdit() {
    if (!editingId || !formName.trim()) {
      setError("Profile name is required");
      return;
    }
    setLoading(true);
    setError(null);

    const saveRights = buildSaveRights();
    const result = await updateProfile(type, editingId, formName.trim(), saveRights);

    if (!result.success) {
      setError(result.error ?? "Failed to update profile");
      setLoading(false);
      return;
    }

    onProfilesChange(
      profiles
        .map((p) =>
          p.id === editingId
            ? { ...p, name: formName.trim(), rights: saveRights }
            : p
        )
        .sort((a, b) => a.name.localeCompare(b.name))
    );
    cancelForm();
    setLoading(false);
  }

  async function handleDelete(profileId: string) {
    setError(null);
    const result = await deleteProfile(type, profileId);

    if (!result.success) {
      setError(result.error ?? "Failed to delete profile");
      return;
    }

    onProfilesChange(profiles.filter((p) => p.id !== profileId));
    if (editingId === profileId) cancelForm();
  }

  function profileSummary(profile: Profile): string {
    const rights = rightDefs
      .filter((r) => {
        const val = profile.rights[r.key];
        if (r.type === "boolean") return val === true;
        return val === "read" || val === "write";
      })
      .map((r) => {
        if (r.type === "access") {
          return `${r.label} (${profile.rights[r.key]})`;
        }
        return r.label;
      });

    if (type === "admin") {
      const ta = getTeamAccess(profile.rights as Record<string, unknown>);
      if (ta.scope === "selected") {
        const names = ta.ids
          .map((id) => teams.find((t) => t.id === id)?.name ?? id)
          .join(", ");
        rights.push(names ? `${names} only` : "No teams selected");
      } else {
        rights.push(teamScopeLabel(ta.scope));
      }
    }

    return rights.join(", ") || "No rights enabled";
  }

  const isFormOpen = adding || editingId !== null;
  const formTeamAccess = getFormTeamAccess();

  return (
    <div className="space-y-3">
      {error && (
        <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Profile list */}
      {profiles.length === 0 && !isFormOpen && (
        <p className="text-sm text-muted-foreground">No profiles yet</p>
      )}

      {profiles.map((profile) =>
        editingId === profile.id ? null : (
          <div
            key={profile.id}
            className="flex items-center justify-between rounded-md border px-3 py-2 cursor-pointer hover:bg-muted/50"
            onClick={() => startEdit(profile)}
          >
            <div className="min-w-0">
              <span className="text-sm font-medium">{profile.name}</span>
              <div className="mt-0.5 text-xs text-muted-foreground">
                {profileSummary(profile)}
              </div>
            </div>
            <div className="flex items-center shrink-0 ml-2">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={(e) => {
                  e.stopPropagation();
                  handleDelete(profile.id);
                }}
              >
                <Trash2 className="h-3.5 w-3.5 text-destructive" />
              </Button>
            </div>
          </div>
        )
      )}

      {/* Add / Edit form */}
      {isFormOpen && (
        <div className="rounded-md border p-3 space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Profile Name</Label>
            <Input
              type="text"
              maxLength={50}
              placeholder="e.g. Team Leader, Basic Access"
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <Label className="text-xs">Rights</Label>
            {rightDefs.map((right) => (
              <div
                key={right.key}
                className={cn(
                  "rounded-md border px-3 py-2",
                  right.type === "boolean"
                    ? "flex items-center justify-between"
                    : "flex flex-col gap-2"
                )}
              >
                <div className="min-w-0">
                  <span className="text-sm">{right.label}</span>
                  {right.description && (
                    <p className="text-xs text-muted-foreground">
                      {right.description}
                    </p>
                  )}
                </div>
                {right.type === "boolean" && (
                  <Switch
                    checked={formRights[right.key] === true}
                    onCheckedChange={(checked) =>
                      toggleRight(right.key, checked)
                    }
                  />
                )}
                {right.type === "access" && (
                  <div className="flex overflow-hidden rounded-md border text-xs self-start">
                    {(["none", "read", "write"] as const).map((option) => (
                      <button
                        key={option}
                        type="button"
                        className={cn(
                          "px-3 py-1.5 capitalize transition-colors",
                          formRights[right.key] === option
                            ? "bg-primary text-primary-foreground"
                            : "hover:bg-muted"
                        )}
                        onClick={() => toggleRight(right.key, option)}
                      >
                        {option}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Team Access — admin profiles only */}
          {type === "admin" && (
            <div className="space-y-2">
              <Label className="text-xs">Team Access</Label>
              <div className="rounded-md border px-3 py-2 space-y-2">
                <div className="flex overflow-hidden rounded-md border text-xs self-start">
                  {(["own", "all", "selected"] as const).map((scope) => (
                    <button
                      key={scope}
                      type="button"
                      className={cn(
                        "px-3 py-1.5 transition-colors",
                        formTeamAccess.scope === scope
                          ? "bg-primary text-primary-foreground"
                          : "hover:bg-muted"
                      )}
                      onClick={() =>
                        setFormTeamAccess({
                          scope,
                          ids: scope === "selected" ? formTeamAccess.ids : [],
                        })
                      }
                    >
                      {scope === "own" ? "Own team(s)" : scope === "all" ? "All teams" : "Specific teams"}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  {formTeamAccess.scope === "own" && "Admin can see members in their own team(s) only."}
                  {formTeamAccess.scope === "all" && "Admin can see members across all teams."}
                  {formTeamAccess.scope === "selected" && "Admin can see members in the selected teams only. Unteamed members are hidden."}
                </p>

                {formTeamAccess.scope === "selected" && teams.length > 0 && (
                  <div className="max-h-40 overflow-y-auto space-y-1 pt-1 border-t">
                    {teams.map((team) => {
                      const checked = formTeamAccess.ids.includes(team.id);
                      return (
                        <label
                          key={team.id}
                          className="flex items-center gap-2 cursor-pointer rounded px-1 py-1 hover:bg-muted/50 text-sm"
                        >
                          <input
                            type="checkbox"
                            className="h-3.5 w-3.5 rounded"
                            checked={checked}
                            onChange={() => {
                              const ids = checked
                                ? formTeamAccess.ids.filter((id) => id !== team.id)
                                : [...formTeamAccess.ids, team.id];
                              setFormTeamAccess({ scope: "selected", ids });
                            }}
                          />
                          {team.name}
                        </label>
                      );
                    })}
                  </div>
                )}

                {formTeamAccess.scope === "selected" && teams.length === 0 && (
                  <p className="text-xs text-muted-foreground pt-1 border-t">
                    No teams have been created yet.
                  </p>
                )}
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={cancelForm}
              disabled={loading}
            >
              <X className="mr-1 h-3.5 w-3.5" />
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={adding ? handleSaveNew : handleSaveEdit}
              disabled={loading || !formName.trim()}
            >
              <Check className="mr-1 h-3.5 w-3.5" />
              {loading ? "Saving..." : adding ? "Create" : "Update"}
            </Button>
          </div>
        </div>
      )}

      {/* Add button */}
      {!isFormOpen && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={startAdd}
          className="w-full"
        >
          <Plus className="mr-1 h-4 w-4" />
          Add Profile
        </Button>
      )}
    </div>
  );
}
