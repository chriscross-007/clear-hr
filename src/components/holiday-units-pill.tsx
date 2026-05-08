/**
 * A small coloured pill that visually distinguishes a Holiday Period's units
 * (CLE-174 follow-up). Days and Hours periods are arithmetically very
 * different — same column of numbers can mean entirely different things —
 * so this pill is shown anywhere a period's units are user-facing: the
 * Units cell on the Holiday Periods table, the period nav header on the
 * planner, etc.
 *
 *   - Days  → sky blue.
 *   - Hours → amber.
 */

import { cn } from "@/lib/utils";

type Units = "days" | "hours";

const STYLES: Record<Units, string> = {
  days: "bg-sky-100 text-sky-900 border-sky-200 dark:bg-sky-900/30 dark:text-sky-200 dark:border-sky-900/50",
  hours: "bg-amber-100 text-amber-900 border-amber-200 dark:bg-amber-900/30 dark:text-amber-200 dark:border-amber-900/50",
};

const LABELS: Record<Units, string> = {
  days: "Days",
  hours: "Hours",
};

export function HolidayUnitsPill({
  units,
  className,
}: {
  units: Units;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium",
        STYLES[units],
        className,
      )}
    >
      {LABELS[units]}
    </span>
  );
}
