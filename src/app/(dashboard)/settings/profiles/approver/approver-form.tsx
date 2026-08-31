"use client";

// CLE-194 — Inline editor fields for an approval profile, shared between
// the Settings → Profiles → Approver popup CRUD and any future surface
// that needs to edit one in place. Renders Name + Absence Type plus
// three Level rows; the parent owns the level state and Save/Cancel
// chrome.
//
// Moved here from the deleted `organisation-edit-dialog-approvals.tsx`.
// The legacy `ApprovalsManager` + `ApprovalsManagerHandle` that wrapped
// these fields with an in-dialog list have been dropped — only the
// Settings page consumes this now.

import { useState } from "react";
import { X, Check } from "lucide-react";
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
import type { ApprovalProfile, ApproverOption } from "@/app/(dashboard)/approval-profile-actions";
import { cn } from "@/lib/utils";

export type AbsenceTypeOption = { id: string; name: string };

/** Per-level editor state. Threshold inputs are tracked as strings so
 *  the user can type partial values without React fighting them on every
 *  keystroke; we coerce to number-or-null at save time. */
export type LevelEdit = {
  mains: string[];
  delegates: string[];
  thresholdDays: string;
  thresholdHours: string;
};

export function emptyLevel(): LevelEdit {
  return { mains: [], delegates: [], thresholdDays: "", thresholdHours: "" };
}

export function levelFromProfile(
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

// ---------------------------------------------------------------------------
// ProfileEditor — inline editor for one profile
// ---------------------------------------------------------------------------

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
                No eligible approvers. Grant the Approve Holidays right to an admin in Settings → Profiles → Rights, or the owner will appear here automatically.
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
                  <span className="text-xs text-muted-foreground">{a.profileName}</span>
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
