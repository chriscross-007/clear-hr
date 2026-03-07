import { AlertTriangle, Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  type ClockingData,
  type WorkPeriodData,
  type ClockingPair,
  computePairs,
  computeGrossHours,
  fmtTime,
  fmtHours,
} from "./timesheet-types";

interface TimesheetGridProps {
  weekStart: string; // "YYYY-MM-DD" (Monday)
  workPeriods: WorkPeriodData[];
  onClockingClick?: (clocking: ClockingData) => void;
}

const INFERRED_TYPE_LABELS: Record<string, string> = {
  IN:        "IN",
  OUT:       "OUT",
  CC:        "CC",
  bStart:    "bStart",
  AMBIGUOUS: "?",
};

const WEEK_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function getDayDates(weekStart: string): string[] {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(`${weekStart}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + i);
    return d.toISOString().slice(0, 10);
  });
}

function formatDayLabel(dateStr: string, short: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  return `${short} ${d.getUTCDate()}`;
}

/** Compute the maximum number of IN/OUT pairs across all periods (determines column count) */
function maxPairs(workPeriods: WorkPeriodData[]): number {
  if (workPeriods.length === 0) return 2;
  return Math.max(
    2,
    ...workPeriods.map((p) => computePairs(p.clockings).length)
  );
}

interface ClockingCellProps {
  clocking: ClockingData | null;
  label: string; // "IN" or "OUT"
  onClick?: (c: ClockingData) => void;
}

function ClockingCell({ clocking, label, onClick }: ClockingCellProps) {
  if (!clocking) {
    return (
      <td className="px-2 py-2 text-center text-muted-foreground/40 tabular-nums text-sm">
        —
      </td>
    );
  }

  const isAmbiguous = clocking.inferredType === "AMBIGUOUS";
  const isBstart    = clocking.inferredType === "bStart";
  const isLocked    = clocking.typeLocked;
  const canClick    = !!onClick;

  return (
    <td
      className={cn(
        "px-2 py-2 text-center tabular-nums text-sm whitespace-nowrap",
        canClick && "cursor-pointer hover:bg-accent/60 transition-colors",
        isAmbiguous && "bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400",
        isBstart && !isAmbiguous && "text-blue-700 dark:text-blue-400",
      )}
      onClick={() => onClick?.(clocking)}
      title={[
        `Raw: ${clocking.rawType ?? "swipe"}`,
        `Inferred: ${INFERRED_TYPE_LABELS[clocking.inferredType ?? ""] ?? "?"}`,
        isLocked ? "Locked by manager" : "",
      ]
        .filter(Boolean)
        .join(" · ")}
    >
      <span className="flex items-center justify-center gap-1">
        {fmtTime(clocking.clockedAt)}
        {isLocked && <Lock className="h-2.5 w-2.5 text-muted-foreground/60" />}
        {isAmbiguous && <AlertTriangle className="h-2.5 w-2.5" />}
      </span>
      {isBstart && (
        <span className="block text-[10px] text-blue-500 leading-none">bStart</span>
      )}
    </td>
  );
}

export function TimesheetGrid({ weekStart, workPeriods, onClockingClick }: TimesheetGridProps) {
  const days = getDayDates(weekStart);
  const numPairs = maxPairs(workPeriods);

  // Group work periods by timesheet_date
  const byDate = new Map<string, WorkPeriodData[]>();
  for (const period of workPeriods) {
    const arr = byDate.get(period.timesheetDate) ?? [];
    arr.push(period);
    byDate.set(period.timesheetDate, arr);
  }

  // Grand total hours across all periods
  const totalHours = workPeriods.reduce((sum, p) => sum + computeGrossHours(computePairs(p.clockings)), 0);

  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full text-sm border-collapse min-w-[600px]">
        <thead>
          {/* Main header */}
          <tr className="bg-muted/50 border-b border-border">
            <th className="sticky left-0 z-10 bg-muted/50 px-3 py-2 text-left font-semibold text-xs uppercase tracking-wide whitespace-nowrap">
              Date
            </th>
            <th className="px-3 py-2 text-left font-semibold text-xs uppercase tracking-wide whitespace-nowrap min-w-28">
              Shift
            </th>
            {Array.from({ length: numPairs }, (_, i) => (
              <th
                key={i}
                colSpan={2}
                className="px-2 py-2 text-center font-semibold text-xs uppercase tracking-wide border-l border-border/50"
              >
                Clocking {i + 1}
              </th>
            ))}
            <th className="px-3 py-2 text-right font-semibold text-xs uppercase tracking-wide whitespace-nowrap border-l border-border/50">
              Hours
            </th>
            <th className="px-2 py-2 w-6" aria-label="Conflicts" />
          </tr>
          {/* Sub-header: IN / OUT labels */}
          <tr className="bg-muted/30 border-b border-border text-muted-foreground">
            <th className="sticky left-0 z-10 bg-muted/30" />
            <th />
            {Array.from({ length: numPairs }, (_, i) => (
              <>
                <th key={`in-${i}`} className="px-2 py-1 text-center font-normal text-xs border-l border-border/50">
                  IN
                </th>
                <th key={`out-${i}`} className="px-2 py-1 text-center font-normal text-xs">
                  OUT
                </th>
              </>
            ))}
            <th className="border-l border-border/50" />
            <th />
          </tr>
        </thead>

        <tbody>
          {days.map((dateStr, dayIdx) => {
            const periods = byDate.get(dateStr) ?? [];
            const isWeekend = dayIdx >= 5;

            if (periods.length === 0) {
              // Empty day row
              return (
                <tr
                  key={dateStr}
                  className={cn(
                    "border-b border-border/50",
                    isWeekend && "bg-muted/20"
                  )}
                >
                  <td className="sticky left-0 z-10 bg-inherit px-3 py-2 font-medium whitespace-nowrap">
                    <span className="text-muted-foreground/60">
                      {formatDayLabel(dateStr, WEEK_DAYS[dayIdx])}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground/40 text-xs">—</td>
                  {Array.from({ length: numPairs * 2 }, (_, i) => (
                    <td key={i} className={cn("px-2 py-2", i % 2 === 0 && "border-l border-border/50")} />
                  ))}
                  <td className="border-l border-border/50" />
                  <td />
                </tr>
              );
            }

            // One or more work periods on this day
            return periods.map((period, periodIdx) => {
              const pairs: ClockingPair[] = computePairs(period.clockings);
              const grossHours = computeGrossHours(pairs);
              const ccClockings = period.clockings.filter(
                (c) => c.inferredType === "CC" || c.inferredType === "bStart"
              );

              return (
                <tr
                  key={period.id}
                  className={cn(
                    "border-b border-border/50",
                    isWeekend && "bg-muted/20",
                    period.hasConflicts && "bg-amber-50/50 dark:bg-amber-950/20",
                    periodIdx > 0 && "border-t-0"
                  )}
                >
                  {/* Date — only show on first period of the day */}
                  <td className="sticky left-0 z-10 bg-inherit px-3 py-2 font-medium whitespace-nowrap align-top">
                    {periodIdx === 0 ? (
                      <span className={cn(isWeekend && "text-muted-foreground")}>
                        {formatDayLabel(dateStr, WEEK_DAYS[dayIdx])}
                      </span>
                    ) : (
                      <span className="text-muted-foreground/40 text-xs pl-2">↳</span>
                    )}
                  </td>

                  {/* Shift name */}
                  <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap max-w-32 truncate align-top">
                    {period.scheduledShift?.name ?? (
                      <span className="text-muted-foreground/40">Open</span>
                    )}
                  </td>

                  {/* Clocking pairs */}
                  {Array.from({ length: numPairs }, (_, pairIdx) => {
                    const pair = pairs[pairIdx] ?? { in: null, out: null };
                    return (
                      <>
                        <td key={`in-${pairIdx}`} className="border-l border-border/50 p-0">
                          <ClockingCell
                            clocking={pair.in}
                            label="IN"
                            onClick={onClockingClick}
                          />
                        </td>
                        <td key={`out-${pairIdx}`} className="p-0">
                          <ClockingCell
                            clocking={pair.out}
                            label="OUT"
                            onClick={onClockingClick}
                          />
                        </td>
                      </>
                    );
                  })}

                  {/* Hours */}
                  <td className="px-3 py-2 text-right font-medium tabular-nums border-l border-border/50 whitespace-nowrap align-top">
                    {fmtHours(grossHours)}
                    {ccClockings.length > 0 && (
                      <span
                        className="ml-1 text-[10px] text-blue-500"
                        title={`${ccClockings.length} CC clocking(s)`}
                      >
                        CC
                      </span>
                    )}
                  </td>

                  {/* Conflict indicator */}
                  <td className="px-1 py-2 text-center align-top">
                    {period.hasConflicts && (
                      <span title="This period has ambiguous or conflicting clockings">
                        <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                      </span>
                    )}
                  </td>
                </tr>
              );
            });
          })}
        </tbody>

        {/* Summary footer */}
        <tfoot>
          <tr className="border-t-2 border-border bg-muted/40 font-semibold">
            <td className="sticky left-0 z-10 bg-muted/40 px-3 py-2 text-xs uppercase tracking-wide">
              Week Total
            </td>
            <td />
            {Array.from({ length: numPairs * 2 }, (_, i) => (
              <td key={i} className={cn("px-2 py-2", i % 2 === 0 && "border-l border-border/50")} />
            ))}
            <td className="px-3 py-2 text-right tabular-nums border-l border-border/50">
              {fmtHours(totalHours)}
            </td>
            <td />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
