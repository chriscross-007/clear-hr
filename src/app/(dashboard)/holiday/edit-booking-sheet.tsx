"use client";

import { useState, useEffect } from "react";
import { Loader2 } from "lucide-react";
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  updateHolidayBooking,
  type HolidayBookingRow,
  type AbsenceReasonOption,
  type BalanceSummary,
} from "../holiday-booking-actions";
import { cancelMyBooking } from "../approvals-actions";

interface EditBookingSheetProps {
  booking: HolidayBookingRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  reasons: AbsenceReasonOption[];
  balance: BalanceSummary | null;
  measurementMode: string;
  onSuccess: () => void;
}

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

export function EditBookingSheet({
  booking,
  open,
  onOpenChange,
  reasons,
  balance,
  measurementMode,
  onSuccess,
}: EditBookingSheetProps) {
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
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false);
  const [cancelLoading, setCancelLoading] = useState(false);

  const unit = measurementMode === "hours" ? "hours" : "days";
  const isHoursMode = measurementMode === "hours";
  const sameDay = startDate === endDate && startDate !== "";
  const isCancelled = booking?.status === "cancelled";

  // Populate form when booking changes or sheet opens
  useEffect(() => {
    if (booking && open) {
      setReasonId(booking.leave_reason_id);
      setStartDate(booking.start_date);
      setEndDate(booking.end_date);
      setStartHalfEnabled(!!booking.start_half);
      setStartHalf((booking.start_half as "am" | "pm") ?? "am");
      setEndHalfEnabled(!!booking.end_half);
      setEndHalf((booking.end_half as "am" | "pm") ?? "pm");
      setHours(booking.hours_deducted !== null ? String(booking.hours_deducted) : "");
      setNote(booking.employee_note ?? "");
      setError(null);
    }
  }, [booking, open]);

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

  // Add back the original booking's deduction to remaining (since it's already counted)
  const originalDeduction = isHoursMode
    ? Number(booking?.hours_deducted ?? 0)
    : Number(booking?.days_deducted ?? 0);
  const adjustedRemaining = balance ? balance.remaining + originalDeduction : null;
  const projectedRemaining = adjustedRemaining !== null ? adjustedRemaining - estimatedDeduction : null;

  // Group reasons by absence type
  const grouped = new Map<string, AbsenceReasonOption[]>();
  for (const r of reasons) {
    const group = grouped.get(r.absence_type_name) ?? [];
    group.push(r);
    grouped.set(r.absence_type_name, group);
  }

  async function handleSave() {
    if (!booking || !reasonId || !startDate || !endDate) return;
    setLoading(true);
    setError(null);

    const result = await updateHolidayBooking(booking.id, {
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

    onOpenChange(false);
    onSuccess();
  }

  async function handleCancel() {
    if (!booking) return;
    setCancelLoading(true);
    const result = await cancelMyBooking(booking.id);
    setCancelLoading(false);
    if (result.success) {
      setCancelConfirmOpen(false);
      onOpenChange(false);
      onSuccess();
    }
  }

  const canSubmit = reasonId && startDate && endDate && endDate >= startDate && estimatedDeduction > 0;

  return (
    <>
      <Sheet
        open={open}
        onOpenChange={onOpenChange}
      >
        <SheetContent className="overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{isCancelled ? "Edit & Resubmit Request" : "Edit Holiday Request"}</SheetTitle>
            <SheetDescription>
              {isCancelled
                ? "Update the details and resubmit as a new pending request."
                : "Update your pending request. Changes take effect immediately."}
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
                <Label htmlFor="edit-start">Start Date</Label>
                <Input
                  id="edit-start"
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
                <Label htmlFor="edit-end">End Date</Label>
                <Input
                  id="edit-end"
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
                      <input type="radio" name="editStartHalf" value="am" checked={startHalf === "am"} onChange={() => setStartHalf("am")} className="accent-primary" />
                      <span className="text-sm">AM</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="radio" name="editStartHalf" value="pm" checked={startHalf === "pm"} onChange={() => setStartHalf("pm")} className="accent-primary" />
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
                          <input type="radio" name="editEndHalf" value="am" checked={endHalf === "am"} onChange={() => setEndHalf("am")} className="accent-primary" />
                          <span className="text-sm">AM</span>
                        </label>
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input type="radio" name="editEndHalf" value="pm" checked={endHalf === "pm"} onChange={() => setEndHalf("pm")} className="accent-primary" />
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
                <Label htmlFor="edit-hours">Hours</Label>
                <Input
                  id="edit-hours"
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
              <Label htmlFor="edit-note">Note (optional)</Label>
              <Textarea
                id="edit-note"
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
                  <span className="text-muted-foreground">Remaining (excl. this booking)</span>
                  <span className="font-medium">{adjustedRemaining} {unit}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">This booking</span>
                  <span className="font-medium text-amber-600">−{estimatedDeduction} {unit}</span>
                </div>
                <div className="flex justify-between border-t pt-1">
                  <span className="text-muted-foreground">After this booking</span>
                  <span className={`font-bold ${projectedRemaining !== null && projectedRemaining < 0 ? "text-destructive" : "text-primary"}`}>
                    {projectedRemaining} {unit}
                  </span>
                </div>
              </div>
            )}

            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>

          <SheetFooter className="flex !justify-between">
            {!isCancelled && (
              <Button
                variant="destructive"
                onClick={() => setCancelConfirmOpen(true)}
                disabled={loading}
              >
                Cancel Request
              </Button>
            )}
            <div className={`flex gap-2 ${isCancelled ? "ml-auto" : ""}`}>
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
                Close
              </Button>
              <Button onClick={handleSave} disabled={loading || !canSubmit}>
                {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                {isCancelled ? "Resubmit Request" : "Save Changes"}
              </Button>
            </div>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* Cancel confirmation */}
      <AlertDialog open={cancelConfirmOpen} onOpenChange={setCancelConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel Holiday Request</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to cancel this holiday request? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={cancelLoading}>Keep Request</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={cancelLoading}
              onClick={(e) => { e.preventDefault(); handleCancel(); }}
            >
              {cancelLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Cancel Request
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
