"use client";

// Approvals tab for the Organisation Settings dialog (CLE-181, CLE-183).
//
// Phase A wired Level 1 only. Phase B enables L2 and L3 with per-level
// length thresholds (days + hours, independent) so admins can require
// additional approval for longer bookings. Empty mains list on L2/L3 =
// level not used; the cascade simply skips it.

import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import { Plus, Trash2, X, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  getApprovalProfilesForOrg,
  saveApprovalProfile,
  deleteApprovalProfile,
  getApproverOptions,
  getOrgAbsenceTypesForApprovals,
  type ApprovalProfile,
  type ApproverOption,
  type ApprovalLevelInput,
} from "./approval-profile-actions";
import { cn } from "@/lib/utils";

type AbsenceTypeOption = { id: string; name: string };

/** Per-level editor state. Threshold inputs are tracked as strings so
 *  the user can type partial values without React fighting them on every
 *  keystroke; we coerce to number-or-null at save time. */
type LevelEdit = {
  mains: string[];
  delegates: string[];
  thresholdDays: string;
  thresholdHours: string;
};

function emptyLevel(): LevelEdit {
  return { mains: [], delegates: [], thresholdDays: "", thresholdHours: "" };
}

function levelFromProfile(
  profile: ApprovalProfile,
  levelNumber: 1 | 2 | 3,
): LevelEdit {
  const lvl = profile.levels.find((l) => l.level === levelNumber);
  if (!lvl) return emptyLevel();
  return {
    mains: lvl.mainApproverIds,
    delegates: lvl.delegateApproverIds,
    thresholdDays: lvl.lengthThresholdDays === null ? "" : String(lvl.lengthThresholdDays),
    thresholdHours: lvl.lengthThresholdHours === null ? "" : String(lvl.lengthThresholdHours),
  };
}

/** Imperative handle so the parent Organisation Settings dialog's main
 *  Cancel/Save buttons can drive the in-progress profile editor without
 *  the editor needing its own buttons. */
export interface ApprovalsManagerHandle {
  /** True when an inline profile editor is open with unsaved fields. */
  hasInProgress(): boolean;
  /** Commit the in-progress edit. Returns the same envelope shape as the
   *  underlying server action, plus `noop: true` if nothing was being
   *  edited (caller can treat that as success). */
  commit(): Promise<{ success: boolean; error?: string; noop?: boolean }>;
  /** Discard the in-progress edit. */
  revert(): void;
}

interface ApprovalsManagerProps {
  /** Called whenever the in-progress editor opens / closes so the parent
   *  dialog's main Save button can enable. */
  onDirtyChange?: (dirty: boolean) => void;
}

export const ApprovalsManager = forwardRef<ApprovalsManagerHandle, ApprovalsManagerProps>(function ApprovalsManager(props, ref) {
  const [profiles, setProfiles] = useState<ApprovalProfile[]>([]);
  const [approvers, setApprovers] = useState<ApproverOption[]>([]);
  const [absenceTypes, setAbsenceTypes] = useState<AbsenceTypeOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | "new" | null>(null);
  const [editName, setEditName] = useState("");
  const [editAbsenceTypeId, setEditAbsenceTypeId] = useState("");
  /** Indexed by level - 1, i.e. editLevels[0] = L1, [1] = L2, [2] = L3. */
  const [editLevels, setEditLevels] = useState<LevelEdit[]>([
    emptyLevel(),
    emptyLevel(),
    emptyLevel(),
  ]);
  const [editError, setEditError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function updateLevel(index: 0 | 1 | 2, patch: Partial<LevelEdit>) {
    setEditLevels((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], ...patch };
      return next;
    });
  }

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

  function startEdit(profile: ApprovalProfile) {
    setEditingId(profile.id);
    setEditName(profile.name);
    setEditAbsenceTypeId(profile.absenceTypeId);
    setEditLevels([
      levelFromProfile(profile, 1),
      levelFromProfile(profile, 2),
      levelFromProfile(profile, 3),
    ]);
    setEditError(null);
  }

  function startNew() {
    setEditingId("new");
    setEditName("");
    setEditAbsenceTypeId(absenceTypes[0]?.id ?? "");
    setEditLevels([emptyLevel(), emptyLevel(), emptyLevel()]);
    setEditError(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditError(null);
  }

  async function handleSave(): Promise<{ success: boolean; error?: string }> {
    setEditError(null);
    if (!editName.trim()) {
      setEditError("Name is required");
      return { success: false, error: "Name is required" };
    }
    if (!editAbsenceTypeId) {
      setEditError("Absence Type is required");
      return { success: false, error: "Absence Type is required" };
    }
    if (editLevels[0].mains.length === 0) {
      setEditError("Level 1 needs at least one main approver");
      return { success: false, error: "Level 1 needs at least one main approver" };
    }

    // CLE-183 — coerce threshold inputs to number-or-null. Empty string =
    // NULL = always required.
    const parseThreshold = (raw: string, kind: "days" | "hours"): number | null | "invalid" => {
      const v = raw.trim();
      if (v === "") return null;
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0) return "invalid";
      if (kind === "days" && !Number.isInteger(n)) return "invalid";
      return n;
    };

    const levels: ApprovalLevelInput[] = [];
    for (let i = 0; i < 3; i++) {
      const lvl = editLevels[i];
      // Drop the level if it has no mains — that means "not used".
      if (lvl.mains.length === 0) continue;
      const days = parseThreshold(lvl.thresholdDays, "days");
      const hours = parseThreshold(lvl.thresholdHours, "hours");
      if (days === "invalid") {
        const msg = `Level ${i + 1} days threshold must be a non-negative whole number`;
        setEditError(msg);
        return { success: false, error: msg };
      }
      if (hours === "invalid") {
        const msg = `Level ${i + 1} hours threshold must be a non-negative number`;
        setEditError(msg);
        return { success: false, error: msg };
      }
      levels.push({
        level: i + 1,
        lengthThresholdDays: days,
        lengthThresholdHours: hours,
        mainApproverIds: lvl.mains,
        delegateApproverIds: lvl.delegates,
      });
    }

    setSaving(true);
    const profileId = editingId === "new" ? undefined : editingId ?? undefined;
    const res = await saveApprovalProfile(
      { name: editName.trim(), absenceTypeId: editAbsenceTypeId, levels },
      profileId,
    );
    setSaving(false);
    if (!res.success) {
      setEditError(res.error ?? "Failed to save");
      return { success: false, error: res.error ?? "Failed to save" };
    }
    // Reload to pick up fresh ids
    const refresh = await getApprovalProfilesForOrg();
    if (refresh.success) setProfiles(refresh.profiles);
    setEditingId(null);
    return { success: true };
  }

  // CLE-186 — notify the parent dialog whenever the editor opens / closes
  // so the main Save button can be enabled while a profile edit is in
  // progress (even if no org-level field has changed).
  const onDirtyChange = props.onDirtyChange;
  useEffect(() => {
    onDirtyChange?.(editingId !== null);
  }, [editingId, onDirtyChange]);

  // CLE-186 — expose imperative API so the parent dialog's main
  // Cancel/Save buttons drive the in-progress profile editor.
  useImperativeHandle(
    ref,
    () => ({
      hasInProgress: () => editingId !== null,
      commit: async () => {
        if (editingId === null) return { success: true, noop: true };
        return handleSave();
      },
      revert: () => {
        cancelEdit();
      },
    }),
    // handleSave is recreated on each render but uses up-to-date closures;
    // the deps below cover the values it reads. cancelEdit is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editingId, editName, editAbsenceTypeId, editLevels],
  );

  async function handleDelete(profile: ApprovalProfile) {
    if (profile.isDefault) return;
    if (!confirm(`Delete the "${profile.name}" approval profile?`)) return;
    const res = await deleteApprovalProfile(profile.id);
    if (!res.success) {
      setError(res.error ?? "Failed to delete");
      return;
    }
    setProfiles(profiles.filter((p) => p.id !== profile.id));
  }

  if (loading) {
    return <div className="text-sm text-muted-foreground">Loading…</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div className="text-sm text-muted-foreground">
          Approval Profiles route holiday and other absence requests to named
          approvers. Each employee points at one profile per absence type. Phase
          A covers Level 1 only — Levels 2 and 3 will be enabled in Phase B.
        </div>
        <Button type="button" size="sm" onClick={startNew} disabled={editingId !== null}>
          <Plus className="h-4 w-4 mr-1" /> Add Profile
        </Button>
      </div>

      {error && (
        <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="rounded-md border divide-y">
        {profiles.length === 0 && editingId !== "new" && (
          <div className="p-4 text-sm text-muted-foreground">
            No approval profiles yet. Click <strong>Add Profile</strong> to create one.
          </div>
        )}

        {editingId === "new" && (
          <div className="p-4">
            <ProfileEditor
              name={editName}
              setName={setEditName}
              absenceTypeId={editAbsenceTypeId}
              setAbsenceTypeId={setEditAbsenceTypeId}
              absenceTypes={absenceTypes}
              levels={editLevels}
              updateLevel={updateLevel}
              approvers={approvers}
              error={editError}
              saving={saving}
            />
          </div>
        )}

        {profiles.map((p) => {
          const isEditing = editingId === p.id;
          return (
            <div key={p.id}>
              {!isEditing && (
                <div
                  role="button"
                  tabIndex={editingId === null ? 0 : -1}
                  onClick={() => {
                    if (editingId === null) startEdit(p);
                  }}
                  onKeyDown={(e) => {
                    if (editingId !== null) return;
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      startEdit(p);
                    }
                  }}
                  aria-disabled={editingId !== null}
                  className={cn(
                    "flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left",
                    editingId === null
                      ? "cursor-pointer hover:bg-muted/40"
                      : "opacity-60 cursor-not-allowed",
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium truncate">{p.name}</span>
                      {p.isDefault && (
                        <span className="text-xs rounded bg-muted px-1.5 py-0.5 text-muted-foreground">
                          Default
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {p.absenceTypeName || "—"} · {p.levels.length === 0 ? "no levels" : p.levels.map((l) => `L${l.level} (${l.mainApproverIds.length}m/${l.delegateApproverIds.length}d)`).join(" → ")}
                    </div>
                  </div>
                  {!p.isDefault && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(p);
                      }}
                      className="text-muted-foreground hover:text-destructive"
                      aria-label="Delete profile"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              )}

              {isEditing && (
                <div className="p-4">
                  <ProfileEditor
                    name={editName}
                    setName={setEditName}
                    absenceTypeId={editAbsenceTypeId}
                    setAbsenceTypeId={setEditAbsenceTypeId}
                    absenceTypes={absenceTypes}
                    levels={editLevels}
                    updateLevel={updateLevel}
                    approvers={approvers}
                    error={editError}
                    saving={saving}
                    isDefault={p.isDefault}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

      <p className="text-xs text-muted-foreground">
        Approver names are admins whose rights profile grants <strong>Approve Holidays</strong>.
        Profile changes only affect new bookings — already-pending bookings keep their original ladder.
        Use the dialog&apos;s <strong>Save changes</strong> button to commit your edits.
      </p>
    </div>
  );
});

// ---------------------------------------------------------------------------
// ProfileEditor — inline editor for one profile
// ---------------------------------------------------------------------------

// CLE-191 — exported so the new Settings Holiday Approval client can
// reuse the same form fields inside a popup without re-implementing.
export type { LevelEdit, AbsenceTypeOption };
export { emptyLevel, levelFromProfile };
export function ProfileEditor(props: {
  name: string;
  setName: (n: string) => void;
  absenceTypeId: string;
  setAbsenceTypeId: (id: string) => void;
  absenceTypes: AbsenceTypeOption[];
  levels: LevelEdit[];
  updateLevel: (index: 0 | 1 | 2, patch: Partial<LevelEdit>) => void;
  approvers: ApproverOption[];
  error: string | null;
  saving: boolean;
  isDefault?: boolean;
}) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="ap-name">Name</Label>
          <Input
            id="ap-name"
            value={props.name}
            onChange={(e) => props.setName(e.target.value)}
            placeholder="e.g. Holiday Approval Default"
            className="font-semibold"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ap-absence-type">Absence Type</Label>
          <Select
            value={props.absenceTypeId}
            onValueChange={props.setAbsenceTypeId}
            disabled={props.isDefault}
          >
            <SelectTrigger id="ap-absence-type">
              <SelectValue placeholder="Choose an absence type" />
            </SelectTrigger>
            <SelectContent>
              {props.absenceTypes.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {([0, 1, 2] as const).map((idx) => (
        <LevelRow
          key={idx}
          levelLabel={`Level ${idx + 1}`}
          level={props.levels[idx]}
          onChange={(patch) => props.updateLevel(idx, patch)}
          approvers={props.approvers}
          requireMains={idx === 0}
        />
      ))}

      <p className="text-xs text-muted-foreground">
        Levels are evaluated in order. Leave Level 2 or 3 with no main approvers
        if you don&apos;t need them. A level&apos;s thresholds apply only when the booking
        unit matches — days threshold for days bookings, hours threshold for
        hours bookings. Leave blank to mean &ldquo;always required&rdquo;.
      </p>

      {props.saving && (
        <div className="text-xs text-muted-foreground">Saving…</div>
      )}
      {props.error && (
        <div className="rounded-md bg-destructive/10 p-2 text-sm text-destructive">
          {props.error}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// LevelRow — one ladder rung. Main + delegate pickers plus length thresholds.
// ---------------------------------------------------------------------------

function LevelRow(props: {
  levelLabel: string;
  level: LevelEdit;
  onChange: (patch: Partial<LevelEdit>) => void;
  approvers: ApproverOption[];
  /** L1 must have at least one main approver (enforced at save). */
  requireMains: boolean;
}) {
  const inactive = !props.requireMains && props.level.mains.length === 0;
  return (
    <div
      className={cn(
        "rounded-md border p-3 space-y-2",
        inactive && "bg-muted/30",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">{props.levelLabel}</span>
        {inactive && (
          <span className="text-xs text-muted-foreground">Not used</span>
        )}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <ApproverPicker
          label={props.requireMains ? "Main approver(s) *" : "Main approver(s)"}
          selected={props.level.mains}
          setSelected={(ids) => props.onChange({ mains: ids })}
          approvers={props.approvers}
          disabled={false}
          placeholder={props.requireMains ? "Choose approvers" : "Leave empty to skip this level"}
        />
        <ApproverPicker
          label="Delegate approver(s)"
          selected={props.level.delegates}
          setSelected={(ids) => props.onChange({ delegates: ids })}
          approvers={props.approvers}
          disabled={false}
          placeholder="Optional fallback"
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Required when booking ≥</Label>
          <div className="flex items-center gap-2">
            <Input
              type="number"
              inputMode="numeric"
              min={0}
              step={1}
              placeholder="any"
              value={props.level.thresholdDays}
              onChange={(e) => props.onChange({ thresholdDays: e.target.value })}
              className="w-20"
            />
            <span className="text-sm text-muted-foreground">days</span>
          </div>
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">or ≥</Label>
          <div className="flex items-center gap-2">
            <Input
              type="number"
              inputMode="decimal"
              min={0}
              step="0.5"
              placeholder="any"
              value={props.level.thresholdHours}
              onChange={(e) => props.onChange({ thresholdHours: e.target.value })}
              className="w-20"
            />
            <span className="text-sm text-muted-foreground">hours</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ApproverPicker — multi-select popover with checkboxes
// ---------------------------------------------------------------------------

function ApproverPicker(props: {
  label: string;
  selected: string[];
  setSelected: (ids: string[]) => void;
  approvers: ApproverOption[];
  disabled: boolean;
  placeholder: string;
}) {
  const [open, setOpen] = useState(false);
  const nameById = new Map(props.approvers.map((a) => [a.id, a.name]));

  function toggle(id: string) {
    if (props.selected.includes(id)) {
      props.setSelected(props.selected.filter((x) => x !== id));
    } else {
      props.setSelected([...props.selected, id]);
    }
  }

  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{props.label}</Label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={props.disabled}
            className={cn(
              "h-9 w-full rounded-md border border-input bg-background px-3 text-left text-sm",
              "flex items-center justify-between",
              "disabled:opacity-50 disabled:cursor-not-allowed",
            )}
          >
            <span className="truncate">
              {props.selected.length === 0 ? (
                <span className="text-muted-foreground">{props.placeholder}</span>
              ) : props.selected.length === 1 ? (
                nameById.get(props.selected[0]) ?? "—"
              ) : (
                `${props.selected.length} selected`
              )}
            </span>
            {props.selected.length > 0 && !props.disabled && (
              <span
                role="button"
                tabIndex={0}
                onClick={(e) => {
                  e.stopPropagation();
                  props.setSelected([]);
                }}
                className="ml-2 rounded-sm p-0.5 hover:bg-muted"
                aria-label="Clear selection"
              >
                <X className="h-3.5 w-3.5" />
              </span>
            )}
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-72 p-0" align="start">
          <div className="max-h-64 overflow-y-auto py-1">
            {props.approvers.length === 0 && (
              <div className="px-3 py-2 text-sm text-muted-foreground">
                No approvers available. Grant the Approve Holidays right to an admin in Settings → Profiles → Rights.
              </div>
            )}
            {props.approvers.map((a) => {
              const checked = props.selected.includes(a.id);
              return (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => toggle(a.id)}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-muted/40"
                >
                  <span
                    className={cn(
                      "flex h-4 w-4 items-center justify-center rounded border",
                      checked ? "bg-primary border-primary" : "border-input",
                    )}
                  >
                    {checked && <Check className="h-3 w-3 text-primary-foreground" />}
                  </span>
                  <span className="flex-1 truncate">{a.name}</span>
                  <span className="text-xs text-muted-foreground capitalize">{a.role}</span>
                  {!a.isActive && (
                    <span className="text-xs text-amber-600">pending</span>
                  )}
                </button>
              );
            })}
          </div>
        </PopoverContent>
      </Popover>
      {props.selected.length > 1 && (
        <div className="flex flex-wrap gap-1">
          {props.selected.map((id) => (
            <span
              key={id}
              className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-xs"
            >
              {nameById.get(id) ?? "—"}
              {!props.disabled && (
                <button
                  type="button"
                  onClick={() => props.setSelected(props.selected.filter((x) => x !== id))}
                  aria-label="Remove"
                  className="text-muted-foreground hover:text-foreground"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
