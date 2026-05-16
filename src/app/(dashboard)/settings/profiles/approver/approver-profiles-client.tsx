"use client";

// CLE-191 — Holiday Approval profiles list + popup CRUD. Replaces the
// inline-editor pattern used by the legacy ApprovalsManager (which
// expanded each row in place because it had to live inside the
// OrganisationEditDialog). On the full Settings page we open a Dialog
// instead. Same underlying server actions; reuses the `ProfileEditor`
// form fields exported from the legacy file so the Save/Cancel logic
// is the only thing duplicated here.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Loader2, Copy, GripVertical } from "lucide-react";
import {
  getApprovalProfilesForOrg,
  saveApprovalProfile,
  deleteApprovalProfile,
  getApproverOptions,
  getOrgAbsenceTypesForApprovals,
  reorderApprovalProfiles,
  type ApprovalProfile,
  type ApproverOption,
  type ApprovalLevelInput,
} from "@/app/(dashboard)/approval-profile-actions";
import {
  ProfileEditor,
  emptyLevel,
  levelFromProfile,
  type LevelEdit,
  type AbsenceTypeOption,
} from "@/app/(dashboard)/organisation-edit-dialog-approvals";
import { Button } from "@/components/ui/button";
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
import { PROFILE_TYPES } from "../profile-types";
import { useListReorder } from "../use-list-reorder";
import { cn } from "@/lib/utils";

export function ApproverProfilesClient() {
  const router = useRouter();
  const { memberLabel } = useMemberLabel();
  const [profiles, setProfiles] = useState<ApprovalProfile[]>([]);
  const [approvers, setApprovers] = useState<ApproverOption[]>([]);
  const [absenceTypes, setAbsenceTypes] = useState<AbsenceTypeOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Editor state
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<ApprovalProfile | null>(null);
  const [copyFrom, setCopyFrom] = useState<ApprovalProfile | null>(null);

  // Delete state
  const [deleting, setDeleting] = useState<ApprovalProfile | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [reorderError, setReorderError] = useState<string | null>(null);

  const { rowProps, rowClassExtra } = useListReorder<ApprovalProfile>({
    items: profiles,
    setItems: setProfiles,
    onReorder: (orderedIds) =>
      reorderApprovalProfiles(orderedIds.filter((id) => {
        const p = profiles.find((pp) => pp.id === id);
        return p && !p.isDefault;
      })),
    canDrag: (p) => !p.isDefault,
    onError: setReorderError,
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [pRes, aRes, tRes] = await Promise.all([
        getApprovalProfilesForOrg(),
        getApproverOptions(),
        getOrgAbsenceTypesForApprovals(),
      ]);
      if (cancelled) return;
      if (!pRes.success) setError(pRes.error ?? "Failed to load profiles");
      else if (!aRes.success) setError(aRes.error ?? "Failed to load approvers");
      else if (!tRes.success) setError(tRes.error ?? "Failed to load absence types");
      setProfiles(pRes.profiles);
      setApprovers(aRes.approvers);
      setAbsenceTypes(tRes.absenceTypes);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function openCreate() {
    setEditing(null);
    setCopyFrom(null);
    setEditorOpen(true);
  }

  function openEdit(p: ApprovalProfile) {
    setEditing(p);
    setCopyFrom(null);
    setEditorOpen(true);
  }

  function openCopy(p: ApprovalProfile) {
    setEditing(null);
    setCopyFrom(p);
    setEditorOpen(true);
  }

  async function handleDelete() {
    if (!deleting) return;
    if (deleting.isDefault) {
      setDeleteError("Cannot delete the default profile");
      return;
    }
    setDeleteLoading(true);
    setDeleteError(null);
    const res = await deleteApprovalProfile(deleting.id);
    setDeleteLoading(false);
    if (!res.success) {
      setDeleteError(res.error ?? "Failed to delete");
      return;
    }
    setProfiles((prev) => prev.filter((p) => p.id !== deleting.id));
    setDeleting(null);
    router.refresh();
  }

  function onSaved(saved: ApprovalProfile) {
    setProfiles((prev) => {
      const exists = prev.some((p) => p.id === saved.id);
      return exists
        ? prev.map((p) => (p.id === saved.id ? saved : p))
        : [...prev, saved];
    });
    setEditorOpen(false);
    router.refresh();
  }

  if (loading) {
    return <div className="text-sm text-muted-foreground">Loading…</div>;
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{PROFILE_TYPES.approver.label}</CardTitle>
          <p className="text-xs text-muted-foreground">
            Route requests to named approvers. Each {memberLabel} points at one profile
            per absence type. Click a row to edit.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          {error && (
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}

          <div className="flex justify-end">
            <Button
              type="button"
              size="sm"
              onClick={openCreate}
              disabled={absenceTypes.length === 0}
            >
              <Plus className="mr-1 h-3.5 w-3.5" />
              New profile
            </Button>
          </div>

          {reorderError && (
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{reorderError}</div>
          )}

          {profiles.length === 0 && (
            <p className="text-sm text-muted-foreground">No approval profiles defined.</p>
          )}

          {profiles.length > 0 && (
            <div className="flex items-center px-3 gap-2">
              <span className="w-4 shrink-0" />
              <span className="text-xs text-muted-foreground font-medium flex-1">Name</span>
              <span className="text-xs text-muted-foreground font-medium w-40">Absence type</span>
              <span className="text-xs text-muted-foreground font-medium flex-1">Levels</span>
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
                {p.isDefault ? (
                  <span className="w-4 shrink-0" />
                ) : (
                  <GripVertical
                    className="h-4 w-4 shrink-0 text-muted-foreground cursor-grab active:cursor-grabbing"
                    onClick={(e) => e.stopPropagation()}
                  />
                )}
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <span className="text-sm font-semibold truncate">{p.name}</span>
                  {p.isDefault && (
                    <span className="rounded bg-muted px-1.5 py-0.5 text-xs font-normal text-muted-foreground shrink-0">
                      Default
                    </span>
                  )}
                </div>
                <span className="text-sm w-40 truncate">{p.absenceTypeName || "—"}</span>
                <span className="text-xs text-muted-foreground flex-1 truncate">
                  {p.levels.length === 0
                    ? "no levels"
                    : p.levels
                        .map((l) => {
                          const approvers = l.mainApproverIds.length + l.delegateApproverIds.length;
                          const dt = l.lengthThresholdDays;
                          const ht = l.lengthThresholdHours;
                          let threshold: string;
                          if (dt === null && ht === null) {
                            threshold = "any";
                          } else {
                            const parts: string[] = [];
                            if (dt !== null) parts.push(`≥${dt}d`);
                            if (ht !== null) parts.push(`≥${ht}h`);
                            threshold = parts.join(" / ");
                          }
                          return `L${l.level} (${approvers}a, ${threshold})`;
                        })
                        .join(" → ")}
                </span>
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
                  {!p.isDefault && (
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
                  )}
                </div>
              </div>
            );
          })}

          <p className="text-xs text-muted-foreground">
            Approver names are admins whose rights profile grants{" "}
            <strong>Approve Holidays</strong>. Profile changes only affect new bookings — already-pending
            bookings keep their original ladder.
          </p>
        </CardContent>
      </Card>

      <ApproverProfileEditorDialog
        open={editorOpen}
        onOpenChange={(o) => {
          setEditorOpen(o);
          if (!o) setCopyFrom(null);
        }}
        editing={editing}
        template={copyFrom}
        approvers={approvers}
        absenceTypes={absenceTypes}
        onSaved={onSaved}
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
            <AlertDialogTitle>Delete approval profile</AlertDialogTitle>
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
  editing: ApprovalProfile | null;
  /** When set, opens in "create from template" mode: levels + absence
   *  type pre-populated from the source, name suffixed with " (Copy)",
   *  save creates a brand-new (non-default) profile. */
  template?: ApprovalProfile | null;
  approvers: ApproverOption[];
  absenceTypes: AbsenceTypeOption[];
  onSaved: (profile: ApprovalProfile) => void;
}

function ApproverProfileEditorDialog({
  open,
  onOpenChange,
  editing,
  template,
  approvers,
  absenceTypes,
  onSaved,
}: EditorProps) {
  const [name, setName] = useState("");
  const [absenceTypeId, setAbsenceTypeId] = useState("");
  const [levels, setLevels] = useState<LevelEdit[]>([
    emptyLevel(),
    emptyLevel(),
    emptyLevel(),
  ]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Snapshot of the seed values as JSON. Used to dirty-check the form so
  // "Save changes" only enables when the user has actually changed something.
  const [initialSnapshot, setInitialSnapshot] = useState<string>("");

  function updateLevel(index: 0 | 1 | 2, patch: Partial<LevelEdit>) {
    setLevels((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], ...patch };
      return next;
    });
  }

  // Seed draft state whenever the dialog opens or the edit target changes.
  // Note: Radix `onOpenChange` does NOT fire on controlled open-prop changes,
  // so we drive seeding from a useEffect instead.
  useEffect(() => {
    if (!open) return;
    let seedName: string;
    let seedAbsenceTypeId: string;
    let seedLevels: LevelEdit[];
    if (editing) {
      seedName = editing.name;
      seedAbsenceTypeId = editing.absenceTypeId;
      seedLevels = [
        levelFromProfile(editing, 1),
        levelFromProfile(editing, 2),
        levelFromProfile(editing, 3),
      ];
    } else if (template) {
      // Copy mode: pre-populate from the source, suffix name to avoid the
      // unique (org, absence_type, name) collision.
      seedName = `${template.name} (Copy)`;
      seedAbsenceTypeId = template.absenceTypeId;
      seedLevels = [
        levelFromProfile(template, 1),
        levelFromProfile(template, 2),
        levelFromProfile(template, 3),
      ];
    } else {
      seedName = "";
      seedAbsenceTypeId = absenceTypes[0]?.id ?? "";
      seedLevels = [emptyLevel(), emptyLevel(), emptyLevel()];
    }
    setName(seedName);
    setAbsenceTypeId(seedAbsenceTypeId);
    setLevels(seedLevels);
    setInitialSnapshot(
      JSON.stringify({ name: seedName, absenceTypeId: seedAbsenceTypeId, levels: seedLevels }),
    );
    setError(null);
  }, [open, editing, template, absenceTypes]);

  const dirty =
    JSON.stringify({ name, absenceTypeId, levels }) !== initialSnapshot;

  async function handleSave() {
    setError(null);
    if (!name.trim()) {
      setError("Name is required");
      return;
    }
    if (!absenceTypeId) {
      setError("Absence Type is required");
      return;
    }
    if (levels[0].mains.length === 0) {
      setError("Level 1 needs at least one main approver");
      return;
    }

    const parseThreshold = (raw: string, kind: "days" | "hours"): number | null | "invalid" => {
      const v = raw.trim();
      if (v === "") return null;
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0) return "invalid";
      if (kind === "days" && !Number.isInteger(n)) return "invalid";
      return n;
    };

    const payloadLevels: ApprovalLevelInput[] = [];
    for (let i = 0; i < 3; i++) {
      const lvl = levels[i];
      if (lvl.mains.length === 0) continue;
      const days = parseThreshold(lvl.thresholdDays, "days");
      const hours = parseThreshold(lvl.thresholdHours, "hours");
      if (days === "invalid") {
        setError(`Level ${i + 1} days threshold must be a non-negative whole number`);
        return;
      }
      if (hours === "invalid") {
        setError(`Level ${i + 1} hours threshold must be a non-negative number`);
        return;
      }
      payloadLevels.push({
        level: i + 1,
        lengthThresholdDays: days,
        lengthThresholdHours: hours,
        mainApproverIds: lvl.mains,
        delegateApproverIds: lvl.delegates,
      });
    }

    setSaving(true);
    const existingId = editing?.id;
    const res = await saveApprovalProfile(
      { name: name.trim(), absenceTypeId, levels: payloadLevels },
      existingId,
    );
    setSaving(false);
    if (!res.success) {
      setError(res.error ?? "Failed to save");
      return;
    }
    // Reload to pick up freshly-rebuilt levels + ids.
    const refresh = await getApprovalProfilesForOrg();
    if (!refresh.success) {
      setError(refresh.error ?? "Saved, but failed to reload");
      return;
    }
    // Prefer the id returned by saveApprovalProfile; fall back to the
    // existing id (edit path) and finally to the last profile.
    const savedId = res.profileId ?? existingId;
    const saved =
      (savedId && refresh.profiles.find((p) => p.id === savedId)) ||
      refresh.profiles[refresh.profiles.length - 1];
    if (saved) onSaved(saved);
    else onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit approval profile" : "New approval profile"}</DialogTitle>
          <DialogDescription>
            Define which approvers handle requests at each level.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 overflow-y-auto max-h-[60vh] px-1">
          <ProfileEditor
            name={name}
            setName={setName}
            absenceTypeId={absenceTypeId}
            setAbsenceTypeId={setAbsenceTypeId}
            absenceTypes={absenceTypes}
            levels={levels}
            updateLevel={updateLevel}
            approvers={approvers}
            error={error}
            saving={saving}
            isDefault={editing?.isDefault}
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={saving || !name.trim() || (editing !== null && !dirty)}
          >
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {editing ? "Save changes" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
