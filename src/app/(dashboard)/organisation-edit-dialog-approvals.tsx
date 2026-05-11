"use client";

// Approvals tab for the Organisation Settings dialog (CLE-181).
//
// Phase A: only Level 1 main + delegate approvers are editable. L2 and L3
// rows render disabled with a "coming in Phase B" tooltip per the settled
// spec. Length thresholds are hidden in Phase A.

import { useEffect, useState } from "react";
import { Plus, Trash2, X, Check, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
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

export function ApprovalsManager() {
  const [profiles, setProfiles] = useState<ApprovalProfile[]>([]);
  const [approvers, setApprovers] = useState<ApproverOption[]>([]);
  const [absenceTypes, setAbsenceTypes] = useState<AbsenceTypeOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | "new" | null>(null);
  const [editName, setEditName] = useState("");
  const [editAbsenceTypeId, setEditAbsenceTypeId] = useState("");
  const [editL1Mains, setEditL1Mains] = useState<string[]>([]);
  const [editL1Delegates, setEditL1Delegates] = useState<string[]>([]);
  const [editError, setEditError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

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
    const l1 = profile.levels.find((l) => l.level === 1);
    setEditL1Mains(l1?.mainApproverIds ?? []);
    setEditL1Delegates(l1?.delegateApproverIds ?? []);
    setEditError(null);
  }

  function startNew() {
    setEditingId("new");
    setEditName("");
    setEditAbsenceTypeId(absenceTypes[0]?.id ?? "");
    setEditL1Mains([]);
    setEditL1Delegates([]);
    setEditError(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditError(null);
  }

  async function handleSave() {
    setEditError(null);
    if (!editName.trim()) {
      setEditError("Name is required");
      return;
    }
    if (!editAbsenceTypeId) {
      setEditError("Absence Type is required");
      return;
    }
    if (editL1Mains.length === 0) {
      setEditError("Level 1 needs at least one main approver");
      return;
    }
    setSaving(true);
    const levels: ApprovalLevelInput[] = [
      {
        level: 1,
        lengthThresholdDays: null,
        lengthThresholdHours: null,
        mainApproverIds: editL1Mains,
        delegateApproverIds: editL1Delegates,
      },
    ];
    const profileId = editingId === "new" ? undefined : editingId ?? undefined;
    const res = await saveApprovalProfile(
      { name: editName.trim(), absenceTypeId: editAbsenceTypeId, levels },
      profileId,
    );
    setSaving(false);
    if (!res.success) {
      setEditError(res.error ?? "Failed to save");
      return;
    }
    // Reload to pick up fresh ids
    const refresh = await getApprovalProfilesForOrg();
    if (refresh.success) setProfiles(refresh.profiles);
    setEditingId(null);
  }

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
              l1Mains={editL1Mains}
              setL1Mains={setEditL1Mains}
              l1Delegates={editL1Delegates}
              setL1Delegates={setEditL1Delegates}
              approvers={approvers}
              error={editError}
              saving={saving}
              onSave={handleSave}
              onCancel={cancelEdit}
            />
          </div>
        )}

        {profiles.map((p) => {
          const isEditing = editingId === p.id;
          const l1 = p.levels.find((l) => l.level === 1);
          return (
            <div key={p.id}>
              {!isEditing && (
                <button
                  type="button"
                  onClick={() => startEdit(p)}
                  className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left hover:bg-muted/40"
                  disabled={editingId !== null}
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
                      {p.absenceTypeName || "—"} · {l1?.mainApproverIds.length ?? 0} main, {l1?.delegateApproverIds.length ?? 0} delegate
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
                </button>
              )}

              {isEditing && (
                <div className="p-4">
                  <ProfileEditor
                    name={editName}
                    setName={setEditName}
                    absenceTypeId={editAbsenceTypeId}
                    setAbsenceTypeId={setEditAbsenceTypeId}
                    absenceTypes={absenceTypes}
                    l1Mains={editL1Mains}
                    setL1Mains={setEditL1Mains}
                    l1Delegates={editL1Delegates}
                    setL1Delegates={setEditL1Delegates}
                    approvers={approvers}
                    error={editError}
                    saving={saving}
                    onSave={handleSave}
                    onCancel={cancelEdit}
                    isDefault={p.isDefault}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

      <p className="text-xs text-muted-foreground">
        Approver names are members of the org with role <strong>owner</strong> or <strong>admin</strong>.
        Profile changes only affect new bookings — already-pending bookings keep their original ladder.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ProfileEditor — inline editor for one profile
// ---------------------------------------------------------------------------

function ProfileEditor(props: {
  name: string;
  setName: (n: string) => void;
  absenceTypeId: string;
  setAbsenceTypeId: (id: string) => void;
  absenceTypes: AbsenceTypeOption[];
  l1Mains: string[];
  setL1Mains: (ids: string[]) => void;
  l1Delegates: string[];
  setL1Delegates: (ids: string[]) => void;
  approvers: ApproverOption[];
  error: string | null;
  saving: boolean;
  onSave: () => void;
  onCancel: () => void;
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

      <LevelRow
        levelLabel="Level 1"
        mains={props.l1Mains}
        setMains={props.setL1Mains}
        delegates={props.l1Delegates}
        setDelegates={props.setL1Delegates}
        approvers={props.approvers}
        disabled={false}
      />

      <LevelRow
        levelLabel="Level 2"
        mains={[]}
        setMains={() => {}}
        delegates={[]}
        setDelegates={() => {}}
        approvers={props.approvers}
        disabled
      />

      <LevelRow
        levelLabel="Level 3"
        mains={[]}
        setMains={() => {}}
        delegates={[]}
        setDelegates={() => {}}
        approvers={props.approvers}
        disabled
      />

      {props.error && (
        <div className="rounded-md bg-destructive/10 p-2 text-sm text-destructive">
          {props.error}
        </div>
      )}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" size="sm" onClick={props.onCancel} disabled={props.saving}>
          Cancel
        </Button>
        <Button type="button" size="sm" onClick={props.onSave} disabled={props.saving}>
          {props.saving ? "Saving…" : "Save Changes"}
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// LevelRow — one ladder rung. Renders disabled for L2/L3 in Phase A.
// ---------------------------------------------------------------------------

function LevelRow(props: {
  levelLabel: string;
  mains: string[];
  setMains: (ids: string[]) => void;
  delegates: string[];
  setDelegates: (ids: string[]) => void;
  approvers: ApproverOption[];
  disabled: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-md border p-3 space-y-2",
        props.disabled && "opacity-60",
      )}
    >
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium">{props.levelLabel}</span>
        {props.disabled && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Info className="h-3.5 w-3.5 text-muted-foreground" />
            </TooltipTrigger>
            <TooltipContent>
              <span className="text-xs">Coming in Phase B — multi-level escalation.</span>
            </TooltipContent>
          </Tooltip>
        )}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <ApproverPicker
          label="Main approver(s)"
          selected={props.mains}
          setSelected={props.setMains}
          approvers={props.approvers}
          disabled={props.disabled}
          placeholder={props.disabled ? "—" : "Choose approvers"}
        />
        <ApproverPicker
          label="Delegate approver(s)"
          selected={props.delegates}
          setSelected={props.setDelegates}
          approvers={props.approvers}
          disabled={props.disabled}
          placeholder={props.disabled ? "—" : "Optional fallback"}
        />
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
                No admins or owners yet. Add an admin first.
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
