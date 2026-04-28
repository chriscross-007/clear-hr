"use client";

import { useMemo, useState, useCallback } from "react";
import { cn } from "@/lib/utils";
import type { WorkPatternHours } from "@/lib/day-counting";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CalendarBooking = {
  id: string;
  start_date: string;
  /** null = open-ended sick booking (employee still off). */
  end_date: string | null;
  status: string;
  reason_name: string;
  reason_colour: string;
  days_deducted: number | null;
  /** True if this booking's absence type requires manager approval. */
  requires_approval: boolean;
  /** Parent absence_type id (used by the filter panel to hide whole categories). */
  absence_type_id: string | null;
  /** Sick booking completion status — null for non-sick bookings. */
  completion_status?: string | null;
};

export type CalendarBankHoliday = {
  date: string;
  name: string;
};

interface HolidayCalendarProps {
  yearStart: string;
  bookings: CalendarBooking[];
  bankHolidays: CalendarBankHoliday[];
  bankHolidayColour?: string;
  /**
   * When set, enables click+drag-to-select on date cells. Called with
   * the (inclusive) selected range on mouse up. Ranges are returned
   * ordered so start <= end, regardless of drag direction.
   */
  onRangeSelected?: (startDate: string, endDate: string) => void;
  /** Suppress the built-in top legend (for consumers rendering their own). */
  hideLegend?: boolean;
  /**
   * Set of absence_type ids whose bookings should be visible. When undefined,
   * all bookings are shown (existing behaviour).
   */
  visibleAbsenceTypeIds?: Set<string> | null;
  /** Employee work pattern, used by the schedule overlay. */
  workPattern?: WorkPatternHours | null;
  /** Render a subtle background tint on the employee's working days. */
  showSchedule?: boolean;
  /**
   * Show bank holiday cells (background colour + tooltip). Defaults to true
   * for backwards compatibility with consumers that don't pass this prop.
   */
  showBankHolidays?: boolean;
  /**
   * Fired when a booking-bearing cell is pressed. Supplies the first booking
   * on that day plus the raw event (for positioning a contextual menu).
   * When provided, pressing a booking cell also suppresses drag-to-select.
   */
  onBookingClick?: (booking: CalendarBooking, event: React.MouseEvent) => void;
}

function textColorForBg(hex: string): string {
  const h = hex.replace("#", "");
  if (h.length !== 6) return "#ffffff";
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? "#000000" : "#ffffff";
}

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

const DOW_LABELS = ["M", "T", "W", "T", "F", "S", "S"];

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Day of week: 0=Mon..6=Sun */
function dow(d: Date): number {
  const js = d.getUTCDay();
  return js === 0 ? 6 : js - 1;
}

function dowOfDate(year: number, month: number, day: number): number {
  return dow(new Date(Date.UTC(year, month, day)));
}

function fmtMonthYear(d: Date): string {
  return d.toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" });
}

// ---------------------------------------------------------------------------
// Grid computation
// ---------------------------------------------------------------------------

interface MonthRow {
  monthStart: Date;
  label: string;
  year: number;
  month: number;
  daysInMonth: number;
  /** 0-based column index where day 1 sits (= dow of the 1st) */
  firstDayCol: number;
}

function buildGrid(yearStart: string) {
  const start = new Date(yearStart + "T00:00:00Z");
  const firstMonth = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));

  const months: MonthRow[] = [];
  for (let i = 0; i < 13; i++) {
    const ms = new Date(Date.UTC(firstMonth.getUTCFullYear(), firstMonth.getUTCMonth() + i, 1));
    const y = ms.getUTCFullYear();
    const m = ms.getUTCMonth();
    const dim = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    const fdc = dowOfDate(y, m, 1);
    months.push({ monthStart: ms, label: fmtMonthYear(ms), year: y, month: m, daysInMonth: dim, firstDayCol: fdc });
  }

  // Fixed 37 columns: worst case is a 31-day month starting Sunday (col 6 + 31 = 37)
  const totalCols = 37;

  return { months, totalCols };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const SCHEDULE_BG = "#e0f2fe"; // sky-100 — subtle "scheduled to work" tint
const DAY_KEY_BY_INDEX: (keyof WorkPatternHours)[] = [
  "hours_monday",
  "hours_tuesday",
  "hours_wednesday",
  "hours_thursday",
  "hours_friday",
  "hours_saturday",
  "hours_sunday",
];

export function HolidayCalendar({
  yearStart,
  bookings,
  bankHolidays,
  bankHolidayColour = "#EF4444",
  onRangeSelected,
  hideLegend,
  visibleAbsenceTypeIds,
  workPattern,
  showSchedule,
  showBankHolidays = true,
  onBookingClick,
}: HolidayCalendarProps) {
  const { months, totalCols } = useMemo(() => buildGrid(yearStart), [yearStart]);

  // Apply the absence-type filter once, then everything downstream uses the
  // filtered list so the legend, tooltips, and grid all stay consistent.
  const filteredBookings = useMemo(() => {
    if (!visibleAbsenceTypeIds) return bookings;
    return bookings.filter((b) => b.absence_type_id !== null && visibleAbsenceTypeIds.has(b.absence_type_id));
  }, [bookings, visibleAbsenceTypeIds]);

  const selectable = !!onRangeSelected;
  const [dragStart, setDragStart] = useState<string | null>(null);
  const [dragHover, setDragHover] = useState<string | null>(null);

  const dragging = dragStart !== null && dragHover !== null;
  const rangeLow = dragging ? (dragStart! <= dragHover! ? dragStart! : dragHover!) : null;
  const rangeHigh = dragging ? (dragStart! <= dragHover! ? dragHover! : dragStart!) : null;

  const handleCellMouseDown = useCallback((date: string) => {
    if (!selectable) return;
    setDragStart(date);
    setDragHover(date);
  }, [selectable]);

  const handleCellMouseEnter = useCallback((date: string) => {
    if (!selectable) return;
    setDragHover((prev) => (prev !== null ? date : prev));
  }, [selectable]);

  const handleCellMouseUp = useCallback((date: string) => {
    if (!selectable || !onRangeSelected || dragStart === null) return;
    const start = dragStart <= date ? dragStart : date;
    const end = dragStart <= date ? date : dragStart;
    setDragStart(null);
    setDragHover(null);
    onRangeSelected(start, end);
  }, [selectable, onRangeSelected, dragStart]);

  const cancelDrag = useCallback(() => {
    setDragStart(null);
    setDragHover(null);
  }, []);

  // For open-ended bookings (end_date = null) we project forward to today so
  // the calendar shows the ongoing absence. Days past the start_date are
  // rendered at reduced opacity via a synthetic "projected" booking wrapper.
  const todayStr = new Date().toISOString().slice(0, 10);

  const bookingMap = useMemo(() => {
    const map = new Map<string, CalendarBooking[]>();
    for (const b of filteredBookings) {
      if (b.status === "cancelled" || b.status === "rejected") continue;
      const s = new Date(b.start_date + "T00:00:00Z");
      // Open-ended: extend to today; closed: use actual end_date
      const effectiveEnd = b.end_date
        ? new Date(b.end_date + "T00:00:00Z")
        : new Date(todayStr + "T00:00:00Z");
      const d = new Date(s);
      while (d <= effectiveEnd) {
        const key = isoDate(d);
        const arr = map.get(key) ?? [];
        arr.push(b);
        map.set(key, arr);
        d.setUTCDate(d.getUTCDate() + 1);
      }
    }
    return map;
  }, [filteredBookings, todayStr]);

  const bhMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const bh of bankHolidays) map.set(bh.date, bh.name);
    return map;
  }, [bankHolidays]);

  const legend = useMemo(() => {
    const seen = new Map<string, { name: string; colour: string }>();
    for (const b of filteredBookings) {
      if (b.status === "cancelled" || b.status === "rejected") continue;
      if (!seen.has(b.reason_name)) {
        seen.set(b.reason_name, { name: b.reason_name, colour: b.reason_colour });
      }
    }
    return Array.from(seen.values());
  }, [filteredBookings]);

  const today = new Date().toISOString().slice(0, 10);

  return (
    <div>
      {/* Legend */}
      {!hideLegend && legend.length > 0 && (
        <div className="flex flex-wrap gap-3 mb-4">
          {legend.map((l) => (
            <div key={l.name} className="flex items-center gap-1.5 text-xs">
              <span className="inline-block h-3 w-3 rounded-sm shrink-0" style={{ backgroundColor: l.colour }} />
              {l.name}
            </div>
          ))}
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="inline-block h-3 w-3 rounded-sm shrink-0 bg-muted border border-border opacity-50" />
            Pending
          </div>
        </div>
      )}

      {/* Calendar grid */}
      <div className="flex justify-center">
      <div
        className="overflow-x-auto border rounded-md w-fit"
        onMouseLeave={selectable ? cancelDrag : undefined}
        style={selectable && dragging ? { userSelect: "none" } : undefined}
      >
        <table className="border-collapse text-xs tabular-nums">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 bg-background text-left px-2 py-1.5 font-medium text-muted-foreground min-w-20 border-r border-b" />
              {Array.from({ length: totalCols }, (_, col) => {
                const isWeekend = col % 7 >= 5;
                return (
                  <th
                    key={col}
                    className={cn(
                      "px-0 py-1.5 text-center text-muted-foreground w-7 border-b text-[10px]",
                      isWeekend ? "bg-muted/40 font-normal" : "font-bold"
                    )}
                  >
                    {DOW_LABELS[col % 7]}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {months.map((m) => (
              <tr key={`${m.year}-${m.month}`} className="border-b last:border-b-0">
                <td className="sticky left-0 z-10 bg-background px-2 py-0.5 text-left font-bold text-muted-foreground whitespace-nowrap border-r">
                  {m.label}
                </td>
                {Array.from({ length: totalCols }, (_, col) => {
                  const isWeekend = col % 7 >= 5;
                  const dayNum = col - m.firstDayCol + 1;
                  const isValidDay = dayNum >= 1 && dayNum <= m.daysInMonth;

                  if (!isValidDay) {
                    return (
                      <td key={col} className={cn("px-0 py-0.5 text-center h-7", isWeekend && "bg-muted/40")} />
                    );
                  }

                  const dateStr = `${m.year}-${String(m.month + 1).padStart(2, "0")}-${String(dayNum).padStart(2, "0")}`;
                  const isToday = dateStr === today;
                  const dayBookings = bookingMap.get(dateStr) ?? [];
                  // When the Bank Holidays filter is off, pretend the day has no BH —
                  // this skips the background fill and the tooltip entry below.
                  const bh = showBankHolidays ? bhMap.get(dateStr) : undefined;
                  const topBooking = dayBookings[0];

                  // Schedule overlay: subtle tint on the employee's working days
                  // (col % 7 == 0..6 = Mon..Sun in this grid) — only when there's
                  // no booking or bank holiday taking precedence on that cell.
                  const patternHours = workPattern
                    ? Number(workPattern[DAY_KEY_BY_INDEX[col % 7]])
                    : 0;
                  const isScheduledWorkDay = !!showSchedule && !!workPattern && patternHours > 0;

                  // Is this day a projected (virtual) day on an open-ended
                  // booking? i.e. the booking has no end_date and this cell is
                  // after the start_date.
                  const isProjectedDay = topBooking
                    && topBooking.end_date === null
                    && dateStr > topBooking.start_date;

                  let bgStyle: React.CSSProperties | undefined;
                  let textClass = "";
                  if (bh) {
                    bgStyle = { backgroundColor: bankHolidayColour, color: textColorForBg(bankHolidayColour) };
                  } else if (topBooking) {
                    bgStyle = {
                      backgroundColor: topBooking.reason_colour,
                      opacity: isProjectedDay ? 0.45
                        : topBooking.status === "pending" ? 0.4
                        : 1,
                    };
                    textClass = "text-white font-medium";
                  } else if (isScheduledWorkDay) {
                    bgStyle = { backgroundColor: SCHEDULE_BG };
                  }

                  const tooltipParts: string[] = [];
                  for (const b of dayBookings) {
                    const days = b.days_deducted ? ` — ${b.days_deducted}d` : "";
                    // Only show the status for absence types that require approval —
                    // for non-approval types (e.g. sick) "(approved)" is meaningless.
                    const statusPart = b.requires_approval ? ` (${b.status})` : "";
                    const openTag = b.end_date === null ? " [Open]" : "";
                    const incompletePart = b.completion_status && b.completion_status !== "complete"
                      ? ` [${b.completion_status.replace(/_/g, " ")}]`
                      : "";
                    tooltipParts.push(`${b.reason_name}${statusPart}${days}${openTag}${incompletePart}`);
                  }
                  if (bh) tooltipParts.push(`Bank Holiday: ${bh}`);

                  const inDragRange =
                    selectable && rangeLow !== null && rangeHigh !== null
                      && dateStr >= rangeLow && dateStr <= rangeHigh;
                  const isRangeEdge = inDragRange && (dateStr === rangeLow || dateStr === rangeHigh);

                  return (
                    <td
                      key={col}
                      className={cn(
                        "px-0 py-0.5 text-center h-7 relative",
                        isWeekend && !topBooking && "bg-muted/40",
                        isToday && "ring-1 ring-primary ring-inset",
                        selectable && "cursor-crosshair",
                      )}
                      style={bgStyle}
                      title={tooltipParts.length > 0 ? tooltipParts.join("\n") : undefined}
                      onMouseDown={selectable ? (e) => {
                        e.preventDefault();
                        // 1. A booking on this cell wins over everything else
                        //    (including bank holidays) — open the Edit/Delete
                        //    context menu rather than starting a drag.
                        if (topBooking && onBookingClick) {
                          onBookingClick(topBooking, e);
                          return;
                        }
                        // 2. Bank holiday cells with no booking shouldn't let
                        //    you "book" the bank holiday itself by clicking it.
                        //    Drag-through from another cell still works because
                        //    onMouseEnter / onMouseUp don't gate on `bh`.
                        if (bh) return;
                        handleCellMouseDown(dateStr);
                      } : undefined}
                      onMouseEnter={selectable ? () => handleCellMouseEnter(dateStr) : undefined}
                      onMouseUp={selectable ? () => handleCellMouseUp(dateStr) : undefined}
                    >
                      <span
                        className={cn(
                          "text-[10px] leading-none",
                          inDragRange && "relative z-10",
                          textClass,
                          !topBooking && !bh && isWeekend && "text-red-500",
                        )}
                        style={bh ? { color: textColorForBg(bankHolidayColour) } : undefined}
                      >
                        {dayNum}
                      </span>
                      {/* Incomplete sick booking indicator — small dot on the 1st day */}
                      {topBooking
                        && topBooking.completion_status
                        && topBooking.completion_status !== "complete"
                        && dateStr === topBooking.start_date && (
                        <span
                          aria-hidden
                          className="absolute top-0.5 right-0.5 h-2 w-2 rounded-full"
                          style={{ backgroundColor: "#ef4444" }}
                          title={`Action needed: ${topBooking.completion_status.replace(/_/g, " ")}`}
                        />
                      )}
                      {inDragRange && (
                        <span
                          aria-hidden
                          className={cn(
                            "pointer-events-none absolute inset-0 bg-primary/20",
                            isRangeEdge && "ring-1 ring-primary ring-inset bg-primary/30",
                          )}
                        />
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      </div>
    </div>
  );
}
