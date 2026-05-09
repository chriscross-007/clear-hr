"use client";

import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { useRouter, usePathname } from "next/navigation";
import { HolidayCalendar, type CalendarBooking, type CalendarBankHoliday } from "@/components/holiday-calendar";
import { HolidayUnitsPill } from "@/components/holiday-units-pill";
import { CalendarLegend } from "@/components/calendar/calendar-legend";
import { CalendarFilterPanel, type AbsenceTypeOption } from "@/components/calendar/calendar-filter-panel";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Trash2, ChevronLeft, ChevronRight, CalendarDays } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetFooter,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BookingConversation } from "./booking-conversation";
import {
  getOrCreateBookingConversation,
  sendConversationMessage,
  uploadDocumentToMessage,
} from "../../../conversation-actions";
import { SickDetailsPanel, type OrgAdminOption } from "./sick-details-panel";
import { BookingHistoryPopover } from "@/components/booking-history-popover";
import { saveSickDetails } from "../../../sick-booking-actions";
import type { SickDetailsInput } from "../../../sick-booking-types";
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
  adminBookAbsence,
  adminUpdateBooking,
  adminDeleteBooking,
  getBookingDetails,
} from "../../../holiday-booking-actions";
import {
  countWorkingDaysSimple,
  patternForDate,
  type WorkPatternHours,
  type WorkPatternAssignment,
} from "@/lib/day-counting";

/** A Holiday Period option exposed to the prev/next nav above the calendar. */
export type PeriodNavOption = {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  units: "days" | "hours";
};

export type AbsenceReasonOption = {
  id: string;
  name: string;
  colour: string;
  absence_type_id: string;
  absence_type_name: string;
};

// Re-export the shared AbsenceTypeOption type so existing imports from
// './admin-calendar-client' keep working without touching the calendar
// page's import line.
export type { AbsenceTypeOption };

interface AdminCalendarClientProps {
  memberId: string;
  memberName: string;
  userId: string;
  /** The admin's own member id — used by the conversation thread to align "mine" bubbles. */
  callerMemberId: string;
  /** Admin/owner members in the org — used by the BTW interviewer dropdown. */
  orgAdmins: OrgAdminOption[];
  /** True if the org has uploaded a self-certification PDF template. */
  hasSelfCertTemplate: boolean;
  yearStart: string;
  /** Number of months the calendar should render — sized to the selected
   *  Holiday Period's range (CLE-174). */
  monthCount: number;
  /** All Holiday Periods for this employee, sorted ascending by startDate. */
  periods: PeriodNavOption[];
  /** Currently displayed period. Drives calendar range + dashboard widget. */
  selectedPeriodId: string;
  /** The period covering today, if any — enables the "Current" jump button. */
  currentPeriodId: string | null;
  bookings: CalendarBooking[];
  bankHolidays: CalendarBankHoliday[];
  bankHolidayColour: string;
  absenceReasons: AbsenceReasonOption[];
  absenceTypes: AbsenceTypeOption[];
  workPattern: WorkPatternHours | null;
  /** Full Work Profile history — passed through to HolidayCalendar so that
   *  the schedule overlay shows the correct pattern for each visible date,
   *  including future-dated assignments. */
  workPatternHistory: WorkPatternAssignment[];
  bankHolidayHandling: string;
  /** If set, auto-open this booking's edit form on mount. */
  initialBookingId?: string | null;
}

type CalendarFilters = {
  hiddenTypeIds: string[];
  showSchedule: boolean;
  showBankHolidays: boolean;
};

function loadFilters(userId: string): CalendarFilters {
  const fallback: CalendarFilters = { hiddenTypeIds: [], showSchedule: true, showBankHolidays: true };
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(`calendar-filters-${userId}`);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<CalendarFilters>;
    return {
      hiddenTypeIds: Array.isArray(parsed.hiddenTypeIds) ? parsed.hiddenTypeIds.filter((s) => typeof s === "string") : [],
      showSchedule: typeof parsed.showSchedule === "boolean" ? parsed.showSchedule : true,
      showBankHolidays: typeof parsed.showBankHolidays === "boolean" ? parsed.showBankHolidays : true,
    };
  } catch {
    return fallback;
  }
}

function saveFilters(userId: string, filters: CalendarFilters): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(`calendar-filters-${userId}`, JSON.stringify(filters));
  } catch {
    // localStorage unavailable — just skip persistence.
  }
}

function formatLongDate(ymd: string): string {
  const d = new Date(ymd + "T00:00:00Z");
  return d.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

type HalfOption = "full" | "am" | "pm";

export function AdminCalendarClient({
  memberId,
  memberName,
  userId,
  callerMemberId,
  orgAdmins,
  hasSelfCertTemplate,
  yearStart,
  monthCount,
  periods,
  selectedPeriodId,
  currentPeriodId,
  bookings,
  bankHolidays,
  bankHolidayColour,
  absenceReasons,
  absenceTypes,
  workPattern,
  workPatternHistory,
  bankHolidayHandling,
  initialBookingId,
}: AdminCalendarClientProps) {
  const router = useRouter();
  const pathname = usePathname();

  // CLE-174 — period nav. Prev/next walk the periods list (sorted ascending),
  // and the Current button jumps to the period covering today.
  const selectedIndex = periods.findIndex((p) => p.id === selectedPeriodId);
  const displayedPeriod = periods[selectedIndex] ?? periods[0];
  const prevPeriod = selectedIndex > 0 ? periods[selectedIndex - 1] : null;
  const nextPeriod =
    selectedIndex >= 0 && selectedIndex < periods.length - 1
      ? periods[selectedIndex + 1]
      : null;
  const viewingCurrentPeriod = currentPeriodId === selectedPeriodId;
  const navigateToPeriod = useCallback(
    (id: string) => {
      router.push(`${pathname}?periodId=${id}`);
    },
    [router, pathname],
  );

  // Per-user filter state (key is `calendar-filters-{userId}` — not scoped per
  // employee, so toggles persist as the admin moves between team members).
  const [hiddenTypeIds, setHiddenTypeIds] = useState<Set<string>>(() => new Set());
  const [showSchedule, setShowSchedule] = useState<boolean>(true);
  const [showBankHolidays, setShowBankHolidays] = useState<boolean>(true);

  // Skip the very first save so the load effect's setStates can land before
  // the save effect overwrites localStorage with the (default) initial state.
  // Otherwise navigating between employees would clobber the persisted filters.
  const skipNextSaveRef = useRef(true);

  useEffect(() => {
    const f = loadFilters(userId);
    setHiddenTypeIds(new Set(f.hiddenTypeIds));
    setShowSchedule(f.showSchedule);
    setShowBankHolidays(f.showBankHolidays);
  }, [userId]);

  useEffect(() => {
    if (skipNextSaveRef.current) {
      skipNextSaveRef.current = false;
      return;
    }
    saveFilters(userId, { hiddenTypeIds: [...hiddenTypeIds], showSchedule, showBankHolidays });
  }, [userId, hiddenTypeIds, showSchedule, showBankHolidays]);

  const visibleAbsenceTypeIds = useMemo(() => {
    const set = new Set<string>();
    for (const t of absenceTypes) if (!hiddenTypeIds.has(t.id)) set.add(t.id);
    return set;
  }, [absenceTypes, hiddenTypeIds]);

  function toggleType(id: string) {
    setHiddenTypeIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setHiddenTypeIds((prev) => {
      // If anything is currently hidden, "All" turns everything on; otherwise
      // it turns everything off. (The All checkbox itself displays as checked
      // when nothing is hidden — see CalendarFilterPanel.)
      if (prev.size === 0) return new Set(absenceTypes.map((t) => t.id));
      return new Set();
    });
  }

  const [range, setRange] = useState<{ start: string; end: string | null } | null>(null);
  const [startHalf, setStartHalf] = useState<HalfOption>("full");
  const [endHalf, setEndHalf] = useState<HalfOption>("full");
  const [reasonId, setReasonId] = useState<string>("");
  // First-message capture for create flow — applied AFTER the booking is saved.
  const [firstMessage, setFirstMessage] = useState("");
  const [firstMessageFiles, setFirstMessageFiles] = useState<File[]>([]);
  // Latest draft of sick-management fields (lifted from SickDetailsPanel).
  // Held in a ref alongside state so handleBook reads the freshest value
  // without the panel forcing re-renders here on every keystroke.
  const [sickDetails, setSickDetails] = useState<Omit<SickDetailsInput, "bookingId"> | null>(null);
  const sickDetailsRef = useRef<Omit<SickDetailsInput, "bookingId"> | null>(null);
  sickDetailsRef.current = sickDetails;
  // Snapshot of sick details after the panel finishes loading — used to detect
  // whether the user has actually changed anything.
  const [originalSickDetails, setOriginalSickDetails] = useState<string | null>(null);
  const sickDetailsDirty = sickDetails !== null && originalSickDetails !== null
    && JSON.stringify(sickDetails) !== originalSickDetails;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // Edit/delete state for existing bookings on the calendar
  const [editingBookingId, setEditingBookingId] = useState<string | null>(null);
  const [deletingBooking, setDeletingBooking] = useState<CalendarBooking | null>(null);
  const [deleting, setDeleting] = useState(false);
  // Snapshot of the booking as it was when the edit sheet opened — used to
  // drive the "is the form dirty?" check that gates Save Changes.
  const [originalEdit, setOriginalEdit] = useState<{
    start: string;
    end: string | null;
    startHalf: HalfOption;
    endHalf: HalfOption;
    reasonId: string;
  } | null>(null);

  // Auto-open a specific booking's edit form when navigated to with ?bookingId=
  const initialBookingHandled = useRef(false);
  useEffect(() => {
    if (!initialBookingId || initialBookingHandled.current) return;
    initialBookingHandled.current = true;
    const match = bookings.find((b) => b.id === initialBookingId);
    if (match) openEditFor(match);
  }, [initialBookingId, bookings]);

  const bankHolidaySet = useMemo(
    () => new Set(bankHolidays.map((bh) => bh.date)),
    [bankHolidays],
  );

  // Pick a sensible default reason (prefer one containing "annual").
  const defaultReasonId = useMemo(() => {
    if (absenceReasons.length === 0) return "";
    const annual = absenceReasons.find((r) => r.name.toLowerCase().includes("annual"));
    return (annual ?? absenceReasons[0]).id;
  }, [absenceReasons]);

  // Sick-type detection from the currently selected reason. The Sick details
  // panel + post-save call only fire when this is true.
  const selectedReason = absenceReasons.find((r) => r.id === reasonId);
  const isSickType = selectedReason?.absence_type_name?.startsWith("Sick") ?? false;

  // Group reasons by absence type for the dropdown — Annual Leave first,
  // Sick second, then any remaining types alphabetically.
  const groupedReasons = useMemo(() => {
    const TYPE_ORDER: Record<string, number> = { "Annual Leave": 0, "Sick": 1 };
    const map = new Map<string, AbsenceReasonOption[]>();
    for (const r of absenceReasons) {
      const group = map.get(r.absence_type_name) ?? [];
      group.push(r);
      map.set(r.absence_type_name, group);
    }
    return Array.from(map.entries()).sort(([a], [b]) => {
      const oa = TYPE_ORDER[a] ?? 999;
      const ob = TYPE_ORDER[b] ?? 999;
      if (oa !== ob) return oa - ob;
      return a.localeCompare(b);
    });
  }, [absenceReasons]);

  function openForRange(start: string, end: string) {
    setEditingBookingId(null);
    setOriginalEdit(null);
    setRange({ start, end });
    setReasonId(defaultReasonId);
    setStartHalf("full");
    setEndHalf("full");
    setFirstMessage("");
    setFirstMessageFiles([]);
    setSickDetails(null);

    setOriginalSickDetails(null);
    sickPanelLoaded.current = false;
    setError(null);
  }

  function closeSheet(navigateBack = true) {
    const wasDeepLinked = initialBookingId && editingBookingId === initialBookingId;
    setRange(null);
    setEditingBookingId(null);
    setOriginalEdit(null);
    setFirstMessage("");
    setFirstMessageFiles([]);
    setSickDetails(null);

    setOriginalSickDetails(null);
    sickPanelLoaded.current = false;
    setError(null);
    setSaving(false);

    // If the user arrived via a deep-link, go back on cancel/dismiss.
    // When called from the save path, navigateBack is false — the caller
    // handles navigation itself after closeSheet returns.
    if (navigateBack && wasDeepLinked) router.back();
  }

  // Stable so the conversation composer doesn't see a new identity on every
  // parent render — the previous inline handler caused its useEffect to
  // re-fire continually and the draft message could be lost on submit.
  const handleFirstMessageReady = useCallback((msg: string, files: File[]) => {
    setFirstMessage(msg);
    setFirstMessageFiles(files);
  }, []);

  // The panel fires onSickDetailsChange on mount (with defaults) and again
  // after its async load. We keep overwriting the baseline snapshot until the
  // panel signals it has finished loading, then any further change is a user
  // edit that makes the form dirty.
  const sickPanelLoaded = useRef(false);
  const handleSickDetailsChange = useCallback((next: Omit<SickDetailsInput, "bookingId">) => {
    setSickDetails(next);
    if (!sickPanelLoaded.current) {
      // Still loading — update the baseline
      setOriginalSickDetails(JSON.stringify(next));
    }
  }, []);
  const handleSickPanelLoaded = useCallback((baseline: Omit<SickDetailsInput, "bookingId">) => {
    setOriginalSickDetails(JSON.stringify(baseline));
    sickPanelLoaded.current = true;
  }, []);

  // Click an existing booking → open the edit form directly
  function handleBookingClick(booking: CalendarBooking) {
    openEditFor(booking);
  }

  // Load the full booking record and open the Sheet in edit mode
  async function openEditFor(booking: CalendarBooking) {

    setOriginalSickDetails(null);
    sickPanelLoaded.current = false;
    const result = await getBookingDetails(booking.id);
    if (!result.success || !result.booking) {
      setError(result.error ?? "Failed to load booking");
      return;
    }
    const b = result.booking;
    const half = (v: string | null): HalfOption => (v === "am" || v === "pm" ? v : "full");
    const sh = half(b.start_half);
    const eh = half(b.end_half);
    setEditingBookingId(b.id);
    setRange({ start: b.start_date, end: b.end_date });
    setReasonId(b.leave_reason_id);
    setStartHalf(sh);
    setEndHalf(eh);
    setOriginalEdit({
      start: b.start_date,
      end: b.end_date,
      startHalf: sh,
      endHalf: eh,
      reasonId: b.leave_reason_id,
    });
    setError(null);
  }

  async function handleDeleteConfirmed() {
    if (!deletingBooking) return;
    setDeleting(true);
    const result = await adminDeleteBooking(deletingBooking.id);
    setDeleting(false);
    if (!result.success) {
      setError(result.error ?? "Failed to delete booking");
      return;
    }
    setDeletingBooking(null);
    setToast(`Booking deleted`);
    setTimeout(() => setToast(null), 3000);

    const shouldGoBack = initialBookingId && editingBookingId === initialBookingId;
    closeSheet(false);

    if (shouldGoBack) {
      router.back();
    } else {
      router.refresh();
    }
  }

  const isOpenEnded = range !== null && range.end === null;
  const sameDay = range ? range.start === range.end : false;

  // Edit-only: has the admin actually changed anything vs what they opened?
  const bookingFieldsDirty =
    editingBookingId !== null && originalEdit !== null && range !== null
      ? range.start !== originalEdit.start
        || range.end !== originalEdit.end
        || startHalf !== originalEdit.startHalf
        || endHalf !== originalEdit.endHalf
        || reasonId !== originalEdit.reasonId
      : false;
  const isDirty = bookingFieldsDirty || sickDetailsDirty;

  const dayCount = useMemo(() => {
    if (!range) return 0;
    // Open-ended bookings use today as the effective end for the live count.
    const effectiveEnd = range.end ?? new Date().toISOString().slice(0, 10);
    const sh = startHalf !== "full";
    const eh = sameDay ? false : endHalf !== "full";
    // Resolve the pattern at the start of the booking range. If a future-
    // dated Work Profile applies to the picked dates, this picks it up.
    // (countWorkingDaysSimple still walks with a single pattern; spanning
    // an assignment boundary inside one booking is rare enough that this
    // approximation is acceptable.)
    const rangePattern = workPatternHistory.length > 0
      ? patternForDate(workPatternHistory, range.start) ?? workPattern
      : workPattern;
    return countWorkingDaysSimple(
      range.start,
      effectiveEnd,
      sh,
      eh,
      rangePattern,
      bankHolidaySet,
      bankHolidayHandling,
    );
  }, [range, sameDay, startHalf, endHalf, workPattern, workPatternHistory, bankHolidaySet, bankHolidayHandling]);

  async function handleBook() {
    if (!range || !reasonId) return;
    setSaving(true);
    setError(null);

    // Map half-day options to the stored "am"/"pm" string or null
    const sh: string | null = sameDay
      ? (startHalf === "full" ? null : startHalf)
      : startHalf === "full" ? null : startHalf;
    const eh: string | null = sameDay ? null : endHalf === "full" ? null : endHalf;

    const result = editingBookingId
      ? await adminUpdateBooking({
          bookingId: editingBookingId,
          leaveReasonId: reasonId,
          startDate: range.start,
          endDate: range.end,
          startHalf: sh,
          endHalf: isOpenEnded ? null : eh,
          note: null,
        })
      : await adminBookAbsence({
          memberId,
          leaveReasonId: reasonId,
          startDate: range.start,
          endDate: range.end,
          startHalf: sh,
          endHalf: isOpenEnded ? null : eh,
          note: null,
        });

    if (!result.success) {
      setSaving(false);
      setError(result.error ?? (editingBookingId ? "Failed to update booking" : "Failed to book absence"));
      return;
    }

    // Resolve the booking id for downstream side-effects (sick details + first
    // message). For edits it's the existing id; for new bookings it comes back
    // on the result.
    const persistedBookingId = editingBookingId
      ?? (result as { bookingId?: string }).bookingId
      ?? null;

    // Persist sick-management fields if the selected reason is a Sick type
    // and the panel surfaced a draft. If this fails, keep the sheet open so
    // the admin can see the error (closeSheet clears the error state).
    let sideEffectError: string | null = null;
    if (isSickType && persistedBookingId && sickDetailsRef.current) {
      try {
        const sd = sickDetailsRef.current;
        const sdRes = await saveSickDetails({ bookingId: persistedBookingId, ...sd });
        if (!sdRes.success) {
          sideEffectError = `Booking saved, but sick details could not be saved: ${sdRes.error ?? "unknown error"}`;
        }
      } catch (e) {
        sideEffectError = `Booking saved, but sick details could not be saved: ${e instanceof Error ? e.message : "unknown error"}`;
      }
    }

    // For new bookings only: if the admin entered a first message or attached
    // files, create the conversation and post that message now (before we
    // close the sheet). Failures here are surfaced to the admin but don't
    // unwind the booking — the booking itself is saved.
    if (!editingBookingId && (firstMessage.trim() || firstMessageFiles.length > 0)) {
      const newBookingId = (result as { bookingId?: string }).bookingId;
      if (newBookingId) {
        try {
          const conv = await getOrCreateBookingConversation(newBookingId);
          if (conv.success && conv.conversationId) {
            const msgRes = await sendConversationMessage(
              conv.conversationId,
              firstMessage.trim() || "(attachment)",
            );
            if (msgRes.success && msgRes.message) {
              for (const file of firstMessageFiles) {
                const fd = new FormData();
                fd.append("file", file);
                fd.append("conversationMessageId", msgRes.message.id);
                fd.append("memberId", memberId);
                await uploadDocumentToMessage(fd);
              }
            }
          }
        } catch {
          sideEffectError = "Booking saved, but the message could not be sent. You can add it from the Edit view.";
        }
      }
    }

    setSaving(false);

    if (sideEffectError) {
      // Keep the sheet open so the admin can see the error.
      setError(sideEffectError);
      router.refresh();
      return;
    }

    setToast(editingBookingId ? "Booking updated" : `Absence booked for ${memberName}`);
    setTimeout(() => setToast(null), 3000);

    // Ensure the just-booked absence type is visible on the calendar. The
    // hidden-type filter is per-user and persists across sessions, so a type
    // toggled off earlier (or via "All") would otherwise hide the booking
    // the admin just created.
    const bookedTypeId = absenceReasons.find((r) => r.id === reasonId)?.absence_type_id;
    if (bookedTypeId) {
      setHiddenTypeIds((prev) => {
        if (!prev.has(bookedTypeId)) return prev;
        const next = new Set(prev);
        next.delete(bookedTypeId);
        return next;
      });
    }

    // If the user arrived via a deep-link (e.g. from the incomplete sick
    // bookings widget), navigate back to where they came from after saving.
    const shouldGoBack = initialBookingId && editingBookingId === initialBookingId;
    closeSheet(false);

    if (shouldGoBack) {
      router.back();
    } else {
      router.refresh();
    }
  }

  return (
    <>
      {toast && (
        <div
          // Fixed overlay — sits above content without shifting the calendar.
          className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-md border border-green-200 bg-green-50 px-4 py-2 text-sm text-green-700 shadow-md dark:border-green-900 dark:bg-green-500/10 dark:text-green-400"
          role="status"
          aria-live="polite"
        >
          {toast}
        </div>
      )}

      <div className="flex w-full items-start gap-3">
        <CalendarLegend bookings={bookings} />
        {/* min-w-0 lets the calendar shrink inside the flex row instead of
            pushing the whole layout wider than the viewport. */}
        <div className="min-w-0 flex-1">
          {/* CLE-174 — period nav header */}
          <div className="mb-2 flex items-center justify-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => prevPeriod && navigateToPeriod(prevPeriod.id)}
              disabled={!prevPeriod}
              title={prevPeriod ? `Previous: ${prevPeriod.name}` : "No earlier period"}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <div className="text-center">
              <div className="flex items-center justify-center gap-2">
                <span className="text-base font-semibold">{displayedPeriod?.name ?? "—"}</span>
                {displayedPeriod && <HolidayUnitsPill units={displayedPeriod.units} />}
              </div>
              <div className="text-xs text-muted-foreground">
                {displayedPeriod
                  ? `${formatLongDate(displayedPeriod.startDate)} – ${formatLongDate(displayedPeriod.endDate)}`
                  : ""}
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => nextPeriod && navigateToPeriod(nextPeriod.id)}
              disabled={!nextPeriod}
              title={nextPeriod ? `Next: ${nextPeriod.name}` : "No later period"}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => currentPeriodId && navigateToPeriod(currentPeriodId)}
              disabled={!currentPeriodId || viewingCurrentPeriod}
              className="ml-2"
              title={
                !currentPeriodId
                  ? "No Holiday Period covers today"
                  : viewingCurrentPeriod
                    ? "Already viewing the current period"
                    : "Jump to the period covering today"
              }
            >
              <CalendarDays className="h-3.5 w-3.5 mr-1.5" />
              Current
            </Button>
          </div>
          <HolidayCalendar
            yearStart={yearStart}
            monthCount={monthCount}
            bookings={bookings}
            bankHolidays={bankHolidays}
            bankHolidayColour={bankHolidayColour}
            onRangeSelected={openForRange}
            onBookingClick={handleBookingClick}
            hideLegend
            visibleAbsenceTypeIds={visibleAbsenceTypeIds}
            workPattern={workPattern}
            workPatternHistory={workPatternHistory}
            showSchedule={showSchedule}
            showBankHolidays={showBankHolidays}
          />
        </div>
        <CalendarFilterPanel
          absenceTypes={absenceTypes}
          hiddenTypeIds={hiddenTypeIds}
          onToggleType={toggleType}
          onToggleAll={toggleAll}
          showSchedule={showSchedule}
          onToggleSchedule={() => setShowSchedule((s) => !s)}
          showBankHolidays={showBankHolidays}
          onToggleBankHolidays={() => setShowBankHolidays((v) => !v)}
          bankHolidayColour={bankHolidayColour}
        />
      </div>

      <p className="mt-3 text-xs text-muted-foreground">
        Tip: click and drag across dates to book an absence for {memberName}.
      </p>

      <Sheet open={range !== null} onOpenChange={(o) => !o && closeSheet()}>
        <SheetContent className="flex flex-col gap-4 sm:max-w-md">
          <SheetHeader>
            <div className="flex items-center gap-2">
              <SheetTitle>
                {editingBookingId ? "Edit Booking" : `Book absence for ${memberName}`}
              </SheetTitle>
              {editingBookingId && (
                <BookingHistoryPopover bookingId={editingBookingId} />
              )}
            </div>
          </SheetHeader>

          {error && (
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div>
          )}

          <div className="flex-1 space-y-4 overflow-y-auto px-1">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="booking-start-date">Start Date</Label>
                {editingBookingId ? (
                  <Input
                    id="booking-start-date"
                    type="date"
                    value={range?.start ?? ""}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (!v) return;
                      // Keep start <= end by bumping end forward when needed.
                      // Open-ended bookings (end = null) don't need bumping.
                      setRange((prev) => prev ? { start: v, end: prev.end !== null && v > prev.end ? v : prev.end } : prev);
                    }}
                  />
                ) : (
                  <Input disabled value={range ? formatLongDate(range.start) : ""} className="bg-muted" />
                )}
              </div>
              <div className="space-y-1">
                <Label htmlFor="booking-end-date">End Date</Label>
                {editingBookingId ? (
                  <div className="flex items-center gap-2">
                    <Input
                      id="booking-end-date"
                      type="date"
                      value={range?.end ?? ""}
                      min={range?.start}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (!v) {
                          // Only allow clearing end date for sick-type reasons
                          if (isSickType) {
                            setRange((prev) => prev ? { start: prev.start, end: null } : prev);
                          }
                          return;
                        }
                        setRange((prev) => prev ? { start: prev.start, end: v < prev.start ? prev.start : v } : prev);
                      }}
                    />
                    {isOpenEnded && (
                      <span className="shrink-0 rounded bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
                        Open
                      </span>
                    )}
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <Input disabled value={range?.end ? formatLongDate(range.end) : ""} className="bg-muted" />
                    {isSickType && (
                      <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-xs">
                        <Checkbox
                          checked={isOpenEnded}
                          onCheckedChange={(v) => {
                            if (v) {
                              setRange((prev) => prev ? { start: prev.start, end: null } : prev);
                            } else {
                              // Restore end = start when un-checking "Open"
                              setRange((prev) => prev ? { start: prev.start, end: prev.start } : prev);
                            }
                          }}
                        />
                        <span>Open</span>
                      </label>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Start</Label>
                <Select value={startHalf} onValueChange={(v) => setStartHalf(v as HalfOption)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="full">Full day</SelectItem>
                    <SelectItem value="am">AM only</SelectItem>
                    <SelectItem value="pm">PM only</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>End</Label>
                <Select
                  value={sameDay || isOpenEnded ? "full" : endHalf}
                  disabled={sameDay || isOpenEnded}
                  onValueChange={(v) => setEndHalf(v as HalfOption)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="full">Full day</SelectItem>
                    <SelectItem value="am">AM only</SelectItem>
                    <SelectItem value="pm">PM only</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1">
              <Label>Absence reason</Label>
              <Select value={reasonId} onValueChange={setReasonId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {groupedReasons.map(([typeName, typeReasons]) => (
                    <SelectGroup key={typeName}>
                      <SelectLabel>{typeName}</SelectLabel>
                      {typeReasons.map((r) => (
                        <SelectItem key={r.id} value={r.id}>
                          <span className="flex items-center gap-2">
                            <span
                              aria-hidden
                              className="inline-block h-3 w-3 rounded-sm"
                              style={{ backgroundColor: r.colour }}
                            />
                            {r.name}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="rounded-md border bg-muted/30 p-3 text-sm">
              <span className="text-muted-foreground">Working days to deduct: </span>
              <span className="font-semibold">
                {dayCount}
                {isOpenEnded && <span className="ml-1 font-normal text-muted-foreground">(and counting)</span>}
              </span>
            </div>

            {isSickType && (
              <SickDetailsPanel
                bookingId={editingBookingId}
                bookingEndDate={range?.end ?? null}
                callerMemberId={callerMemberId}
                orgAdmins={orgAdmins}
                hasSelfCertTemplate={hasSelfCertTemplate}
                onSickDetailsChange={handleSickDetailsChange}
                onLoaded={handleSickPanelLoaded}
              />
            )}

            <div className="space-y-1">
              <Label>Conversation</Label>
              <BookingConversation
                bookingId={editingBookingId}
                memberId={memberId}
                callerMemberId={callerMemberId}
                callerRole="admin"
                onFirstMessageReady={handleFirstMessageReady}
              />
            </div>
          </div>

          <SheetFooter className="flex-row justify-between gap-2">
            <div>
              {editingBookingId && (
                <Button
                  variant="destructive"
                  disabled={saving}
                  onClick={() => {
                    const matched = absenceReasons.find((r) => r.id === reasonId);
                    const bk: CalendarBooking = {
                      id: editingBookingId,
                      start_date: range?.start ?? "",
                      end_date: range?.end ?? null,
                      status: "approved",
                      reason_name: matched?.name ?? "this",
                      reason_colour: matched?.colour ?? "#888",
                      days_deducted: null,
                      requires_approval: false,
                      absence_type_id: null,
                    };
                    setDeletingBooking(bk);
                  }}
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Delete
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => closeSheet()} disabled={saving}>Cancel</Button>
              <Button
                onClick={handleBook}
                disabled={saving || !reasonId || (editingBookingId !== null && !isDirty)}
              >
                {saving
                  ? (editingBookingId ? "Saving..." : "Booking...")
                  : (editingBookingId ? "Save Changes" : "Book")}
              </Button>
            </div>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* Delete confirmation */}
      <AlertDialog
        open={deletingBooking !== null}
        onOpenChange={(o) => { if (!o && !deleting) setDeletingBooking(null); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Booking</AlertDialogTitle>
            <AlertDialogDescription>
              {deletingBooking && (
                <>
                  Are you sure you want to delete this {deletingBooking.reason_name} booking
                  ({deletingBooking.start_date}{deletingBooking.end_date ? ` to ${deletingBooking.end_date}` : " — Open"})?
                  This action cannot be undone.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleting}
              onClick={(e) => { e.preventDefault(); handleDeleteConfirmed(); }}
            >
              {deleting ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// CalendarLegend and CalendarFilterPanel were extracted to
// `@/components/calendar/calendar-legend` and
// `@/components/calendar/calendar-filter-panel` so the My Holiday page can
// reuse the same key + filter (CLE-176).
