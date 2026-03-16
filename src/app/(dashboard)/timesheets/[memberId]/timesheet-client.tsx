"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, ChevronRight, RefreshCw, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TimesheetGrid } from "@/components/timesheet/timesheet-grid";
import { ClockingEditDialog } from "@/components/timesheet/clocking-edit-dialog";
import { triggerInference, setDayShift } from "@/app/(dashboard)/timesheets/actions";
import type { CellClickContext, WorkPeriodData, RoundingConfig, OvertimeBandDef, BreakRuleDef } from "@/components/timesheet/timesheet-types";
import { ClockingsDebug, type DebugClocking } from "./clockings-debug";

interface TimesheetClientProps {
  memberId: string;
  memberName: string;
  weekStart: string;  // "YYYY-MM-DD"
  weekEnd:   string;
  workPeriods: WorkPeriodData[];
  callerRole: string;
  shiftDefs: { id: string; name: string }[];
  shiftByDate: Record<string, { shiftDefinitionId: string | null; name: string | null; isOffDay: boolean }>;
  shiftBands: Record<string, OvertimeBandDef[]>;
  shiftBreakRules: Record<string, BreakRuleDef[]>;
  debugClockings: DebugClocking[];
  roundingConfig: RoundingConfig;
  rates: { id: string; name: string; rate_multiplier: number }[];
}

function offsetWeek(dateStr: string, offsetWeeks: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offsetWeeks * 7);
  return d.toISOString().slice(0, 10);
}

function formatWeekLabel(start: string, end: string): string {
  const s = new Date(`${start}T00:00:00Z`);
  const e = new Date(`${end}T00:00:00Z`);
  const opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", timeZone: "UTC" };
  return `${s.toLocaleDateString("en-GB", opts)} – ${e.toLocaleDateString("en-GB", { ...opts, year: "numeric" })}`;
}

export function TimesheetClient({
  memberId,
  memberName,
  weekStart,
  weekEnd,
  workPeriods,
  callerRole,
  shiftDefs,
  shiftByDate,
  shiftBands,
  shiftBreakRules,
  debugClockings,
  roundingConfig,
  rates,
}: TimesheetClientProps) {
  const router = useRouter();
  const [selectedCell, setSelectedCell] = useState<CellClickContext | null>(null);
  const [isReinferring, startReinference] = useTransition();
  const [reinferResult, setReinferResult] = useState<{ msg: string; ok: boolean } | null>(null);

  const canEdit = callerRole === "owner" || callerRole === "admin";

  async function handleShiftChange(date: string, shiftDefinitionId: string | null) {
    const result = await setDayShift(memberId, date, shiftDefinitionId);
    if (result.success) {
      router.refresh();
    }
  }

  const prevWeek = offsetWeek(weekStart, -1);
  const nextWeek = offsetWeek(weekStart, 1);

  async function runRecalculate() {
    const result = await triggerInference(memberId, weekStart, weekEnd);
    if (result.success) {
      setReinferResult({
        ok: true,
        msg: `Done — ${result.periodsCreated} created, ${result.periodsUpdated} updated${result.conflicts > 0 ? `, ${result.conflicts} conflict(s)` : ""}`,
      });
    } else {
      setReinferResult({ ok: false, msg: result.error ?? "Recalculation failed" });
    }
    router.refresh();
  }

  function handleRecalculate() {
    setReinferResult(null);
    startReinference(runRecalculate);
  }

  const totalConflicts = workPeriods.filter((p) => p.hasConflicts).length;

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      {/* Header */}
      <div className="mb-6">
        <p className="text-sm text-muted-foreground">Timesheet</p>
        <h1 className="text-2xl font-bold">{memberName}</h1>
      </div>

      {/* Week navigation */}
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" asChild>
            <Link href={`/timesheets/${memberId}?week=${prevWeek}`}>
              <ChevronLeft className="h-4 w-4" />
            </Link>
          </Button>
          <span className="text-sm font-medium min-w-48 text-center">
            {formatWeekLabel(weekStart, weekEnd)}
          </span>
          <Button variant="outline" size="icon" asChild>
            <Link href={`/timesheets/${memberId}?week=${nextWeek}`}>
              <ChevronRight className="h-4 w-4" />
            </Link>
          </Button>
        </div>

        <div className="flex items-center gap-3">
          {totalConflicts > 0 && (
            <span className="flex items-center gap-1.5 text-sm text-amber-600 dark:text-amber-400">
              <AlertTriangle className="h-4 w-4" />
              {totalConflicts} conflict{totalConflicts > 1 ? "s" : ""} need attention
            </span>
          )}
          {canEdit && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleRecalculate}
              disabled={isReinferring}
            >
              <RefreshCw className={`h-4 w-4 mr-1.5 ${isReinferring ? "animate-spin" : ""}`} />
              Recalculate Timesheet
            </Button>
          )}
        </div>
      </div>

      {reinferResult && (
        <p className={`mb-3 text-sm ${reinferResult.ok ? "text-muted-foreground" : "text-destructive font-medium"}`}>
          {reinferResult.msg}
        </p>
      )}

      {/* Grid */}
      <TimesheetGrid
        weekStart={weekStart}
        workPeriods={workPeriods}
        shiftByDate={shiftByDate}
        shiftBands={shiftBands}
        shiftBreakRules={shiftBreakRules}
        onCellClick={canEdit ? setSelectedCell : undefined}
        shiftDefs={shiftDefs}
        onShiftChange={canEdit ? handleShiftChange : undefined}
        roundingConfig={roundingConfig}
        rates={rates}
      />

      {/* Debug: clockings CRUD */}
      <ClockingsDebug
        memberId={memberId}
        weekStart={weekStart}
        clockings={debugClockings}
        onRefresh={() => startReinference(runRecalculate)}
      />

      {/* Edit dialog */}
      {selectedCell && (
        <ClockingEditDialog
          ctx={selectedCell}
          memberId={memberId}
          onClose={() => setSelectedCell(null)}
          onSuccess={() => { setSelectedCell(null); startReinference(runRecalculate); }}
        />
      )}
    </div>
  );
}
