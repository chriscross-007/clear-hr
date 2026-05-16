"use client";

// CLE-191 — Working Pattern profiles list + popup CRUD. Replaces the
// Sheet-based editor used by the legacy WorkProfilesClient. Same
// underlying CRUD actions (createWorkProfile / updateWorkProfile /
// deleteWorkProfile).

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Loader2, Copy, GripVertical } from "lucide-react";
import {
  createWorkProfile,
  updateWorkProfile,
  deleteWorkProfile,
  reorderWorkProfiles,
  type WorkProfile,
  type WorkProfileInput,
} from "@/app/(dashboard)/work-profile-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
import { useMemberLabel } from "@/contexts/member-label-context";
import { capitalize, pluralize } from "@/lib/label-utils";
import { PROFILE_TYPES } from "../profile-types";
import { useListReorder } from "../use-list-reorder";
import { cn } from "@/lib/utils";

const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;
const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const DAY_FULL = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const DEFAULT_HOURS = [8, 8, 8, 8, 8, 0, 0];

function totalHours(p: WorkProfile | number[]): number {
  if (Array.isArray(p)) return p.reduce((a, b) => a + b, 0);
  return DAYS.reduce((sum, d) => sum + Number(p[`hours_${d}`]), 0);
}

export function WorkingPatternProfilesClient({ initialProfiles }: { initialProfiles: WorkProfile[] }) {
  const router = useRouter();
  const { memberLabel } = useMemberLabel();
  const membersPluralCap = capitalize(pluralize(memberLabel));
  const [profiles, setProfiles] = useState<WorkProfile[]>(initialProfiles);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<WorkProfile | null>(null);
  const [copyFrom, setCopyFrom] = useState<WorkProfile | null>(null);
  const [deleting, setDeleting] = useState<WorkProfile | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [reorderError, setReorderError] = useState<string | null>(null);

  const { rowProps, rowClassExtra } = useListReorder<WorkProfile>({
    items: profiles,
    setItems: setProfiles,
    onReorder: (orderedIds) => reorderWorkProfiles(orderedIds),
    onError: setReorderError,
  });

  function openCreate() {
    setEditing(null);
    setCopyFrom(null);
    setEditorOpen(true);
  }

  function openEdit(p: WorkProfile) {
    setEditing(p);
    setCopyFrom(null);
    setEditorOpen(true);
  }

  function openCopy(p: WorkProfile) {
    setEditing(null);
    setCopyFrom(p);
    setEditorOpen(true);
  }

  async function handleDelete() {
    if (!deleting) return;
    setDeleteLoading(true);
    setDeleteError(null);
    const result = await deleteWorkProfile(deleting.id);
    setDeleteLoading(false);
    if (!result.success) {
      setDeleteError(result.error ?? "Failed to delete work profile");
      return;
    }
    setProfiles((prev) => prev.filter((p) => p.id !== deleting.id));
    setDeleting(null);
    router.refresh();
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{PROFILE_TYPES.workingPattern.label}</CardTitle>
          <p className="text-xs text-muted-foreground">
            Hours per day of the week. Click a row to edit.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          {reorderError && (
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{reorderError}</div>
          )}

          <div className="flex justify-end">
            <Button type="button" size="sm" onClick={openCreate}>
              <Plus className="mr-1 h-3.5 w-3.5" />
              New profile
            </Button>
          </div>

          {profiles.length === 0 && (
            <p className="text-sm text-muted-foreground">No work profiles defined.</p>
          )}

          {profiles.length > 0 && (
            <div className="flex items-center px-3 gap-2">
              <span className="w-4 shrink-0" />
              <span className="text-xs text-muted-foreground font-medium flex-1">Name</span>
              {DAY_LABELS.map((d) => (
                <span key={d} className="text-xs text-muted-foreground font-medium w-10 text-center">{d}</span>
              ))}
              <span className="text-xs text-muted-foreground font-medium w-12 text-center">Total</span>
              <span className="text-xs text-muted-foreground font-medium w-20 text-center">{membersPluralCap}</span>
              <span className="w-7" />
              <span className="w-7" />
            </div>
          )}

          {profiles.map((p, idx) => {
            const drag = rowProps(idx);
            return (
              <div
                key={p.id}
                {...drag}
                className={cn(
                  "flex items-center rounded-md border px-3 py-1.5 gap-2 cursor-pointer hover:bg-muted/50 transition-colors",
                  rowClassExtra(idx),
                )}
                onClick={() => openEdit(p)}
              >
                <GripVertical
                  className="h-4 w-4 shrink-0 text-muted-foreground cursor-grab active:cursor-grabbing"
                  onClick={(e) => e.stopPropagation()}
                />
                <span className="text-sm font-semibold flex-1 truncate">{p.name}</span>
                {DAYS.map((d) => {
                  const h = Number(p[`hours_${d}`]);
                  return (
                    <span key={d} className="text-sm w-10 text-center tabular-nums">
                      {h > 0 ? `${h}h` : "—"}
                    </span>
                  );
                })}
                <span className="text-sm w-12 text-center font-medium tabular-nums">{totalHours(p)}h</span>
                <span className="text-sm w-20 text-center tabular-nums">{p.employee_count ?? 0}</span>
                <div className="w-7 flex justify-center" onClick={(e) => e.stopPropagation()}>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    title="Copy as new"
                    onClick={() => openCopy(p)}
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <div className="w-7 flex justify-center" onClick={(e) => e.stopPropagation()}>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => {
                      setDeleteError(null);
                      setDeleting(p);
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
                  </Button>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <WorkingPatternEditor
        open={editorOpen}
        onOpenChange={setEditorOpen}
        editing={editing}
        template={copyFrom}
        onSaved={(saved, isNew) => {
          setProfiles((prev) =>
            isNew
              ? [...prev, saved]
              : prev.map((p) => (p.id === saved.id ? { ...saved, employee_count: p.employee_count } : p)),
          );
          setEditorOpen(false);
          setCopyFrom(null);
          router.refresh();
        }}
      />

      <AlertDialog
        open={!!deleting}
        onOpenChange={(open) => {
          if (!open) {
            setDeleting(null);
            setDeleteError(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete work profile</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteError ? (
                <span className="text-destructive">{deleteError}</span>
              ) : (
                <>Are you sure you want to delete <strong>{deleting?.name}</strong>?</>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteLoading}>Cancel</AlertDialogCancel>
            {!deleteError && (
              <AlertDialogAction
                disabled={deleteLoading}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={(e) => {
                  e.preventDefault();
                  handleDelete();
                }}
              >
                {deleteLoading ? "Deleting…" : "Delete"}
              </AlertDialogAction>
            )}
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
  editing: WorkProfile | null;
  /** When set, the editor opens in "create new from this template" mode —
   *  fields pre-populated from the source profile, name suffixed with
   *  " (Copy)", save creates a brand-new row. */
  template?: WorkProfile | null;
  onSaved: (profile: WorkProfile, isNew: boolean) => void;
}

function WorkingPatternEditor({ open, onOpenChange, editing, template, onSaved }: EditorProps) {
  const [name, setName] = useState("");
  const [hours, setHours] = useState<number[]>([...DEFAULT_HOURS]);
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
    let seedHours: number[];
    if (editing) {
      seedName = editing.name;
      seedHours = DAYS.map((d) => Number(editing[`hours_${d}`]));
    } else if (template) {
      // Copy mode: pre-populate hours from the source, suffix name to avoid
      // the unique-name collision with the original.
      seedName = `${template.name} (Copy)`;
      seedHours = DAYS.map((d) => Number(template[`hours_${d}`]));
    } else {
      seedName = "";
      seedHours = [...DEFAULT_HOURS];
    }
    setName(seedName);
    setHours(seedHours);
    setInitialSnapshot(JSON.stringify({ name: seedName, hours: seedHours }));
    setError(null);
  }, [open, editing, template]);

  const dirty = JSON.stringify({ name, hours }) !== initialSnapshot;

  async function handleSave() {
    setLoading(true);
    setError(null);
    const input: WorkProfileInput = {
      name: name.trim(),
      hours_monday: hours[0],
      hours_tuesday: hours[1],
      hours_wednesday: hours[2],
      hours_thursday: hours[3],
      hours_friday: hours[4],
      hours_saturday: hours[5],
      hours_sunday: hours[6],
    };
    const result = editing
      ? await updateWorkProfile(editing.id, input)
      : await createWorkProfile(input);
    setLoading(false);
    if (!result.success || !result.profile) {
      setError(result.error ?? "Failed to save");
      return;
    }
    onSaved(result.profile, !editing);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit working pattern" : "New working pattern"}</DialogTitle>
          <DialogDescription>
            Define working hours for each day of the week.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 overflow-y-auto max-h-[60vh] px-1">
          {error && (
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="wp-name">Name</Label>
            <Input
              id="wp-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Full Time 37.5h"
              maxLength={50}
              autoFocus
              className="font-semibold"
            />
          </div>

          {DAYS.map((d, i) => (
            <div key={d} className="flex items-center justify-between">
              <Label>{DAY_FULL[i]}</Label>
              <Input
                type="number"
                min={0}
                max={24}
                step={0.5}
                className="w-24 text-right"
                value={hours[i]}
                onChange={(e) => {
                  const next = [...hours];
                  next[i] = Number(e.target.value) || 0;
                  setHours(next);
                }}
              />
            </div>
          ))}

          <div className="flex items-center justify-between border-t pt-3">
            <Label className="font-medium">Total hours/week</Label>
            <span className="font-bold tabular-nums">{totalHours(hours)}h</span>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={loading || !name.trim() || (editing !== null && !dirty)}
          >
            {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {editing ? "Save changes" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
