"use server";

import { createClient } from "@/lib/supabase/server";

export type NoticePeriodRule = {
  id: string;
  organisation_id: string;
  min_booking_days: number;
  notice_days: number;
};

async function getCallerAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const { data: member } = await supabase
    .from("members")
    .select("id, organisation_id, role")
    .eq("user_id", user.id)
    .limit(1)
    .single();

  if (!member) throw new Error("No organisation");
  if (member.role !== "owner" && member.role !== "admin") throw new Error("Insufficient permissions");

  return { supabase, member };
}

export async function getNoticePeriodRules(): Promise<{
  success: boolean;
  error?: string;
  rules?: NoticePeriodRule[];
}> {
  try {
    const { supabase, member } = await getCallerAdmin();
    const { data, error } = await supabase
      .from("notice_period_rules")
      .select("id, organisation_id, min_booking_days, notice_days")
      .eq("organisation_id", member.organisation_id)
      .order("min_booking_days", { ascending: false });

    if (error) return { success: false, error: error.message };
    return { success: true, rules: data ?? [] };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "An error occurred" };
  }
}

export async function saveNoticePeriodRules(
  rules: { id?: string; min_booking_days: number; notice_days: number }[]
): Promise<{ success: boolean; error?: string }> {
  try {
    const { supabase, member } = await getCallerAdmin();
    const orgId = member.organisation_id;

    // Fetch existing rules
    const { data: existing } = await supabase
      .from("notice_period_rules")
      .select("id")
      .eq("organisation_id", orgId);

    const existingIds = new Set((existing ?? []).map((r) => r.id));
    const incomingIds = new Set(rules.filter((r) => r.id).map((r) => r.id!));

    // Delete removed rules
    const toDelete = [...existingIds].filter((id) => !incomingIds.has(id));
    if (toDelete.length > 0) {
      const { error } = await supabase
        .from("notice_period_rules")
        .delete()
        .in("id", toDelete)
        .eq("organisation_id", orgId);
      if (error) return { success: false, error: error.message };
    }

    // Upsert remaining rules
    for (const rule of rules) {
      if (rule.id && existingIds.has(rule.id)) {
        const { error } = await supabase
          .from("notice_period_rules")
          .update({ min_booking_days: rule.min_booking_days, notice_days: rule.notice_days })
          .eq("id", rule.id)
          .eq("organisation_id", orgId);
        if (error) return { success: false, error: error.message };
      } else {
        const { error } = await supabase
          .from("notice_period_rules")
          .insert({ organisation_id: orgId, min_booking_days: rule.min_booking_days, notice_days: rule.notice_days });
        if (error) return { success: false, error: error.message };
      }
    }

    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "An error occurred" };
  }
}

export async function checkBookingsInBreach(): Promise<{
  success: boolean;
  error?: string;
  breachedCount?: number;
}> {
  try {
    const { supabase, member } = await getCallerAdmin();
    const orgId = member.organisation_id;

    // Fetch current rules
    const { data: rules } = await supabase
      .from("notice_period_rules")
      .select("min_booking_days, notice_days")
      .eq("organisation_id", orgId)
      .order("min_booking_days", { ascending: false });

    if (!rules || rules.length === 0) return { success: true, breachedCount: 0 };

    // Fetch all pending/approved bookings in the org
    const { data: bookings } = await supabase
      .from("holiday_bookings")
      .select("id, start_date, days_deducted, created_at")
      .eq("organisation_id", orgId)
      .in("status", ["pending", "approved"]);

    if (!bookings || bookings.length === 0) return { success: true, breachedCount: 0 };

    let breached = 0;
    for (const b of bookings) {
      const bookingDays = b.days_deducted ? Number(b.days_deducted) : 1;
      const matchingRule = rules.find((r) => bookingDays >= r.min_booking_days);
      if (!matchingRule) continue;

      const createdAt = new Date(b.created_at);
      createdAt.setUTCHours(0, 0, 0, 0);
      const startDate = new Date(b.start_date + "T00:00:00Z");
      const diffMs = startDate.getTime() - createdAt.getTime();
      const noticeDaysGiven = Math.floor(diffMs / 86_400_000);

      if (noticeDaysGiven < matchingRule.notice_days) {
        breached++;
      }
    }

    return { success: true, breachedCount: breached };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "An error occurred" };
  }
}
