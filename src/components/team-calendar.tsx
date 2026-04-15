"use client";

import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { ChevronLeft, ChevronRight } from "lucide-react";
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
  member_id: string;
  start_date: string;
  end_date: string;
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
  endDate: string;
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

export function TeamCalendar({ members, bookings, bankHolidays, bankHolidayColour = "#EF4444", initialMonth, highlightMemberId, focusRange }: TeamCalendarProps) {
  const initDate = initialMonth ? new Date(initialMonth + "T00:00:00Z") : new Date();
  const [year, setYear] = useState(initDate.getUTCFullYear());
  const [month, setMonth] = useState(initDate.getUTCMonth());

  const isRolling = !!focusRange;

  // Build the day entries — either from a fixed month or rolling window
  const { dayEntries, monthSpans } = useMemo(() => {
    if (focusRange) {
      const { days, monthSpans } = buildRollingWindow(focusRange.startDate, focusRange.endDate);
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

  // Build booking lookup: "memberId:date" → booking
  const bookingMap = useMemo(() => {
    const map = new Map<string, TeamBooking>();
    for (const b of bookings) {
      if (b.status !== "approved" && b.status !== "pending") continue;
      const s = new Date(b.start_date + "T00:00:00Z");
      const e = new Date(b.end_date + "T00:00:00Z");
      const d = new Date(s);
      while (d <= e) {
        const key = `${b.member_id}:${isoDate(d)}`;
        if (!map.has(key)) map.set(key, b);
        d.setUTCDate(d.getUTCDate() + 1);
      }
    }
    return map;
  }, [bookings]);

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

      {/* Grid */}
      <div className="overflow-x-auto border rounded-md">
        <table className="border-collapse text-xs tabular-nums">
          <thead>
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
              {dayEntries.map((de) => (
                <th
                  key={de.dateStr}
                  className={cn(
                    "px-0 py-1 text-center min-w-6 w-6 border-b text-[10px]",
                    de.isWeekend ? "bg-muted/40 font-normal" : "font-bold"
                  )}
                >
                  {de.day}
                </th>
              ))}
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
                    const booking = bookingMap.get(`${m.id}:${de.dateStr}`);
                    const bh = bhMap.get(de.dateStr);
                    const working = isWorkingDay(m, de.dow);

                    let bgStyle: React.CSSProperties | undefined;
                    if (bh) {
                      bgStyle = { backgroundColor: bankHolidayColour, color: textColorForBg(bankHolidayColour) };
                    } else if (booking) {
                      bgStyle = {
                        backgroundColor: booking.reason_colour,
                        opacity: booking.status === "pending" ? 0.4 : 1,
                      };
                    }

                    const tooltipParts: string[] = [];
                    if (booking) tooltipParts.push(`${booking.reason_name} (${booking.status})${booking.days_deducted ? ` — ${booking.days_deducted}d` : ""}`);
                    if (booking?.status === "pending" && booking.created_at) tooltipParts.push(`Requested: ${fmtDateTime(booking.created_at)}`);
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

            {/* Summary: Count row */}
            {members.length > 0 && (
              <tr className="border-t-2 border-border">
                <td className="sticky left-0 z-10 bg-muted/50 px-2 py-1 text-left font-bold whitespace-nowrap border-r text-[10px] text-muted-foreground">
                  Off
                </td>
                {dayEntries.map((de, i) => {
                  const count = offCounts[i];
                  const pct = members.length > 0 ? Math.round((count / members.length) * 100) : 0;
                  return (
                    <td
                      key={de.dateStr}
                      className={cn(
                        "px-0 py-1 text-center text-[9px] font-medium",
                        de.isWeekend && "bg-muted/40",
                        count > 0 && "text-amber-600",
                      )}
                      title={`${count}/${members.length} (${pct}%)`}
                    >
                      {count > 0 ? count : ""}
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
