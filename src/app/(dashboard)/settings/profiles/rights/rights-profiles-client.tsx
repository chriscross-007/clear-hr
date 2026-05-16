"use client";

// CLE-191 — Rights profiles list + popup CRUD. Replaces the inline-form
// pattern of the legacy ProfileManager. Owns its own list state and
// talks directly to createProfile / updateProfile / deleteProfile.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Copy, GripVertical } from "lucide-react";
import {
  createProfile,
  updateProfile,
  deleteProfile,
  reorderProfiles,
  type Profile,
} from "@/app/(dashboard)/employees/profile-actions";
import type { RightDef } from "@/lib/rights-config";
import { buildDefaultRights, coerceAccess } from "@/lib/rights-config";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { useMemberLabel } from "@/contexts/member-label-context";
import { capitalize, pluralize } from "@/lib/label-utils";
import { PROFILE_TYPES } from "../profile-types";
import { useListReorder } from "../use-list-reorder";

type ProfileType = "admin" | "employee";
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

function scopeLabel(scope: TeamScope): string {
  if (scope === "all") return "All teams";
  if (scope === "own") return "Own team(s)";
  return "Selected teams";
}

interface RightsProfilesClientProps {
  initialAdminProfiles: Profile[];
  initialEmployeeProfiles: Profile[];
  /** Admins (role='admin') in the org with no `admin_profile_id` set. */
  initialAdminNoProfileCount: number;
  /** Employees (role='employee') in the org with no `employee_profile_id` set. */
  initialEmployeeNoProfileCount: number;
  teams: { id: string; name: string }[];
  adminRights: RightDef[];
  employeeRights: RightDef[];
}

export function RightsProfilesClient({
  initialAdminProfiles,
  initialEmployeeProfiles,
  initialAdminNoProfileCount,
  initialEmployeeNoProfileCount,
  teams,
  adminRights,
  employeeRights,
}: RightsProfilesClientProps) {
  const { memberLabel } = useMemberLabel();
  const memberLabelCap = capitalize(memberLabel);
  const [type, setType] = useState<ProfileType>("admin");
  const [adminProfiles, setAdminProfiles] = useState<Profile[]>(initialAdminProfiles);
  const [employeeProfiles, setEmployeeProfiles] = useState<Profile[]>(initialEmployeeProfiles);
  const [adminNoProfileCount, setAdminNoProfileCount] = useState(initialAdminNoProfileCount);
  const [employeeNoProfileCount, setEmployeeNoProfileCount] = useState(initialEmployeeNoProfileCount);

  const profiles = type === "admin" ? adminProfiles : employeeProfiles;
  const rightDefs = type === "admin" ? adminRights : employeeRights;
  const setProfiles = type === "admin" ? setAdminProfiles : setEmployeeProfiles;
  const noProfileCount = type === "admin" ? adminNoProfileCount : employeeNoProfileCount;
  const setNoProfileCount =
    type === "admin" ? setAdminNoProfileCount : setEmployeeNoProfileCount;
  // Roles use plural English for the summary footer. Admins stay literal;
  // employees go through the dynamic member-label so e.g. "Colleagues" or
  // "Members" stays consistent with the rest of the app.
  const roleLabelPlural = type === "admin" ? "admins" : pluralize(memberLabel);
  const onProfileTotal = profiles.reduce((sum, p) => sum + (p.memberCount ?? 0), 0);

  const [editing, setEditing] = useState<Profile | null>(null);
  const [creating, setCreating] = useState(false);
  const [copyFrom, setCopyFrom] = useState<Profile | null>(null);
  const [deleting, setDeleting] = useState<Profile | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const editorOpen = editing !== null || creating;

  const { rowProps, rowClassExtra } = useListReorder<Profile>({
    items: profiles,
    setItems: setProfiles,
    onReorder: (orderedIds) => reorderProfiles(type, orderedIds),
    onError: setError,
  });

  function profileSummary(profile: Profile): string {
    const rights = rightDefs
      .filter((r) => {
        const v = profile.rights[r.key];
        if (r.type === "boolean") return v === true;
        return v === "read" || v === "write";
      })
      .map((r) =>
        r.type === "access" ? `${r.label} (${profile.rights[r.key]})` : r.label,
      );
    if (type === "admin") {
      const ta = getTeamAccess(profile.rights as Record<string, unknown>);
      if (ta.scope === "selected") {
        const names = ta.ids
          .map((id) => teams.find((t) => t.id === id)?.name ?? id)
          .join(", ");
        rights.push(names ? `${names} only` : "No teams selected");
      } else {
        rights.push(scopeLabel(ta.scope));
      }
    }
    return rights.join(", ") || "No rights enabled";
  }

  async function handleDelete() {
    if (!deleting) return;
    setDeleteLoading(true);
    setError(null);
    const result = await deleteProfile(type, deleting.id);
    setDeleteLoading(false);
    if (!result.success) {
      setError(result.error ?? "Failed to delete profile");
      return;
    }
    // Members on the deleted profile shift to "no profile" (DB FK is
    // ON DELETE SET NULL). Bump the unassigned count to match.
    const shifted = deleting.memberCount ?? 0;
    setProfiles((prev) => prev.filter((p) => p.id !== deleting.id));
    if (shifted > 0) setNoProfileCount((n) => n + shifted);
    setDeleting(null);
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{PROFILE_TYPES.rights.label}</CardTitle>
          <p className="text-xs text-muted-foreground">
            Choose between admin and {memberLabel} profile sets, then click a row to edit.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && (
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div>
          )}

          <div className="flex items-center justify-between">
            <div className="flex overflow-hidden rounded-md border border-input text-sm w-fit">
              {(["admin", "employee"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setType(t)}
                  className={cn(
                    "px-4 py-1.5 transition-colors",
                    type === t
                      ? "bg-primary text-primary-foreground font-medium"
                      : "bg-background hover:bg-muted",
                  )}
                >
                  {t === "admin" ? "Admin" : memberLabelCap}
                </button>
              ))}
            </div>
            <Button type="button" size="sm" onClick={() => setCreating(true)}>
              <Plus className="mr-1 h-3.5 w-3.5" />
              New profile
            </Button>
          </div>

          {profiles.length === 0 ? (
            <p className="text-sm text-muted-foreground">No profiles yet.</p>
          ) : (
            <div className="space-y-2">
              {profiles.map((profile, idx) => {
                const drag = rowProps(idx);
                return (
                  <div
                    key={profile.id}
                    {...drag}
                    className={cn(
                      "flex items-center justify-between rounded-md border px-3 py-2 gap-2 cursor-pointer hover:bg-muted/50 transition-colors",
                      rowClassExtra(idx),
                    )}
                    onClick={() => setEditing(profile)}
                  >
                    <GripVertical
                      className="h-4 w-4 shrink-0 text-muted-foreground cursor-grab active:cursor-grabbing"
                      onClick={(e) => e.stopPropagation()}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold">{profile.name}</div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {profileSummary(profile)}
                      </div>
                    </div>
                    <span
                      className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs font-medium tabular-nums text-muted-foreground"
                      title={`${profile.memberCount ?? 0} ${roleLabelPlural} on this profile`}
                    >
                      {profile.memberCount ?? 0}
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 shrink-0"
                      title="Copy as new"
                      onClick={(e) => {
                        e.stopPropagation();
                        setCopyFrom(profile);
                        setCreating(true);
                      }}
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 shrink-0"
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeleting(profile);
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  </div>
                );
              })}
            </div>
          )}

          {/* Summary footer: total assigned + how many are unassigned */}
          {(profiles.length > 0 || noProfileCount > 0) && (
            <div className="flex items-center justify-between rounded-md bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
              <span>
                <span className="font-semibold tabular-nums text-foreground">{onProfileTotal}</span>{" "}
                {roleLabelPlural} on these profiles
              </span>
              <span>
                <span className="font-semibold tabular-nums text-foreground">{noProfileCount}</span>{" "}
                without a profile
              </span>
            </div>
          )}
        </CardContent>
      </Card>

      <RightsProfileEditor
        open={editorOpen}
        onOpenChange={(o) => {
          if (!o) {
            setEditing(null);
            setCreating(false);
            setCopyFrom(null);
          }
        }}
        type={type}
        rightDefs={rightDefs}
        teams={teams}
        editing={editing}
        template={copyFrom}
        onSaved={(saved, isNew) => {
          setProfiles((prev) =>
            isNew ? [...prev, saved] : prev.map((p) => (p.id === saved.id ? saved : p)),
          );
          setEditing(null);
          setCreating(false);
          setCopyFrom(null);
        }}
      />

      <AlertDialog
        open={deleting !== null}
        onOpenChange={(o) => { if (!o && !deleteLoading) setDeleting(null); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete profile</AlertDialogTitle>
            <AlertDialogDescription>
              {deleting && (
                <>Permanently delete the &ldquo;{deleting.name}&rdquo; profile? Members currently assigned to it will fall back to no profile.</>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteLoading}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteLoading}
              onClick={(e) => { e.preventDefault(); handleDelete(); }}
            >
              {deleteLoading ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// ---------------------------------------------------------------------------
// Editor dialog
// ---------------------------------------------------------------------------

interface EditorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  type: ProfileType;
  rightDefs: RightDef[];
  teams: { id: string; name: string }[];
  editing: Profile | null;
  /** When set, opens in "create from template" mode: rights pre-populated
   *  from the source, name suffixed with " (Copy)". Save creates a new
   *  profile rather than updating the original. */
  template?: Profile | null;
  onSaved: (profile: Profile, isNew: boolean) => void;
}

function RightsProfileEditor({
  open,
  onOpenChange,
  type,
  rightDefs,
  teams,
  editing,
  template,
  onSaved,
}: EditorProps) {
  const router = useRouter();
  const { memberLabel } = useMemberLabel();
  const [name, setName] = useState("");
  const [rights, setRights] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Snapshot of the seed values as JSON. Used to dirty-check the form so
  // "Save changes" only enables when the user has actually changed something.
  const [initialSnapshot, setInitialSnapshot] = useState<string>("");

  // Seed draft state whenever the dialog opens or the edit target changes.
  // Note: Radix `onOpenChange` does NOT fire on controlled open-prop changes,
  // so we drive seeding from a useEffect instead.
  useEffect(() => {
    if (!open) return;
    let seedName: string;
    let seedRights: Record<string, unknown>;
    if (editing) {
      seedRights = { ...buildDefaultRights(rightDefs), ...editing.rights };
      if (type === "admin" && !seedRights["object_access"]) {
        seedRights["object_access"] = { teams: { scope: "own", ids: [] } };
      }
      // Coerce legacy boolean values into tri-state strings for any right
      // that's been promoted from boolean → access (e.g. can_define_custom_fields).
      // Without this, an existing profile with `true` would render with no
      // button selected until the user re-saves.
      for (const def of rightDefs) {
        if (def.type === "access") {
          seedRights[def.key] = coerceAccess(seedRights[def.key]);
        }
      }
      seedName = editing.name;
    } else if (template) {
      // Copy mode: pre-populate rights from the source. Same coercion +
      // object_access fallback as the editing branch.
      seedRights = { ...buildDefaultRights(rightDefs), ...template.rights };
      if (type === "admin" && !seedRights["object_access"]) {
        seedRights["object_access"] = { teams: { scope: "own", ids: [] } };
      }
      for (const def of rightDefs) {
        if (def.type === "access") {
          seedRights[def.key] = coerceAccess(seedRights[def.key]);
        }
      }
      seedName = `${template.name} (Copy)`;
    } else {
      seedRights = buildDefaultRights(rightDefs);
      if (type === "admin") {
        seedRights["object_access"] = { teams: { scope: "own", ids: [] } };
      }
      seedName = "";
    }
    setName(seedName);
    setRights(seedRights);
    setInitialSnapshot(JSON.stringify({ name: seedName, rights: seedRights }));
    setError(null);
  }, [open, editing, template, type, rightDefs]);

  const dirty = JSON.stringify({ name, rights }) !== initialSnapshot;

  const teamAccess = getTeamAccess(rights);

  function setTeamAccess(ta: TeamAccess) {
    const oa = (rights["object_access"] as Record<string, unknown>) ?? {};
    setRights((prev) => ({
      ...prev,
      object_access: { ...oa, teams: ta },
    }));
  }

  async function handleSave() {
    if (!name.trim()) {
      setError("Profile name is required");
      return;
    }
    setLoading(true);
    setError(null);

    const saveRights: Record<string, unknown> = { ...rights };
    if (type === "admin") {
      saveRights["can_view_all_teams"] = teamAccess.scope === "all";
    }

    if (editing) {
      const result = await updateProfile(type, editing.id, name.trim(), saveRights);
      setLoading(false);
      if (!result.success) {
        setError(result.error ?? "Failed to save profile");
        return;
      }
      onSaved({ ...editing, name: name.trim(), rights: saveRights }, false);
    } else {
      const result = await createProfile(type, name.trim(), saveRights);
      setLoading(false);
      if (!result.success || !result.profile) {
        setError(result.error ?? "Failed to create profile");
        return;
      }
      onSaved(result.profile, true);
    }
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit profile" : "New profile"}</DialogTitle>
          <DialogDescription>
            {type === "admin"
              ? "Admin profile — controls administrative permissions and team visibility."
              : `${capitalize(memberLabel)} profile — controls what ${
                  /^[aeiou]/i.test(memberLabel) ? "an" : "a"
                } ${memberLabel} can do in the app.`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 overflow-y-auto max-h-[60vh] px-1">
          {error && (
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div>
          )}

          <div className="space-y-1.5">
            <Label className="text-xs">Profile name</Label>
            <Input
              type="text"
              maxLength={50}
              placeholder="e.g. Team Leader, Basic Access"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              className="font-semibold"
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
                    : "flex flex-col gap-2",
                )}
              >
                <div className="min-w-0">
                  <span className="text-sm">{right.label}</span>
                  {right.description && (
                    <p className="text-xs text-muted-foreground">{right.description}</p>
                  )}
                </div>
                {right.type === "boolean" && (
                  <Switch
                    checked={rights[right.key] === true}
                    onCheckedChange={(checked) =>
                      setRights((prev) => ({ ...prev, [right.key]: checked }))
                    }
                  />
                )}
                {right.type === "access" && (
                  <div className="flex overflow-hidden rounded-md border text-xs self-start">
                    {(["none", "read", "write"] as const).map((opt) => (
                      <button
                        key={opt}
                        type="button"
                        className={cn(
                          "px-3 py-1.5 capitalize transition-colors",
                          rights[right.key] === opt
                            ? "bg-primary text-primary-foreground"
                            : "hover:bg-muted",
                        )}
                        onClick={() => setRights((prev) => ({ ...prev, [right.key]: opt }))}
                      >
                        {opt}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>

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
                        teamAccess.scope === scope
                          ? "bg-primary text-primary-foreground"
                          : "hover:bg-muted",
                      )}
                      onClick={() =>
                        setTeamAccess({
                          scope,
                          ids: scope === "selected" ? teamAccess.ids : [],
                        })
                      }
                    >
                      {scope === "own"
                        ? "Own team(s)"
                        : scope === "all"
                          ? "All teams"
                          : "Specific teams"}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  {teamAccess.scope === "own" && "Admin can see members in their own team(s) only."}
                  {teamAccess.scope === "all" && "Admin can see members across all teams."}
                  {teamAccess.scope === "selected" && "Admin can see members in the selected teams only."}
                </p>

                {teamAccess.scope === "selected" && teams.length > 0 && (
                  <div className="max-h-40 overflow-y-auto space-y-1 pt-1 border-t">
                    {teams.map((team) => {
                      const checked = teamAccess.ids.includes(team.id);
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
                                ? teamAccess.ids.filter((id) => id !== team.id)
                                : [...teamAccess.ids, team.id];
                              setTeamAccess({ scope: "selected", ids });
                            }}
                          />
                          {team.name}
                        </label>
                      );
                    })}
                  </div>
                )}

                {teamAccess.scope === "selected" && teams.length === 0 && (
                  <p className="text-xs text-muted-foreground pt-1 border-t">
                    No teams have been created yet.
                  </p>
                )}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={loading || !name.trim() || (editing !== null && !dirty)}
          >
            {loading ? "Saving…" : editing ? "Save changes" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
