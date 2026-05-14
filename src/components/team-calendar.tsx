"use client";

import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { ChevronLeft, ChevronRight, ArrowDown } from "lucide-react";
import { Button } from "@/components/ui/button";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TeamMember = {
  id: string;
  name: string;
  /** Per-day working hours [Mon..Sun], null = use default Mon-Fri */
  workPattern: number[] | null;
};

export type TeamBooking = {
  /** Optional booking id; used by consumers that merge bookings from
   *  multiple fetches (e.g. AvailabilityClient's lazy month loader) to
   *  dedupe rows that overlap month boundaries. */
  id?: string;
  member_id: string;
  start_date: string;
  end_date: string | null;
  status: string;
  reason_name: string;
  reason_colour: string;
  created_at?: string;
  days_deducted?: number | null;
};

export type TeamBankHoliday = {
  date: string;
  name: string;
};

/** When set, the calendar shows a rolling date window instead of a fixed month. */
export type FocusRange = {
  startDate: string;
  endDate: string | null;
};

function textColorForBg(hex: string): string {
  const h = hex.replace("#", "");
  if (h.length !== 6) return "#ffffff";
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? "#000000" : "#ffffff";
}

interface TeamCalendarProps {
  members: TeamMember[];
  bookings: TeamBooking[];
  bankHolidays: TeamBankHoliday[];
  bankHolidayColour?: string;
  /** Initial month to display (ISO date, e.g. "2026-04-01"). Defaults to current month. */
  initialMonth?: string;
  /** Member ID to highlight (e.g. the requesting employee in approvals view) */
  highlightMemberId?: string;
  /** Show a rolling window centred on this booking range (hides month nav, adds month header row) */
  focusRange?: FocusRange;
  /** CLE-188 — fires whenever the displayed month changes (initial mount,
   *  prev/next nav). Lets the parent lazy-load bookings for that month.
   *  Month is 0-indexed (Jan = 0). */
  onMonthChange?: (year: number, month: number) => void;
  /** CLE-189 — when set, renders a "Required cover: N" line above the
   *  table. Used by the Approvals page's inline calendar so the admin can
   *  see the team's Min Cover next to the data. */
  requiredCover?: number;
  /** CLE-189 — ISO dates within the focused booking's range where
   *  approving it would drop the team below Min Cover. The day-of-month
   *  header cell and the matching summary-row cell render in red. */
  offendingDates?: string[];
  /** CLE-189 — when TRUE, the bottom summary row is labelled "Cover" and
   *  its numbers show **members present** (team size minus the off
   *  count) instead of the count of members off. Used by the Approvals
   *  page so admins can read the row as "how many remain on duty" against
   *  the Required Cover line above the table. Default FALSE preserves
   *  the original "Off" semantics for Availability and any other caller. */
  coverMode?: boolean;
  /** CLE-192 — used by the focus-arrows row (Approvals inline calendar
   *  only) to decide whether a bank holiday inside the booking's range
   *  counts against the requester's allowance. `'additional'` = BHs are
   *  free, no arrow; `'deducted'` = BHs are normal working days, arrow
   *  shows. Default `'additional'`. */
  bankHolidayHandling?: "additional" | "deducted";
}

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

const DOW_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function dow(year: number, month: number, day: number): number {
  const js = new Date(Date.UTC(year, month, day)).getUTCDay();
  return js === 0 ? 6 : js - 1;
}

function fmtMonthYear(year: number, month: number): string {
  return new Date(Date.UTC(year, month, 1)).toLocaleDateString("en-GB", {
    month: "long", year: "numeric", timeZone: "UTC",
  });
}

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  const date = d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });
  return `${date} ${time}`;
}

function isWorkingDay(member: TeamMember, dayOfWeek: number): boolean {
  if (!member.workPattern) {
    // Default Mon-Fri
    return dayOfWeek < 5;
  }
  return (member.workPattern[dayOfWeek] ?? 0) > 0;
}

// ---------------------------------------------------------------------------
// Rolling window helpers
// ---------------------------------------------------------------------------

const PADDING_DAYS = 14; // 2 weeks either side of the booking

type DayEntry = { date: Date; dateStr: string; day: number; dow: number; isWeekend: boolean };
type MonthSpan = { label: string; colSpan: number };

function buildRollingWindow(startDate: string, endDate: string): { days: DayEntry[]; monthSpans: MonthSpan[] } {
  const s = new Date(startDate + "T00:00:00Z");
  const e = new Date(endDate + "T00:00:00Z");

  const windowStart = new Date(s);
  windowStart.setUTCDate(windowStart.getUTCDate() - PADDING_DAYS);
  const windowEnd = new Date(e);
  windowEnd.setUTCDate(windowEnd.getUTCDate() + PADDING_DAYS);

  const days: DayEntry[] = [];
  const d = new Date(windowStart);
  while (d <= windowEnd) {
    const jsDay = d.getUTCDay();
    const dayOfWeek = jsDay === 0 ? 6 : jsDay - 1;
    days.push({
      date: new Date(d),
      dateStr: isoDate(d),
      day: d.getUTCDate(),
      dow: dayOfWeek,
      isWeekend: dayOfWeek >= 5,
    });
    d.setUTCDate(d.getUTCDate() + 1);
  }

  // Build month spans for the header row
  const monthSpans: MonthSpan[] = [];
  let currentLabel = "";
  let currentCount = 0;
  for (const day of days) {
    const label = day.date.toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
    if (label !== currentLabel) {
      if (currentCount > 0) monthSpans.push({ label: currentLabel, colSpan: currentCount });
      currentLabel = label;
      currentCount = 1;
    } else {
      currentCount++;
    }
  }
  if (currentCount > 0) monthSpans.push({ label: currentLabel, colSpan: currentCount });

  return { days, monthSpans };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function TeamCalendar({
  members,
  bookings,
  bankHolidays,
  bankHolidayColour = "#EF4444",
  initialMonth,
  highlightMemberId,
  focusRange,
  onMonthChange,
  requiredCover,
  offendingDates,
  coverMode = false,
  bankHolidayHandling = "additional",
}: TeamCalendarProps) {
  const initDate = initialMonth ? new Date(initialMonth + "T00:00:00Z") : new Date();
  const [year, setYear] = useState(initDate.getUTCFullYear());
  const [month, setMonth] = useState(initDate.getUTCMonth());

  // CLE-188 — notify the parent on each displayed-month change so it can
  // lazy-load bookings for that month if it hasn't already been fetched.
  // Fires once on initial mount + on every prev/next month click.
  useEffect(() => {
    if (focusRange) return; // rolling window doesn't have a single "month"
    onMonthChange?.(year, month);
    // We intentionally exclude onMonthChange from deps so we don't refire
    // when the parent passes a new (non-memoised) callback reference.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, month, focusRange]);

  const isRolling = !!focusRange;

  // Build the day entries — either from a fixed month or rolling window
  const { dayEntries, monthSpans } = useMemo(() => {
    if (focusRange) {
      const effectiveEnd = focusRange.endDate ?? new Date().toISOString().slice(0, 10);
      const { days, monthSpans } = buildRollingWindow(focusRange.startDate, effectiveEnd);
      return { dayEntries: days, monthSpans };
    }
    // Fixed month mode
    const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    const entries: DayEntry[] = Array.from({ length: daysInMonth }, (_, i) => {
      const day = i + 1;
      const d = dow(year, month, day);
      return {
        date: new Date(Date.UTC(year, month, day)),
        dateStr: `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
        day,
        dow: d,
        isWeekend: d >= 5,
      };
    });
    return { dayEntries: entries, monthSpans: [] as MonthSpan[] };
  }, [focusRange, year, month]);

  // Build booking lookup: "memberId:date" → { booking, ongoing }.
  // CLE-187 — open-ended bookings (end_date NULL) are rendered all the way
  // through the visible window, not capped at today. Cells past today are
  // flagged `ongoing=true` so the row renderer can give them a striped /
  // muted treatment, distinguishing "we know they were off" from "still
  // open — return date not set". Matches the cover-check semantics in
  // book-holiday-sheet: an open booking keeps counting against cover until
  // someone closes it.
  const bookingMap = useMemo(() => {
    const map = new Map<string, { booking: TeamBooking; ongoing: boolean }>();
    const todayStr = new Date().toISOString().slice(0, 10);
    // Extend open-ended cells to the end of whatever window the calendar
    // happens to be showing (either the fixed month or the rolling focus
    // range). Capping at the visible window keeps the map small.
    const windowEndStr = dayEntries.length > 0
      ? dayEntries[dayEntries.length - 1].dateStr
      : todayStr;
    for (const b of bookings) {
      if (b.status !== "approved" && b.status !== "pending") continue;
      const s = new Date(b.start_date + "T00:00:00Z");
      const eStr = b.end_date ?? windowEndStr;
      const e = new Date(eStr + "T00:00:00Z");
      const d = new Date(s);
      while (d <= e) {
        const iso = isoDate(d);
        const key = `${b.member_id}:${iso}`;
        if (!map.has(key)) {
          const ongoing = b.end_date === null && iso > todayStr;
          map.set(key, { booking: b, ongoing });
        }
        d.setUTCDate(d.getUTCDate() + 1);
      }
    }
    return map;
  }, [bookings, dayEntries]);

  const bhMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const bh of bankHolidays) map.set(bh.date, bh.name);
    return map;
  }, [bankHolidays]);

  const today = new Date().toISOString().slice(0, 10);

  // Summary: count of employees off per day
  const offCounts = useMemo(() => {
    return dayEntries.map((de) => {
      let count = 0;
      for (const m of members) {
        if (bookingMap.has(`${m.id}:${de.dateStr}`)) count++;
      }
      return count;
    });
  }, [dayEntries, members, bookingMap]);

  // CLE-189 — Offending dates for the red-highlight treatment. If the
  // caller provides an explicit list (Approvals does — the booking-
  // specific dates pre-computed server-side) we use that. Otherwise,
  // when `requiredCover` is set, we auto-compute from offCounts: any
  // working day where present count (members − off) falls below
  // `requiredCover` is offending. This lets simple consumers like the
  // Availability page just pass `requiredCover` and have the highlights
  // "just work".
  const offendingSet = useMemo(() => {
    if (offendingDates) return new Set(offendingDates);
    if (typeof requiredCover !== "number" || requiredCover <= 0) return new Set<string>();
    const computed = new Set<string>();
    for (let i = 0; i < dayEntries.length; i++) {
      const de = dayEntries[i];
      // Weekends and bank holidays don't trigger cover rules.
      if (de.dow >= 5) continue;
      if (bhMap.has(de.dateStr)) continue;
      const present = members.length - offCounts[i];
      if (present < requiredCover) computed.add(de.dateStr);
    }
    return computed;
  }, [offendingDates, requiredCover, dayEntries, members, offCounts, bhMap]);

  function prevMonth() {
    if (month === 0) { setYear(year - 1); setMonth(11); }
    else setMonth(month - 1);
  }
  function nextMonth() {
    if (month === 11) { setYear(year + 1); setMonth(0); }
    else setMonth(month + 1);
  }

  return (
    <div>
      {/* Month navigation — hidden in rolling/focus mode */}
      {!isRolling && (
        <div className="flex items-center gap-3 mb-4">
          <Button variant="outline" size="icon" onClick={prevMonth}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <h2 className="text-lg font-bold min-w-40 text-center">{fmtMonthYear(year, month)}</h2>
          <Button variant="outline" size="icon" onClick={nextMonth}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}

      {/* CLE-189 — Required cover summary line, shown when a parent (e.g.
          the Approvals inline calendar) wants admins to see the team's
          Min Cover next to the data. */}
      {typeof requiredCover === "number" && requiredCover > 0 && (
        <div className="mb-2 text-xs font-medium text-muted-foreground">
          Required cover: <span className="text-foreground">{requiredCover}</span>
        </div>
      )}

      {/* Grid */}
      <div className="overflow-x-auto border rounded-md">
        <table className="border-collapse text-xs tabular-nums">
          <thead>
            {/* CLE-192 — focus arrows. Renders only in rolling/focus
                mode (Approvals inline calendar). Drops a red down-arrow
                above every day inside the booking's range that actually
                counts against the requester's allowance — i.e. a working
                day in their Work Pattern, AND either a non-bank-holiday
                or a bank holiday on an org that deducts BHs from
                allowance (`bank_holiday_handling = 'deducted'`).
                Skips the requester's own non-working days so an
                employee who doesn't work Wednesdays won't see an arrow
                on Wednesday. */}
            {isRolling && focusRange && (() => {
              // Resolve requester's work pattern; null = default Mon-Fri.
              const requester = highlightMemberId
                ? members.find((m) => m.id === highlightMemberId)
                : undefined;
              const pattern = requester?.workPattern ?? null;
              return (
                <tr>
                  <th className="sticky left-0 z-10 bg-background border-r min-w-32" />
                  {dayEntries.map((de) => {
                    const inRange =
                      de.dateStr >= focusRange.startDate
                      && (focusRange.endDate === null || de.dateStr <= focusRange.endDate);
                    const isWorkingDay = pattern
                      ? (pattern[de.dow] ?? 0) > 0
                      : de.dow < 5;
                    const bhCounts =
                      !bhMap.has(de.dateStr) || bankHolidayHandling === "deducted";
                    const showArrow = inRange && isWorkingDay && bhCounts;
                    return (
                      <th
                        key={de.dateStr}
                        className="px-0 py-0 text-center min-w-6 w-6 align-bottom"
                      >
                        {showArrow && (
                          <ArrowDown
                            className="inline-block h-[18px] w-[18px] text-red-600"
                            strokeWidth={3}
                            aria-hidden
                          />
                        )}
                      </th>
                    );
                  })}
                </tr>
              );
            })()}
            {/* Row 0 (rolling only): Month/Year spans */}
            {isRolling && monthSpans.length > 0 && (
              <tr>
                <th className="sticky left-0 z-10 bg-background px-2 py-1 border-r border-b min-w-32" />
                {monthSpans.map((span) => (
                  <th
                    key={span.label}
                    colSpan={span.colSpan}
                    className="px-0 py-1 text-center border-b text-[10px] font-bold"
                  >
                    {span.label}
                  </th>
                ))}
              </tr>
            )}
            {/* Row 1: Day of month */}
            <tr>
              <th className="sticky left-0 z-10 bg-background px-2 py-1 border-r border-b min-w-32" />
              {dayEntries.map((de) => {
                // CLE-189 — paint the day-of-month cell red on dates where
                // approving this booking would breach Min Cover.
                const offending = offendingSet.has(de.dateStr);
                return (
                  <th
                    key={de.dateStr}
                    className={cn(
                      "px-0 py-1 text-center min-w-6 w-6 border-b text-[10px]",
                      de.isWeekend ? "bg-muted/40 font-normal" : "font-bold",
                      offending && "bg-red-500 text-white",
                    )}
                  >
                    {de.day}
                  </th>
                );
              })}
            </tr>
            {/* Row 2: Day of week */}
            <tr>
              <th className="sticky left-0 z-10 bg-background px-2 py-1 border-r border-b min-w-32 text-left text-muted-foreground font-medium text-[10px]">
                Employee
              </th>
              {dayEntries.map((de) => (
                <th
                  key={de.dateStr}
                  className={cn(
                    "px-0 py-1 text-center min-w-6 w-6 border-b text-[10px]",
                    de.isWeekend ? "bg-muted/40 font-normal" : "font-bold"
                  )}
                >
                  {DOW_LABELS[de.dow]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {/* Employee rows */}
            {members.length === 0 ? (
              <tr>
                <td colSpan={dayEntries.length + 1} className="h-16 text-center text-muted-foreground">
                  No employees to display.
                </td>
              </tr>
            ) : (
              members.map((m) => (
                <tr key={m.id} className={cn("border-b last:border-b-0", highlightMemberId === m.id && "bg-primary/10")}>
                  <td className={cn("sticky left-0 z-10 px-2 py-0.5 text-left font-bold whitespace-nowrap border-r text-[11px]", highlightMemberId === m.id ? "bg-primary/10" : "bg-background")}>
                    {m.name}
                  </td>
                  {dayEntries.map((de) => {
                    const isToday = de.dateStr === today;
                    const entry = bookingMap.get(`${m.id}:${de.dateStr}`);
                    const booking = entry?.booking;
                    const ongoing = entry?.ongoing ?? false;
                    const bh = bhMap.get(de.dateStr);
                    const working = isWorkingDay(m, de.dow);

                    let bgStyle: React.CSSProperties | undefined;
                    if (bh) {
                      bgStyle = { backgroundColor: bankHolidayColour, color: textColorForBg(bankHolidayColour) };
                    } else if (booking) {
                      // CLE-187 — ongoing (post-today portion of an
                      // open-ended booking) shows the reason colour as a
                      // diagonal stripe on a muted background, marking
                      // "still open — we don't actually know they'll be
                      // off here". Pending bookings keep their existing
                      // 0.4 opacity treatment.
                      if (ongoing) {
                        bgStyle = {
                          backgroundImage: `repeating-linear-gradient(135deg, ${booking.reason_colour} 0 4px, transparent 4px 8px)`,
                          backgroundColor: "transparent",
                          opacity: 0.7,
                        };
                      } else {
                        bgStyle = {
                          backgroundColor: booking.reason_colour,
                          opacity: booking.status === "pending" ? 0.4 : 1,
                        };
                      }
                    }

                    const tooltipParts: string[] = [];
                    if (booking) tooltipParts.push(`${booking.reason_name} (${booking.status})${booking.days_deducted ? ` — ${booking.days_deducted}d` : ""}`);
                    if (booking?.status === "pending" && booking.created_at) tooltipParts.push(`Requested: ${fmtDateTime(booking.created_at)}`);
                    if (ongoing) tooltipParts.push("Ongoing — return date not set");
                    if (bh) tooltipParts.push(`Bank Holiday: ${bh}`);
                    if (!working && !de.isWeekend) tooltipParts.push("Non-working day");

                    return (
                      <td
                        key={de.dateStr}
                        className={cn(
                          "px-0 py-0 text-center h-6 relative",
                          de.isWeekend && !booking && "bg-muted/40",
                          isToday && "ring-1 ring-primary ring-inset",
                        )}
                        style={bgStyle}
                        title={tooltipParts.length > 0 ? tooltipParts.join("\n") : undefined}
                      >
                        {!working && !de.isWeekend && !booking && (
                          <span className="text-red-400 text-[9px]">×</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))
            )}

            {/* Summary: Count row. In default mode the label is "Off"
                and values are the count of members off per day. In cover
                mode (Approvals) the label is "Cover" and values flip to
                members present (team size minus off). */}
            {members.length > 0 && (
              <tr className="border-t-2 border-border">
                <td className="sticky left-0 z-10 bg-muted/50 px-2 py-1 text-left font-bold whitespace-nowrap border-r text-[10px] text-muted-foreground">
                  {coverMode ? "Cover" : "Off"}
                </td>
                {dayEntries.map((de, i) => {
                  const off = offCounts[i];
                  const present = members.length - off;
                  const value = coverMode ? present : off;
                  const pct = members.length > 0 ? Math.round((off / members.length) * 100) : 0;
                  const offending = offendingSet.has(de.dateStr);
                  // CLE-189 — in cover mode we always show the number
                  // (including 0) because "0 present" is a real and
                  // important read for the admin. In off mode we keep
                  // the existing "blank when nobody's off" behaviour.
                  const display = coverMode
                    ? String(value)
                    : value > 0 ? String(value) : "";
                  return (
                    <td
                      key={de.dateStr}
                      className={cn(
                        "px-0 py-1 text-center text-[9px] font-medium",
                        de.isWeekend && "bg-muted/40",
                        !coverMode && off > 0 && !offending && "text-amber-600",
                        // CLE-189 — offending dates take precedence over
                        // the amber count tint so the red highlight reads
                        // unambiguously.
                        offending && "bg-red-500 text-white",
                      )}
                      title={coverMode
                        ? `${present} on duty of ${members.length} (${off} off)`
                        : `${off}/${members.length} (${pct}%)`}
                    >
                      {display}
                    </td>
                  );
                })}
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
