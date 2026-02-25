"use client";

import { useState } from "react";
import { Plus, Trash2, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
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
}

export function ProfileManager({
  type,
  rightDefs,
  profiles,
  onProfilesChange,
}: ProfileManagerProps) {
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formName, setFormName] = useState("");
  const [formRights, setFormRights] = useState<Record<string, unknown>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function startAdd() {
    setAdding(true);
    setEditingId(null);
    setFormName("");
    setFormRights(buildDefaultRights(rightDefs));
    setError(null);
  }

  function startEdit(profile: Profile) {
    setEditingId(profile.id);
    setAdding(false);
    setFormName(profile.name);
    // Merge with defaults so any new rights appear
    setFormRights({ ...buildDefaultRights(rightDefs), ...profile.rights });
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

  async function handleSaveNew() {
    if (!formName.trim()) {
      setError("Profile name is required");
      return;
    }
    setLoading(true);
    setError(null);

    const result = await createProfile(type, formName.trim(), formRights);

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

    const result = await updateProfile(type, editingId, formName.trim(), formRights);

    if (!result.success) {
      setError(result.error ?? "Failed to update profile");
      setLoading(false);
      return;
    }

    onProfilesChange(
      profiles
        .map((p) =>
          p.id === editingId
            ? { ...p, name: formName.trim(), rights: formRights }
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

  const isFormOpen = adding || editingId !== null;

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
                {rightDefs
                  .filter((r) => {
                    const val = profile.rights[r.key];
                    return r.type === "boolean" ? val === true : val != null;
                  })
                  .map((r) => r.label)
                  .join(", ") || "No rights enabled"}
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
                className="flex items-center justify-between rounded-md border px-3 py-2"
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
              </div>
            ))}
          </div>

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
