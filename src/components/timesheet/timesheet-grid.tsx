"use client";

import React, { useState, useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  type ClockingData,
  type WorkPeriodData,
  type ClockingPair,
  type CellClickContext,
  type RoundingConfig,
  type OvertimeBandDef,
  type BreakRuleDef,
  effectiveType,
  effectiveTime,
  computePairs,
  computeGrossHours,
  splitHoursByBands,
  applyBreakRules,
  fmtTime,
  fmtHours,
  fmtRoundedTime,
} from "./timesheet-types";

type DayShift = { shiftDefinitionId: string | null; name: string | null; isOffDay: boolean };

interface TimesheetGridProps {
  weekStart: string; // "YYYY-MM-DD" (Monday)
  workPeriods: WorkPeriodData[];
  shiftByDate?: Record<string, DayShift>;
  /** Called when any clocking cell is clicked (filled or empty) */
  onCellClick?: (ctx: CellClickContext) => void;
  shiftDefs?: { id: string; name: string }[];
  onShiftChange?: (date: string, shiftDefinitionId: string | null) => void;
  roundingConfig?: RoundingConfig;
  rates?: { id: string; name: string; rate_multiplier: number }[];
  shiftBands?: Record<string, OvertimeBandDef[]>;
  shiftBreakRules?: Record<string, BreakRuleDef[]>;
}

const INFERRED_TYPE_LABELS: Record<string, string> = {
  bStart:       "bStart",
  bEnd:         "bEnd",
  BreakOut:     "Brk Out",
  BreakIn:      "Brk In",
  INambiguous:  "IN?",
  OUTambiguous: "OUT?",
  CC:           "CC",
  // legacy labels (may still be in DB until re-inference)
  IN:           "IN",
  OUT:          "OUT",
  BRK_OUT:      "Brk Out",
  BRK_IN:       "Brk In",
  AMBIGUOUS:    "?",
};

const WEEK_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MAX_PAIRS_PER_ROW = 2;

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

/** Split pairs into chunks of MAX_PAIRS_PER_ROW for multi-row display */
function chunkPairs(pairs: ClockingPair[]): ClockingPair[][] {
  if (pairs.length === 0) return [[]];
  const chunks: ClockingPair[][] = [];
  for (let i = 0; i < pairs.length; i += MAX_PAIRS_PER_ROW) {
    chunks.push(pairs.slice(i, i + MAX_PAIRS_PER_ROW));
  }
  return chunks;
}

interface ClockingCellProps {
  clocking:       ClockingData | null;
  expectedType:   "IN" | "OUT";
  date:           string;
  workPeriodId:   string | null;
  onCellClick?:   (ctx: CellClickContext) => void;
  className?:     string;
  roundingConfig?: RoundingConfig;
}

function ClockingCell({ clocking, expectedType, date, workPeriodId, onCellClick, className, roundingConfig }: ClockingCellProps) {
  const ctx: CellClickContext = { clocking, date, workPeriodId, expectedType };

  if (!clocking) {
    return (
      <td
        className={cn(
          "px-2 py-2 text-center tabular-nums text-sm",
          onCellClick
            ? "cursor-pointer hover:bg-accent/60 transition-colors text-muted-foreground/30"
            : "text-muted-foreground/40",
          className,
        )}
        onClick={() => onCellClick?.(ctx)}
        title={onCellClick ? `Add ${expectedType} clocking on ${date}` : undefined}
      >
        {onCellClick ? "+" : "—"}
      </td>
    );
  }

  const eff          = effectiveType(clocking);
  const isOverridden = clocking.overrideType != null;
  const isEdited     = clocking.editedClockedAt != null || clocking.editedRawType != null || clocking.source === "manual";
  const isAmbiguous  = eff === "INambiguous" || eff === "OUTambiguous";
  const displayLabel = INFERRED_TYPE_LABELS[eff ?? ""] ?? eff ?? "?";
  const shownTime    = fmtTime(effectiveTime(clocking));

  const roundedLabel = roundingConfig
    ? fmtRoundedTime(effectiveTime(clocking), eff, roundingConfig)
    : null;

  const tooltipParts = [
    roundedLabel ? `Rounded: ${roundedLabel}` : "",
    `Raw: ${clocking.editedRawType ?? clocking.rawType ?? "bare swipe"}`,
    isEdited ? `Original: ${fmtTime(clocking.clockedAt)} (${clocking.rawType ?? "bare swipe"})` : "",
    `Inferred: ${INFERRED_TYPE_LABELS[clocking.inferredType ?? ""] ?? clocking.inferredType ?? "—"}`,
    isOverridden ? `Override → ${displayLabel}` : "",
    isEdited && clocking.editedByName
      ? `Edited by ${clocking.editedByName}${clocking.editedAt ? ` on ${new Date(clocking.editedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })} at ${fmtTime(clocking.editedAt)}` : ""}`
      : "",
  ].filter(Boolean).join(" · ");

  return (
    <td
      className={cn(
        "px-2 py-2 text-center tabular-nums text-sm whitespace-nowrap",
        onCellClick && "cursor-pointer hover:bg-accent/60 transition-colors",
        isAmbiguous  && "bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400",
        isEdited     && !isAmbiguous && "text-blue-600 dark:text-blue-400",
        isOverridden && !isAmbiguous && !isEdited && "text-blue-600 dark:text-blue-400",
        className,
      )}
      onClick={() => onCellClick?.(ctx)}
      title={tooltipParts}
    >
      <span className="flex items-center justify-center gap-1">
        {shownTime}
        {isAmbiguous && <AlertTriangle className="h-2.5 w-2.5" />}
      </span>
      {isOverridden && !isEdited && (
        <span className="block text-[10px] text-blue-500 leading-none">{displayLabel}</span>
      )}
      {isEdited && (
        <span className="block text-[10px] text-blue-400 leading-none">edited</span>
      )}
      {!isOverridden && !isEdited && eff === "bStart" && (
        <span className="block text-[10px] text-muted-foreground/50 leading-none">start</span>
      )}
    </td>
  );
}

function shiftDefToSelectValue(shiftDef: { shiftDefinitionId: string | null; isOffDay: boolean } | null): string {
  if (!shiftDef) return "";
  if (shiftDef.isOffDay) return "__off__";
  return shiftDef.shiftDefinitionId ?? "";
}

function ShiftCell({
  date,
  shiftDef,
  shiftDefs,
  onShiftChange,
}: {
  date: string;
  shiftDef: { shiftDefinitionId: string | null; name: string | null; isOffDay: boolean } | null;
  shiftDefs: { id: string; name: string }[];
  onShiftChange?: (date: string, shiftDefinitionId: string | null) => void;
}) {
  const serverValue = shiftDefToSelectValue(shiftDef);
  const [value, setValue] = useState(serverValue);

  useEffect(() => { setValue(serverValue); }, [serverValue]);

  if (onShiftChange) {
    return (
      <select
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          onShiftChange(date, e.target.value || null);
        }}
        className="w-full text-xs rounded border border-border bg-background px-1.5 py-1 text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
      >
        <option value="">— Open —</option>
        <option value="__off__">Not scheduled</option>
        {shiftDefs.map((s) => (
          <option key={s.id} value={s.id}>{s.name}</option>
        ))}
      </select>
    );
  }

  if (shiftDef?.isOffDay) {
    return <span className="text-xs text-muted-foreground/60 italic">Not scheduled</span>;
  }
  return (
    <span className="text-xs text-muted-foreground">
      {shiftDef?.name ?? <span className="text-muted-foreground/40">Open</span>}
    </span>
  );
}

export function TimesheetGrid({ weekStart, workPeriods, shiftByDate = {}, onCellClick, shiftDefs = [], onShiftChange, roundingConfig, rates = [], shiftBands = {}, shiftBreakRules = {} }: TimesheetGridProps) {
  const days = getDayDates(weekStart);

  const byDate = new Map<string, WorkPeriodData[]>();
  for (const period of workPeriods) {
    const arr = byDate.get(period.timesheetDate) ?? [];
    arr.push(period);
    byDate.set(period.timesheetDate, arr);
  }

  // Per-rate totals for the footer.
  // Periods with no bands contribute gross hours to the first rate column (fallback).
  const rateTotals: Record<string, number> = {};
  let noBandsTotalHours = 0;
  const totalHours = workPeriods.reduce((sum, p) => {
    const pairs      = computePairs(p.clockings);
    const gross      = computeGrossHours(pairs, roundingConfig);
    const shiftDefId = p.scheduledShift?.shiftDefinitionId ?? "";
    const bands      = shiftBands[shiftDefId] ?? [];
    const brules     = shiftBreakRules[shiftDefId] ?? [];
    if (bands.length === 0) {
      noBandsTotalHours += gross;
    } else {
      const split    = splitHoursByBands(pairs, bands, roundingConfig);
      const adjusted = applyBreakRules(p.clockings, split, brules);
      for (const [rateId, hrs] of Object.entries(adjusted)) {
        rateTotals[rateId] = (rateTotals[rateId] ?? 0) + hrs;
      }
    }
    return sum + gross;
  }, 0);

  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full text-sm border-collapse min-w-[600px]">
        <thead>
          <tr className="bg-muted/50 border-b border-border">
            <th className="sticky left-0 z-10 bg-muted/50 px-3 py-2 text-left font-semibold text-xs uppercase tracking-wide whitespace-nowrap">
              Date
            </th>
            <th className="px-3 py-2 text-left font-semibold text-xs uppercase tracking-wide whitespace-nowrap min-w-28">
              Shift
            </th>
            {Array.from({ length: MAX_PAIRS_PER_ROW }, (_, i) => (
              <th
                key={i}
                colSpan={2}
                className="px-2 py-2 text-center font-semibold text-xs uppercase tracking-wide border-l border-border/50"
              >
                Clocking {i + 1}
              </th>
            ))}
            {rates.length > 0 ? rates.map((rate) => (
              <th key={rate.id} className="px-3 py-2 text-right font-semibold text-xs uppercase tracking-wide whitespace-nowrap border-l border-border/50">
                <div>{rate.name}</div>
                <div className="text-[10px] font-normal text-muted-foreground tabular-nums">×{Number(rate.rate_multiplier).toFixed(2)}</div>
              </th>
            )) : (
              <th className="px-3 py-2 text-right font-semibold text-xs uppercase tracking-wide whitespace-nowrap border-l border-border/50">
                Hours
              </th>
            )}
            <th className="px-2 py-2 w-6" aria-label="Conflicts" />
          </tr>
          <tr className="bg-muted/30 border-b border-border text-muted-foreground">
            <th className="sticky left-0 z-10 bg-muted/30" />
            <th />
            {Array.from({ length: MAX_PAIRS_PER_ROW }, (_, i) => (
              <React.Fragment key={i}>
                <th className="px-2 py-1 text-center font-normal text-xs border-l border-border/50">IN</th>
                <th className="px-2 py-1 text-center font-normal text-xs">OUT</th>
              </React.Fragment>
            ))}
            {rates.length > 0 ? rates.map((rate) => (
              <th key={rate.id} className="border-l border-border/50" />
            )) : (
              <th className="border-l border-border/50" />
            )}
            <th />
          </tr>
        </thead>

        <tbody>
          {days.map((dateStr, dayIdx) => {
            const periods   = byDate.get(dateStr) ?? [];
            const isWeekend = dayIdx >= 5;

            if (periods.length === 0) {
              return (
                <tr
                  key={dateStr}
                  className={cn("border-b border-border/50", isWeekend && "bg-muted/20")}
                >
                  <td className="sticky left-0 z-10 bg-inherit px-3 py-2 font-medium whitespace-nowrap">
                    <span className="text-muted-foreground/60">
                      {formatDayLabel(dateStr, WEEK_DAYS[dayIdx])}
                    </span>
                  </td>
                  <td className="px-2 py-1.5">
                    <ShiftCell date={dateStr} shiftDef={shiftByDate[dateStr] ?? null} shiftDefs={shiftDefs} onShiftChange={onShiftChange} />
                  </td>
                  {Array.from({ length: MAX_PAIRS_PER_ROW }, (_, i) => (
                    <React.Fragment key={i}>
                      <ClockingCell
                        clocking={null}
                        expectedType="IN"
                        date={dateStr}
                        workPeriodId={null}
                        onCellClick={onCellClick}
                        className="border-l border-border/50"
                        roundingConfig={roundingConfig}
                      />
                      <ClockingCell
                        clocking={null}
                        expectedType="OUT"
                        date={dateStr}
                        workPeriodId={null}
                        onCellClick={onCellClick}
                        roundingConfig={roundingConfig}
                      />
                    </React.Fragment>
                  ))}
                  {rates.length > 0 ? rates.map((rate) => (
                    <td key={rate.id} className="border-l border-border/50" />
                  )) : (
                    <td className="border-l border-border/50" />
                  )}
                  <td />
                </tr>
              );
            }

            return periods.flatMap((period, periodIdx) => {
              const pairs        = computePairs(period.clockings);
              const grossHours   = computeGrossHours(pairs, roundingConfig);
              const ccClockings  = period.clockings.filter((c) => effectiveType(c) === "CC");
              const chunks       = chunkPairs(pairs);
              const shiftDefId   = period.scheduledShift?.shiftDefinitionId ?? "";
              const bands        = shiftBands[shiftDefId] ?? [];
              const hasBands     = bands.length > 0;
              const brules       = shiftBreakRules[shiftDefId] ?? [];
              const rateSplit    = applyBreakRules(
                period.clockings,
                splitHoursByBands(pairs, bands, roundingConfig),
                brules,
              );

              return chunks.map((chunk, chunkIdx) => {
                const isFirstOfDay    = periodIdx === 0 && chunkIdx === 0;
                const isFirstOfPeriod = chunkIdx === 0;

                return (
                  <tr
                    key={`${period.id}-${chunkIdx}`}
                    className={cn(
                      "border-b border-border/50",
                      isWeekend && "bg-muted/20",
                      period.hasConflicts && "bg-amber-50/50 dark:bg-amber-950/20",
                      !isFirstOfDay && "border-t-0"
                    )}
                  >
                    {/* Date cell */}
                    <td className="sticky left-0 z-10 bg-inherit px-3 py-2 font-medium whitespace-nowrap align-top">
                      {isFirstOfDay ? (
                        <span className={cn(isWeekend && "text-muted-foreground")}>
                          {formatDayLabel(dateStr, WEEK_DAYS[dayIdx])}
                        </span>
                      ) : isFirstOfPeriod ? (
                        <span className="text-muted-foreground/40 text-xs pl-2">↳</span>
                      ) : (
                        <span className="text-muted-foreground/30 text-xs pl-4">·</span>
                      )}
                    </td>

                    {/* Shift cell — shown once per period (first row only) */}
                    <td className="px-2 py-1.5 align-top">
                      {isFirstOfPeriod ? (
                        <ShiftCell
                          date={dateStr}
                          shiftDef={period.scheduledShift}
                          shiftDefs={shiftDefs}
                          onShiftChange={onShiftChange}
                        />
                      ) : null}
                    </td>

                    {/* Clocking pair cells */}
                    {Array.from({ length: MAX_PAIRS_PER_ROW }, (_, pairIdx) => {
                      const pair = chunk[pairIdx] ?? { in: null, out: null };
                      return (
                        <React.Fragment key={pairIdx}>
                          <ClockingCell
                            clocking={pair.in}
                            expectedType="IN"
                            date={dateStr}
                            workPeriodId={period.id}
                            onCellClick={onCellClick}
                            className="border-l border-border/50"
                            roundingConfig={roundingConfig}
                          />
                          <ClockingCell
                            clocking={pair.out}
                            expectedType="OUT"
                            date={dateStr}
                            workPeriodId={period.id}
                            onCellClick={onCellClick}
                            roundingConfig={roundingConfig}
                          />
                        </React.Fragment>
                      );
                    })}

                    {/* Hours per rate — shown on first row of each period */}
                    {rates.length > 0 ? rates.map((rate, rateIdx) => {
                      // No bands: show gross hours in first column as fallback
                      const hrs = hasBands
                        ? (rateSplit[rate.id] ?? 0)
                        : (rateIdx === 0 ? grossHours : 0);
                      return (
                        <td key={rate.id} className="px-3 py-2 text-right font-medium tabular-nums border-l border-border/50 whitespace-nowrap align-top">
                          {isFirstOfPeriod ? (
                            <>
                              {fmtHours(hrs)}
                              {rateIdx === 0 && ccClockings.length > 0 && (
                                <span className="ml-1 text-[10px] text-blue-500" title={`${ccClockings.length} CC clocking(s)`}>
                                  CC
                                </span>
                              )}
                            </>
                          ) : null}
                        </td>
                      );
                    }) : (
                      <td className="px-3 py-2 text-right font-medium tabular-nums border-l border-border/50 whitespace-nowrap align-top">
                        {isFirstOfPeriod ? (
                          <>
                            {fmtHours(grossHours)}
                            {ccClockings.length > 0 && (
                              <span className="ml-1 text-[10px] text-blue-500" title={`${ccClockings.length} CC clocking(s)`}>
                                CC
                              </span>
                            )}
                          </>
                        ) : null}
                      </td>
                    )}

                    {/* Conflict indicator — shown on first row of each period */}
                    <td className="px-1 py-2 text-center align-top">
                      {isFirstOfPeriod && period.hasConflicts && (
                        <span title="This period has ambiguous or conflicting clockings">
                          <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                        </span>
                      )}
                    </td>
                  </tr>
                );
              });
            });
          })}
        </tbody>

        <tfoot>
          <tr className="border-t-2 border-border bg-muted/40 font-semibold">
            <td className="sticky left-0 z-10 bg-muted/40 px-3 py-2 text-xs uppercase tracking-wide">
              Week Total
            </td>
            <td />
            {Array.from({ length: MAX_PAIRS_PER_ROW * 2 }, (_, i) => (
              <td key={i} className={cn("px-2 py-2", i % 2 === 0 && "border-l border-border/50")} />
            ))}
            {rates.length > 0 ? rates.map((rate, rateIdx) => {
              // No-bands periods contribute to the first column as a fallback
              const hrs = (rateTotals[rate.id] ?? 0) +
                (rateIdx === 0 ? noBandsTotalHours : 0);
              return (
                <td key={rate.id} className="px-3 py-2 text-right tabular-nums border-l border-border/50">
                  {fmtHours(hrs)}
                </td>
              );
            }) : (
              <td className="px-3 py-2 text-right tabular-nums border-l border-border/50">
                {fmtHours(totalHours)}
              </td>
            )}
            <td />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
