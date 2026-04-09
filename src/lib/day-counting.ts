/**
 * Day counting utility for holiday bookings (CLE-31).
 *
 * Centralised logic used by both:
 * - The live balance indicator in the booking sheet (client-side, via countWorkingDaysSimple)
 * - The server action that saves the booking (server-side, via countWorkingDays)
 *
 * Rules:
 * 1. Only days in the employee's active work pattern are counted (hours > 0 = working day).
 * 2. Weekends (Sat/Sun) never count, regardless of work pattern hours.
 * 3. A half day (AM or PM) on a working day counts as 0.5.
 * 4. A half day on a non-working day or weekend counts as 0.
 * 5. Bank holiday logic is deferred — see TODO below.
 */

export type WorkPatternHours = {
  hours_monday: number;
  hours_tuesday: number;
  hours_wednesday: number;
  hours_thursday: number;
  hours_friday: number;
  hours_saturday: number;
  hours_sunday: number;
};

/** Default Mon–Fri 8h pattern used as final fallback */
const DEFAULT_PATTERN: WorkPatternHours = {
  hours_monday: 8,
  hours_tuesday: 8,
  hours_wednesday: 8,
  hours_thursday: 8,
  hours_friday: 8,
  hours_saturday: 0,
  hours_sunday: 0,
};

/** Map from 0=Monday...6=Sunday to the corresponding hours key */
const DAY_KEYS: (keyof WorkPatternHours)[] = [
  "hours_monday",
  "hours_tuesday",
  "hours_wednesday",
  "hours_thursday",
  "hours_friday",
  "hours_saturday",
  "hours_sunday",
];

/**
 * Count working days between two dates (inclusive) based on a work pattern.
 *
 * @param startDate  ISO date string "YYYY-MM-DD"
 * @param endDate    ISO date string "YYYY-MM-DD"
 * @param startHalf  true if only half the first day should be deducted
 * @param endHalf    true if only half the last day should be deducted
 * @param pattern    Work pattern hours per day (null = use default Mon–Fri 8h)
 * @param bankHolidays  Set of ISO date strings that are bank holidays (currently unused — see TODO)
 * @param bankHolidayHandling  'additional' = skip bank hols, 'deducted' = count them (currently unused)
 * @returns Number of days to deduct
 */
export function countWorkingDays(
  startDate: string,
  endDate: string,
  startHalf: boolean,
  endHalf: boolean,
  pattern: WorkPatternHours | null,
  bankHolidays: Set<string>,
  bankHolidayHandling: string
): number {
  const p = pattern ?? DEFAULT_PATTERN;
  const s = new Date(startDate + "T00:00:00Z");
  const e = new Date(endDate + "T00:00:00Z");
  const sameDay = startDate === endDate;

  let total = 0;
  const d = new Date(s);
  let dayIndex = 0;
  const lastDay = Math.round((e.getTime() - s.getTime()) / (1000 * 60 * 60 * 24));

  while (d <= e) {
    // JS getUTCDay: 0=Sun, 1=Mon, ...6=Sat
    const jsDay = d.getUTCDay();

    // Rule 2: Weekends (Sat=6, Sun=0) never count regardless of work pattern
    const isWeekend = jsDay === 0 || jsDay === 6;

    // Convert JS day to our index: 0=Mon...6=Sun
    const patternIdx = jsDay === 0 ? 6 : jsDay - 1;
    const hoursForDay = Number(p[DAY_KEYS[patternIdx]]);

    // Rule 1: Day must be a weekday AND have hours > 0 in the work pattern
    const isWorkingDay = !isWeekend && hoursForDay > 0;

    // TODO (CLE - Bank Holidays): When bank holiday admin UI is built,
    // uncomment and implement the following logic:
    //
    // const dateStr = d.toISOString().slice(0, 10);
    // const isBankHoliday = bankHolidays.has(dateStr);
    // if (isWorkingDay && isBankHoliday && bankHolidayHandling === "additional") {
    //   // Don't deduct — bank holiday is additional to allowance
    //   d.setUTCDate(d.getUTCDate() + 1);
    //   dayIndex++;
    //   continue;
    // }

    if (isWorkingDay) {
      let dayValue = 1;

      // Rule 3: Half-day adjustments (0.5 instead of 1)
      if (sameDay && startHalf) {
        dayValue = 0.5;
      } else {
        if (dayIndex === 0 && startHalf) dayValue = 0.5;
        if (dayIndex === lastDay && endHalf) dayValue = 0.5;
      }

      total += dayValue;
    }
    // Rule 4: Non-working days and weekends contribute 0 (implicit — no else branch)

    d.setUTCDate(d.getUTCDate() + 1);
    dayIndex++;
  }

  // Suppress unused parameter warnings until bank holiday logic is enabled
  void bankHolidays;
  void bankHolidayHandling;

  return total;
}

/**
 * Client-side helper for the live balance indicator in booking sheets.
 * Same logic as countWorkingDays but without bank holiday data (not available client-side).
 */
export function countWorkingDaysSimple(
  startDate: string,
  endDate: string,
  startHalf: boolean,
  endHalf: boolean,
  pattern: WorkPatternHours | null
): number {
  return countWorkingDays(
    startDate,
    endDate,
    startHalf,
    endHalf,
    pattern,
    new Set(),
    "deducted"
  );
}

export { DEFAULT_PATTERN };
