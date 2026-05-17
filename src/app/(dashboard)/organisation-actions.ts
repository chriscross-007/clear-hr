"use server";

import { createClient } from "@/lib/supabase/server";
import { logAudit, diffChanges } from "@/lib/audit";
import {
  recalculateBookingDays,
  findBookingIdsForOrgFallback,
} from "@/lib/recalculate-bookings";

export async function updateOrganisation(data: {
  // CLE-191 — name/memberLabel made optional so per-section Settings
  // pages can do partial updates without re-sending the org identity
  // every time. The legacy dialog still passes both; new pages pass
  // only what they edit.
  name?: string;
  memberLabel?: string;
  requireMfa?: boolean;
  currencySymbol?: string;
  tsMaxShiftHours?: number;
  tsMaxBreakMinutes?: number;
  tsShiftStartVarianceMinutes?: number;
  tsRoundFirstInMins?: number | null;
  tsRoundFirstInGraceMins?: number | null;
  tsRoundBreakOutMins?: number | null;
  tsRoundBreakOutGraceMins?: number | null;
  tsRoundBreakInMins?: number | null;
  tsRoundBreakInGraceMins?: number | null;
  tsRoundLastOutMins?: number | null;
  tsRoundLastOutGraceMins?: number | null;
  holidayYearStartType?: string;
  holidayYearStartDay?: number | null;
  holidayYearStartMonth?: number | null;
  bankHolidayHandling?: string;
  bankHolidayColour?: string;
  countryCode?: string;
  defaultWorkProfileId?: string | null;
  // CLE-194 Phase 2 — the org-level Default Cascade props
  // (`defaultHoliday*`) were removed. The Default Holiday Profile in
  // `holiday_profiles` is now the single source of starting values for
  // new members; edit it via Settings → Profiles → Holiday Profiles.
  // CLE-178 — when true, server hard-rejects holiday requests that breach
  // notice_period_rules. Default false: requests get through with a soft
  // warning shown to the employee in the booking sheet.
  noticeRulesBlockRequests?: boolean;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { success: false, error: "Not authenticated" };

  // Verify caller is owner OR an admin with can_edit_organisation permission.
  const { data: membership } = await supabase
    .from("members")
    .select("id, organisation_id, role, permissions, first_name, last_name")
    .eq("user_id", user.id)
    .limit(1)
    .single();

  if (!membership) return { success: false, error: "No organisation" };
  const callerPerms = (membership.permissions as Record<string, unknown> | null) ?? {};
  const isOwner = membership.role === "owner";
  const isPermittedAdmin =
    membership.role === "admin" && callerPerms.can_edit_organisation === true;
  if (!isOwner && !isPermittedAdmin) {
    return { success: false, error: "You do not have permission to edit organisation settings" };
  }

  // Fetch before-state for audit diff
  const { data: beforeOrg } = await supabase
    .from("organisations")
    .select("name, member_label, require_mfa, currency_symbol, ts_max_shift_hours, ts_max_break_minutes, ts_shift_start_variance_minutes, ts_round_first_in_mins, ts_round_first_in_grace_mins, ts_round_break_out_mins, ts_round_break_out_grace_mins, ts_round_break_in_mins, ts_round_break_in_grace_mins, ts_round_last_out_mins, ts_round_last_out_grace_mins, holiday_year_start_type, holiday_year_start_day, holiday_year_start_month, bank_holiday_handling, default_work_profile_id")
    .eq("id", membership.organisation_id)
    .single();

  const updatePayload: Record<string, string | boolean | number | null> = {};

  // CLE-191 — only write identity fields when the caller actually sends
  // them. Lets partial-update callers (per-section Settings pages) skip
  // re-sending name + member_label.
  if (typeof data.name === "string" && data.name.trim()) {
    updatePayload.name = data.name.trim();
  }
  if (typeof data.memberLabel === "string") {
    updatePayload.member_label = data.memberLabel || "member";
  }

  if (typeof data.requireMfa === "boolean") {
    updatePayload.require_mfa = data.requireMfa;
  }
  if (typeof data.currencySymbol === "string" && data.currencySymbol.trim()) {
    updatePayload.currency_symbol = data.currencySymbol.trim();
  }
  if (typeof data.tsMaxShiftHours === "number" && data.tsMaxShiftHours > 0) {
    updatePayload.ts_max_shift_hours = data.tsMaxShiftHours;
  }
  if (typeof data.tsMaxBreakMinutes === "number" && data.tsMaxBreakMinutes > 0) {
    updatePayload.ts_max_break_minutes = data.tsMaxBreakMinutes;
  }
  if (typeof data.tsShiftStartVarianceMinutes === "number" && data.tsShiftStartVarianceMinutes >= 0) {
    updatePayload.ts_shift_start_variance_minutes = data.tsShiftStartVarianceMinutes;
  }
  // Rounding fields: allow null to clear
  if (data.tsRoundFirstInMins !== undefined)       updatePayload.ts_round_first_in_mins        = data.tsRoundFirstInMins;
  if (data.tsRoundFirstInGraceMins !== undefined)  updatePayload.ts_round_first_in_grace_mins  = data.tsRoundFirstInGraceMins;
  if (data.tsRoundBreakOutMins !== undefined)      updatePayload.ts_round_break_out_mins       = data.tsRoundBreakOutMins;
  if (data.tsRoundBreakOutGraceMins !== undefined) updatePayload.ts_round_break_out_grace_mins = data.tsRoundBreakOutGraceMins;
  if (data.tsRoundBreakInMins !== undefined)       updatePayload.ts_round_break_in_mins        = data.tsRoundBreakInMins;
  if (data.tsRoundBreakInGraceMins !== undefined)  updatePayload.ts_round_break_in_grace_mins  = data.tsRoundBreakInGraceMins;
  if (data.tsRoundLastOutMins !== undefined)       updatePayload.ts_round_last_out_mins        = data.tsRoundLastOutMins;
  if (data.tsRoundLastOutGraceMins !== undefined)  updatePayload.ts_round_last_out_grace_mins  = data.tsRoundLastOutGraceMins;

  // Holiday year start
  if (data.holidayYearStartType !== undefined) {
    updatePayload.holiday_year_start_type = data.holidayYearStartType;
    if (data.holidayYearStartType === "fixed") {
      updatePayload.holiday_year_start_day = data.holidayYearStartDay ?? 1;
      updatePayload.holiday_year_start_month = data.holidayYearStartMonth ?? 1;
    } else {
      updatePayload.holiday_year_start_day = null;
      updatePayload.holiday_year_start_month = null;
    }
  }

  // Bank holiday handling
  if (data.bankHolidayHandling !== undefined) {
    updatePayload.bank_holiday_handling = data.bankHolidayHandling;
  }

  // Bank holiday colour
  if (data.bankHolidayColour !== undefined) {
    updatePayload.bank_holiday_colour = data.bankHolidayColour;
  }

  // Country code
  if (data.countryCode !== undefined) {
    updatePayload.country_code = data.countryCode;
  }

  // Default work profile
  if (data.defaultWorkProfileId !== undefined) {
    updatePayload.default_work_profile_id = data.defaultWorkProfileId;
  }

  // Notice-rules block flag (CLE-178). CLE-194 made this per-profile, but
  // the legacy OrganisationEditDialog still writes to the org-level column.
  // Mirror the write across to the Default notice profile's block_requests
  // so booking validation (which reads from the profile) stays in sync
  // with what the legacy dialog shows. Drop both sides once the legacy
  // dialog is removed.
  if (typeof data.noticeRulesBlockRequests === "boolean") {
    updatePayload.notice_rules_block_requests = data.noticeRulesBlockRequests;
    await supabase
      .from("notice_period_profiles")
      .update({ block_requests: data.noticeRulesBlockRequests })
      .eq("organisation_id", membership.organisation_id)
      .eq("is_default", true);
  }

  // CLE-194 Phase 2 — `default_holiday_*` columns removed. The Default
  // Holiday Profile in `holiday_profiles` is the source of truth.

  const { error } = await supabase
    .from("organisations")
    .update(updatePayload)
    .eq("id", membership.organisation_id);

  if (error) return { success: false, error: error.message };

  // If the org default work profile changed, recalculate days_deducted for
  // any active bookings belonging to members who fall back to the org default
  // (i.e. those without an employee_work_profiles assignment). Additive only.
  if (
    data.defaultWorkProfileId !== undefined
    && beforeOrg
    && beforeOrg.default_work_profile_id !== data.defaultWorkProfileId
  ) {
    try {
      const ids = await findBookingIdsForOrgFallback(membership.organisation_id);
      if (ids.length > 0) {
        const res = await recalculateBookingDays(ids);
        console.log(
          `[recalc] org.defaultWorkProfile change (org=${membership.organisation_id}): ` +
          `updated=${res.updated} unchanged=${res.unchanged} skipped=${res.skipped} errors=${res.errors}`,
        );
      }
    } catch (e) {
      console.error("[recalc] org default change post-save failed:", e instanceof Error ? e.message : e);
    }
  }

  if (beforeOrg) {
    const changes = diffChanges(
      {
        name: beforeOrg.name,
        member_label: beforeOrg.member_label,
        require_mfa: beforeOrg.require_mfa,
        currency_symbol: beforeOrg.currency_symbol,
        ts_max_shift_hours: beforeOrg.ts_max_shift_hours,
        ts_max_break_minutes: beforeOrg.ts_max_break_minutes,
        ts_shift_start_variance_minutes: beforeOrg.ts_shift_start_variance_minutes,
        ts_round_first_in_mins:        beforeOrg.ts_round_first_in_mins,
        ts_round_first_in_grace_mins:  beforeOrg.ts_round_first_in_grace_mins,
        ts_round_break_out_mins:       beforeOrg.ts_round_break_out_mins,
        ts_round_break_out_grace_mins: beforeOrg.ts_round_break_out_grace_mins,
        ts_round_break_in_mins:        beforeOrg.ts_round_break_in_mins,
        ts_round_break_in_grace_mins:  beforeOrg.ts_round_break_in_grace_mins,
        ts_round_last_out_mins:        beforeOrg.ts_round_last_out_mins,
        ts_round_last_out_grace_mins:  beforeOrg.ts_round_last_out_grace_mins,
        holiday_year_start_type:  beforeOrg.holiday_year_start_type,
        holiday_year_start_day:   beforeOrg.holiday_year_start_day,
        holiday_year_start_month: beforeOrg.holiday_year_start_month,
        bank_holiday_handling:    beforeOrg.bank_holiday_handling,
      },
      {
        // CLE-191 — fall back to the unchanged before-state when a
        // partial-update caller (per-section Settings page) omits the
        // field, so the audit diff doesn't record spurious "name changed"
        // events.
        name: typeof data.name === "string" && data.name.trim() ? data.name.trim() : beforeOrg.name,
        member_label: typeof data.memberLabel === "string" ? (data.memberLabel || "member") : beforeOrg.member_label,
        require_mfa: data.requireMfa ?? beforeOrg.require_mfa,
        currency_symbol: (typeof data.currencySymbol === "string" && data.currencySymbol.trim()) ? data.currencySymbol.trim() : beforeOrg.currency_symbol,
        ts_max_shift_hours: data.tsMaxShiftHours ?? beforeOrg.ts_max_shift_hours,
        ts_max_break_minutes: data.tsMaxBreakMinutes ?? beforeOrg.ts_max_break_minutes,
        ts_shift_start_variance_minutes: data.tsShiftStartVarianceMinutes ?? beforeOrg.ts_shift_start_variance_minutes,
        ts_round_first_in_mins:        data.tsRoundFirstInMins        !== undefined ? data.tsRoundFirstInMins        : beforeOrg.ts_round_first_in_mins,
        ts_round_first_in_grace_mins:  data.tsRoundFirstInGraceMins   !== undefined ? data.tsRoundFirstInGraceMins   : beforeOrg.ts_round_first_in_grace_mins,
        ts_round_break_out_mins:       data.tsRoundBreakOutMins       !== undefined ? data.tsRoundBreakOutMins       : beforeOrg.ts_round_break_out_mins,
        ts_round_break_out_grace_mins: data.tsRoundBreakOutGraceMins  !== undefined ? data.tsRoundBreakOutGraceMins  : beforeOrg.ts_round_break_out_grace_mins,
        ts_round_break_in_mins:        data.tsRoundBreakInMins        !== undefined ? data.tsRoundBreakInMins        : beforeOrg.ts_round_break_in_mins,
        ts_round_break_in_grace_mins:  data.tsRoundBreakInGraceMins   !== undefined ? data.tsRoundBreakInGraceMins   : beforeOrg.ts_round_break_in_grace_mins,
        ts_round_last_out_mins:        data.tsRoundLastOutMins        !== undefined ? data.tsRoundLastOutMins        : beforeOrg.ts_round_last_out_mins,
        ts_round_last_out_grace_mins:  data.tsRoundLastOutGraceMins   !== undefined ? data.tsRoundLastOutGraceMins   : beforeOrg.ts_round_last_out_grace_mins,
        holiday_year_start_type:  data.holidayYearStartType  ?? beforeOrg.holiday_year_start_type,
        holiday_year_start_day:   data.holidayYearStartType === "fixed" ? (data.holidayYearStartDay ?? beforeOrg.holiday_year_start_day) : null,
        holiday_year_start_month: data.holidayYearStartType === "fixed" ? (data.holidayYearStartMonth ?? beforeOrg.holiday_year_start_month) : null,
        bank_holiday_handling:    data.bankHolidayHandling ?? beforeOrg.bank_holiday_handling,
      }
    );

    if (changes) {
      logAudit({
        organisationId: membership.organisation_id,
        actorId: membership.id,
        actorName: `${membership.first_name} ${membership.last_name}`,
        action: "org.updated",
        targetType: "organisation",
        targetId: membership.organisation_id,
        changes,
      });
    }
  }

  return { success: true };
}
