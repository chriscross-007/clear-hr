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
    .select("name, member_label, require_mfa, currency_symbol, ts_max_shift_hours, ts_max_break_minutes, ts_shift_start_variance_minutes")
    .eq("id", membership.organisation_id)
    .single();

  const updatePayload: Record<string, string | boolean | number> = {
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
      },
      {
        name: data.name,
        member_label: data.memberLabel || "member",
        require_mfa: data.requireMfa ?? beforeOrg.require_mfa,
        currency_symbol: (typeof data.currencySymbol === "string" && data.currencySymbol.trim()) ? data.currencySymbol.trim() : beforeOrg.currency_symbol,
        ts_max_shift_hours: data.tsMaxShiftHours ?? beforeOrg.ts_max_shift_hours,
        ts_max_break_minutes: data.tsMaxBreakMinutes ?? beforeOrg.ts_max_break_minutes,
        ts_shift_start_variance_minutes: data.tsShiftStartVarianceMinutes ?? beforeOrg.ts_shift_start_variance_minutes,
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
