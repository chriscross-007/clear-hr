"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter, usePathname } from "next/navigation";
import { X, ChevronLeft, ChevronRight, CalendarDays } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cancelBookingAsAdmin } from "../employees/actions";
import { cancelMyBooking } from "../approvals-actions";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { BookHolidaySheet } from "./book-holiday-sheet";
import { EditBookingSheet } from "./edit-booking-sheet";
import { HolidayCalendar, type CalendarBooking, type CalendarBankHoliday } from "@/components/holiday-calendar";
import type { WorkPatternHours, WorkPatternAssignment } from "@/lib/day-counting";
import { CalendarLegend } from "@/components/calendar/calendar-legend";
import { CalendarFilterPanel, type AbsenceTypeOption } from "@/components/calendar/calendar-filter-panel";
import { HolidayUnitsPill } from "@/components/holiday-units-pill";
import { PlannerDashboard, type HolidayStats, type SickPlotStats, type SickStats } from "../members/[memberId]/calendar/planner-dashboard";
import type { PeriodNavOption } from "../members/[memberId]/calendar/admin-calendar-client";
import type {
  HolidayBookingRow,
  BalanceSummary,
  AbsenceReasonOption,
} from "../holiday-booking-actions";
import { StickyPageHeader } from "@/components/ui/sticky-page-header";

interface MyHolidayClientProps {
  memberId: string;
  /** CLE-201c-9 — replaces the legacy `role` prop. When true, the
   *  caller can retroactively cancel their own approved bookings; when
   *  false they can only withdraw pending requests. */
  canOverrideOwnBookings: boolean;
  balance: BalanceSummary | null;
  nextBalance: BalanceSummary | null;
  bookings: HolidayBookingRow[];
  reasons: AbsenceReasonOption[];
  measurementMode: string;
  calendarYearStart: string | null;
  calendarMonthCount: number;
  calendarBookings: CalendarBooking[];
  calendarBankHolidays: CalendarBankHoliday[];
  bankHolidayColour?: string;
  // Planner-style Calendar tab (CLE-176)
  workPattern: WorkPatternHours | null;
  workPatternHistory: WorkPatternAssignment[];
  absenceTypes: AbsenceTypeOption[];
  periods: PeriodNavOption[];
  selectedPeriodId: string | null;
  currentPeriodId: string | null;
  holidayStats: HolidayStats | null;
  holidayUnits: "days" | "hours";
  holidayBaseColour: string;
  holidayPeriodStart: string | null;
  holidayPeriodEnd: string | null;
  sick: SickStats | null;
  sickPlot: SickPlotStats | null;
  bradfordFactor: number | undefined;
}

function fmtDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00Z");
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

function fmtDateRange(start: string, end: string | null, startHalf: string | null, endHalf: string | null): string {
  if (end === null) {
    let label = `${fmtDate(start)} – Open`;
    if (startHalf) label += ` (${startHalf.toUpperCase()})`;
    return label;
  }
  const sameDay = start === end;
  let label = sameDay ? fmtDate(start) : `${fmtDate(start)} – ${fmtDate(end)}`;
  if (startHalf) label += ` (${startHalf.toUpperCase()})`;
  if (!sameDay && endHalf) label += ` to (${endHalf.toUpperCase()})`;
  return label;
}

const STATUS_STYLE: Record<string, { label: string; variant: "default" | "secondary" | "outline" | "destructive"; className?: string }> = {
  pending: { label: "Pending", variant: "outline", className: "border-gray-400 text-gray-500 bg-gray-50 dark:bg-gray-900/30" },
  approved: { label: "Approved", variant: "default", className: "bg-green-600 text-white border-green-600" },
  rejected: { label: "Rejected", variant: "destructive" },
  cancelled: { label: "Cancelled", variant: "outline", className: "border-orange-400 text-orange-600 bg-orange-50 dark:bg-orange-900/30" },
};

const STATUS_CHECKBOX_CLASS: Record<string, string> = {
  pending: "data-[state=checked]:bg-gray-500 data-[state=checked]:border-gray-500",
  approved: "data-[state=checked]:bg-green-600 data-[state=checked]:border-green-600",
  rejected: "data-[state=checked]:bg-red-600 data-[state=checked]:border-red-600",
  cancelled: "data-[state=checked]:bg-orange-500 data-[state=checked]:border-orange-500",
};

export function MyHolidayClient({
  memberId,
  canOverrideOwnBookings,
  balance,
  nextBalance,
  bookings,
  reasons,
  measurementMode,
  calendarYearStart,
  calendarMonthCount,
  calendarBookings,
  calendarBankHolidays,
  bankHolidayColour,
  workPattern,
  workPatternHistory,
  absenceTypes,
  periods,
  selectedPeriodId,
  currentPeriodId,
  holidayStats,
  holidayUnits,
  holidayBaseColour,
  holidayPeriodStart,
  holidayPeriodEnd,
  sick,
  sickPlot,
  bradfordFactor,
}: MyHolidayClientProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [bookSheetOpen, setBookSheetOpen] = useState(false);
  const [bookSheetInitialStart, setBookSheetInitialStart] = useState<string | null>(null);
  const [bookSheetInitialEnd, setBookSheetInitialEnd] = useState<string | null>(null);
  const [bookSheetExisting, setBookSheetExisting] = useState<HolidayBookingRow | null>(null);
  const [editingBooking, setEditingBooking] = useState<HolidayBookingRow | null>(null);
  const [cancellingBooking, setCancellingBooking] = useState<HolidayBookingRow | null>(null);
  const [cancelBookingLoading, setCancelBookingLoading] = useState(false);
  const isAdmin = canOverrideOwnBookings;
  const unit = measurementMode === "hours" ? "hours" : "days";

  // -------------------------------------------------------------------------
  // Planner-style Calendar tab state (CLE-176)
  // -------------------------------------------------------------------------
  const [hiddenTypeIds, setHiddenTypeIds] = useState<Set<string>>(() => new Set());
  const [showSchedule, setShowSchedule] = useState<boolean>(true);
  const [showBankHolidays, setShowBankHolidays] = useState<boolean>(true);
  const visibleAbsenceTypeIds = new Set(
    absenceTypes.filter((t) => !hiddenTypeIds.has(t.id)).map((t) => t.id),
  );
  const toggleType = (id: string) => {
    setHiddenTypeIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const toggleAll = () => {
    setHiddenTypeIds((prev) => {
      if (prev.size === 0) return new Set(absenceTypes.map((t) => t.id));
      return new Set();
    });
  };

  const selectedIndex = periods.findIndex((p) => p.id === selectedPeriodId);
  const displayedPeriod = periods[selectedIndex] ?? periods[0];
  const prevPeriod = selectedIndex > 0 ? periods[selectedIndex - 1] : null;
  const nextPeriod = selectedIndex >= 0 && selectedIndex < periods.length - 1
    ? periods[selectedIndex + 1]
    : null;
  const viewingCurrentPeriod = currentPeriodId === selectedPeriodId;
  const navigateToPeriod = useCallback(
    (id: string) => {
      router.push(`${pathname}?periodId=${id}`);
    },
    [router, pathname],
  );

  // Annual-Leave reasons are tracked separately because the notice-period
  // stitching for consecutive bookings (passed to `existingHolidayBookings`
  // below) is an AL-only concern. The overlap detection itself surfaces
  // pending requests of any absence type.
  const holidayReasonIds = new Set(
    reasons.filter((r) => r.absence_type_name === "Annual Leave").map((r) => r.id),
  );

  function openBookSheetForRange(startDate: string, endDate: string) {
    // If the picked range overlaps an existing pending OR approved
    // booking, surface that booking in the sheet. Pending → editable
    // (Save Changes + Delete Request). Approved → read-only ("Booked
    // Absence" — must contact admin for changes). The sheet itself
    // branches on existingBooking.status to pick the right chrome.
    const overlapping = bookings.find((b) => {
      if (b.status !== "pending" && b.status !== "approved") return false;
      if (b.end_date === null) return b.start_date <= endDate;
      return b.start_date <= endDate && b.end_date >= startDate;
    });
    if (overlapping) {
      setBookSheetExisting(overlapping);
      setBookSheetInitialStart(null);
      setBookSheetInitialEnd(null);
    } else {
      setBookSheetExisting(null);
      setBookSheetInitialStart(startDate);
      setBookSheetInitialEnd(endDate);
    }
    setBookSheetOpen(true);
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

  async function handleCancelBooking() {
    if (!cancellingBooking) return;
    const bookingId = cancellingBooking.id;
    setCancelBookingLoading(true);
    const result = isAdmin
      ? await cancelBookingAsAdmin(bookingId)
      : await cancelMyBooking(bookingId);
    setCancelBookingLoading(false);
    setCancellingBooking(null);
    if (result.success) {
      router.refresh();
    }
  }

  // Status filter for bookings table
  const storageKey = `holiday-status-filter-${memberId}`;
  const [statusFilters, setStatusFilters] = useState<Record<string, boolean>>({ pending: true, approved: true, rejected: true, cancelled: true });

  useEffect(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored) setStatusFilters(JSON.parse(stored));
    } catch { /* ignore */ }
  }, [storageKey]);

  function toggleFilter(status: string) {
    setStatusFilters((prev) => {
      const next = { ...prev, [status]: !prev[status] };
      try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }

  const today = new Date().toISOString().slice(0, 10);
  const yearStart = balance?.yearStart ?? today;
  const filteredBookings = bookings.filter((b) =>
    (b.start_date >= yearStart || b.end_date === null || (b.end_date ?? "") >= today) && statusFilters[b.status]
  );

  return (
    <>
      <Tabs defaultValue="calendar" className="w-full mb-6">
        <StickyPageHeader>
          <div className="flex items-center justify-between gap-4 mb-3">
            <h1 className="text-2xl font-bold">My Absences</h1>
          </div>
          <TabsList>
            <TabsTrigger value="calendar">Calendar</TabsTrigger>
            <TabsTrigger value="overview">Holiday</TabsTrigger>
          </TabsList>
        </StickyPageHeader>

        <TabsContent value="overview" className="mt-4">
      {/* Balance summary — current period */}
      {balance && (
        <div className="mb-6">
          <h2 className="text-sm font-medium text-muted-foreground mb-2">
            {fmtDate(balance.yearStart)} – {fmtDate(balance.yearEnd)}
          </h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <BalanceCard label="Entitlement" value={balance.entitlement - balance.carriedOver} unit={unit} carriedOver={balance.carriedOver} />
            <BalanceCard label="Taken" value={balance.taken} unit={unit} />
            <BalanceCard label="Booked" value={balance.booked} unit={unit} />
            <BalanceCard label="Pending" value={balance.pending} unit={unit} />
            <BalanceCard label="Remaining" value={balance.remaining} unit={unit} highlight negative={balance.remaining < 0} />
            <BalanceCard label="Carry Over" value={balance.carryOverProjected} unit={unit} muted />
          </div>
        </div>
      )}

      {/* Balance summary — next period */}
      {nextBalance && (
        <div className="mb-6">
          <h2 className="text-sm font-medium text-muted-foreground mb-2">
            {fmtDate(nextBalance.yearStart)} – {fmtDate(nextBalance.yearEnd)}
          </h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <BalanceCard label="Entitlement" value={nextBalance.entitlement - nextBalance.carriedOver} unit={unit} carriedOver={nextBalance.carriedOver} />
            <BalanceCard label="Taken" value={nextBalance.taken} unit={unit} />
            <BalanceCard label="Booked" value={nextBalance.booked} unit={unit} />
            <BalanceCard label="Pending" value={nextBalance.pending} unit={unit} />
            <BalanceCard label="Remaining" value={nextBalance.remaining} unit={unit} highlight negative={nextBalance.remaining < 0} />
            <BalanceCard label="Carry Over" value={nextBalance.carryOverProjected} unit={unit} muted />
          </div>
        </div>
      )}

      {!balance && (
        <div className="mb-6 rounded-md border p-4 text-sm text-muted-foreground">
          No active holiday year record found.
        </div>
      )}

      {/* Holiday Bookings — future only with status filters */}
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Holiday Bookings</h2>
        <div className="flex items-center gap-4">
          {(["pending", "approved", "rejected", "cancelled"] as const).map((s) => {
            const count = bookings.filter((b) => (b.start_date >= yearStart || b.end_date === null || (b.end_date ?? "") >= today) && b.status === s).length;
            return (
              <label key={s} className="flex items-center gap-1.5 cursor-pointer">
                <Checkbox
                  checked={statusFilters[s] ?? true}
                  onCheckedChange={() => toggleFilter(s)}
                  className={STATUS_CHECKBOX_CLASS[s]}
                />
                <span className="text-sm capitalize">{s} ({count})</span>
              </label>
            );
          })}
        </div>
      </div>
      <div className="flex justify-center w-full">
        <div className="w-auto max-w-[90%] min-w-0">
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Dates</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>{measurementMode === "hours" ? "Hours" : "Days"}</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Notes</TableHead>
                  <TableHead className="w-24">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredBookings.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                      No upcoming bookings.
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredBookings.map((b) => {
                    const val = measurementMode === "hours" ? b.hours_deducted : b.days_deducted;
                    const badge = STATUS_STYLE[b.status] ?? STATUS_STYLE.pending;
                    const isEditable = b.status === "pending" || b.status === "cancelled";
                    return (
                      <TableRow
                        key={b.id}
                        className={isEditable ? "cursor-pointer hover:bg-muted/50" : ""}
                        onClick={isEditable ? () => setEditingBooking(b) : undefined}
                      >
                        <TableCell className="font-medium">
                          {fmtDateRange(b.start_date, b.end_date, b.start_half, b.end_half)}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <span className="inline-block h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: b.reason_colour }} />
                            {b.reason_name}
                          </div>
                        </TableCell>
                        <TableCell>{val ?? "—"} {val !== null ? unit : ""}</TableCell>
                        <TableCell><Badge variant={badge.variant} className={badge.className}>{badge.label}</Badge></TableCell>
                        <TableCell className="max-w-60 text-muted-foreground">
                          <div className="space-y-0.5">
                            {b.employee_note && <p className="truncate italic">You: {b.employee_note}</p>}
                            {b.approver_note && <p className="truncate">{b.approver_name ?? "Approver"}: {b.approver_note}</p>}
                            {!b.employee_note && !b.approver_note && "—"}
                          </div>
                        </TableCell>
                        <TableCell>
                          {isAdmin && (b.status === "pending" || b.status === "approved") && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-red-600 border-red-200 hover:bg-red-50 dark:hover:bg-red-950/30"
                              onClick={(e) => { e.stopPropagation(); setCancellingBooking(b); }}
                            >
                              <X className="h-3.5 w-3.5 mr-1" />
                              Cancel
                            </Button>
                          )}
                          {!isAdmin && b.status === "pending" && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={(e) => { e.stopPropagation(); setCancellingBooking(b); }}
                            >
                              <X className="h-3.5 w-3.5 mr-1" />
                              Cancel
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      </div>
        </TabsContent>

        <TabsContent value="calendar" className="mt-4">
          {calendarYearStart && holidayStats && holidayPeriodStart && holidayPeriodEnd ? (
            <>
              {/* Dashboard widgets — same as the admin planner */}
              <PlannerDashboard
                holidayStats={holidayStats}
                holidayBaseColour={holidayBaseColour}
                holidayPeriodStart={holidayPeriodStart}
                holidayPeriodEnd={holidayPeriodEnd}
                holidayUnits={holidayUnits}
                sick={sick ?? undefined}
                sickPlot={sickPlot ?? undefined}
                bradfordFactor={bradfordFactor}
              />

              <div className="flex w-full items-start gap-3">
                <CalendarLegend bookings={calendarBookings} />
                <div className="min-w-0 flex-1">
                  {/* Period nav header */}
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
                    yearStart={calendarYearStart}
                    monthCount={calendarMonthCount}
                    bookings={calendarBookings}
                    bankHolidays={calendarBankHolidays}
                    bankHolidayColour={bankHolidayColour}
                    onRangeSelected={openBookSheetForRange}
                    hideLegend
                    visibleAbsenceTypeIds={visibleAbsenceTypeIds}
                    workPattern={workPattern}
                    workPatternHistory={workPatternHistory}
                    showSchedule={showSchedule}
                    showBankHolidays={showBankHolidays}
                  />

                  <p className="mt-3 text-xs text-muted-foreground">
                    Tip: click and drag across dates to request a holiday.
                  </p>
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
                  bankHolidayColour={bankHolidayColour ?? "#EF4444"}
                />
              </div>
            </>
          ) : (
            <p className="text-muted-foreground">No active Holiday Period found.</p>
          )}
        </TabsContent>
      </Tabs>

      {/* Edit Booking Sheet (pending only) */}
      <EditBookingSheet
        booking={editingBooking}
        open={!!editingBooking}
        onOpenChange={(open) => { if (!open) setEditingBooking(null); }}
        reasons={reasons}
        balance={balance}
        measurementMode={measurementMode}
        onSuccess={() => {
          setEditingBooking(null);
          router.refresh();
        }}
      />

      {/* Book Holiday Sheet */}
      <BookHolidaySheet
        open={bookSheetOpen}
        memberId={memberId}
        onOpenChange={(open) => {
          setBookSheetOpen(open);
          if (!open) {
            setBookSheetInitialStart(null);
            setBookSheetInitialEnd(null);
            setBookSheetExisting(null);
          }
        }}
        reasons={reasons}
        balance={balance}
        measurementMode={measurementMode}
        initialStartDate={bookSheetInitialStart}
        initialEndDate={bookSheetInitialEnd}
        existingBooking={bookSheetExisting}
        existingHolidayBookings={bookings
          .filter((b) =>
            (b.status === "pending" || b.status === "approved")
            && holidayReasonIds.has(b.leave_reason_id),
          )
          .map((b) => ({
            id: b.id,
            start_date: b.start_date,
            end_date: b.end_date,
            days_deducted: b.days_deducted,
            status: b.status,
          }))}
        onSuccess={() => {
          setBookSheetOpen(false);
          setBookSheetInitialStart(null);
          setBookSheetInitialEnd(null);
          setBookSheetExisting(null);
          router.refresh();
        }}
      />

      {/* Admin cancel booking dialog */}
      <AlertDialog open={!!cancellingBooking} onOpenChange={(open) => { if (!open) setCancellingBooking(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel Holiday Request</AlertDialogTitle>
            <AlertDialogDescription>
              {cancellingBooking && (
                <>
                  Are you sure you want to cancel this {cancellingBooking.status} booking for{" "}
                  <strong>{fmtDate(cancellingBooking.start_date)}</strong>
                  {cancellingBooking.end_date === null
                    ? <> – <strong>Open</strong></>
                    : cancellingBooking.start_date !== cancellingBooking.end_date && <> – <strong>{fmtDate(cancellingBooking.end_date)}</strong></>}
                  {" "}({cancellingBooking.reason_name})? The days will be returned to your balance.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={cancelBookingLoading}>Keep Booking</AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={cancelBookingLoading}
              onClick={handleCancelBooking}
            >
              {cancelBookingLoading ? "Cancelling..." : "Cancel Booking"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function BalanceCard({ label, value, unit, highlight, negative, muted, carriedOver }: { label: string; value: number; unit: string; highlight?: boolean; negative?: boolean; muted?: boolean; carriedOver?: number }) {
  return (
    <div className={`rounded-lg border p-4 ${highlight ? (negative ? "bg-destructive/5 border-destructive/20" : "bg-primary/5 border-primary/20") : ""}`}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`text-2xl font-bold tabular-nums ${negative ? "text-destructive" : highlight ? "text-primary" : muted ? "text-muted-foreground" : ""}`}>
        {value} <span className="text-sm font-normal text-muted-foreground">{unit}</span>
        {carriedOver != null && carriedOver > 0 && (
          <span className="text-sm font-normal text-muted-foreground">
            {" "}+ {carriedOver}{" "}
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="underline decoration-dotted cursor-help">{unit} BF</span>
                </TooltipTrigger>
                <TooltipContent>Brought Forward from previous period</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </span>
        )}
      </p>
    </div>
  );
}
