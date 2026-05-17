"use client";

// CLE-194 Phase 2 — Holiday Profiles list + popup CRUD. Mirrors the
// other Profile tabs: flex-row layout, header strip, drag-reorder,
// Copy as new, Default pinned + name-locked + undeleteable.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Loader2, Copy, GripVertical } from "lucide-react";
import {
  createHolidayProfile,
  updateHolidayProfile,
  deleteHolidayProfile,
  reorderHolidayProfiles,
  getHolidayProfiles,
  type HolidayProfile,
  type HolidayProfileInput,
} from "@/app/(dashboard)/holiday-profile-actions";
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

export function HolidayProfilesClient({
  initialProfiles,
}: {
  initialProfiles: HolidayProfile[];
}) {
  const router = useRouter();
  const { memberLabel } = useMemberLabel();
  const membersPluralCap = capitalize(pluralize(memberLabel));
  const [profiles, setProfiles] = useState<HolidayProfile[]>(initialProfiles);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<HolidayProfile | null>(null);
  const [copyFrom, setCopyFrom] = useState<HolidayProfile | null>(null);
  const [deleting, setDeleting] = useState<HolidayProfile | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [reorderError, setReorderError] = useState<string | null>(null);

  const { rowProps, rowClassExtra } = useListReorder<HolidayProfile>({
    items: profiles,
    setItems: setProfiles,
    onReorder: (orderedIds) =>
      reorderHolidayProfiles(orderedIds.filter((id) => {
        const p = profiles.find((pp) => pp.id === id);
        return p && !p.isDefault;
      })),
    canDrag: (p) => !p.isDefault,
    onError: setReorderError,
  });

  function openCreate() {
    setEditing(null);
    setCopyFrom(null);
    setEditorOpen(true);
  }

  function openEdit(p: HolidayProfile) {
    setEditing(p);
    setCopyFrom(null);
    setEditorOpen(true);
  }

  function openCopy(p: HolidayProfile) {
    setEditing(null);
    setCopyFrom(p);
    setEditorOpen(true);
  }

  async function handleDelete() {
    if (!deleting) return;
    setDeleteLoading(true);
    setDeleteError(null);
    const res = await deleteHolidayProfile(deleting.id);
    setDeleteLoading(false);
    if (!res.success) {
      setDeleteError(res.error ?? "Failed to delete");
      return;
    }
    const refresh = await getHolidayProfiles();
    if (refresh.success) setProfiles(refresh.profiles ?? []);
    setDeleting(null);
    router.refresh();
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{PROFILE_TYPES.holiday.label}</CardTitle>
          <p className="text-xs text-muted-foreground">
            Each profile is a set of 7 values (type, units, allowance, factor, toil, max/min carry forward) snapshotted onto each new Holiday Period at creation. Click a row to edit.
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
            <p className="text-sm text-muted-foreground">No {PROFILE_TYPES.holiday.label} defined.</p>
          )}

          {profiles.length > 0 && (
            <div className="flex items-center px-3 gap-2">
              <span className="w-4 shrink-0" />
              <span className="text-xs text-muted-foreground font-medium flex-1">Name</span>
              <span className="text-xs text-muted-foreground font-medium w-16 text-center">Type</span>
              <span className="text-xs text-muted-foreground font-medium w-16 text-center">Units</span>
              <span className="text-xs text-muted-foreground font-medium w-24 text-center">Allowance</span>
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
                <span className="text-xs w-16 text-center text-muted-foreground capitalize">{p.holidayType}</span>
                <span className="text-xs w-16 text-center text-muted-foreground capitalize">{p.holidayUnits}</span>
                <span className="text-sm w-24 text-center tabular-nums">
                  {p.holidayType === "earned" ? "—" : p.holidayAllowance}
                </span>
                <span className="text-sm w-20 text-center tabular-nums">{p.memberCount}</span>
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
        </CardContent>
      </Card>

      <HolidayProfileEditorDialog
        open={editorOpen}
        onOpenChange={(o) => {
          setEditorOpen(o);
          if (!o) setCopyFrom(null);
        }}
        editing={editing}
        template={copyFrom}
        onSaved={async () => {
          const refresh = await getHolidayProfiles();
          if (refresh.success) setProfiles(refresh.profiles ?? []);
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
            <AlertDialogTitle>Delete {PROFILE_TYPES.holiday.label.replace(/s$/, "")} profile</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteError ? (
                <span className="text-destructive">{deleteError}</span>
              ) : (
                <>
                  Delete <strong>{deleting?.name}</strong>?
                  {(deleting?.memberCount ?? 0) > 0 && (
                    <>
                      {" "}
                      {deleting?.memberCount} {membersPluralCap.toLowerCase()} currently on this profile will be re-assigned to the Default.
                    </>
                  )}
                </>
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
  editing: HolidayProfile | null;
  template?: HolidayProfile | null;
  onSaved: () => void;
}

function HolidayProfileEditorDialog({
  open,
  onOpenChange,
  editing,
  template,
  onSaved,
}: EditorProps) {
  const [name, setName] = useState("");
  const [holidayType, setHolidayType] = useState<"fixed" | "earned">("fixed");
  const [holidayUnits, setHolidayUnits] = useState<"days" | "hours">("days");
  const [earnedFactor, setEarnedFactor] = useState<string>("0");
  const [allowance, setAllowance] = useState<string>("0");
  const [toilHoursPerDay, setToilHoursPerDay] = useState<string>("0");
  const [maxCarryForward, setMaxCarryForward] = useState<string>("0");
  const [minCarryForward, setMinCarryForward] = useState<string>("0");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [initialSnapshot, setInitialSnapshot] = useState<string>("");

  useEffect(() => {
    if (!open) return;
    const source: HolidayProfile | null = editing ?? template ?? null;
    let seedName: string;
    if (editing) {
      seedName = editing.name;
    } else if (template) {
      seedName = `${template.name} (Copy)`;
    } else {
      seedName = "";
    }
    const seedType: "fixed" | "earned" = source?.holidayType ?? "fixed";
    const seedUnits: "days" | "hours" = source?.holidayUnits ?? "days";
    const seedEarnedFactor = String(source?.holidayEarnedFactor ?? 0);
    const seedAllowance = String(source?.holidayAllowance ?? 20);
    const seedToil = String(source?.holidayToilHoursPerDay ?? 0);
    const seedMaxCf = String(source?.holidayMaxCarryForward ?? 0);
    const seedMinCf = String(source?.holidayMinCarryForward ?? 0);

    setName(seedName);
    setHolidayType(seedType);
    setHolidayUnits(seedUnits);
    setEarnedFactor(seedEarnedFactor);
    setAllowance(seedAllowance);
    setToilHoursPerDay(seedToil);
    setMaxCarryForward(seedMaxCf);
    setMinCarryForward(seedMinCf);
    setInitialSnapshot(
      JSON.stringify({
        name: seedName,
        holidayType: seedType,
        holidayUnits: seedUnits,
        earnedFactor: seedEarnedFactor,
        allowance: seedAllowance,
        toilHoursPerDay: seedToil,
        maxCarryForward: seedMaxCf,
        minCarryForward: seedMinCf,
      }),
    );
    setError(null);
  }, [open, editing, template]);

  const dirty =
    JSON.stringify({
      name,
      holidayType,
      holidayUnits,
      earnedFactor,
      allowance,
      toilHoursPerDay,
      maxCarryForward,
      minCarryForward,
    }) !== initialSnapshot;

  async function handleSave() {
    setError(null);

    const trimmed = name.trim();
    if (!trimmed) {
      setError("Name is required");
      return;
    }

    const numAllowance = Number(allowance) || 0;
    const numEarnedFactor = Number(earnedFactor) || 0;
    const numToil = Number(toilHoursPerDay) || 0;
    const numMaxCf = Number(maxCarryForward) || 0;
    const numMinCf = Number(minCarryForward) || 0;

    if (numMaxCf < 0) {
      setError("Max Carry Forward must be non-negative");
      return;
    }
    if (numMinCf > 0) {
      setError("Min Carry Forward must be non-positive");
      return;
    }

    setSaving(true);
    const input: HolidayProfileInput = {
      name: trimmed,
      holidayType,
      holidayUnits,
      holidayEarnedFactor: numEarnedFactor,
      holidayAllowance: numAllowance,
      holidayToilHoursPerDay: numToil,
      holidayMaxCarryForward: numMaxCf,
      holidayMinCarryForward: numMinCf,
    };

    if (editing) {
      const res = await updateHolidayProfile(editing.id, input);
      setSaving(false);
      if (!res.success) {
        setError(res.error ?? "Failed to save");
        return;
      }
    } else {
      const res = await createHolidayProfile(input);
      setSaving(false);
      if (!res.success) {
        setError(res.error ?? "Failed to save");
        return;
      }
    }

    onSaved();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {editing
              ? `Edit ${PROFILE_TYPES.holiday.label.replace(/s$/, "")} profile`
              : `New ${PROFILE_TYPES.holiday.label.replace(/s$/, "")} profile`}
          </DialogTitle>
          <DialogDescription>
            These values snapshot onto each new Holiday Period at creation.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 overflow-y-auto max-h-[60vh] px-1">
          {error && (
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="hp-name">Name</Label>
            <Input
              id="hp-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Standard 20 days"
              maxLength={50}
              autoFocus
              disabled={editing?.isDefault}
              className="font-semibold"
            />
            {editing?.isDefault && (
              <p className="text-xs text-muted-foreground">
                The Default profile&apos;s name can&apos;t be changed.
              </p>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label className="text-xs text-muted-foreground">Type</Label>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  value="fixed"
                  checked={holidayType === "fixed"}
                  onChange={() => setHolidayType("fixed")}
                  className="accent-primary"
                />
                <span className="text-sm">Fixed</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  value="earned"
                  checked={holidayType === "earned"}
                  onChange={() => setHolidayType("earned")}
                  className="accent-primary"
                />
                <span className="text-sm">Earned</span>
              </label>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label className="text-xs text-muted-foreground">Units</Label>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  value="days"
                  checked={holidayUnits === "days"}
                  onChange={() => setHolidayUnits("days")}
                  className="accent-primary"
                />
                <span className="text-sm">Days</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  value="hours"
                  checked={holidayUnits === "hours"}
                  onChange={() => setHolidayUnits("hours")}
                  className="accent-primary"
                />
                <span className="text-sm">Hours</span>
              </label>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label className="text-xs text-muted-foreground">
                Allowance ({holidayUnits})
              </Label>
              <Input
                type="number"
                min={0}
                step={holidayUnits === "days" ? "0.5" : "0.01"}
                value={allowance}
                onChange={(e) => setAllowance(e.target.value)}
                disabled={holidayType === "earned"}
              />
              {holidayType === "earned" && (
                <p className="text-xs text-muted-foreground">
                  Earned-type allowance is derived from worked hours.
                </p>
              )}
            </div>

            {holidayType === "earned" && (
              <div className="flex flex-col gap-1.5">
                <Label className="text-xs text-muted-foreground">
                  Earned Factor (% of worked unit)
                </Label>
                <Input
                  type="number"
                  min={0}
                  step="0.001"
                  value={earnedFactor}
                  onChange={(e) => setEarnedFactor(e.target.value)}
                />
              </div>
            )}

            <div className="flex flex-col gap-1.5">
              <Label className="text-xs text-muted-foreground">Toil hours per Day</Label>
              <Input
                type="number"
                min={0}
                step="0.01"
                value={toilHoursPerDay}
                onChange={(e) => setToilHoursPerDay(e.target.value)}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label className="text-xs text-muted-foreground">
                Max Carry Forward ({holidayUnits})
              </Label>
              <Input
                type="text"
                inputMode="decimal"
                value={maxCarryForward}
                onChange={(e) => {
                  if (/^\d*\.?\d*$/.test(e.target.value)) {
                    setMaxCarryForward(e.target.value);
                  }
                }}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label className="text-xs text-muted-foreground">
                Min Carry Forward ({holidayUnits}, ≤ 0)
              </Label>
              <Input
                type="text"
                inputMode="decimal"
                value={minCarryForward}
                onChange={(e) => {
                  const v = e.target.value;
                  const ok =
                    v === "" ||
                    v === "-" ||
                    /^0\.?0*$/.test(v) ||
                    /^-(\d*\.?\d*|\.\d*)$/.test(v);
                  if (ok) {
                    setMinCarryForward(v);
                  }
                }}
              />
              <p className="text-xs text-muted-foreground">
                Set to a less-negative value (e.g. <code>0</code>) to wipe debt at period end.
              </p>
            </div>
          </div>
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
