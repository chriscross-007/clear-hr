"use client";

import { useState, useEffect, useRef } from "react";
import { Loader2, AlertTriangle, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  AbsenceFormFields,
  type AbsenceFormState,
  type HalfOption,
} from "@/components/absence-form-fields";
import {
  submitHolidayBooking,
  updateHolidayBooking,
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
import {
  BookingConversation,
  type BookingConversationHandle,
} from "@/app/(dashboard)/members/[memberId]/calendar/booking-conversation";
import { Label } from "@/components/ui/label";
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

interface BookHolidaySheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Member id of the booking owner — same as the viewing employee on
   *  My Absences. Passed to <BookingConversation> in existing-mode so
   *  the thread + document upload metadata are scoped correctly. */
  memberId: string;
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

function emptyFormState(defaultTypeId: string, defaultReasonId: string): AbsenceFormState {
  return {
    typeId: defaultTypeId,
    reasonId: defaultReasonId,
    startDate: "",
    endDate: "",
    startHalf: "full",
    endHalf: "full",
    hours: "",
    note: "",
  };
}

export function BookHolidaySheet({
  open,
  onOpenChange,
  memberId,
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
  // Pending bookings → fully editable existing mode (Save + Delete).
  // Approved bookings (any type) → read-only "Booked Absence" view; any
  // change has to go through an admin. Notice/cover preview panels and
  // the balance projection are also suppressed in read-only mode — the
  // booking has already been accepted, so warning the user that it
  // "might be rejected" is misleading.
  const isApprovedBooking = isExistingMode && existingBooking?.status === "approved";
  const isReadOnly = isApprovedBooking;

  // Default opens on Annual Leave / Annual Leave (the canonical "request
  // holiday" path). Type drives the Reason list — switching type reloads
  // Reason to the first non-deprecated reason within the new type, so the
  // dropdown is never left pointing at a reason from a different type.
  const defaultReason = reasons.find((r) => r.absence_type_name === "Annual Leave" && !r.is_deprecated);
  const defaultReasonId = defaultReason?.id ?? "";
  const defaultTypeId = defaultReason?.absence_type_id ?? "";

  // Single form-state object shared with the AbsenceFormFields component.
  // CLE — consolidated from six separate useStates so the shared component
  // can drive Type / Reason / dates / half-days / hours / note as a unit.
  const [form, setForm] = useState<AbsenceFormState>(() =>
    emptyFormState(defaultTypeId, defaultReasonId),
  );
  function updateForm(patch: Partial<AbsenceFormState>) {
    setForm((prev) => ({ ...prev, ...patch }));
  }

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

  // Seed the form on open. When an existingBooking is supplied, populate
  // every field from it; otherwise prefill any dates the parent passed in
  // (e.g. drag-to-select on the calendar). Only on the open transition —
  // subsequent in-form edits are preserved.
  useEffect(() => {
    if (!open) return;
    if (existingBooking) {
      const existingReason = reasons.find((r) => r.id === existingBooking.leave_reason_id);
      // Translate stored half-day flags ("am"/"pm"/null) into the
      // HalfOption ("full"/"am"/"pm") used by the shared form.
      const half = (v: string | null): HalfOption => (v === "am" || v === "pm" ? v : "full");
      setForm({
        typeId: existingReason?.absence_type_id ?? defaultTypeId,
        reasonId: existingBooking.leave_reason_id,
        startDate: existingBooking.start_date,
        endDate: existingBooking.end_date ?? existingBooking.start_date,
        startHalf: half(existingBooking.start_half),
        endHalf: half(existingBooking.end_half),
        hours: existingBooking.hours_deducted !== null ? String(existingBooking.hours_deducted) : "",
        note: existingBooking.employee_note ?? "",
      });
      return;
    }
    setForm((prev) => ({
      ...prev,
      startDate: initialStartDate ?? prev.startDate,
      endDate: initialEndDate ?? prev.endDate,
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const unit = measurementMode === "hours" ? "hours" : "days";
  const isHoursMode = measurementMode === "hours";
  const sameDay = form.startDate === form.endDate && form.startDate !== "";

  // Calculate estimated deduction using work pattern. The shared form
  // uses HalfOption ("full"/"am"/"pm"); convert to the booleans the day
  // counter expects.
  let estimatedDeduction = 0;
  const startIsHalf = form.startHalf !== "full";
  const endIsHalf = form.endHalf !== "full";
  if (isHoursMode) {
    estimatedDeduction = Number(form.hours) || 0;
  } else if (form.startDate && form.endDate && form.endDate >= form.startDate) {
    estimatedDeduction = countWorkingDaysSimple(
      form.startDate, form.endDate, startIsHalf, endIsHalf && !sameDay, workPattern,
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
    // Already-approved bookings have cleared whatever approval workflow
    // the org has — surfacing "this might be rejected" warnings on them
    // would be misleading.
    if (isReadOnly) return null;
    if (!form.startDate || !form.endDate) return null;
    if (estimatedDeduction <= 0) return null;
    if (noticeRules.length === 0) return null;

    const workingDaysInGap = (afterIso: string, beforeIso: string): number => {
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
      if (b.end_date < form.startDate && workingDaysInGap(b.end_date, form.startDate) === 0) return true;
      if (form.endDate !== null && b.start_date > form.endDate && workingDaysInGap(form.endDate, b.start_date) === 0) return true;
      return false;
    });

    let combinedDays = estimatedDeduction;
    let earliestStart = form.startDate;
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

  // Determine if the selected reason requires approval
  const selectedReason = reasons.find((r) => r.id === form.reasonId);
  const requiresApproval = selectedReason ? selectedReason.requires_approval : true;
  // Only Annual Leave bookings deduct from the holiday balance, so the
  // remaining / projected / over-allowance panels only make sense for AL.
  // Sick / Compassionate / other absence types are submitted as-is and the
  // server-side compute helper already filters them out of the balance.
  const affectsHolidayBalance = selectedReason?.absence_type_name === "Annual Leave";

  function resetForm() {
    setForm(emptyFormState(defaultTypeId, defaultReasonId));
    setError(null);
    setWarning(null);
  }

  const [showOverBookWarning, setShowOverBookWarning] = useState(false);

  // Unsent-draft guard. If the user types a comment in the conversation
  // panel but never hits Send, then triggers any close path (Cancel,
  // Save Changes, Delete Request, Sheet X / overlay), prompt them to
  // Send / Discard / stay before proceeding.
  const conversationRef = useRef<BookingConversationHandle | null>(null);
  const [draftDialogAction, setDraftDialogAction] = useState<(() => void | Promise<void>) | null>(null);

  async function withDraftGuard(action: () => void | Promise<void>) {
    if (conversationRef.current?.hasUnsentDraft()) {
      // Stash the original action and pop the confirm dialog. The
      // dialog buttons will either send first then run the action, or
      // discard and run, or cancel and stay.
      setDraftDialogAction(() => action);
      return;
    }
    await action();
  }

  async function handleDraftSendAndContinue() {
    const action = draftDialogAction;
    setDraftDialogAction(null);
    const res = await conversationRef.current?.sendUnsentDraft();
    if (res && !res.success) {
      setError(res.error ?? "Could not send your comment");
      return;
    }
    if (action) await action();
  }

  async function handleDraftDiscardAndContinue() {
    const action = draftDialogAction;
    setDraftDialogAction(null);
    if (action) await action();
  }

  function handleSubmit() {
    if (!form.reasonId || !form.startDate || !form.endDate) return;
    // Only Annual Leave touches the holiday balance, so the
    // over-allowance confirm step is skipped for other absence types.
    if (
      affectsHolidayBalance
      && projectedRemaining !== null
      && projectedRemaining < 0
      && !showOverBookWarning
    ) {
      setShowOverBookWarning(true);
      return;
    }
    setShowOverBookWarning(false);
    doSubmit();
  }

  async function doSubmit() {
    if (!form.reasonId || !form.startDate || !form.endDate) return;
    setLoading(true);
    setError(null);
    setWarning(null);

    const result = await submitHolidayBooking({
      leaveReasonId: form.reasonId,
      startDate: form.startDate,
      endDate: form.endDate,
      // Convert HalfOption back to the "am"/"pm"/null shape the server
      // action persists.
      startHalf: form.startHalf === "full" ? null : form.startHalf,
      endHalf: form.endHalf === "full" || sameDay ? null : form.endHalf,
      daysDeducted: !isHoursMode ? estimatedDeduction : null,
      hoursDeducted: isHoursMode ? estimatedDeduction : null,
      note: form.note.trim() || null,
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
    // Same rationale as the notice preview — approved bookings have
    // already cleared the workflow; warning the user that the team
    // won't have cover is just noise at this point.
    if (isReadOnly) return null;
    if (!form.startDate || !form.endDate) return null;
    if (!teamCover || !teamCover.teamId) return null;
    if (teamCover.minCover <= 0) return null;
    const start = new Date(form.startDate + "T00:00:00Z");
    const end = new Date(form.endDate + "T00:00:00Z");
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

  // Form validity — same conditions gate both Submit Request (new) and
  // Save Changes (edit existing). Notice/cover hard-blocks apply to both.
  const validForm = !!form.reasonId
    && !!form.startDate
    && !!form.endDate
    && form.endDate >= form.startDate
    && estimatedDeduction > 0
    && !noticeBlocksSubmit
    && !coverBlocksSubmit;

  async function handleSaveChanges() {
    if (!existingBooking || !form.reasonId || !form.startDate || !form.endDate) return;
    setLoading(true);
    setError(null);
    setWarning(null);

    const result = await updateHolidayBooking(existingBooking.id, {
      leaveReasonId: form.reasonId,
      startDate: form.startDate,
      endDate: form.endDate,
      startHalf: form.startHalf === "full" ? null : form.startHalf,
      endHalf: form.endHalf === "full" || sameDay ? null : form.endHalf,
      daysDeducted: !isHoursMode ? estimatedDeduction : null,
      hoursDeducted: isHoursMode ? estimatedDeduction : null,
      note: form.note.trim() || null,
    });

    setLoading(false);

    if (!result.success) {
      setError(result.error ?? "An error occurred");
      return;
    }

    resetForm();
    onSuccess();
  }

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

  function closeSheet() {
    resetForm();
    onOpenChange(false);
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(v) => {
        if (v) { onOpenChange(v); return; }
        // Closing — intercept so an unsent conversation draft can be
        // captured before the Sheet tears down its state.
        withDraftGuard(closeSheet);
      }}
    >
      <SheetContent className="overflow-y-auto">
        <SheetHeader>
          <div className="flex items-center gap-2">
            <SheetTitle>
              {isApprovedBooking
                ? "Booked Absence"
                : isExistingMode
                  ? "Existing Absence Request"
                  : (requiresApproval ? "Request Absence" : "Book Absence")}
            </SheetTitle>
            {/* History popover — visible only on existing requests so the
                employee can see who has acted on the request and how far
                a multi-level approval has progressed. */}
            {isExistingMode && existingBooking && (
              <BookingHistoryPopover bookingId={existingBooking.id} />
            )}
          </div>
          <SheetDescription>
            {isApprovedBooking
              ? "Status: Booked. Please contact your manager to request changes."
              : isExistingMode
                ? `Status: ${existingBooking?.status ?? "—"}. Edit and save your changes, or use Delete Request to cancel.`
                : (requiresApproval
                    ? "This request will need manager approval."
                    : "This booking will be confirmed immediately.")}
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-5 px-4">
          {/* Shared form fields — Type, Reason, dates, half-days, hours,
              note. Fields are read-only when viewing an approved booking
              (employee must contact admin to amend); editable in pending
              existing mode and in new-request mode. */}
          <AbsenceFormFields
            state={form}
            onChange={updateForm}
            reasons={reasons}
            measurementMode={isHoursMode ? "hours" : "days"}
            disabled={isReadOnly}
            // For existing bookings the conversation panel below
            // replaces the single-shot Note field — the employee can
            // see admin replies and post follow-ups instead of just
            // owning a one-line note. New requests keep the Note field
            // since it becomes the first message in the conversation
            // when the booking is created (handled server-side in
            // submitHolidayBooking).
            hideNote={isExistingMode}
          />

          {/* Conversation thread on existing bookings — same component
              the admin uses on their Edit Absence form, so both sides
              see the same messages and attachments. */}
          {isExistingMode && existingBooking && (
            <div className="flex flex-col gap-1.5">
              <Label>Conversation</Label>
              <BookingConversation
                ref={conversationRef}
                bookingId={existingBooking.id}
                memberId={memberId}
                callerMemberId={memberId}
                callerRole="employee"
              />
            </div>
          )}

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

          {/* Team cover preview (CLE-187). */}
          {coverViolation !== null && (() => {
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

          {/* Booking summary. "This booking" always renders when there's
              a measurable duration — it's just the size of the request,
              useful regardless of absence type. The balance-projection
              rows (Current remaining / After …) only render when the
              user can actually act on the balance: Annual Leave with an
              active Holiday Period, AND the form isn't in read-only mode
              (approved bookings show the deduction only — any change has
              to go through admin).

              Sign convention on "This booking":
                • Pending editable (delete refunds the balance) → +N
                • New request OR approved read-only → −N (it's a deduction) */}
          {estimatedDeduction > 0 && (
            <div className="rounded-md border p-3 space-y-1 text-sm">
              {affectsHolidayBalance && balance && !isReadOnly && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Current remaining</span>
                  <span className="font-medium">{balance.remaining} {unit}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-muted-foreground">This booking</span>
                <span className={`font-medium ${isExistingMode && !isReadOnly ? "text-green-600" : "text-amber-600"}`}>
                  {isExistingMode && !isReadOnly ? "+" : "−"}{estimatedDeduction} {unit}
                </span>
              </div>
              {affectsHolidayBalance && balance && !isReadOnly && (
                <div className="flex justify-between border-t pt-1">
                  <span className="text-muted-foreground">
                    {isExistingMode ? "After deletion" : "After booking"}
                  </span>
                  <span className={`font-bold ${projectedRemaining !== null && projectedRemaining < 0 ? "text-destructive" : "text-primary"}`}>
                    {projectedRemaining} {unit}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Warning */}
          {warning && (
            <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 dark:bg-amber-950/30 p-3 text-sm text-amber-700 dark:text-amber-400">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              {warning}
            </div>
          )}

          {/* Over-allowance confirm step (AL only). */}
          {affectsHolidayBalance && showOverBookWarning && projectedRemaining !== null && (
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
          <Button variant="outline" onClick={() => withDraftGuard(closeSheet)} disabled={loading}>
            {isReadOnly ? "Close" : "Cancel"}
          </Button>
          {isReadOnly ? null : isExistingMode ? (
            <>
              <Button
                variant="destructive"
                onClick={() => withDraftGuard(handleDelete)}
                disabled={loading}
              >
                {loading
                  ? <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  : <Trash2 className="h-4 w-4 mr-2" />}
                Delete Request
              </Button>
              <Button onClick={() => withDraftGuard(handleSaveChanges)} disabled={loading || !validForm}>
                {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Save Changes
              </Button>
            </>
          ) : (
            <Button onClick={handleSubmit} disabled={loading || !validForm}>
              {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Submit Request
            </Button>
          )}
        </SheetFooter>
      </SheetContent>

      {/* Unsent-draft guard. Pops when a close path is triggered while
          the conversation panel still has draft text or pending file
          attachments — the user picks Send (post first, then proceed),
          Discard (drop the draft, proceed), or Cancel (stay on the
          form). */}
      <AlertDialog
        open={draftDialogAction !== null}
        onOpenChange={(o) => { if (!o) setDraftDialogAction(null); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unsent comment</AlertDialogTitle>
            <AlertDialogDescription>
              Do you wish to send the comment you just made before closing?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <Button
              variant="outline"
              onClick={(e) => {
                e.preventDefault();
                handleDraftDiscardAndContinue();
              }}
            >
              Discard
            </Button>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                handleDraftSendAndContinue();
              }}
            >
              Send
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Sheet>
  );
}
