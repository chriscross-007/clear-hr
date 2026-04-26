"use client";

import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { HolidayCalendar, type CalendarBooking, type CalendarBankHoliday } from "@/components/holiday-calendar";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { Pencil, Trash2 } from "lucide-react";
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
import { saveSickDetails, type SickDetailsInput } from "../../../sick-booking-actions";
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
  type WorkPatternHours,
} from "@/lib/day-counting";

export type AbsenceReasonOption = {
  id: string;
  name: string;
  colour: string;
  absence_type_id: string;
  absence_type_name: string;
};

export type AbsenceTypeOption = {
  id: string;
  name: string;
  colour: string;
};

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
  bookings: CalendarBooking[];
  bankHolidays: CalendarBankHoliday[];
  bankHolidayColour: string;
  absenceReasons: AbsenceReasonOption[];
  absenceTypes: AbsenceTypeOption[];
  workPattern: WorkPatternHours | null;
  bankHolidayHandling: string;
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
  bookings,
  bankHolidays,
  bankHolidayColour,
  absenceReasons,
  absenceTypes,
  workPattern,
  bankHolidayHandling,
}: AdminCalendarClientProps) {
  const router = useRouter();

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

  const [range, setRange] = useState<{ start: string; end: string } | null>(null);
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
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // Edit/delete state for existing bookings on the calendar
  const [editingBookingId, setEditingBookingId] = useState<string | null>(null);
  const [actionMenu, setActionMenu] = useState<{ booking: CalendarBooking; x: number; y: number } | null>(null);
  const [deletingBooking, setDeletingBooking] = useState<CalendarBooking | null>(null);
  const [deleting, setDeleting] = useState(false);
  // Snapshot of the booking as it was when the edit sheet opened — used to
  // drive the "is the form dirty?" check that gates Save Changes.
  const [originalEdit, setOriginalEdit] = useState<{
    start: string;
    end: string;
    startHalf: HalfOption;
    endHalf: HalfOption;
    reasonId: string;
  } | null>(null);

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
    setError(null);
  }

  function closeSheet() {
    setRange(null);
    setEditingBookingId(null);
    setOriginalEdit(null);
    setFirstMessage("");
    setFirstMessageFiles([]);
    setSickDetails(null);
    setError(null);
    setSaving(false);
  }

  // Stable so the conversation composer doesn't see a new identity on every
  // parent render — the previous inline handler caused its useEffect to
  // re-fire continually and the draft message could be lost on submit.
  const handleFirstMessageReady = useCallback((msg: string, files: File[]) => {
    setFirstMessage(msg);
    setFirstMessageFiles(files);
  }, []);

  const handleSickDetailsChange = useCallback((next: Omit<SickDetailsInput, "bookingId">) => {
    setSickDetails(next);
  }, []);

  // Open the context menu anchored to the clicked booking cell
  function handleBookingClick(booking: CalendarBooking, event: React.MouseEvent) {
    setActionMenu({ booking, x: event.clientX, y: event.clientY });
  }

  // Load the full booking record and open the Sheet in edit mode
  async function openEditFor(booking: CalendarBooking) {
    setActionMenu(null);
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
    router.refresh();
  }

  const sameDay = range ? range.start === range.end : false;

  // Edit-only: has the admin actually changed anything vs what they opened?
  const isDirty =
    editingBookingId !== null && originalEdit !== null && range !== null
      ? range.start !== originalEdit.start
        || range.end !== originalEdit.end
        || startHalf !== originalEdit.startHalf
        || endHalf !== originalEdit.endHalf
        || reasonId !== originalEdit.reasonId
      : false;

  const dayCount = useMemo(() => {
    if (!range) return 0;
    const sh = startHalf !== "full";
    const eh = sameDay ? false : endHalf !== "full";
    return countWorkingDaysSimple(
      range.start,
      range.end,
      sh,
      eh,
      workPattern,
      bankHolidaySet,
      bankHolidayHandling,
    );
  }, [range, sameDay, startHalf, endHalf, workPattern, bankHolidaySet, bankHolidayHandling]);

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
          endHalf: eh,
          note: null,
        })
      : await adminBookAbsence({
          memberId,
          leaveReasonId: reasonId,
          startDate: range.start,
          endDate: range.end,
          startHalf: sh,
          endHalf: eh,
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
    // and the panel surfaced a draft. Failure is surfaced but doesn't undo
    // the booking save.
    if (isSickType && persistedBookingId && sickDetailsRef.current) {
      try {
        const sd = sickDetailsRef.current;
        const sdRes = await saveSickDetails({ bookingId: persistedBookingId, ...sd });
        if (!sdRes.success) {
          setError(`Booking saved, but sick details could not be saved: ${sdRes.error ?? "unknown error"}`);
        }
      } catch (e) {
        setError(`Booking saved, but sick details could not be saved: ${e instanceof Error ? e.message : "unknown error"}`);
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
          // Booking is already saved at this point — surface the message
          // failure rather than silently dropping it.
          setError("Booking saved, but the message could not be sent. You can add it from the Edit view.");
        }
      }
    }

    setSaving(false);
    setToast(editingBookingId ? "Booking updated" : `Absence booked for ${memberName}`);
    setTimeout(() => setToast(null), 3000);
    closeSheet();
    router.refresh();
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
          <HolidayCalendar
            yearStart={yearStart}
            bookings={bookings}
            bankHolidays={bankHolidays}
            bankHolidayColour={bankHolidayColour}
            onRangeSelected={openForRange}
            onBookingClick={handleBookingClick}
            hideLegend
            visibleAbsenceTypeIds={visibleAbsenceTypeIds}
            workPattern={workPattern}
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
            <SheetTitle>
              {editingBookingId ? "Edit Booking" : `Book absence for ${memberName}`}
            </SheetTitle>
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
                      setRange((prev) => prev ? { start: v, end: v > prev.end ? v : prev.end } : prev);
                    }}
                  />
                ) : (
                  <Input disabled value={range ? formatLongDate(range.start) : ""} className="bg-muted" />
                )}
              </div>
              <div className="space-y-1">
                <Label htmlFor="booking-end-date">End Date</Label>
                {editingBookingId ? (
                  <Input
                    id="booking-end-date"
                    type="date"
                    value={range?.end ?? ""}
                    min={range?.start}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (!v) return;
                      setRange((prev) => prev ? { start: prev.start, end: v < prev.start ? prev.start : v } : prev);
                    }}
                  />
                ) : (
                  <Input disabled value={range ? formatLongDate(range.end) : ""} className="bg-muted" />
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
                  value={sameDay ? "full" : endHalf}
                  disabled={sameDay}
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
              <span className="font-semibold">{dayCount}</span>
            </div>

            {isSickType && (
              <SickDetailsPanel
                bookingId={editingBookingId}
                callerMemberId={callerMemberId}
                orgAdmins={orgAdmins}
                hasSelfCertTemplate={hasSelfCertTemplate}
                onSickDetailsChange={handleSickDetailsChange}
              />
            )}

            <div className="space-y-1">
              <Label>Conversation</Label>
              <BookingConversation
                bookingId={editingBookingId}
                memberId={memberId}
                callerMemberId={callerMemberId}
                onFirstMessageReady={handleFirstMessageReady}
              />
            </div>
          </div>

          <SheetFooter className="flex-row justify-end gap-2">
            <Button variant="outline" onClick={closeSheet} disabled={saving}>Cancel</Button>
            <Button
              onClick={handleBook}
              disabled={saving || !reasonId || (editingBookingId !== null && !isDirty)}
            >
              {saving
                ? (editingBookingId ? "Saving..." : "Booking...")
                : (editingBookingId ? "Save Changes" : "Book")}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* Context menu for an existing booking — anchored to the click point
          via a zero-size hidden trigger. */}
      <DropdownMenu
        open={actionMenu !== null}
        onOpenChange={(o) => { if (!o) setActionMenu(null); }}
      >
        <DropdownMenuTrigger asChild>
          <span
            aria-hidden
            className="pointer-events-none fixed"
            style={{ left: actionMenu?.x ?? 0, top: actionMenu?.y ?? 0, width: 0, height: 0 }}
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem
            onSelect={() => { if (actionMenu) openEditFor(actionMenu.booking); }}
          >
            <Pencil className="mr-2 h-4 w-4" />
            Edit
          </DropdownMenuItem>
          <DropdownMenuItem
            className="text-destructive focus:text-destructive"
            onSelect={() => {
              if (!actionMenu) return;
              setDeletingBooking(actionMenu.booking);
              setActionMenu(null);
            }}
          >
            <Trash2 className="mr-2 h-4 w-4" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

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
                  ({deletingBooking.start_date} to {deletingBooking.end_date})?
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

// ---------------------------------------------------------------------------
// External legend — vertical 2-column list of active absence reasons, to the
// left of the calendar grid. Caps at 12 visible entries and shows "+N more"
// for any overflow.
// ---------------------------------------------------------------------------

const MAX_LEGEND_ITEMS = 12;

function CalendarLegend({
  bookings,
}: {
  bookings: CalendarBooking[];
}) {
  // Always shows every reason that exists in the bookings, regardless of the
  // filter panel state — this is a colour key, not a filtered list, and a
  // stable width prevents the calendar shifting when filters toggle.
  const items = useMemo(() => {
    const seen = new Map<string, { name: string; colour: string }>();
    for (const b of bookings) {
      if (b.status === "cancelled" || b.status === "rejected") continue;
      if (!seen.has(b.reason_name)) {
        seen.set(b.reason_name, { name: b.reason_name, colour: b.reason_colour });
      }
    }
    return Array.from(seen.values());
  }, [bookings]);

  if (items.length === 0) return null;

  const visible = items.slice(0, MAX_LEGEND_ITEMS);
  const overflow = items.length - visible.length;

  return (
    <div className="w-32 shrink-0">
      <div
        className="grid gap-x-2 gap-y-1"
        style={{ gridTemplateColumns: visible.length > 6 ? "repeat(2, minmax(0, 1fr))" : "repeat(1, minmax(0, 1fr))", gridAutoFlow: "column", gridTemplateRows: `repeat(${Math.min(6, visible.length)}, minmax(0, auto))` }}
      >
        {visible.map((l) => (
          <div key={l.name} className="flex items-center gap-1.5 text-xs">
            <span className="inline-block h-3 w-3 shrink-0 rounded-sm" style={{ backgroundColor: l.colour }} />
            <span className="truncate">{l.name}</span>
          </div>
        ))}
      </div>
      {overflow > 0 && (
        <p className="mt-2 text-xs text-muted-foreground">+{overflow} more</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Filter panel — absence-type checkboxes + Schedule overlay toggle, sits to
// the right of the calendar.
// ---------------------------------------------------------------------------

function CalendarFilterPanel({
  absenceTypes,
  hiddenTypeIds,
  onToggleType,
  onToggleAll,
  showSchedule,
  onToggleSchedule,
  showBankHolidays,
  onToggleBankHolidays,
  bankHolidayColour,
}: {
  absenceTypes: AbsenceTypeOption[];
  hiddenTypeIds: Set<string>;
  onToggleType: (id: string) => void;
  onToggleAll: () => void;
  showSchedule: boolean;
  onToggleSchedule: () => void;
  showBankHolidays: boolean;
  onToggleBankHolidays: () => void;
  bankHolidayColour: string;
}) {
  // Derived "All" state: true when nothing is hidden, false when everything is
  // hidden, and "indeterminate" when only some are hidden.
  const totalTypes = absenceTypes.length;
  const hiddenCount = hiddenTypeIds.size;
  const allChecked: boolean | "indeterminate" =
    totalTypes === 0
      ? false
      : hiddenCount === 0
      ? true
      : hiddenCount === totalTypes
      ? false
      : "indeterminate";

  return (
    <div className="w-40 shrink-0">
      <p className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Filters
      </p>

      {totalTypes > 0 && (
        <label className="mb-1.5 flex cursor-pointer items-center gap-2 px-1 text-sm font-medium">
          <Checkbox checked={allChecked} onCheckedChange={onToggleAll} />
          <span>All</span>
        </label>
      )}

      <div className="flex flex-col gap-1.5 px-1">
        {absenceTypes.map((t) => {
          const checked = !hiddenTypeIds.has(t.id);
          return (
            <label
              key={t.id}
              className="flex cursor-pointer items-center gap-2 text-sm"
            >
              <Checkbox checked={checked} onCheckedChange={() => onToggleType(t.id)} />
              <span
                aria-hidden
                className="inline-block h-3 w-3 shrink-0 rounded-sm border border-border"
                style={{ backgroundColor: t.colour }}
              />
              <span className="truncate">{t.name}</span>
            </label>
          );
        })}
      </div>

      <div className="mt-3 flex flex-col gap-1.5 border-t border-gray-200 pt-3">
        <label className="flex cursor-pointer items-center gap-2 px-1 text-sm">
          <Checkbox checked={showSchedule} onCheckedChange={onToggleSchedule} />
          <span
            aria-hidden
            className="inline-block h-3 w-3 shrink-0 rounded-sm border border-border"
            style={{ backgroundColor: "#e0f2fe" }}
          />
          <span>Schedule</span>
        </label>
        <label className="flex cursor-pointer items-center gap-2 px-1 text-sm">
          <Checkbox checked={showBankHolidays} onCheckedChange={onToggleBankHolidays} />
          <span
            aria-hidden
            className="inline-block h-3 w-3 shrink-0 rounded-sm border border-border"
            style={{ backgroundColor: bankHolidayColour }}
          />
          <span>Bank Holidays</span>
        </label>
      </div>
    </div>
  );
}
