"use client";

import { Checkbox } from "@/components/ui/checkbox";

/**
 * Right-rail filter panel for the planner calendar — absence-type checkboxes
 * with an "All" tri-state toggle, plus Schedule overlay and Bank Holidays
 * toggles. Sized at `w-40` to mirror the legend on the left.
 */

export type AbsenceTypeOption = {
  id: string;
  name: string;
  colour: string;
};

export function CalendarFilterPanel({
  absenceTypes,
  hiddenTypeIds,
  onToggleType,
  onToggleAll,
  showSchedule,
  onToggleSchedule,
  showBankHolidays,
  onToggleBankHolidays,
  bankHolidayColour,
}: {
  absenceTypes: AbsenceTypeOption[];
  hiddenTypeIds: Set<string>;
  onToggleType: (id: string) => void;
  onToggleAll: () => void;
  showSchedule: boolean;
  onToggleSchedule: () => void;
  showBankHolidays: boolean;
  onToggleBankHolidays: () => void;
  bankHolidayColour: string;
}) {
  // Derived "All" state: true when nothing is hidden, false when everything is
  // hidden, "indeterminate" when only some are hidden.
  const totalTypes = absenceTypes.length;
  const hiddenCount = hiddenTypeIds.size;
  const allChecked: boolean | "indeterminate" =
    totalTypes === 0
      ? false
      : hiddenCount === 0
      ? true
      : hiddenCount === totalTypes
      ? false
      : "indeterminate";

  return (
    <div className="w-40 shrink-0">
      <p className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Filters
      </p>

      {totalTypes > 0 && (
        <label className="mb-1.5 flex cursor-pointer items-center gap-2 px-1 text-sm font-medium">
          <Checkbox checked={allChecked} onCheckedChange={onToggleAll} />
          <span>All</span>
        </label>
      )}

      <div className="flex flex-col gap-1.5 px-1">
        {absenceTypes.map((t) => {
          const checked = !hiddenTypeIds.has(t.id);
          return (
            <label
              key={t.id}
              className="flex cursor-pointer items-center gap-2 text-sm"
            >
              <Checkbox checked={checked} onCheckedChange={() => onToggleType(t.id)} />
              <span
                aria-hidden
                className="inline-block h-3 w-3 shrink-0 rounded-sm border border-border"
                style={{ backgroundColor: t.colour }}
              />
              <span className="truncate">{t.name}</span>
            </label>
          );
        })}
      </div>

      <div className="mt-3 flex flex-col gap-1.5 border-t border-gray-200 pt-3">
        <label className="flex cursor-pointer items-center gap-2 px-1 text-sm">
          <Checkbox checked={showSchedule} onCheckedChange={onToggleSchedule} />
          <span
            aria-hidden
            className="inline-block h-3 w-3 shrink-0 rounded-sm border border-border"
            style={{ backgroundColor: "#e0f2fe" }}
          />
          <span>Schedule</span>
        </label>
        <label className="flex cursor-pointer items-center gap-2 px-1 text-sm">
          <Checkbox checked={showBankHolidays} onCheckedChange={onToggleBankHolidays} />
          <span
            aria-hidden
            className="inline-block h-3 w-3 shrink-0 rounded-sm border border-border"
            style={{ backgroundColor: bankHolidayColour }}
          />
          <span>Bank Holidays</span>
        </label>
      </div>
    </div>
  );
}
