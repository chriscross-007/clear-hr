"use server";

// Profileless Holiday Management — server actions (CLE-168, parent CLE-166).
//
// CRUD + Default Cascade resolution for holiday_periods. Live computation of
// Brought Forward / Worked / Toil / Taken / Booked / Balance / Carry Forward
// is layered on top via separate helpers — see computeHolidayPeriodValues.
//
// Spec: Profileless Holiday Management — settled spec
// https://linear.app/clearhr/document/profileless-holiday-management-settled-spec-bae7e878e485

import { createClient } from "@/lib/supabase/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

import { logAudit, diffChanges } from "@/lib/audit";
import {
  computeAllHolidayPeriodValues,
  type ComputeBookingInput,
  type ComputeContext,
} from "@/app/(dashboard)/holiday-period-compute";
import {
  getMemberWorkPatternHistory,
  getBankHolidaysForOrg,
  getBankHolidayHandling,
} from "@/lib/work-pattern-data";
import { getMemberWorkedHoursInRange } from "@/lib/timesheet-totals";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type HolidayPeriodType = "fixed" | "earned";
export type HolidayUnits = "days" | "hours";

/**
 * Snapshot of a Holiday Period's computed values at the moment of locking.
 * Mirrors the runtime `ComputedPeriodValues` shape from holiday-period-compute.
 * Re-declared here (rather than imported) to avoid a circular value import
 * between actions ↔ compute. The compute helper validates the shape on read.
 */
export type LockedHolidayPeriodSnapshot = {
  broughtForward: number;
  worked: number;
  toil: number;
  allowance: number;
  taken: number;
  booked: number;
  /** Pending-status bookings — past, present, or future. Added in CLE-177.
   *  Snapshots predating the change have `pending = 0` and may carry pending
   *  amounts inside `taken` / `booked` until the admin re-locks. */
  pending: number;
  balance: number;
  carryForward: number;
};

export type HolidayPeriod = {
  id: string;
  organisationId: string;
  memberId: string;
  name: string;
  startDate: string;
  endDate: string;
  type: HolidayPeriodType;
  units: HolidayUnits;
  allowance: number | null;
  earnedFactor: number;
  adjust: number;
  maxCarryForward: number;
  minCarryForward: number;
  locked: boolean;
  /**
   * Frozen ComputedPeriodValues at the moment of locking. NULL when
   * unlocked, or for legacy locked rows that pre-date CLE-172. When
   * present, the compute helper renders the snapshot directly and uses
   * snapshot.carryForward as the next period's broughtForward — earlier
   * manual edits do not propagate through this period.
   */
  lockedSnapshot: LockedHolidayPeriodSnapshot | null;
  createdAt: string;
  updatedAt: string;
};

/** Editable fields on a Holiday Period. */
export type HolidayPeriodInput = {
  name: string;
  startDate: string;
  endDate: string;
  type: HolidayPeriodType;
  units: HolidayUnits;
  allowance: number | null;
  earnedFactor: number;
  adjust: number;
  maxCarryForward: number;
  minCarryForward: number;
};

// CLE-194 Phase 2 — `MemberHolidayCog` and `OrgHolidayDefaults` types
// removed alongside the cog/Default Cascade actions; the 7-value bundle
// now lives on `holiday_profiles`. See `HolidayProfile` in
// `holiday-profile-actions.ts`.

// ---------------------------------------------------------------------------
// Standard helpers (matching the pattern in conversation-actions.ts)
// ---------------------------------------------------------------------------

function getAdminClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } },
  );
}

async function getCallerMember() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const { data: member } = await supabase
    .from("members")
    .select("id, organisation_id, role, first_name, last_name")
    .eq("user_id", user.id)
    .limit(1)
    .single();
  if (!member) throw new Error("No membership found");

  return { supabase, member };
}

async function requireAdminOrOwner() {
  const { supabase, member } = await getCallerMember();
  // CLE-196b-3 — Managing holiday periods requires holiday-approve rights
  // (Manager/HR/Admin), matching the approvals mental model.
  const { getEffectiveRightsForUser } = await import("@/lib/rights-resolver");
  const { data: { user } } = await supabase.auth.getUser();
  const resolved = user ? await getEffectiveRightsForUser(user.id) : null;
  if (!resolved?.rights.canApproveHolidays) {
    throw new Error("Insufficient permissions");
  }
  return { supabase, member };
}

// ---------------------------------------------------------------------------
// DTO mappers
// ---------------------------------------------------------------------------

type HolidayPeriodRow = {
  id: string;
  organisation_id: string;
  member_id: string;
  name: string;
  start_date: string;
  end_date: string;
  type: HolidayPeriodType;
  units: HolidayUnits;
  allowance: string | number | null;
  earned_factor: string | number;
  adjust: string | number;
  max_carry_forward: string | number;
  min_carry_forward: string | number;
  locked: boolean;
  locked_snapshot: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

const PERIOD_SELECT = "id, organisation_id, member_id, name, start_date, end_date, type, units, allowance, earned_factor, adjust, max_carry_forward, min_carry_forward, locked, locked_snapshot, created_at, updated_at";

/** Coerce a stored locked_snapshot JSON blob into a typed snapshot, or null
 *  if the shape doesn't validate. Defensive against hand-edited rows. */
function parseLockedSnapshot(raw: Record<string, unknown> | null): LockedHolidayPeriodSnapshot | null {
  if (!raw || typeof raw !== "object") return null;
  const num = (v: unknown): number | null => {
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
    return null;
  };
  const broughtForward = num(raw.broughtForward);
  const worked = num(raw.worked);
  const toil = num(raw.toil);
  const allowance = num(raw.allowance);
  const taken = num(raw.taken);
  const booked = num(raw.booked);
  const balance = num(raw.balance);
  const carryForward = num(raw.carryForward);
  // CLE-177 — `pending` was added later. Legacy snapshots that lack it
  // default to 0 (the pending amounts will be inside taken/booked from the
  // old splitting rule until the admin re-locks).
  const pending = num(raw.pending) ?? 0;
  if (
    broughtForward === null
    || worked === null
    || toil === null
    || allowance === null
    || taken === null
    || booked === null
    || balance === null
    || carryForward === null
  ) {
    return null;
  }
  return { broughtForward, worked, toil, allowance, taken, booked, pending, balance, carryForward };
}

function rowToPeriod(row: HolidayPeriodRow): HolidayPeriod {
  return {
    id: row.id,
    organisationId: row.organisation_id,
    memberId: row.member_id,
    name: row.name,
    startDate: row.start_date,
    endDate: row.end_date,
    type: row.type,
    units: row.units,
    allowance: row.allowance === null ? null : Number(row.allowance),
    earnedFactor: Number(row.earned_factor),
    adjust: Number(row.adjust),
    maxCarryForward: Number(row.max_carry_forward),
    minCarryForward: Number(row.min_carry_forward),
    locked: row.locked,
    lockedSnapshot: parseLockedSnapshot(row.locked_snapshot),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function inputToRow(input: HolidayPeriodInput) {
  // Earned-type periods must not store an allowance (chk_holiday_periods_allowance_per_type).
  const allowance = input.type === "earned" ? null : input.allowance ?? 0;
  return {
    name: input.name.trim(),
    start_date: input.startDate,
    end_date: input.endDate,
    type: input.type,
    units: input.units,
    allowance,
    earned_factor: input.earnedFactor,
    adjust: input.adjust,
    max_carry_forward: input.maxCarryForward,
    min_carry_forward: input.minCarryForward,
  };
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

export async function getHolidayPeriodsForMember(
  memberId: string,
): Promise<{ success: boolean; error?: string; periods: HolidayPeriod[] }> {
  try {
    const { supabase, member } = await getCallerMember();

    // CLE-196b-3 — Members can only read their own periods unless
    // their profile grants cross-user access.
    const { getEffectiveRightsForUser } = await import("@/lib/rights-resolver");
    const { data: { user } } = await supabase.auth.getUser();
    const resolvedPeriods = user ? await getEffectiveRightsForUser(user.id) : null;
    const canSeeOthers = resolvedPeriods ? resolvedPeriods.rights.crossUserAccess !== "self" : false;
    if (!canSeeOthers && member.id !== memberId) {
      return { success: false, error: "Insufficient permissions", periods: [] };
    }

    const { data, error } = await supabase
      .from("holiday_periods")
      .select(PERIOD_SELECT)
      .eq("member_id", memberId)
      .order("start_date", { ascending: true });

    if (error) return { success: false, error: error.message, periods: [] };

    return {
      success: true,
      periods: (data ?? []).map((r) => rowToPeriod(r as HolidayPeriodRow)),
    };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : "An error occurred",
      periods: [],
    };
  }
}

// ---------------------------------------------------------------------------
// Default Cascade — seed values for a new period
// ---------------------------------------------------------------------------

export type NewPeriodDefaults = {
  name: string;
  startDate: string;
  endDate: string;
  type: HolidayPeriodType;
  units: HolidayUnits;
  allowance: number | null;
  earnedFactor: number;
  adjust: number;
  maxCarryForward: number;
  minCarryForward: number;
};

/**
 * Compute the suggested defaults for creating a new Holiday Period for a
 * given employee, following the spec's rules:
 *
 * If a previous period exists for this employee:
 *   Start = day after the latest period's End Date
 *   End   = Start + 1 year − 1 day
 *
 * Otherwise (first period for the employee), the period is anchored to the
 * **current** period boundary so admins onboarding a long-tenured employee
 * don't accidentally create a period 5 years in the past:
 *
 *   Fixed Day mode:
 *     anchor = the most recent Fixed Day (e.g. 1 Jan) on or before today;
 *              if this year's Fixed Day hasn't passed yet, use last year's.
 *     Start  = max(anchor, employee.start_date)   ← partial period for
 *                                                   mid-period hires
 *     End    = anchor + 1 year − 1 day
 *
 *   Employee Start Date mode:
 *     anchor = the most recent anniversary of employee.start_date on or
 *              before today.
 *     Start  = anchor
 *     End    = anchor + 1 year − 1 day
 *
 * The remaining field defaults (Type, Units, Allowance, etc.) come from the
 * member's cog (snapshotted from the org defaults at employee creation).
 */
export async function getNewPeriodDefaults(
  memberId: string,
): Promise<{ success: boolean; error?: string; defaults?: NewPeriodDefaults }> {
  try {
    await requireAdminOrOwner();
    const admin = getAdminClient();

    // Employee + assigned holiday profile (CLE-194 Phase 2: the 7 cog values
    // now live on holiday_profiles, joined via members.holiday_profile_id).
    const { data: m } = await admin
      .from("members")
      .select(
        "id, organisation_id, start_date, holiday_profile_id, holiday_profiles!holiday_profile_id(holiday_type, holiday_units, holiday_earned_factor, holiday_allowance, holiday_max_carry_forward, holiday_min_carry_forward)",
      )
      .eq("id", memberId)
      .single();

    if (!m) return { success: false, error: "Member not found" };
    if (!m.start_date) {
      return {
        success: false,
        error: "Employee has no Start Date set — set this first before creating a Holiday Period.",
      };
    }
    const profile = m.holiday_profiles as unknown as {
      holiday_type: string;
      holiday_units: string;
      holiday_earned_factor: number;
      holiday_allowance: number;
      holiday_max_carry_forward: number;
      holiday_min_carry_forward: number;
    } | null;
    if (!profile) {
      return {
        success: false,
        error: "Employee has no Holiday Profile assigned — assign one on the Employment page first.",
      };
    }

    // Org settings
    const { data: org } = await admin
      .from("organisations")
      .select("holiday_year_start_type, holiday_year_start_day, holiday_year_start_month")
      .eq("id", m.organisation_id)
      .single();

    if (!org) return { success: false, error: "Organisation not found" };

    // Latest period (if any) for this employee
    const { data: latestPeriod } = await admin
      .from("holiday_periods")
      .select("end_date")
      .eq("member_id", memberId)
      .order("end_date", { ascending: false })
      .limit(1)
      .maybeSingle();

    const memberStart = m.start_date as string;
    const todayISO = new Date().toISOString().slice(0, 10);

    // Compute the current period anchor. For a continuation, anchor is the
    // day after the latest period's end. For a first period, anchor depends
    // on org mode (Fixed Day or Employee Start Date) — see the JSDoc above.
    const anchorISO: string = (() => {
      if (latestPeriod?.end_date) {
        const next = new Date(latestPeriod.end_date + "T00:00:00Z");
        next.setUTCDate(next.getUTCDate() + 1);
        return next.toISOString().slice(0, 10);
      }
      if (org.holiday_year_start_type === "employee_start_date") {
        // Most recent anniversary of employee.start_date on or before today
        const empStart = new Date(memberStart + "T00:00:00Z");
        const today = new Date(todayISO + "T00:00:00Z");
        let anniv = new Date(Date.UTC(
          today.getUTCFullYear(),
          empStart.getUTCMonth(),
          empStart.getUTCDate(),
        ));
        if (anniv.getTime() > today.getTime()) {
          anniv = new Date(Date.UTC(
            today.getUTCFullYear() - 1,
            empStart.getUTCMonth(),
            empStart.getUTCDate(),
          ));
        }
        const annivISO = anniv.toISOString().slice(0, 10);
        // For a sub-1-year-old employee the anchor is their actual start date
        return annivISO < memberStart ? memberStart : annivISO;
      }
      // Fixed Day mode: most recent Fixed Day on or before today
      const month = (org.holiday_year_start_month ?? 1) - 1;
      const day = org.holiday_year_start_day ?? 1;
      const today = new Date(todayISO + "T00:00:00Z");
      let fixedDay = new Date(Date.UTC(today.getUTCFullYear(), month, day));
      if (fixedDay.getTime() > today.getTime()) {
        fixedDay = new Date(Date.UTC(today.getUTCFullYear() - 1, month, day));
      }
      return fixedDay.toISOString().slice(0, 10);
    })();

    // Start Date: for the first period in Fixed Day mode we may need to push
    // the start forward to the employee's actual hire date (mid-period hire)
    // so the period is auto-prorated. In Employee Start Date mode the anchor
    // already is or follows the employee's start date.
    const startDate: string = !latestPeriod?.end_date && memberStart > anchorISO
      ? memberStart
      : anchorISO;

    // End Date: anchor + 1 year - 1 day, regardless of whether Start was
    // pulled forward by a mid-period hire (the period still ends at the
    // org's natural cycle boundary).
    const endDate: string = (() => {
      const end = new Date(anchorISO + "T00:00:00Z");
      end.setUTCFullYear(end.getUTCFullYear() + 1);
      end.setUTCDate(end.getUTCDate() - 1);
      return end.toISOString().slice(0, 10);
    })();

    // Pro-rate Allowance for partial-year first periods. Earned-type periods
    // don't carry an Allowance — leave null.
    const totalDays = daysBetween(startDate, endDate) + 1;
    const fullYearDays = isLeapYearSpan(startDate, endDate) ? 366 : 365;
    const proRateFactor = Math.min(1, totalDays / fullYearDays);
    const profileAllowance = Number(profile.holiday_allowance ?? 0);
    const allowance =
      profile.holiday_type === "earned"
        ? null
        : roundHalfDay(profileAllowance * proRateFactor);

    return {
      success: true,
      defaults: {
        name: new Date(startDate + "T00:00:00Z").getUTCFullYear().toString(),
        startDate,
        endDate,
        type: profile.holiday_type as HolidayPeriodType,
        units: profile.holiday_units as HolidayUnits,
        allowance,
        earnedFactor: Number(profile.holiday_earned_factor ?? 0),
        adjust: 0,
        maxCarryForward: Number(profile.holiday_max_carry_forward ?? 0),
        minCarryForward: Number(profile.holiday_min_carry_forward ?? 0),
      },
    };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : "An error occurred",
    };
  }
}

function daysBetween(startISO: string, endISO: string): number {
  const start = new Date(startISO + "T00:00:00Z").getTime();
  const end = new Date(endISO + "T00:00:00Z").getTime();
  return Math.round((end - start) / 86_400_000);
}

function isLeapYearSpan(startISO: string, endISO: string): boolean {
  const start = new Date(startISO + "T00:00:00Z");
  const end = new Date(endISO + "T00:00:00Z");
  for (let y = start.getUTCFullYear(); y <= end.getUTCFullYear(); y++) {
    if ((y % 4 === 0 && y % 100 !== 0) || y % 400 === 0) return true;
  }
  return false;
}

function roundHalfDay(n: number): number {
  return Math.round(n * 2) / 2;
}

// ---------------------------------------------------------------------------
// Create / Update / Delete
// ---------------------------------------------------------------------------

export async function createHolidayPeriod(
  memberId: string,
  input: HolidayPeriodInput,
): Promise<{ success: boolean; error?: string; period?: HolidayPeriod }> {
  try {
    const { member } = await requireAdminOrOwner();
    const admin = getAdminClient();

    // Verify the target member is in the caller's org
    const { data: target } = await admin
      .from("members")
      .select("id, organisation_id, first_name, last_name")
      .eq("id", memberId)
      .eq("organisation_id", member.organisation_id)
      .single();
    if (!target) return { success: false, error: "Member not found in your organisation" };

    if (!input.name.trim()) return { success: false, error: "Name is required" };
    if (input.endDate <= input.startDate) {
      return { success: false, error: "End Date must be after Start Date" };
    }
    if (input.minCarryForward > 0) {
      return { success: false, error: "Min Carry Forward must be a non-positive value" };
    }

    const row = {
      organisation_id: target.organisation_id,
      member_id: memberId,
      ...inputToRow(input),
    };

    const { data, error } = await admin
      .from("holiday_periods")
      .insert(row)
      .select(PERIOD_SELECT)
      .single();

    if (error) {
      if (error.code === "23P01") {
        return { success: false, error: "This Holiday Period overlaps with an existing one." };
      }
      if (error.code === "23505") {
        return { success: false, error: "A Holiday Period with this name already exists for the employee." };
      }
      return { success: false, error: error.message };
    }

    const period = rowToPeriod(data as HolidayPeriodRow);

    logAudit({
      organisationId: target.organisation_id,
      actorId: member.id,
      actorName: `${member.first_name} ${member.last_name}`,
      action: "holiday_period.created",
      targetType: "holiday_period",
      targetId: period.id,
      targetLabel: `${target.first_name} ${target.last_name} — ${period.name}`,
      metadata: {
        startDate: period.startDate,
        endDate: period.endDate,
        type: period.type,
        units: period.units,
      },
    });

    return { success: true, period };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : "An error occurred",
    };
  }
}

export async function updateHolidayPeriod(
  id: string,
  input: HolidayPeriodInput,
): Promise<{ success: boolean; error?: string; period?: HolidayPeriod }> {
  try {
    const { member } = await requireAdminOrOwner();
    const admin = getAdminClient();

    // Fetch existing period (for org check, lock check, audit diff).
    // Cast: Supabase's template-literal type inference can't follow a
    // run-time-concatenated select string.
    const { data: existingRaw } = await admin
      .from("holiday_periods")
      .select(PERIOD_SELECT + ", members!inner(first_name, last_name)")
      .eq("id", id)
      .eq("organisation_id", member.organisation_id)
      .single();
    const existing = existingRaw as
      | (HolidayPeriodRow & { members: { first_name: string; last_name: string } | { first_name: string; last_name: string }[] })
      | null;

    if (!existing) return { success: false, error: "Holiday Period not found" };

    if (existing.locked) {
      return {
        success: false,
        error: "This Holiday Period is locked. Unlock it before editing.",
      };
    }

    if (!input.name.trim()) return { success: false, error: "Name is required" };
    if (input.endDate <= input.startDate) {
      return { success: false, error: "End Date must be after Start Date" };
    }
    if (input.minCarryForward > 0) {
      return { success: false, error: "Min Carry Forward must be a non-positive value" };
    }

    const { data, error } = await admin
      .from("holiday_periods")
      .update(inputToRow(input))
      .eq("id", id)
      .select(PERIOD_SELECT)
      .single();

    if (error) {
      if (error.code === "23P01") {
        return { success: false, error: "This Holiday Period overlaps with an existing one." };
      }
      if (error.code === "23505") {
        return { success: false, error: "A Holiday Period with this name already exists for the employee." };
      }
      return { success: false, error: error.message };
    }

    const period = rowToPeriod(data as HolidayPeriodRow);
    const targetMember = (existing as unknown as { members: { first_name: string; last_name: string } }).members;

    const oldPeriod = rowToPeriod(existing as HolidayPeriodRow);
    const changes = diffChanges(
      {
        name: oldPeriod.name,
        startDate: oldPeriod.startDate,
        endDate: oldPeriod.endDate,
        type: oldPeriod.type,
        units: oldPeriod.units,
        allowance: oldPeriod.allowance,
        earnedFactor: oldPeriod.earnedFactor,
        adjust: oldPeriod.adjust,
        maxCarryForward: oldPeriod.maxCarryForward,
        minCarryForward: oldPeriod.minCarryForward,
      },
      {
        name: period.name,
        startDate: period.startDate,
        endDate: period.endDate,
        type: period.type,
        units: period.units,
        allowance: period.allowance,
        earnedFactor: period.earnedFactor,
        adjust: period.adjust,
        maxCarryForward: period.maxCarryForward,
        minCarryForward: period.minCarryForward,
      },
    );

    if (changes) {
      logAudit({
        organisationId: member.organisation_id,
        actorId: member.id,
        actorName: `${member.first_name} ${member.last_name}`,
        action: "holiday_period.updated",
        targetType: "holiday_period",
        targetId: period.id,
        targetLabel: `${targetMember.first_name} ${targetMember.last_name} — ${period.name}`,
        changes,
      });
    }

    return { success: true, period };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : "An error occurred",
    };
  }
}

export async function deleteHolidayPeriod(
  id: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const { member } = await requireAdminOrOwner();
    const admin = getAdminClient();

    const { data: existingRaw } = await admin
      .from("holiday_periods")
      .select("id, name, locked, organisation_id, members!inner(first_name, last_name)")
      .eq("id", id)
      .eq("organisation_id", member.organisation_id)
      .single();
    const existing = existingRaw as
      | { id: string; name: string; locked: boolean; organisation_id: string; members: { first_name: string; last_name: string } | { first_name: string; last_name: string }[] }
      | null;

    if (!existing) return { success: false, error: "Holiday Period not found" };
    if (existing.locked) {
      return {
        success: false,
        error: "This Holiday Period is locked. Unlock it before deleting.",
      };
    }

    const { error } = await admin
      .from("holiday_periods")
      .delete()
      .eq("id", id);

    if (error) return { success: false, error: error.message };

    const targetMember = (existing as unknown as { members: { first_name: string; last_name: string } }).members;

    logAudit({
      organisationId: member.organisation_id,
      actorId: member.id,
      actorName: `${member.first_name} ${member.last_name}`,
      action: "holiday_period.deleted",
      targetType: "holiday_period",
      targetId: id,
      targetLabel: `${targetMember.first_name} ${targetMember.last_name} — ${existing.name}`,
    });

    return { success: true };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : "An error occurred",
    };
  }
}

// ---------------------------------------------------------------------------
// Lock / Unlock
// ---------------------------------------------------------------------------

export async function setHolidayPeriodLock(
  id: string,
  locked: boolean,
): Promise<{ success: boolean; error?: string; period?: HolidayPeriod }> {
  try {
    const { member } = await requireAdminOrOwner();
    const admin = getAdminClient();

    const { data: existingRaw } = await admin
      .from("holiday_periods")
      .select("id, name, locked, organisation_id, member_id, members!inner(first_name, last_name)")
      .eq("id", id)
      .eq("organisation_id", member.organisation_id)
      .single();
    const existing = existingRaw as
      | { id: string; name: string; locked: boolean; organisation_id: string; member_id: string; members: { first_name: string; last_name: string } | { first_name: string; last_name: string }[] }
      | null;

    if (!existing) return { success: false, error: "Holiday Period not found" };
    if (existing.locked === locked) {
      // No-op — already in the requested state.
      return { success: true };
    }

    // CLE-172: compute and store a snapshot of the period's ComputedPeriodValues
    // when locking, so earlier manual edits don't propagate through this period.
    // When unlocking, clear the snapshot back to NULL.
    let lockedSnapshot: LockedHolidayPeriodSnapshot | null = null;
    if (locked) {
      const targetMemberId = (existing as unknown as { member_id: string }).member_id;

      const { data: periodsRaw } = await admin
        .from("holiday_periods")
        .select(PERIOD_SELECT)
        .eq("member_id", targetMemberId)
        .eq("organisation_id", member.organisation_id);
      const periods: HolidayPeriod[] = (periodsRaw ?? []).map(
        (r) => rowToPeriod(r as HolidayPeriodRow),
      );

      // Only count bookings whose absence reason deducts from holiday
      // entitlement — sick / compassionate / etc. track separately.
      const { data: deductingReasons } = await admin
        .from("absence_reasons")
        .select("id, absence_types!inner(deducts_from_entitlement)")
        .eq("organisation_id", member.organisation_id)
        .eq("absence_types.deducts_from_entitlement", true);
      const deductingReasonIds = new Set<string>(
        (deductingReasons ?? []).map((r) => r.id as string),
      );

      const { data: bookingsRaw } = await admin
        .from("holiday_bookings")
        .select("start_date, end_date, start_half, end_half, status, leave_reason_id")
        .eq("member_id", targetMemberId)
        .in("status", ["approved", "pending"]);
      const bookings: ComputeBookingInput[] = (bookingsRaw ?? [])
        .filter((b) => deductingReasonIds.has(b.leave_reason_id as string))
        .map((b) => ({
          startDate: b.start_date as string,
          endDate: (b.end_date as string | null) ?? null,
          startHalf: (b.start_half as string | null) ?? null,
          endHalf: (b.end_half as string | null) ?? null,
          status: b.status as string,
        }));

      // CLE-173 — context for day-by-day attribution.
      const todayISO = new Date().toISOString().slice(0, 10);
      const periodSpan = periods.length > 0
        ? {
          from: periods.reduce((acc, p) => p.startDate < acc ? p.startDate : acc, periods[0].startDate),
          to: periods.reduce((acc, p) => p.endDate > acc ? p.endDate : acc, periods[0].endDate),
        }
        : { from: todayISO, to: todayISO };
      const [workPatternHistory, bankHolidays, bankHolidayHandling] = await Promise.all([
        getMemberWorkPatternHistory(admin, targetMemberId, member.organisation_id),
        getBankHolidaysForOrg(admin, member.organisation_id, periodSpan.from, periodSpan.to),
        getBankHolidayHandling(admin, member.organisation_id),
      ]);

      // CLE-175 — worked hours per Earned period, so the snapshot reflects
      // the same allowance the live page shows.
      const earnedPeriods = periods.filter((pp) => pp.type === "earned");
      const workedHoursByPeriodId = new Map<string, number>();
      if (earnedPeriods.length > 0) {
        const totals = await Promise.all(
          earnedPeriods.map((pp) =>
            getMemberWorkedHoursInRange(
              admin,
              targetMemberId,
              member.organisation_id,
              pp.startDate,
              pp.endDate,
            ),
          ),
        );
        earnedPeriods.forEach((pp, i) => {
          workedHoursByPeriodId.set(pp.id, totals[i]);
        });
      }

      const ctx: ComputeContext = {
        workPatternHistory,
        bankHolidays,
        bankHolidayHandling,
        workedHoursByPeriodId,
      };

      const computedMap = computeAllHolidayPeriodValues(periods, bookings, ctx, todayISO);
      const computed = computedMap.get(id);

      if (!computed) {
        return { success: false, error: "Could not compute snapshot for lock" };
      }
      lockedSnapshot = {
        broughtForward: computed.broughtForward,
        worked: computed.worked,
        toil: computed.toil,
        allowance: computed.allowance,
        taken: computed.taken,
        booked: computed.booked,
        pending: computed.pending,
        balance: computed.balance,
        carryForward: computed.carryForward,
      };
    }

    const { data, error } = await admin
      .from("holiday_periods")
      .update({ locked, locked_snapshot: lockedSnapshot })
      .eq("id", id)
      .select(PERIOD_SELECT)
      .single();

    if (error) return { success: false, error: error.message };

    const period = rowToPeriod(data as HolidayPeriodRow);
    const targetMember = (existing as unknown as { members: { first_name: string; last_name: string } }).members;

    logAudit({
      organisationId: member.organisation_id,
      actorId: member.id,
      actorName: `${member.first_name} ${member.last_name}`,
      action: locked ? "holiday_period.locked" : "holiday_period.unlocked",
      targetType: "holiday_period",
      targetId: period.id,
      targetLabel: `${targetMember.first_name} ${targetMember.last_name} — ${period.name}`,
    });

    return { success: true, period };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : "An error occurred",
    };
  }
}

// ---------------------------------------------------------------------------
// Admin Dashboard call-to-action — list of employees with no Holiday Period
// (typically new hires needing their first period set up).  CLE-171.
// ---------------------------------------------------------------------------

export type EmployeeMissingHolidayPeriod = {
  memberId: string;
  memberName: string;
  startDate: string | null;
};

export async function getEmployeesWithoutHolidayPeriod(): Promise<{
  success: boolean;
  error?: string;
  employees: EmployeeMissingHolidayPeriod[];
}> {
  try {
    const { member } = await requireAdminOrOwner();
    const admin = getAdminClient();

    // All members in the org, plus their holiday_periods (just enough to
    // know whether any exist). Admin client because RLS on holiday_periods
    // restricts SELECT to own rows for employees; we want a complete picture.
    const { data, error } = await admin
      .from("members")
      .select("id, first_name, last_name, start_date, holiday_periods!left(id)")
      .eq("organisation_id", member.organisation_id)
      .order("first_name");

    if (error) return { success: false, error: error.message, employees: [] };

    const employees: EmployeeMissingHolidayPeriod[] = (data ?? [])
      .filter((m) => {
        const periods = m.holiday_periods as unknown as { id: string }[] | null;
        return !periods || periods.length === 0;
      })
      .map((m) => ({
        memberId: m.id as string,
        memberName: [m.first_name, m.last_name].filter(Boolean).join(" ").trim() || "(unnamed)",
        startDate: (m.start_date as string | null) ?? null,
      }));

    return { success: true, employees };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : "An error occurred",
      employees: [],
    };
  }
}

// ---------------------------------------------------------------------------
// Member Start Date — quick setter used by the Holiday page banner so an
// admin can resolve a missing start_date inline without leaving the page.
// ---------------------------------------------------------------------------

export async function updateMemberStartDate(
  memberId: string,
  startDate: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const { member } = await requireAdminOrOwner();
    const admin = getAdminClient();

    if (!startDate) return { success: false, error: "Start Date is required" };

    const { data: target } = await admin
      .from("members")
      .select("id, first_name, last_name, start_date")
      .eq("id", memberId)
      .eq("organisation_id", member.organisation_id)
      .single();
    if (!target) return { success: false, error: "Member not found in your organisation" };

    const { error } = await admin
      .from("members")
      .update({ start_date: startDate })
      .eq("id", memberId);

    if (error) return { success: false, error: error.message };

    if (target.start_date !== startDate) {
      logAudit({
        organisationId: member.organisation_id,
        actorId: member.id,
        actorName: `${member.first_name} ${member.last_name}`,
        action: "member.updated",
        targetType: "member",
        targetId: memberId,
        targetLabel: `${target.first_name} ${target.last_name}`,
        changes: { start_date: { old: target.start_date, new: startDate } },
      });
    }

    // CLE-194 Phase 2 — setting start_date may now satisfy the precondition
    // for auto-creating the first Holiday Period (members on an org with
    // holiday_year_start_type='employee_start_date' need both profile +
    // start_date set). Non-fatal: any error is swallowed.
    try {
      const { tryAutoCreateFirstPeriod } = await import("./holiday-profile-actions");
      await tryAutoCreateFirstPeriod(memberId);
    } catch {
      /* swallow */
    }

    return { success: true };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : "An error occurred",
    };
  }
}

// ---------------------------------------------------------------------------
// CLE-194 Phase 2 — Per-employee cog + org-level Default Cascade actions
// were removed when the 7-value bundle moved onto `holiday_profiles`.
// Look in `holiday-profile-actions.ts` for the replacement CRUD, and
// `holiday_profiles.holiday_*` columns for the live values.
// ---------------------------------------------------------------------------
