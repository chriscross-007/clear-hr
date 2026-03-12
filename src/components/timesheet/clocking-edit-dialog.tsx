"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { editClocking, deleteClockingEdit, deleteClocking, addClocking, overrideClockingType } from "@/app/(dashboard)/timesheets/actions";
import { effectiveTime } from "./timesheet-types";
import type { CellClickContext } from "./timesheet-types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert an ISO UTC timestamp to a datetime-local string (treated as UTC) */
function toDatetimeLocal(iso: string): string {
  return iso.slice(0, 16); // "YYYY-MM-DDTHH:MM"
}

/** Convert a datetime-local string to an ISO UTC string */
function fromDatetimeLocal(dtl: string): string {
  return `${dtl}:00.000Z`;
}

/** Format a short date+time label for display */
function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", {
    weekday: "short", day: "numeric", month: "short",
    hour: "2-digit", minute: "2-digit", timeZone: "UTC",
  }) + " UTC";
}

// Types a manager can explicitly assign via override.
// "__auto__" means "let the inference engine decide" (clears any override).
const INFERRED_TYPES = [
  { value: "__auto__", label: "Auto (inferred)" },
  { value: "bStart",   label: "bStart" },
  { value: "bEnd",     label: "bEnd" },
  { value: "IN",       label: "IN" },
  { value: "OUT",      label: "OUT" },
  { value: "BRK_OUT",  label: "Brk Out" },
  { value: "BRK_IN",   label: "Brk In" },
  { value: "CC",       label: "CC" },
];

const SELECTABLE_TYPE_VALUES = new Set(INFERRED_TYPES.map((t) => t.value));

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface ClockingEditDialogProps {
  /** Cell click context — clocking is null for empty cells */
  ctx: CellClickContext;
  /** The member whose timesheet is being edited */
  memberId: string;
  onClose: () => void;
  onSuccess: () => void;
}

export function ClockingEditDialog({ ctx, memberId, onClose, onSuccess }: ClockingEditDialogProps) {
  const { clocking, date } = ctx;
  const isAdd = clocking === null;

  // Use the inferred type as the baseline for both display and change detection.
  // If the inferred type isn't a manager-selectable value (e.g. AMBIGUOUS),
  // fall back to "__auto__" so the dropdown is in a valid state.
  const currentInferredType = isAdd ? null : (clocking.inferredType ?? null);
  const currentSelectableType =
    currentInferredType && SELECTABLE_TYPE_VALUES.has(currentInferredType)
      ? currentInferredType
      : "__auto__";

  const initialTime = isAdd
    ? `${date}T00:00`
    : toDatetimeLocal(effectiveTime(clocking));

  const [datetimeVal, setDatetimeVal] = useState(initialTime);
  const [selectedType, setSelectedType] = useState(currentSelectableType);
  const [loading, setLoading]           = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [revertLoading, setRevertLoading] = useState(false);
  const [error, setError]               = useState<string | null>(null);

  // "Delete Edit" is available when the clocking's time has been manually edited.
  const hasTimeEdit = !isAdd && clocking.editedClockedAt != null;

  async function handleSave() {
    setLoading(true);
    setError(null);

    const isoTime    = fromDatetimeLocal(datetimeVal);
    const typeToSave = selectedType === "__auto__" ? null : selectedType;

    if (isAdd) {
      const result = await addClocking(memberId, isoTime, null, typeToSave);
      setLoading(false);
      if (result.success) { onSuccess(); } else { setError(result.error ?? "An error occurred"); }
      return;
    }

    const timeChanged = datetimeVal !== toDatetimeLocal(effectiveTime(clocking!));
    const typeChanged = selectedType !== currentSelectableType;

    // Set override first so inference (triggered by editClocking) respects it.
    if (typeChanged) {
      const r = await overrideClockingType(clocking!.id, typeToSave, "");
      if (!r.success) { setError(r.error ?? "An error occurred"); setLoading(false); return; }
    }

    if (timeChanged) {
      const r = await editClocking(clocking!.id, isoTime, null);
      if (!r.success) { setError(r.error ?? "An error occurred"); setLoading(false); return; }
    }

    setLoading(false);
    onSuccess();
  }

  async function handleRevertEdit() {
    if (!clocking) return;
    setRevertLoading(true);
    setError(null);
    const result = await deleteClockingEdit(clocking.id);
    setRevertLoading(false);
    if (result.success) {
      onSuccess();
    } else {
      setError(result.error ?? "An error occurred");
    }
  }

  async function handleDelete() {
    if (!clocking) return;
    setDeleteLoading(true);
    setError(null);
    const result = await deleteClocking(clocking.id);
    setDeleteLoading(false);
    if (result.success) {
      onSuccess();
    } else {
      setError(result.error ?? "An error occurred");
    }
  }

  const title       = isAdd ? "Add Clocking" : "Edit Clocking";
  const description = isAdd
    ? `Adding a new clocking on ${date}`
    : `Original: ${fmtDateTime(clocking!.clockedAt)}${hasTimeEdit ? ` · Edited ${fmtDateTime(clocking!.editedClockedAt!)}` : ""}`;

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          {/* Show original clocking if a time edit exists */}
          {hasTimeEdit && clocking && (
            <div className="rounded-md border border-border bg-muted/40 px-4 py-3 text-sm space-y-1">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">Original clocking</p>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Time</span>
                <span className="font-medium">{fmtDateTime(clocking.clockedAt)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Type</span>
                <span className="font-medium">{clocking.inferredType ?? "—"}</span>
              </div>
              {clocking.editedByName && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Edited by</span>
                  <span className="font-medium">{clocking.editedByName}{clocking.editedAt ? ` · ${fmtDateTime(clocking.editedAt)}` : ""}</span>
                </div>
              )}
            </div>
          )}

          {/* Date/Time input */}
          <div className="space-y-1.5">
            <Label htmlFor="clocking-datetime">Date & Time (UTC)</Label>
            <Input
              id="clocking-datetime"
              type="datetime-local"
              value={datetimeVal}
              onChange={(e) => setDatetimeVal(e.target.value)}
            />
          </div>

          {/* Type selector (inferred types) */}
          <div className="space-y-1.5">
            <Label htmlFor="clocking-type">Type</Label>
            <Select value={selectedType} onValueChange={setSelectedType}>
              <SelectTrigger id="clocking-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {INFERRED_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter className="flex-wrap gap-2 sm:justify-between">
          {/* Left-side destructive actions */}
          <div className="flex gap-2">
            {hasTimeEdit && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleRevertEdit}
                disabled={revertLoading || loading || deleteLoading}
              >
                {revertLoading ? "Reverting…" : "Revert Time Edit"}
              </Button>
            )}
            {!isAdd && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive"
                onClick={handleDelete}
                disabled={deleteLoading || loading || revertLoading}
              >
                {deleteLoading ? "Deleting…" : "Delete Clocking"}
              </Button>
            )}
          </div>

          {/* Right-side primary actions */}
          <div className="flex gap-2">
            <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={loading || deleteLoading || revertLoading}>
              Cancel
            </Button>
            <Button type="button" size="sm" onClick={handleSave} disabled={loading || deleteLoading || revertLoading || !datetimeVal}>
              {loading ? "Saving…" : isAdd ? "Add" : "Save"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
