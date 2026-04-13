"use client";

import { useMemo } from "react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CalendarBooking = {
  id: string;
  start_date: string;
  end_date: string;
  status: string;
  reason_name: string;
  reason_colour: string;
  days_deducted: number | null;
};

export type CalendarBankHoliday = {
  date: string;
  name: string;
};

interface HolidayCalendarProps {
  yearStart: string;
  bookings: CalendarBooking[];
  bankHolidays: CalendarBankHoliday[];
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

export function HolidayCalendar({ yearStart, bookings, bankHolidays }: HolidayCalendarProps) {
  const { months, totalCols } = useMemo(() => buildGrid(yearStart), [yearStart]);

  const bookingMap = useMemo(() => {
    const map = new Map<string, CalendarBooking[]>();
    for (const b of bookings) {
      if (b.status === "cancelled" || b.status === "rejected") continue;
      const s = new Date(b.start_date + "T00:00:00Z");
      const e = new Date(b.end_date + "T00:00:00Z");
      const d = new Date(s);
      while (d <= e) {
        const key = isoDate(d);
        const arr = map.get(key) ?? [];
        arr.push(b);
        map.set(key, arr);
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

  const legend = useMemo(() => {
    const seen = new Map<string, { name: string; colour: string }>();
    for (const b of bookings) {
      if (b.status === "cancelled" || b.status === "rejected") continue;
      if (!seen.has(b.reason_name)) {
        seen.set(b.reason_name, { name: b.reason_name, colour: b.reason_colour });
      }
    }
    return Array.from(seen.values());
  }, [bookings]);

  const today = new Date().toISOString().slice(0, 10);

  return (
    <div>
      {/* Legend */}
      {legend.length > 0 && (
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
      <div className="overflow-x-auto border rounded-md w-fit">
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
                      "px-0 py-1.5 text-center text-muted-foreground min-w-6 w-6 border-b text-[10px]",
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
                      <td key={col} className={cn("px-0 py-0.5 text-center h-6", isWeekend && "bg-muted/40")} />
                    );
                  }

                  const dateStr = `${m.year}-${String(m.month + 1).padStart(2, "0")}-${String(dayNum).padStart(2, "0")}`;
                  const isToday = dateStr === today;
                  const dayBookings = bookingMap.get(dateStr) ?? [];
                  const bh = bhMap.get(dateStr);
                  const topBooking = dayBookings[0];

                  let bgStyle: React.CSSProperties | undefined;
                  let textClass = "";
                  if (topBooking) {
                    bgStyle = {
                      backgroundColor: topBooking.reason_colour,
                      opacity: topBooking.status === "pending" ? 0.4 : 1,
                    };
                    textClass = "text-white font-medium";
                  }

                  const tooltipParts: string[] = [];
                  for (const b of dayBookings) {
                    tooltipParts.push(`${b.reason_name} (${b.status})${b.days_deducted ? ` — ${b.days_deducted}d` : ""}`);
                  }
                  if (bh) tooltipParts.push(`Bank Holiday: ${bh}`);

                  return (
                    <td
                      key={col}
                      className={cn(
                        "px-0 py-0.5 text-center h-6 relative",
                        isWeekend && !topBooking && "bg-muted/40",
                        isToday && "ring-1 ring-primary ring-inset",
                      )}
                      style={bgStyle}
                      title={tooltipParts.length > 0 ? tooltipParts.join("\n") : undefined}
                    >
                      <span className={cn("text-[10px] leading-none", textClass, !topBooking && isWeekend && "text-red-500")}>
                        {dayNum}
                      </span>
                      {bh && !topBooking && (
                        <span className="absolute bottom-0 right-0 text-[6px] text-muted-foreground leading-none">
                          BH
                        </span>
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
