// CLE-239 — Employment Notice Profiles: shared types, formatting and the
// statutory-minimum rule. Plain module (no "use server", no server-only
// imports) so client components, server actions and the document-template
// field resolver can all use it.
//
// Spec: Spec Vault → specs/Employee Records/Employment Notice Profiles.md

export type NoticeUnit = "week" | "month";

export interface EmploymentNoticeProfile {
  id: string;
  name: string;
  isDefault: boolean;
  sortOrder: number;
  memberAmount: number;
  memberUnit: NoticeUnit;
  employerAmount: number;
  employerUnit: NoticeUnit;
  employerStatutoryFloor: boolean;
  probationMemberAmount: number | null;
  probationMemberUnit: NoticeUnit | null;
  probationEmployerAmount: number | null;
  probationEmployerUnit: NoticeUnit | null;
  memberCount: number;
}

export type EmploymentNoticeProfileInput = Omit<EmploymentNoticeProfile, "id" | "isDefault" | "sortOrder" | "memberCount">;

/** Columns selected wherever a profile is read. */
export const EMPLOYMENT_NOTICE_COLUMNS =
  "id, name, is_default, sort_order, member_amount, member_unit, employer_amount, employer_unit, employer_statutory_floor, probation_member_amount, probation_member_unit, probation_employer_amount, probation_employer_unit";

export interface EmploymentNoticeRow {
  id: string;
  name: string;
  is_default: boolean;
  sort_order: number;
  member_amount: number;
  member_unit: NoticeUnit;
  employer_amount: number;
  employer_unit: NoticeUnit;
  employer_statutory_floor: boolean;
  probation_member_amount: number | null;
  probation_member_unit: NoticeUnit | null;
  probation_employer_amount: number | null;
  probation_employer_unit: NoticeUnit | null;
}

export function mapEmploymentNoticeRow(r: EmploymentNoticeRow, memberCount = 0): EmploymentNoticeProfile {
  return {
    id: r.id,
    name: r.name,
    isDefault: !!r.is_default,
    sortOrder: Number(r.sort_order ?? 0),
    memberAmount: Number(r.member_amount ?? 0),
    memberUnit: r.member_unit === "week" ? "week" : "month",
    employerAmount: Number(r.employer_amount ?? 0),
    employerUnit: r.employer_unit === "week" ? "week" : "month",
    employerStatutoryFloor: r.employer_statutory_floor !== false,
    probationMemberAmount: r.probation_member_amount ?? null,
    probationMemberUnit: r.probation_member_unit ?? null,
    probationEmployerAmount: r.probation_employer_amount ?? null,
    probationEmployerUnit: r.probation_employer_unit ?? null,
    memberCount,
  };
}

/** "1 month", "3 months", "1 week", "0 weeks". */
export function formatNotice(amount: number | null | undefined, unit: NoticeUnit | null | undefined): string {
  if (amount === null || amount === undefined || !unit) return "";
  return `${amount} ${unit}${amount === 1 ? "" : "s"}`;
}

/** Probation figure, falling back to the main figure when not set. */
export function probationNotice(
  amount: number | null,
  unit: NoticeUnit | null,
  fallbackAmount: number,
  fallbackUnit: NoticeUnit,
): string {
  return amount !== null && unit ? formatNotice(amount, unit) : formatNotice(fallbackAmount, fallbackUnit);
}

function parseIso(iso: string): Date {
  return new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
}

/** Complete months / years between two dates (UTC calendar). */
function completedMonths(from: Date, to: Date): number {
  let m = (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + (to.getUTCMonth() - from.getUTCMonth());
  if (to.getUTCDate() < from.getUTCDate()) m -= 1;
  return Math.max(0, m);
}

/**
 * Statutory minimum notice the employer must give (UK, Employment Rights
 * Act 1996 s86), in weeks, for someone who started on `startDate`, as at
 * `asOf`: none in the first month; 1 week from one month to two years;
 * then 1 week per complete year of service, up to 12 weeks.
 * Returns null when there's no start date.
 */
export function statutoryEmployerNoticeWeeks(startDate: string | null | undefined, asOf: Date = new Date()): number | null {
  if (!startDate) return null;
  const start = parseIso(startDate);
  if (Number.isNaN(start.getTime()) || start > asOf) return 0;
  const months = completedMonths(start, asOf);
  if (months < 1) return 0;
  const years = Math.floor(months / 12);
  if (years < 2) return 1;
  return Math.min(years, 12);
}

/** Lowest number of whole weeks a notice period can be (a month is at
 *  least 28 days = 4 weeks). Used to flag a profile below the minimum. */
export function minimumWeeks(amount: number, unit: NoticeUnit): number {
  return unit === "week" ? amount : amount * 4;
}

/** True when the employer's contractual notice may be less than the
 *  statutory minimum. */
export function belowStatutory(profile: Pick<EmploymentNoticeProfile, "employerAmount" | "employerUnit">, statutoryWeeks: number | null): boolean {
  if (statutoryWeeks === null || statutoryWeeks === 0) return false;
  return minimumWeeks(profile.employerAmount, profile.employerUnit) < statutoryWeeks;
}

/** One-line summary for pickers and the directory. */
export function summariseProfile(p: EmploymentNoticeProfile, memberLabel = "member"): string {
  const floor = p.employerStatutoryFloor ? ", or the legal minimum if greater" : "";
  return `${memberLabel} gives ${formatNotice(p.memberAmount, p.memberUnit)} · organisation gives ${formatNotice(p.employerAmount, p.employerUnit)}${floor}`;
}
