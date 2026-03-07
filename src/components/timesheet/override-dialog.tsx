"use client";

import { useState } from "react";
import { Lock } from "lucide-react";
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
import { overrideClockingType } from "@/app/(dashboard)/timesheets/actions";
import { fmtTime } from "./timesheet-types";
import type { ClockingData } from "./timesheet-types";

const INFERRED_TYPES = [
  { value: "IN",        label: "IN — Work period entry or break return" },
  { value: "OUT",       label: "OUT — Work period exit or break start" },
  { value: "CC",        label: "CC — Cost centre change" },
  { value: "bStart",    label: "bStart — Cost centre clocking that opens the period" },
  { value: "AMBIGUOUS", label: "AMBIGUOUS — Cannot determine (flag for review)" },
];

interface ClockingOverrideDialogProps {
  clocking: ClockingData;
  onClose: () => void;
  onSuccess: () => void;
}

export function ClockingOverrideDialog({
  clocking,
  onClose,
  onSuccess,
}: ClockingOverrideDialogProps) {
  const [newType, setNewType] = useState(clocking.inferredType ?? "IN");
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!reason.trim()) { setError("A reason is required."); return; }
    if (newType === clocking.inferredType) { setError("Type is unchanged — select a different type or close."); return; }

    setLoading(true);
    setError(null);
    const result = await overrideClockingType(clocking.id, newType, reason.trim());
    setLoading(false);

    if (result.success) {
      onSuccess();
    } else {
      setError(result.error ?? "Unknown error");
    }
  }

  const clockedAtDate = new Date(clocking.clockedAt);
  const dateLabel = clockedAtDate.toLocaleDateString("en-GB", {
    weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
  });
  const timeLabel = fmtTime(clocking.clockedAt);

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Override Clocking Type</DialogTitle>
          <DialogDescription>
            {dateLabel} at {timeLabel}
            {clocking.typeLocked && (
              <span className="ml-2 inline-flex items-center gap-1 text-xs text-amber-600">
                <Lock className="h-3 w-3" /> Previously locked by manager
              </span>
            )}
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
              <span className="text-muted-foreground">Current inferred type</span>
              <span className="font-medium">{clocking.inferredType ?? "—"}</span>
            </div>
          </div>

          {/* New type selector */}
          <div className="space-y-1.5">
            <Label htmlFor="new-type">New type</Label>
            <Select value={newType} onValueChange={setNewType}>
              <SelectTrigger id="new-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {INFERRED_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
              This is recorded in the audit log and cannot be removed.
            </p>
          </div>

          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={loading}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? "Saving…" : "Save Override"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
