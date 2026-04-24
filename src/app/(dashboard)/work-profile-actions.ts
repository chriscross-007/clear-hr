"use server";

import { createClient } from "@/lib/supabase/server";
import {
  recalculateBookingDays,
  findBookingIdsForMemberFromDate,
} from "@/lib/recalculate-bookings";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type WorkProfile = {
  id: string;
  organisation_id: string;
  name: string;
  hours_monday: number;
  hours_tuesday: number;
  hours_wednesday: number;
  hours_thursday: number;
  hours_friday: number;
  hours_saturday: number;
  hours_sunday: number;
  employee_count?: number;
};

export type WorkProfileInput = {
  name: string;
  hours_monday: number;
  hours_tuesday: number;
  hours_wednesday: number;
  hours_thursday: number;
  hours_friday: number;
  hours_saturday: number;
  hours_sunday: number;
};

export type EmployeeWorkProfileRow = {
  id: string;
  work_profile_id: string;
  work_profile_name: string;
  effective_from: string;
};

const PROFILE_SELECT = "id, organisation_id, name, hours_monday, hours_tuesday, hours_wednesday, hours_thursday, hours_friday, hours_saturday, hours_sunday";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getCallerAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const { data: member } = await supabase
    .from("members")
    .select("id, organisation_id, role")
    .eq("user_id", user.id)
    .limit(1)
    .single();

  if (!member) throw new Error("No organisation");
  if (member.role !== "owner" && member.role !== "admin") {
    throw new Error("Insufficient permissions");
  }

  return { supabase, member };
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export async function getWorkProfiles(): Promise<WorkProfile[]> {
  const { supabase, member } = await getCallerAdmin();

  const { data: profiles } = await supabase
    .from("work_profiles")
    .select(PROFILE_SELECT)
    .eq("organisation_id", member.organisation_id)
    .is("member_id", null)
    .order("name");

  // Count employees per profile
  const { data: assignments } = await supabase
    .from("employee_work_profiles")
    .select("work_profile_id");

  const countMap = new Map<string, number>();
  for (const a of assignments ?? []) {
    countMap.set(a.work_profile_id, (countMap.get(a.work_profile_id) ?? 0) + 1);
  }

  return (profiles ?? []).map((p) => ({
    ...p,
    employee_count: countMap.get(p.id) ?? 0,
  })) as WorkProfile[];
}

export async function createWorkProfile(
  input: WorkProfileInput
): Promise<{ success: boolean; error?: string; profile?: WorkProfile }> {
  try {
    const { supabase, member } = await getCallerAdmin();

    if (!input.name.trim()) return { success: false, error: "Name is required" };

    const { data, error } = await supabase
      .from("work_profiles")
      .insert({
        organisation_id: member.organisation_id,
        name: input.name.trim(),
        effective_from: new Date().toISOString().slice(0, 10),
        hours_monday: input.hours_monday,
        hours_tuesday: input.hours_tuesday,
        hours_wednesday: input.hours_wednesday,
        hours_thursday: input.hours_thursday,
        hours_friday: input.hours_friday,
        hours_saturday: input.hours_saturday,
        hours_sunday: input.hours_sunday,
      })
      .select(PROFILE_SELECT)
      .single();

    if (error) return { success: false, error: error.message };
    return { success: true, profile: { ...data, employee_count: 0 } as WorkProfile };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "An error occurred" };
  }
}

export async function updateWorkProfile(
  id: string,
  input: WorkProfileInput
): Promise<{ success: boolean; error?: string; profile?: WorkProfile }> {
  try {
    const { supabase, member } = await getCallerAdmin();

    if (!input.name.trim()) return { success: false, error: "Name is required" };

    const { data, error } = await supabase
      .from("work_profiles")
      .update({
        name: input.name.trim(),
        hours_monday: input.hours_monday,
        hours_tuesday: input.hours_tuesday,
        hours_wednesday: input.hours_wednesday,
        hours_thursday: input.hours_thursday,
        hours_friday: input.hours_friday,
        hours_saturday: input.hours_saturday,
        hours_sunday: input.hours_sunday,
      })
      .eq("id", id)
      .eq("organisation_id", member.organisation_id)
      .select(PROFILE_SELECT)
      .single();

    if (error) return { success: false, error: error.message };
    return { success: true, profile: data as WorkProfile };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "An error occurred" };
  }
}

export async function deleteWorkProfile(
  id: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const { supabase, member } = await getCallerAdmin();

    const { count } = await supabase
      .from("employee_work_profiles")
      .select("id", { count: "exact", head: true })
      .eq("work_profile_id", id);

    if (count && count > 0) {
      return { success: false, error: "This profile cannot be deleted as employees are assigned to it." };
    }

    const { error } = await supabase
      .from("work_profiles")
      .delete()
      .eq("id", id)
      .eq("organisation_id", member.organisation_id);

    if (error) return { success: false, error: error.message };
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "An error occurred" };
  }
}

// ---------------------------------------------------------------------------
// Employee work profile assignments
// ---------------------------------------------------------------------------

export async function getEmployeeWorkProfiles(
  memberId: string
): Promise<EmployeeWorkProfileRow[]> {
  const { supabase, member } = await getCallerAdmin();

  // Verify member belongs to org
  const { data: target } = await supabase
    .from("members")
    .select("id")
    .eq("id", memberId)
    .eq("organisation_id", member.organisation_id)
    .single();

  if (!target) return [];

  const { data } = await supabase
    .from("employee_work_profiles")
    .select("id, work_profile_id, effective_from, work_profiles(name)")
    .eq("member_id", memberId)
    .order("effective_from", { ascending: false });

  return (data ?? []).map((r) => {
    const wp = r.work_profiles as unknown as { name: string } | null;
    return {
      id: r.id,
      work_profile_id: r.work_profile_id,
      work_profile_name: wp?.name ?? "—",
      effective_from: r.effective_from,
    };
  });
}

export async function assignWorkProfile(
  memberId: string,
  workProfileId: string,
  effectiveFrom: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const { supabase, member } = await getCallerAdmin();

    // Verify member belongs to org
    const { data: target } = await supabase
      .from("members")
      .select("id")
      .eq("id", memberId)
      .eq("organisation_id", member.organisation_id)
      .single();

    if (!target) return { success: false, error: "Member not found" };

    const { error } = await supabase
      .from("employee_work_profiles")
      .insert({
        member_id: memberId,
        work_profile_id: workProfileId,
        effective_from: effectiveFrom,
      });

    if (error) {
      if (error.code === "23505") {
        return { success: false, error: "An assignment already exists for this date." };
      }
      return { success: false, error: error.message };
    }

    // Recalculate any active bookings this employee has from the effective date
    // onward. Additive: failure here must not block the assignment.
    try {
      const ids = await findBookingIdsForMemberFromDate(memberId, effectiveFrom);
      if (ids.length > 0) {
        const res = await recalculateBookingDays(ids);
        console.log(
          `[recalc] assignWorkProfile(member=${memberId}, effectiveFrom=${effectiveFrom}): ` +
          `updated=${res.updated} unchanged=${res.unchanged} skipped=${res.skipped} errors=${res.errors}`,
        );
      }
    } catch (e) {
      console.error("[recalc] assignWorkProfile post-save failed:", e instanceof Error ? e.message : e);
    }

    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "An error occurred" };
  }
}
