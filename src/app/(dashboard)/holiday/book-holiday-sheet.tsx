"use client";

import { useState, useEffect } from "react";
import { Loader2, AlertTriangle, Trash2 } from "lucide-react";
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
  getMyWorkPattern,
  getMyBankHolidayContext,
  getMyTeamCoverContext,
  type AbsenceReasonOption,
  type BalanceSummary,
  type HolidayBookingRow,
  type TeamCoverContext,
} from "../holiday-booking-actions";
import { cancelMyBooking } from "../approvals-actions";
import { getMyOrgNoticeContext } from "../notice-period-actions";
import { countWorkingDaysSimple, type WorkPatternHours } from "@/lib/day-counting";
import { BookingHistoryPopover } from "@/components/booking-history-popover";

interface BookHolidaySheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  reasons: AbsenceReasonOption[];
  balance: BalanceSummary | null;
  measurementMode: string;
  onSuccess: () => void;
  /** Pre-fills the start/end dates when opening (e.g. when the calendar's
   *  drag-to-select hands a picked range to the sheet). Both apply only on
   *  the open transition; subsequent edits in the form are kept. */
  initialStartDate?: string | null;
  initialEndDate?: string | null;
  /** When set, the sheet displays the existing booking's details read-only,
   *  hides the Submit button, and surfaces a red Delete Request button that
   *  cancels via `cancelMyBooking`. Used when the user clicks/drags onto
   *  an existing pending/approved booking on the calendar. */
  existingBooking?: HolidayBookingRow | null;
  /** The user's other Holiday-type bookings (pending/approved) — used so the
   *  notice-period preview can stitch consecutive bookings together (CLE-179).
   *  Pass an empty array if the consecutive check isn't relevant. */
  existingHolidayBookings?: Array<{
    id: string;
    start_date: string;
    end_date: string | null;
    days_deducted: number | null;
    status: string;
  }>;
}

export function BookHolidaySheet({
  open,
  onOpenChange,
  reasons,
  balance,
  measurementMode,
  onSuccess,
  initialStartDate,
  initialEndDate,
  existingBooking,
  existingHolidayBookings = [],
}: BookHolidaySheetProps) {
  const isExistingMode = !!existingBooking;
  const defaultReasonId = reasons.find((r) => r.absence_type_name === "Annual Leave" && !r.is_deprecated)?.id ?? "";
  const [reasonId, setReasonId] = useState(defaultReasonId);
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
  const [workPattern, setWorkPattern] = useState<WorkPatternHours | null>(null);
  const [bankHolidays, setBankHolidays] = useState<Set<string>>(new Set());
  const [bankHolidayHandling, setBankHolidayHandling] = useState<string>("deducted");
  const [noticeRules, setNoticeRules] = useState<{ min_booking_days: number; notice_days: number }[]>([]);
  const [noticeBlocks, setNoticeBlocks] = useState<boolean>(false);
  // CLE-187 — team-cover preview context. Loaded once on open; the client
  // computes per-day cover impact locally as the user adjusts dates.
  const [teamCover, setTeamCover] = useState<TeamCoverContext | null>(null);

  // Load work pattern + bank holidays + notice rules on sheet open
  useEffect(() => {
    if (open) {
      getMyWorkPattern().then(setWorkPattern);
      getMyBankHolidayContext().then((ctx) => {
        setBankHolidays(new Set(ctx.dates));
        setBankHolidayHandling(ctx.handling);
      });
      getMyOrgNoticeContext().then((ctx) => {
        setNoticeRules(ctx.rules);
        setNoticeBlocks(ctx.blockRequests);
      });
      getMyTeamCoverContext().then((res) => {
        setTeamCover(res.success ? res.context : null);
      });
    }
  }, [open]);

  // Pre-fill start/end dates when the sheet opens with an initial range
  // (e.g. drag-to-select on the planner calendar). When an existingBooking
  // is supplied, populate the whole form from it instead. Only on the open
  // transition — subsequent edits in the form are preserved.
  useEffect(() => {
    if (open) {
      if (existingBooking) {
        setReasonId(existingBooking.leave_reason_id);
        setStartDate(existingBooking.start_date);
        setEndDate(existingBooking.end_date ?? existingBooking.start_date);
        setStartHalfEnabled(!!existingBooking.start_half);
        setStartHalf((existingBooking.start_half as "am" | "pm" | null) ?? "am");
        setEndHalfEnabled(!!existingBooking.end_half);
        setEndHalf((existingBooking.end_half as "am" | "pm" | null) ?? "pm");
        setHours(existingBooking.hours_deducted !== null ? String(existingBooking.hours_deducted) : "");
        setNote(existingBooking.employee_note ?? "");
        return;
      }
      if (initialStartDate) setStartDate(initialStartDate);
      if (initialEndDate) setEndDate(initialEndDate);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const unit = measurementMode === "hours" ? "hours" : "days";
  const isHoursMode = measurementMode === "hours";
  const sameDay = startDate === endDate && startDate !== "";

  // Calculate estimated deduction using work pattern
  let estimatedDeduction = 0;
  if (isHoursMode) {
    estimatedDeduction = Number(hours) || 0;
  } else if (startDate && endDate && endDate >= startDate) {
    estimatedDeduction = countWorkingDaysSimple(
      startDate, endDate, startHalfEnabled, endHalfEnabled && !sameDay, workPattern,
      bankHolidays, bankHolidayHandling
    );
  }

  // For a new request the deduction subtracts from remaining; for an
  // existing booking shown for deletion, the days come BACK to the balance,
  // so we add instead.
  const projectedRemaining = balance
    ? (isExistingMode
        ? balance.remaining + estimatedDeduction
        : balance.remaining - estimatedDeduction)
    : null;

  // Notice period violation preview (CLE-178 / CLE-179). Picks the rule
  // with the largest min_booking_days the (potentially-combined) booking
  // is at or above. Consecutive existing pending/approved Holiday bookings
  // (calendar-day adjacent) are folded into the days count and the
  // earliest start_date is used for the notice calculation, so an
  // employee can't dodge a notice rule by splitting one large request
  // into two adjacent small ones.
  const noticeViolation:
    | { noticeDays: number; minBookingDays: number; daysGiven: number; combined: boolean; combinedDays: number }
    | null = (() => {
    if (isExistingMode) return null;
    if (!startDate || !endDate) return null;
    if (estimatedDeduction <= 0) return null;
    if (noticeRules.length === 0) return null;

    // Find existing bookings whose gap to the new request contains zero
    // working days — Wed → Fri stitches with Mon → Tue because the only
    // days in between are a weekend. Uses the same Work Profile + bank
    // holiday handling the rest of the booking flow uses, so the
    // arithmetic stays consistent.
    const workingDaysInGap = (afterIso: string, beforeIso: string): number => {
      // Working days strictly between afterIso and beforeIso. Exclusive.
      if (afterIso >= beforeIso) return 0;
      const inner = new Date(new Date(afterIso + "T00:00:00Z").getTime() + 86_400_000)
        .toISOString()
        .slice(0, 10);
      const innerEnd = new Date(new Date(beforeIso + "T00:00:00Z").getTime() - 86_400_000)
        .toISOString()
        .slice(0, 10);
      if (inner > innerEnd) return 0;
      return countWorkingDaysSimple(
        inner, innerEnd, false, false, workPattern, bankHolidays, bankHolidayHandling,
      );
    };
    const adjacent = existingHolidayBookings.filter((b) => {
      if (!b.end_date) return false;
      if (b.end_date < startDate && workingDaysInGap(b.end_date, startDate) === 0) return true;
      if (b.start_date > endDate && workingDaysInGap(endDate, b.start_date) === 0) return true;
      return false;
    });

    let combinedDays = estimatedDeduction;
    let earliestStart = startDate;
    for (const a of adjacent) {
      combinedDays += Number(a.days_deducted ?? 0);
      if (a.start_date < earliestStart) earliestStart = a.start_date;
    }

    const matching = noticeRules.find((r) => combinedDays >= r.min_booking_days);
    if (!matching) return null;

    const todayLocal = new Date();
    todayLocal.setUTCHours(0, 0, 0, 0);
    const earliest = new Date(earliestStart + "T00:00:00Z");
    const diffDays = Math.floor((earliest.getTime() - todayLocal.getTime()) / 86_400_000);
    if (diffDays >= matching.notice_days) return null;

    return {
      noticeDays: matching.notice_days,
      minBookingDays: matching.min_booking_days,
      daysGiven: Math.max(0, diffDays),
      combined: adjacent.length > 0,
      combinedDays,
    };
  })();

  // Filter to Annual Leave reasons only, exclude deprecated
  const activeReasons = reasons.filter((r) => r.absence_type_name === "Annual Leave" && !r.is_deprecated);

  // Group reasons by absence type
  const grouped = new Map<string, AbsenceReasonOption[]>();
  for (const r of activeReasons) {
    const group = grouped.get(r.absence_type_name) ?? [];
    group.push(r);
    grouped.set(r.absence_type_name, group);
  }

  // Determine if the selected reason requires approval
  const selectedReason = reasons.find((r) => r.id === reasonId);
  const requiresApproval = selectedReason ? selectedReason.requires_approval : true;

  function resetForm() {
    setReasonId(defaultReasonId);
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

  const [showOverBookWarning, setShowOverBookWarning] = useState(false);

  function handleSubmit() {
    if (!reasonId || !startDate || !endDate) return;
    if (projectedRemaining !== null && projectedRemaining < 0 && !showOverBookWarning) {
      setShowOverBookWarning(true);
      return;
    }
    setShowOverBookWarning(false);
    doSubmit();
  }

  async function doSubmit() {
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

  const noticeBlocksSubmit = noticeViolation !== null && noticeBlocks;

  // CLE-187 — team-cover preview. Walk each working day in the selected
  // range, count teammates already on leave (pending or approved), and
  // record the first day where dropping the caller too would push present
  // members below the team's Min Cover. Same block-or-warn semantics as
  // notice rules (driven by the same `noticeBlocks` flag from the org).
  const coverViolation: {
    firstDate: string;
    present: number;
    minCover: number;
    teamSize: number;
    onLeaveCount: number;
    onLeaveIds: string[];
  } | null = (() => {
    if (isExistingMode) return null;
    if (!startDate || !endDate) return null;
    if (!teamCover || !teamCover.teamId) return null;
    if (teamCover.minCover <= 0) return null;
    const start = new Date(startDate + "T00:00:00Z");
    const end = new Date(endDate + "T00:00:00Z");
    const cur = new Date(start);
    while (cur <= end) {
      const dow = cur.getUTCDay();
      const iso = cur.toISOString().slice(0, 10);
      const isWeekend = dow === 0 || dow === 6;
      const isBankHoliday = bankHolidays.has(iso) && bankHolidayHandling === "additional";
      if (!isWeekend && !isBankHoliday) {
        const onLeave = new Set<string>();
        for (const b of teamCover.teammateBookings) {
          if (b.startDate > iso) continue;
          if (b.endDate !== null && b.endDate < iso) continue;
          onLeave.add(b.memberId);
        }
        const present = teamCover.teamSize - onLeave.size - 1;
        if (present < teamCover.minCover) {
          return {
            firstDate: iso,
            present,
            minCover: teamCover.minCover,
            teamSize: teamCover.teamSize,
            onLeaveCount: onLeave.size,
            onLeaveIds: [...onLeave],
          };
        }
      }
      cur.setUTCDate(cur.getUTCDate() + 1);
    }
    return null;
  })();
  const coverBlocksSubmit = coverViolation !== null && (teamCover?.blockCover ?? false);

  const canSubmit = !isExistingMode
    && reasonId
    && startDate
    && endDate
    && endDate >= startDate
    && estimatedDeduction > 0
    && !noticeBlocksSubmit
    && !coverBlocksSubmit;

  async function handleDelete() {
    if (!existingBooking) return;
    setLoading(true);
    setError(null);
    const result = await cancelMyBooking(existingBooking.id);
    setLoading(false);
    if (!result.success) {
      setError(result.error ?? "Could not delete request");
      return;
    }
    resetForm();
    onSuccess();
  }

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) resetForm(); onOpenChange(v); }}>
      <SheetContent className="overflow-y-auto">
        <SheetHeader>
          <div className="flex items-center gap-2">
            <SheetTitle>
              {isExistingMode
                ? "Existing Holiday Request"
                : (requiresApproval ? "Request Holiday" : "Book Holiday")}
            </SheetTitle>
            {/* History popover — visible only on existing requests so the
                employee can see who has acted on the request and how far
                a multi-level approval has progressed. */}
            {isExistingMode && existingBooking && (
              <BookingHistoryPopover bookingId={existingBooking.id} />
            )}
          </div>
          <SheetDescription>
            {isExistingMode
              ? `Status: ${existingBooking?.status ?? "—"}. Use Delete Request to cancel this booking.`
              : (requiresApproval
                  ? "This request will need manager approval."
                  : "This booking will be confirmed immediately.")}
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-5 px-4">
          {/* Absence Reason */}
          <div className="flex flex-col gap-1.5">
            <Label>Absence Reason</Label>
            <Select value={reasonId} onValueChange={setReasonId} disabled={isExistingMode}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select a reason" />
              </SelectTrigger>
              <SelectContent>
                {activeReasons.length === 0 && (
                  <div className="px-2 py-3 text-sm text-muted-foreground text-center">No active absence reasons available.</div>
                )}
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
                disabled={isExistingMode}
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
                disabled={isExistingMode}
              />
            </div>
          </div>

          {/* Half-day toggles (days mode only) */}
          {!isHoursMode && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>Start half day</Label>
                <Switch checked={startHalfEnabled} onCheckedChange={setStartHalfEnabled} disabled={isExistingMode} />
              </div>
              {startHalfEnabled && (
                <div className="flex gap-4 pl-4">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="radio" name="startHalf" value="am" checked={startHalf === "am"} onChange={() => setStartHalf("am")} disabled={isExistingMode} className="accent-primary" />
                    <span className="text-sm">AM</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="radio" name="startHalf" value="pm" checked={startHalf === "pm"} onChange={() => setStartHalf("pm")} disabled={isExistingMode} className="accent-primary" />
                    <span className="text-sm">PM</span>
                  </label>
                </div>
              )}

              {!sameDay && (
                <>
                  <div className="flex items-center justify-between">
                    <Label>End half day</Label>
                    <Switch checked={endHalfEnabled} onCheckedChange={setEndHalfEnabled} disabled={isExistingMode} />
                  </div>
                  {endHalfEnabled && (
                    <div className="flex gap-4 pl-4">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input type="radio" name="endHalf" value="am" checked={endHalf === "am"} onChange={() => setEndHalf("am")} disabled={isExistingMode} className="accent-primary" />
                        <span className="text-sm">AM</span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input type="radio" name="endHalf" value="pm" checked={endHalf === "pm"} onChange={() => setEndHalf("pm")} disabled={isExistingMode} className="accent-primary" />
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
                disabled={isExistingMode}
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
              disabled={isExistingMode}
            />
          </div>

          {/* Notice period preview (CLE-178 / CLE-179). Hard-block when the
              org has notice_rules_block_requests=true; soft-warn otherwise.
              Combined-with-adjacent text shown when the rule fires only
              because of a consecutive existing booking. */}
          {noticeViolation !== null && (() => {
            const combinedClause = noticeViolation.combined
              ? `Combined with an existing consecutive booking, this is ${noticeViolation.combinedDays} days, which `
              : "This booking ";
            return noticeBlocksSubmit ? (
              <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>
                  {combinedClause}needs at least{" "}
                  <strong>{noticeViolation.noticeDays} days&apos; notice</strong>{" "}
                  (applies to bookings of {noticeViolation.minBookingDays}+ days).
                  You&apos;ve given {noticeViolation.daysGiven}.
                </span>
              </div>
            ) : (
              <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 dark:bg-amber-950/30 p-3 text-sm text-amber-700 dark:text-amber-400">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>
                  This request will likely be rejected as you haven&apos;t given sufficient notice
                  ({noticeViolation.noticeDays} days required for bookings of{" "}
                  {noticeViolation.minBookingDays}+ days; you&apos;ve given {noticeViolation.daysGiven}
                  {noticeViolation.combined
                    ? ` — counting an existing consecutive booking, this is ${noticeViolation.combinedDays} days in total`
                    : ""}).
                </span>
              </div>
            );
          })()}

          {/* Team cover preview (CLE-187). Hard-block when the org has
              notice_rules_block_requests=true; soft-warn otherwise.
              CLE-188 — show the exact computed present count + minimum so
              the user can see how close they are and so any mis-counting
              shows up directly in the message. */}
          {coverViolation !== null && (() => {
            // CLE-187 — production-ready wording. Names of already-on-leave
            // teammates go inside the sentence (not parens) so admins can
            // see at a glance which existing bookings are pushing the team
            // close to the minimum.
            const onLeaveNames = coverViolation.onLeaveIds
              .map((id) => teamCover?.teammateNames[id] ?? id)
              .join(" and ");
            const alreadyOff = coverViolation.onLeaveCount > 0
              ? ` ${onLeaveNames} ${coverViolation.onLeaveCount === 1 ? "is" : "are"} already off that day.`
              : "";
            return coverBlocksSubmit ? (
              <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>
                  This booking would leave only <strong>{coverViolation.present}</strong>{" "}
                  member{coverViolation.present === 1 ? "" : "s"} on duty on{" "}
                  <strong>{coverViolation.firstDate}</strong> — the team requires at least{" "}
                  <strong>{coverViolation.minCover}</strong>.{alreadyOff}
                </span>
              </div>
            ) : (
              <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 dark:bg-amber-950/30 p-3 text-sm text-amber-700 dark:text-amber-400">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>
                  This request will likely be rejected — it would leave only{" "}
                  <strong>{coverViolation.present}</strong> member{coverViolation.present === 1 ? "" : "s"} on duty on{" "}
                  <strong>{coverViolation.firstDate}</strong>, below the team minimum of{" "}
                  <strong>{coverViolation.minCover}</strong>.{alreadyOff}
                </span>
              </div>
            );
          })()}

          {/* Balance indicator */}
          {balance && estimatedDeduction > 0 && (
            <div className="rounded-md border p-3 space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Current remaining</span>
                <span className="font-medium">{balance.remaining} {unit}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">This booking</span>
                <span className={`font-medium ${isExistingMode ? "text-green-600" : "text-amber-600"}`}>
                  {isExistingMode ? "+" : "−"}{estimatedDeduction} {unit}
                </span>
              </div>
              <div className="flex justify-between border-t pt-1">
                <span className="text-muted-foreground">
                  {isExistingMode ? "After deletion" : "After booking"}
                </span>
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
          {showOverBookWarning && projectedRemaining !== null && (
            <div className="rounded-md bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 p-3 space-y-2">
              <p className="text-sm font-medium text-amber-800 dark:text-amber-200 flex items-center gap-1.5">
                <AlertTriangle className="h-4 w-4" /> Exceeds allowance
              </p>
              <p className="text-sm text-amber-700 dark:text-amber-300">
                This request would take your remaining balance to <strong>{projectedRemaining} {measurementMode === "hours" ? "hours" : "days"}</strong>. Do you want to submit anyway?
              </p>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => setShowOverBookWarning(false)}>Go Back</Button>
                <Button size="sm" variant="destructive" onClick={doSubmit} disabled={loading}>Submit Anyway</Button>
              </div>
            </div>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <SheetFooter>
          <Button variant="outline" onClick={() => { resetForm(); onOpenChange(false); }} disabled={loading}>
            Cancel
          </Button>
          {isExistingMode && (
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={loading}
            >
              {loading
                ? <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                : <Trash2 className="h-4 w-4 mr-2" />}
              Delete Request
            </Button>
          )}
          <Button onClick={handleSubmit} disabled={loading || !canSubmit}>
            {loading && !isExistingMode && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {requiresApproval ? "Submit Request" : "Book Holiday"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
