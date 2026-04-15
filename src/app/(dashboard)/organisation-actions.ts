"use server";

import { createClient } from "@/lib/supabase/server";
import { logAudit, diffChanges } from "@/lib/audit";

export async function updateOrganisation(data: {
  name: string;
  memberLabel: string;
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
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { success: false, error: "Not authenticated" };

  // Verify caller is owner
  const { data: membership } = await supabase
    .from("members")
    .select("id, organisation_id, role, first_name, last_name")
    .eq("user_id", user.id)
    .limit(1)
    .single();

  if (!membership) return { success: false, error: "No organisation" };
  if (membership.role !== "owner")
    return { success: false, error: "Only the owner can edit organisation settings" };

  // Fetch before-state for audit diff
  const { data: beforeOrg } = await supabase
    .from("organisations")
    .select("name, member_label, require_mfa, currency_symbol, ts_max_shift_hours, ts_max_break_minutes, ts_shift_start_variance_minutes, ts_round_first_in_mins, ts_round_first_in_grace_mins, ts_round_break_out_mins, ts_round_break_out_grace_mins, ts_round_break_in_mins, ts_round_break_in_grace_mins, ts_round_last_out_mins, ts_round_last_out_grace_mins, holiday_year_start_type, holiday_year_start_day, holiday_year_start_month, bank_holiday_handling")
    .eq("id", membership.organisation_id)
    .single();

  const updatePayload: Record<string, string | boolean | number | null> = {
    name: data.name,
    member_label: data.memberLabel || "member",
  };

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

  const { error } = await supabase
    .from("organisations")
    .update(updatePayload)
    .eq("id", membership.organisation_id);

  if (error) return { success: false, error: error.message };

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
        name: data.name,
        member_label: data.memberLabel || "member",
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
