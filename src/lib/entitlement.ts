/**
 * Entitlement calculation logic (CLE-29).
 *
 * Centralised balance formula:
 *   effective_entitlement = pro_rata_amount + adjustment + carried_over
 *   used = sum(days_deducted) WHERE status IN ('approved', 'pending')
 *   remaining = effective_entitlement - used
 *
 * Pro-rata applies when the employee started mid-year:
 *   pro_rata_amount = base_amount * (months_remaining / 12)
 *   Rounded down to nearest 0.5
 *
 * Accrual is informational only (does not cap bookings):
 *   monthly_accrual = base_amount / 12
 *   accrued_to_date = monthly_accrual * months_elapsed
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type HolidayYearRecordInput = {
  year_start: string;
  year_end: string;
  base_amount: number;
  pro_rata_amount: number | null;
  adjustment: number;
  carried_over: number;
};

export type BookingUsage = {
  days_deducted: number | null;
  hours_deducted: number | null;
  status: string;
  end_date: string;
};

export type EntitlementResult = {
  /** base_amount from the profile (full annual entitlement) */
  base_amount: number;
  /** Pro-rated amount (= base_amount if full year, < base if mid-year starter) */
  pro_rata_amount: number;
  /** effective_entitlement = pro_rata_amount + adjustment + carried_over */
  effective_entitlement: number;
  /** Sum of deductions for pending bookings */
  pending: number;
  /** Sum of deductions for approved bookings where end_date < today */
  taken: number;
  /** Sum of deductions for approved bookings where end_date >= today */
  booked: number;
  /** effective_entitlement - pending - booked - taken */
  remaining: number;
  /** Accrual: monthly_accrual * months_elapsed (informational, fixed mode only) */
  accrued_to_date: number;
};

// ---------------------------------------------------------------------------
// Pro-rata calculation
// ---------------------------------------------------------------------------

/**
 * Calculate pro-rated entitlement for a mid-year starter.
 *
 * @param baseAmount  Full annual entitlement from the profile
 * @param startDate   Employee's start date (or year_start if started before)
 * @param yearStart   Holiday year start date
 * @param yearEnd     Holiday year end date
 * @returns Pro-rated amount, rounded down to nearest 0.5
 */
export function calculateProRata(
  baseAmount: number,
  startDate: string | null,
  yearStart: string,
  yearEnd: string
): number {
  // If no start date or started on/before year start, full entitlement
  if (!startDate || startDate <= yearStart) {
    return baseAmount;
  }

  // If started after year end, no entitlement
  if (startDate > yearEnd) {
    return 0;
  }

  // Count complete months from start_date to year_end (inclusive)
  const start = new Date(startDate + "T00:00:00Z");
  const end = new Date(yearEnd + "T00:00:00Z");

  // If started on or before the 1st of the month, include that month
  const startMonth = start.getUTCDate() <= 1
    ? start.getUTCMonth()
    : start.getUTCMonth() + 1;
  const startYear = start.getUTCFullYear() + (startMonth > 11 ? 1 : 0);
  const adjustedStartMonth = startMonth % 12;

  const endMonth = end.getUTCMonth();
  const endYear = end.getUTCFullYear();

  const monthsRemaining = (endYear - startYear) * 12 + (endMonth - adjustedStartMonth) + 1;

  if (monthsRemaining <= 0) return 0;
  if (monthsRemaining >= 12) return baseAmount;

  const raw = baseAmount * (monthsRemaining / 12);

  // Round down to nearest 0.5
  return Math.floor(raw * 2) / 2;
}

// ---------------------------------------------------------------------------
// Accrual calculation
// ---------------------------------------------------------------------------

/**
 * Calculate accrued entitlement to date (informational, for fixed mode).
 *
 * @param baseAmount   Full annual entitlement
 * @param yearStart    Holiday year start date
 * @param today        Current date ISO string
 * @returns Accrued amount to date
 */
export function calculateAccrual(
  baseAmount: number,
  yearStart: string,
  today: string
): number {
  const start = new Date(yearStart + "T00:00:00Z");
  const now = new Date(today + "T00:00:00Z");

  if (now < start) return 0;

  const monthsElapsed =
    (now.getUTCFullYear() - start.getUTCFullYear()) * 12 +
    (now.getUTCMonth() - start.getUTCMonth()) + 1;

  const capped = Math.min(monthsElapsed, 12);
  const monthlyAccrual = baseAmount / 12;

  return Math.round(monthlyAccrual * capped * 100) / 100;
}

// ---------------------------------------------------------------------------
// Full entitlement calculation
// ---------------------------------------------------------------------------

/**
 * Calculate the full entitlement breakdown for a holiday year record.
 *
 * @param record       The holiday_year_record data
 * @param bookings     All bookings for this member/year with status pending or approved
 * @param startDate    Employee's start_date from members table (nullable)
 * @param unit         'days' or 'hours' — determines which deduction field to sum
 * @param today        Current date ISO string (for accrual + taken/booked split)
 */
export function calculateEntitlement(
  record: HolidayYearRecordInput,
  bookings: BookingUsage[],
  startDate: string | null,
  unit: string,
  today: string
): EntitlementResult {
  const baseAmount = Number(record.base_amount);

  // Use stored pro_rata_amount if set, otherwise calculate
  const proRata = record.pro_rata_amount !== null
    ? Number(record.pro_rata_amount)
    : calculateProRata(baseAmount, startDate, record.year_start, record.year_end);

  const adjustment = Number(record.adjustment);
  const carriedOver = Number(record.carried_over);
  const effectiveEntitlement = proRata + adjustment + carriedOver;

  // Sum bookings by status
  let pending = 0;
  let booked = 0;
  let taken = 0;

  for (const b of bookings) {
    const val = unit === "hours"
      ? Number(b.hours_deducted ?? 0)
      : Number(b.days_deducted ?? 0);

    if (b.status === "pending") {
      pending += val;
    } else if (b.status === "approved" && b.end_date < today) {
      taken += val;
    } else {
      booked += val;
    }
  }

  const remaining = effectiveEntitlement - pending - booked - taken;
  const accruedToDate = calculateAccrual(baseAmount, record.year_start, today);

  return {
    base_amount: baseAmount,
    pro_rata_amount: proRata,
    effective_entitlement: effectiveEntitlement,
    pending,
    taken,
    booked,
    remaining,
    accrued_to_date: accruedToDate,
  };
}
