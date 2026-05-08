// Profileless Holiday Management — pure computation helpers (CLE-170, CLE-173).
//
// This module is intentionally a plain TypeScript file (no "use server"
// directive) because Next.js requires every export of a "use server" file
// to be an async function. The HolidayPeriod data shape is shared with
// holiday-period-actions.ts (re-exported here for convenience).
//
// Spec: Profileless Holiday Management — settled spec
// https://linear.app/clearhr/document/profileless-holiday-management-settled-spec-bae7e878e485

import type { HolidayPeriod } from "./holiday-period-actions";
import {
  patternForDate,
  type WorkPatternHours,
  type WorkPatternAssignment,
} from "@/lib/day-counting";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Computed-on-the-fly fields for a Holiday Period. */
export type ComputedPeriodValues = {
  broughtForward: number;
  worked: number;          // stubbed to 0; timesheet integration is a follow-up
  toil: number;            // stubbed to 0; timesheet integration is a follow-up
  allowance: number;       // for Earned: worked × earnedFactor; for Fixed: the stored value
  taken: number;
  booked: number;
  balance: number;
  carryForward: number;
};

/** A booking row shape consumed by the computation helpers. */
export type ComputeBookingInput = {
  startDate: string;       // YYYY-MM-DD
  endDate: string | null;  // YYYY-MM-DD; open-ended sick bookings can be null
  startHalf: string | null; // 'AM' | 'PM' | null
  endHalf: string | null;   // 'AM' | 'PM' | null
  status: string;          // 'pending' | 'approved' (others are ignored)
};

/** Context bundle for splitting bookings across periods (CLE-173). */
export type ComputeContext = {
  /**
   * Full Work Profile history for the employee. The compute helper picks
   * the pattern that applies on each calendar day via `patternForDate`,
   * so a future-dated assignment correctly governs bookings on or after
   * its `effectiveFrom`.
   */
  workPatternHistory: WorkPatternAssignment[];
  bankHolidays: Set<string>;
  /** 'additional' = bank holidays are free; 'deducted' = count as normal. */
  bankHolidayHandling: string;
  /**
   * Pre-fetched total worked hours per Earned-type Holiday Period (CLE-175).
   * Looked up by `period.id`. Missing entries default to 0. Fixed-type
   * periods don't need an entry — they ignore worked hours. The caller
   * (page.tsx / setHolidayPeriodLock) sources values from
   * `getMemberWorkedHoursInRange`.
   */
  workedHoursByPeriodId?: Map<string, number>;
};

// ---------------------------------------------------------------------------
// Day-by-day attribution (CLE-173)
// ---------------------------------------------------------------------------

const DAY_HOUR_KEYS = [
  "hours_monday",
  "hours_tuesday",
  "hours_wednesday",
  "hours_thursday",
  "hours_friday",
  "hours_saturday",
  "hours_sunday",
] as const;

/** Mon–Fri 8h fallback when no Work Profile is configured. */
const DEFAULT_PATTERN: WorkPatternHours = {
  hours_monday: 8,
  hours_tuesday: 8,
  hours_wednesday: 8,
  hours_thursday: 8,
  hours_friday: 8,
  hours_saturday: 0,
  hours_sunday: 0,
};

/** Average hours per working day for a Work Profile (e.g. Mon–Fri 8h → 8). */
function avgHoursPerWorkingDay(pattern: WorkPatternHours): number {
  const hours = DAY_HOUR_KEYS.map((k) => Number(pattern[k]) || 0);
  const workingDays = hours.filter((h) => h > 0).length;
  if (workingDays === 0) return 8; // fallback when no working days are defined
  const total = hours.reduce((a, b) => a + b, 0);
  return total / workingDays;
}

/** Hours scheduled for a given ISO date, per the Work Profile that applies on that date. 0 = non-working day. */
function hoursForDate(iso: string, history: WorkPatternAssignment[]): number {
  const p = patternForDate(history, iso) ?? DEFAULT_PATTERN;
  const jsDay = new Date(iso + "T00:00:00Z").getUTCDay(); // 0=Sun..6=Sat
  // Weekends never count regardless of the pattern (matches countWorkingDays).
  if (jsDay === 0 || jsDay === 6) return 0;
  const idx = jsDay - 1; // 0=Mon..4=Fri
  return Number(p[DAY_HOUR_KEYS[idx]]) || 0;
}

/** Find the period that covers a given date, or null. */
function periodForDate(
  iso: string,
  sortedPeriods: HolidayPeriod[],
): HolidayPeriod | null {
  for (const p of sortedPeriods) {
    if (iso >= p.startDate && iso <= p.endDate) return p;
  }
  return null;
}

/**
 * Walk one booking day-by-day, attributing each working day to whichever
 * Holiday Period covers it. Non-working days, weekends, and 'additional'
 * bank holidays contribute zero. The booking's stored `daysDeducted` /
 * `hoursDeducted` are intentionally ignored — the per-period split is
 * derived from the work pattern so straddling bookings deduct correctly
 * from each side in each side's units.
 *
 * Days on or before `todayISO` count as Taken; later days count as Booked.
 */
function attributeBookingToPeriods(
  booking: ComputeBookingInput,
  sortedPeriods: HolidayPeriod[],
  ctx: ComputeContext,
  todayISO: string,
  out: Map<string, { taken: number; booked: number }>,
): void {
  if (!booking.endDate) return;
  if (booking.status !== "approved" && booking.status !== "pending") return;
  if (booking.endDate < booking.startDate) return;

  const sameDay = booking.startDate === booking.endDate;
  const startMs = new Date(booking.startDate + "T00:00:00Z").getTime();
  const endMs = new Date(booking.endDate + "T00:00:00Z").getTime();
  const lastIdx = Math.round((endMs - startMs) / 86_400_000);

  const cursor = new Date(booking.startDate + "T00:00:00Z");
  let dayIdx = 0;

  while (cursor.getTime() <= endMs) {
    const iso = cursor.toISOString().slice(0, 10);
    const hoursToday = hoursForDate(iso, ctx.workPatternHistory);
    const isWorkingDay = hoursToday > 0;

    // Bank-holiday handling: 'additional' skips them as free days.
    const isFreeBankHol =
      isWorkingDay
      && ctx.bankHolidays.has(iso)
      && ctx.bankHolidayHandling === "additional";

    if (isWorkingDay && !isFreeBankHol) {
      // Half-day rule (matches countWorkingDays in lib/day-counting.ts).
      let fraction = 1;
      if (sameDay && booking.startHalf) {
        fraction = 0.5;
      } else {
        if (dayIdx === 0 && booking.startHalf) fraction = 0.5;
        if (dayIdx === lastIdx && booking.endHalf) fraction = 0.5;
      }

      const period = periodForDate(iso, sortedPeriods);
      if (period) {
        // days-mode period contributes a fractional day; hours-mode period
        // contributes the day's scheduled hours × fraction.
        const contribution =
          period.units === "hours" ? hoursToday * fraction : 1 * fraction;

        const slot = out.get(period.id) ?? { taken: 0, booked: 0 };
        if (iso <= todayISO) {
          slot.taken += contribution;
        } else {
          slot.booked += contribution;
        }
        out.set(period.id, slot);
      }
    }

    cursor.setUTCDate(cursor.getUTCDate() + 1);
    dayIdx++;
  }
}

/**
 * Working-day deduction for a single booking within a single period range,
 * expressed in the period's units. Mirrors `attributeBookingToPeriods` but
 * scoped to one period and without the today-split — callers categorise by
 * status (pending / approved past / approved future) themselves.
 *
 * Used by the planner dashboard widget so the holiday stats reflect only
 * the in-period portion of a booking that crosses a period boundary, and
 * use the per-date Work Profile rather than today's pattern.
 */
export function bookingWorkingDaysInPeriod(
  booking: ComputeBookingInput,
  periodStart: string,
  periodEnd: string,
  periodUnits: "days" | "hours",
  ctx: ComputeContext,
): number {
  if (!booking.endDate) return 0;
  if (booking.endDate < booking.startDate) return 0;
  if (booking.endDate < periodStart) return 0;
  if (booking.startDate > periodEnd) return 0;

  const sameDay = booking.startDate === booking.endDate;
  const startMs = new Date(booking.startDate + "T00:00:00Z").getTime();
  const endMs = new Date(booking.endDate + "T00:00:00Z").getTime();
  const lastIdx = Math.round((endMs - startMs) / 86_400_000);

  const cursor = new Date(booking.startDate + "T00:00:00Z");
  let dayIdx = 0;
  let total = 0;

  while (cursor.getTime() <= endMs) {
    const iso = cursor.toISOString().slice(0, 10);
    if (iso >= periodStart && iso <= periodEnd) {
      const hoursToday = hoursForDate(iso, ctx.workPatternHistory);
      const isWorkingDay = hoursToday > 0;
      const isFreeBankHol =
        isWorkingDay
        && ctx.bankHolidays.has(iso)
        && ctx.bankHolidayHandling === "additional";
      if (isWorkingDay && !isFreeBankHol) {
        let fraction = 1;
        if (sameDay && booking.startHalf) {
          fraction = 0.5;
        } else {
          if (dayIdx === 0 && booking.startHalf) fraction = 0.5;
          if (dayIdx === lastIdx && booking.endHalf) fraction = 0.5;
        }
        total += periodUnits === "hours" ? hoursToday * fraction : 1 * fraction;
      }
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    dayIdx++;
  }

  return total;
}

// ---------------------------------------------------------------------------
// Period chain
// ---------------------------------------------------------------------------

/**
 * Compute every period's derived values in one pass. Periods are processed
 * in chronological order so each period's `broughtForward` is the previous
 * period's `carryForward`.
 *
 * Lock semantics (CLE-172): when a period has a `lockedSnapshot` (taken at
 * the moment of locking), the snapshot is emitted directly for that period
 * and `snapshot.carryForward` becomes the next period's broughtForward.
 * Earlier manual edits do not propagate through a locked period in either
 * direction. Legacy locked rows without a snapshot fall back to live compute.
 *
 * Booking attribution (CLE-173): bookings are walked day-by-day. Each
 * working day is attributed to whichever period covers it, in that period's
 * own units (days vs hours). Straddling bookings are split correctly.
 *
 * `worked` and `toil` are stubbed to 0; the timesheet integration is a
 * separate follow-up.
 */
export function computeAllHolidayPeriodValues(
  periods: HolidayPeriod[],
  bookings: ComputeBookingInput[],
  ctx: ComputeContext,
  todayISO: string,
): Map<string, ComputedPeriodValues> {
  const sorted = [...periods].sort((a, b) => a.startDate.localeCompare(b.startDate));

  // Pre-compute Taken / Booked per period from the day-by-day attribution.
  const splitByPeriod = new Map<string, { taken: number; booked: number }>();
  for (const b of bookings) {
    attributeBookingToPeriods(b, sorted, ctx, todayISO, splitByPeriod);
  }

  const out = new Map<string, ComputedPeriodValues>();
  let runningBroughtForward = 0;

  for (const p of sorted) {
    // Locked period with a snapshot → emit snapshot, advance the chain
    // using snapshot.carryForward, and do NOT recompute live.
    if (p.locked && p.lockedSnapshot) {
      out.set(p.id, {
        broughtForward: p.lockedSnapshot.broughtForward,
        worked: p.lockedSnapshot.worked,
        toil: p.lockedSnapshot.toil,
        allowance: p.lockedSnapshot.allowance,
        taken: p.lockedSnapshot.taken,
        booked: p.lockedSnapshot.booked,
        balance: p.lockedSnapshot.balance,
        carryForward: p.lockedSnapshot.carryForward,
      });
      runningBroughtForward = p.lockedSnapshot.carryForward;
      continue;
    }

    // CLE-175 — Earned periods derive allowance from actual worked hours.
    // For days-mode earned periods we convert worked hours to days using the
    // average hours-per-working-day from the Work Profile that applies on
    // the period's startDate. Falls back to 8h/day when no profile resolves.
    const workedHours = ctx.workedHoursByPeriodId?.get(p.id) ?? 0;
    const toil = 0;
    let worked = 0;
    let allowance = 0;
    if (p.type === "earned") {
      const periodStartPattern = patternForDate(ctx.workPatternHistory, p.startDate);
      const hoursPerWorkingDay = periodStartPattern
        ? avgHoursPerWorkingDay(periodStartPattern)
        : 8;
      // For hours-mode periods, `worked` is hours; for days-mode periods,
      // `worked` is days (= hours / hoursPerWorkingDay) so the column reads
      // in the same units as the rest of the row.
      worked = p.units === "hours" ? workedHours : workedHours / hoursPerWorkingDay;
      const earnedFraction = p.earnedFactor / 100;
      allowance = worked * earnedFraction;
    } else {
      allowance = p.allowance ?? 0;
    }

    const split = splitByPeriod.get(p.id) ?? { taken: 0, booked: 0 };
    const taken = split.taken;
    const booked = split.booked;

    const balance = runningBroughtForward + allowance + p.adjust + toil - taken - booked;
    const carryForward = balance >= 0
      ? Math.min(balance, p.maxCarryForward)
      : Math.max(balance, p.minCarryForward);

    out.set(p.id, {
      broughtForward: runningBroughtForward,
      worked,
      toil,
      allowance,
      taken,
      booked,
      balance,
      carryForward,
    });

    runningBroughtForward = carryForward;
  }

  return out;
}

// ---------------------------------------------------------------------------
// Display formatting
// ---------------------------------------------------------------------------

/**
 * Format a computed value per the spec: integer when whole, 1dp when
 * exactly half, 2dp (rounded) otherwise.
 */
export function formatHolidayValue(n: number): string {
  if (!isFinite(n)) return "—";
  if (Number.isInteger(n)) return String(n);
  if (Math.abs((n * 2) - Math.round(n * 2)) < 1e-9) return n.toFixed(1);
  return n.toFixed(2);
}
