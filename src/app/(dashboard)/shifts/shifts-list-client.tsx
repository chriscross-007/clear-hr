"use client";

import Link from "next/link";
import { Moon, Clock } from "lucide-react";
import { cn } from "@/lib/utils";

interface ShiftDef {
  id: string;
  name: string;
  is_open_shift: boolean;
  planned_start: string | null;
  planned_end: string | null;
  crosses_midnight: boolean;
  break_type: string;
  active: boolean;
}

function fmtShiftTime(t: string | null): string {
  if (!t) return "—";
  return t.slice(0, 5); // "HH:MM" from "HH:MM:SS"
}

const BREAK_TYPE_LABELS: Record<string, string> = {
  none:         "No breaks",
  clocked:      "Clocked breaks",
  auto_deduct:  "Auto-deduct",
};

export function ShiftsListClient({ shiftDefs }: { shiftDefs: ShiftDef[] }) {
  if (shiftDefs.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border p-12 text-center">
        <p className="text-muted-foreground text-sm">No shift definitions yet.</p>
        <p className="text-muted-foreground text-xs mt-1">Create a shift to get started.</p>
      </div>
    );
  }

  return (
    <div className="flex justify-center w-full">
      <div className="w-auto max-w-[90%] min-w-0">
        <div className="rounded-md border border-border divide-y divide-border">
          {shiftDefs.map((s) => (
        <Link
          key={s.id}
          href={`/shifts/${s.id}`}
          className="flex items-center gap-4 px-4 py-3 hover:bg-accent/50 transition-colors"
        >
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className={cn("font-medium text-sm", !s.active && "text-muted-foreground")}>
                {s.name}
              </span>
              {!s.active && (
                <span className="text-xs bg-muted text-muted-foreground px-1.5 py-0.5 rounded">
                  Inactive
                </span>
              )}
              {s.crosses_midnight && (
                <span title="Crosses midnight">
                  <Moon className="h-3 w-3 text-indigo-500" />
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              {s.is_open_shift
                ? "Open shift"
                : `${fmtShiftTime(s.planned_start)} – ${fmtShiftTime(s.planned_end)}`}
              {" · "}
              {BREAK_TYPE_LABELS[s.break_type] ?? s.break_type}
            </p>
          </div>
          <Clock className="h-4 w-4 text-muted-foreground shrink-0" />
        </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
