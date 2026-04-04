"use client";

import { useState } from "react";
import { Loader2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  submitHolidayBooking,
  type AbsenceReasonOption,
  type BalanceSummary,
} from "../holiday-booking-actions";

interface BookHolidaySheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  reasons: AbsenceReasonOption[];
  balance: BalanceSummary | null;
  measurementMode: string;
  onSuccess: () => void;
}

/** Count weekdays (Mon–Fri) between two dates inclusive */
function countWorkingDays(start: string, end: string): number {
  const s = new Date(start + "T00:00:00Z");
  const e = new Date(end + "T00:00:00Z");
  let count = 0;
  const d = new Date(s);
  while (d <= e) {
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) count++;
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return count;
}

export function BookHolidaySheet({
  open,
  onOpenChange,
  reasons,
  balance,
  measurementMode,
  onSuccess,
}: BookHolidaySheetProps) {
  const [reasonId, setReasonId] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [startHalfEnabled, setStartHalfEnabled] = useState(false);
  const [startHalf, setStartHalf] = useState<"am" | "pm">("am");
  const [endHalfEnabled, setEndHalfEnabled] = useState(false);
  const [endHalf, setEndHalf] = useState<"am" | "pm">("pm");
  const [hours, setHours] = useState("");
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  const unit = measurementMode === "hours" ? "hours" : "days";
  const isHoursMode = measurementMode === "hours";
  const sameDay = startDate === endDate && startDate !== "";

  // Calculate estimated deduction
  let estimatedDeduction = 0;
  if (isHoursMode) {
    estimatedDeduction = Number(hours) || 0;
  } else if (startDate && endDate && endDate >= startDate) {
    estimatedDeduction = countWorkingDays(startDate, endDate);
    if (startHalfEnabled) estimatedDeduction -= 0.5;
    if (endHalfEnabled && !sameDay) estimatedDeduction -= 0.5;
    if (sameDay && startHalfEnabled) estimatedDeduction = 0.5;
  }

  const projectedRemaining = balance ? balance.remaining - estimatedDeduction : null;

  // Group reasons by absence type
  const grouped = new Map<string, AbsenceReasonOption[]>();
  for (const r of reasons) {
    const group = grouped.get(r.absence_type_name) ?? [];
    group.push(r);
    grouped.set(r.absence_type_name, group);
  }

  // Determine if the selected reason requires approval
  const selectedReason = reasons.find((r) => r.id === reasonId);
  const requiresApproval = selectedReason ? selectedReason.requires_approval : true;

  function resetForm() {
    setReasonId("");
    setStartDate("");
    setEndDate("");
    setStartHalfEnabled(false);
    setStartHalf("am");
    setEndHalfEnabled(false);
    setEndHalf("pm");
    setHours("");
    setNote("");
    setError(null);
    setWarning(null);
  }

  async function handleSubmit() {
    if (!reasonId || !startDate || !endDate) return;
    setLoading(true);
    setError(null);
    setWarning(null);

    const result = await submitHolidayBooking({
      leaveReasonId: reasonId,
      startDate,
      endDate,
      startHalf: startHalfEnabled ? startHalf : null,
      endHalf: endHalfEnabled && !sameDay ? endHalf : null,
      daysDeducted: !isHoursMode ? estimatedDeduction : null,
      hoursDeducted: isHoursMode ? estimatedDeduction : null,
      note: note.trim() || null,
    });

    setLoading(false);

    if (!result.success) {
      setError(result.error ?? "An error occurred");
      return;
    }

    if (result.warning) {
      setWarning(result.warning);
    }

    resetForm();
    onSuccess();
  }

  const canSubmit = reasonId && startDate && endDate && endDate >= startDate && estimatedDeduction > 0;

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) resetForm(); onOpenChange(v); }}>
      <SheetContent className="overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{requiresApproval ? "Request Holiday" : "Book Holiday"}</SheetTitle>
          <SheetDescription>
            {requiresApproval
              ? "This request will need manager approval."
              : "This booking will be confirmed immediately."}
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-5 px-4">
          {/* Absence Reason */}
          <div className="flex flex-col gap-1.5">
            <Label>Absence Reason</Label>
            <Select value={reasonId} onValueChange={setReasonId}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select a reason" />
              </SelectTrigger>
              <SelectContent>
                {Array.from(grouped.entries()).map(([typeName, typeReasons]) => (
                  <SelectGroup key={typeName}>
                    <SelectLabel>{typeName}</SelectLabel>
                    {typeReasons.map((r) => (
                      <SelectItem key={r.id} value={r.id}>
                        <div className="flex items-center gap-2">
                          <span
                            className="inline-block h-2.5 w-2.5 rounded-full shrink-0"
                            style={{ backgroundColor: r.colour }}
                          />
                          {r.name}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectGroup>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Dates */}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="booking-start">Start Date</Label>
              <Input
                id="booking-start"
                type="date"
                value={startDate}
                onChange={(e) => {
                  setStartDate(e.target.value);
                  if (!endDate || e.target.value > endDate) setEndDate(e.target.value);
                }}
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="booking-end">End Date</Label>
              <Input
                id="booking-end"
                type="date"
                min={startDate}
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                required
              />
            </div>
          </div>

          {/* Half-day toggles (days mode only) */}
          {!isHoursMode && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>Start half day</Label>
                <Switch checked={startHalfEnabled} onCheckedChange={setStartHalfEnabled} />
              </div>
              {startHalfEnabled && (
                <div className="flex gap-4 pl-4">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="radio" name="startHalf" value="am" checked={startHalf === "am"} onChange={() => setStartHalf("am")} className="accent-primary" />
                    <span className="text-sm">AM</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="radio" name="startHalf" value="pm" checked={startHalf === "pm"} onChange={() => setStartHalf("pm")} className="accent-primary" />
                    <span className="text-sm">PM</span>
                  </label>
                </div>
              )}

              {!sameDay && (
                <>
                  <div className="flex items-center justify-between">
                    <Label>End half day</Label>
                    <Switch checked={endHalfEnabled} onCheckedChange={setEndHalfEnabled} />
                  </div>
                  {endHalfEnabled && (
                    <div className="flex gap-4 pl-4">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input type="radio" name="endHalf" value="am" checked={endHalf === "am"} onChange={() => setEndHalf("am")} className="accent-primary" />
                        <span className="text-sm">AM</span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input type="radio" name="endHalf" value="pm" checked={endHalf === "pm"} onChange={() => setEndHalf("pm")} className="accent-primary" />
                        <span className="text-sm">PM</span>
                      </label>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* Hours input (hours mode only) */}
          {isHoursMode && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="booking-hours">Hours</Label>
              <Input
                id="booking-hours"
                type="number"
                min={0}
                step={0.5}
                value={hours}
                onChange={(e) => setHours(e.target.value)}
                required
              />
            </div>
          )}

          {/* Note */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="booking-note">Note (optional)</Label>
            <Textarea
              id="booking-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              placeholder="Any additional details..."
            />
          </div>

          {/* Balance indicator */}
          {balance && estimatedDeduction > 0 && (
            <div className="rounded-md border p-3 space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Current remaining</span>
                <span className="font-medium">{balance.remaining} {unit}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">This booking</span>
                <span className="font-medium text-amber-600">−{estimatedDeduction} {unit}</span>
              </div>
              <div className="flex justify-between border-t pt-1">
                <span className="text-muted-foreground">After booking</span>
                <span className={`font-bold ${projectedRemaining !== null && projectedRemaining < 0 ? "text-destructive" : "text-primary"}`}>
                  {projectedRemaining} {unit}
                </span>
              </div>
            </div>
          )}

          {/* Warning */}
          {warning && (
            <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 dark:bg-amber-950/30 p-3 text-sm text-amber-700 dark:text-amber-400">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              {warning}
            </div>
          )}

          {/* Error */}
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <SheetFooter>
          <Button variant="outline" onClick={() => { resetForm(); onOpenChange(false); }} disabled={loading}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={loading || !canSubmit}>
            {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {requiresApproval ? "Submit Request" : "Book Holiday"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
