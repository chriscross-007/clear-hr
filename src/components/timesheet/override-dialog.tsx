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
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { overrideClockingType } from "@/app/(dashboard)/timesheet-actions";
import { fmtTime, effectiveType } from "./timesheet-types";
import type { ClockingData } from "./timesheet-types";

const OVERRIDE_TYPES = [
  { value: "",            label: "— Use inferred (clear override) —" },
  { value: "bStart",      label: "bStart — Beginning of shift" },
  { value: "bEnd",        label: "bEnd — End of shift" },
  { value: "BreakOut",    label: "BreakOut — Start of break" },
  { value: "BreakIn",     label: "BreakIn — Return from break" },
  { value: "INambiguous", label: "INambiguous — Ambiguous IN (flag for review)" },
  { value: "OUTambiguous",label: "OUTambiguous — Ambiguous OUT (flag for review)" },
  { value: "CC",          label: "CC — Cost centre allocation" },
];

interface ClockingOverrideDialogProps {
  clocking: ClockingData;
  onClose:  () => void;
  onSuccess: () => void;
}

export function ClockingOverrideDialog({
  clocking,
  onClose,
  onSuccess,
}: ClockingOverrideDialogProps) {
  const currentOverride = clocking.overrideType ?? "";
  const [newType, setNewType]   = useState(currentOverride);
  const [reason, setReason]     = useState("");
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!reason.trim()) { setError("A reason is required."); return; }
    if (newType === currentOverride) {
      setError("No change — select a different type or close.");
      return;
    }

    setLoading(true);
    setError(null);
    // newType="" means clear the override (pass null to action)
    const result = await overrideClockingType(clocking.id, newType || null, reason.trim());
    setLoading(false);

    if (result.success) {
      onSuccess();
    } else {
      setError(result.error ?? "Unknown error");
    }
  }

  const clockedAtDate = new Date(clocking.clockedAt);
  const dateLabel = clockedAtDate.toLocaleDateString("en-GB", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  });
  const timeLabel = fmtTime(clocking.clockedAt);
  const eff = effectiveType(clocking);

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Clocking Type</DialogTitle>
          <DialogDescription>
            {dateLabel} at {timeLabel}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          {/* Current state */}
          <div className="rounded-md border border-border bg-muted/40 px-4 py-3 text-sm space-y-1">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Raw type from terminal</span>
              <span className="font-medium">{clocking.rawType ?? "bare swipe"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Engine inferred type</span>
              <span className="font-medium">{clocking.inferredType ?? "—"}</span>
            </div>
            {clocking.overrideType && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Current override</span>
                <span className="font-medium text-blue-600 dark:text-blue-400">{clocking.overrideType}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-muted-foreground">Effective type</span>
              <span className="font-semibold">{eff ?? "—"}</span>
            </div>
          </div>

          {/* Type selector */}
          <div className="space-y-1.5">
            <Label htmlFor="new-type">Set override type</Label>
            <Select value={newType} onValueChange={setNewType}>
              <SelectTrigger id="new-type">
                <SelectValue placeholder="— Use inferred (clear override) —" />
              </SelectTrigger>
              <SelectContent>
                {OVERRIDE_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Selecting &ldquo;Use inferred&rdquo; clears any existing override and lets the engine decide.
            </p>
          </div>

          {/* Reason */}
          <div className="space-y-1.5">
            <Label htmlFor="reason">
              Reason <span className="text-destructive">*</span>
            </Label>
            <Textarea
              id="reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Explain why the type is being changed…"
              rows={3}
              maxLength={500}
            />
            <p className="text-xs text-muted-foreground">
              Recorded in the audit log and cannot be removed.
            </p>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={loading}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
