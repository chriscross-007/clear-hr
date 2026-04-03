"use server";

import { createClient } from "@/lib/supabase/server";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getCallerOrgMembership() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Not authenticated");

  const { data: membership } = await supabase
    .from("members")
    .select("id, organisation_id, role")
    .eq("user_id", user.id)
    .limit(1)
    .single();

  if (!membership) throw new Error("No organisation");
  if (membership.role !== "owner" && membership.role !== "admin") {
    throw new Error("Insufficient permissions");
  }

  return { supabase, membership };
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AbsenceType = {
  id: string;
  organisation_id: string;
  name: string;
  is_paid: boolean;
  requires_tracking: boolean;
  deducts_from_entitlement: boolean;
  requires_approval: boolean;
  is_default: boolean;
};

type AbsenceTypeInput = {
  name: string;
  is_paid: boolean;
  requires_tracking: boolean;
  deducts_from_entitlement: boolean;
  requires_approval: boolean;
};

export type AbsenceReason = {
  id: string;
  organisation_id: string;
  absence_type_id: string;
  name: string;
  colour: string;
  is_default: boolean;
};

type AbsenceReasonCreateInput = {
  absence_type_id: string;
  name: string;
  colour: string;
};

type AbsenceReasonUpdateInput = {
  name: string;
  colour: string;
};

// ---------------------------------------------------------------------------
// Seed defaults (fallback for pre-existing orgs)
// ---------------------------------------------------------------------------

export async function seedDefaultAbsenceTypes(): Promise<{ success: boolean; error?: string }> {
  try {
    const { supabase, membership } = await getCallerOrgMembership();

    const { error } = await supabase.rpc("seed_default_absence_types", {
      org_id: membership.organisation_id,
    });

    if (error) return { success: false, error: error.message };
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "An error occurred" };
  }
}

// ---------------------------------------------------------------------------
// Get all absence types for the caller's org
// ---------------------------------------------------------------------------

export async function getAbsenceTypes(): Promise<AbsenceType[]> {
  const { supabase, membership } = await getCallerOrgMembership();

  const { data } = await supabase
    .from("absence_types")
    .select("id, organisation_id, name, is_paid, requires_tracking, deducts_from_entitlement, requires_approval, is_default")
    .eq("organisation_id", membership.organisation_id)
    .order("is_default", { ascending: false })
    .order("name");

  return (data ?? []) as AbsenceType[];
}

// ---------------------------------------------------------------------------
// Create a custom absence type
// ---------------------------------------------------------------------------

export async function createAbsenceType(
  input: AbsenceTypeInput
): Promise<{ success: boolean; error?: string; absenceType?: AbsenceType }> {
  try {
    const { supabase, membership } = await getCallerOrgMembership();

    if (!input.name.trim()) {
      return { success: false, error: "Name is required" };
    }

    const { data, error } = await supabase
      .from("absence_types")
      .insert({
        organisation_id: membership.organisation_id,
        name: input.name.trim(),
        is_paid: input.is_paid,
        requires_tracking: input.requires_tracking,
        deducts_from_entitlement: input.deducts_from_entitlement,
        requires_approval: input.requires_approval,
        is_default: false,
      })
      .select("id, organisation_id, name, is_paid, requires_tracking, deducts_from_entitlement, requires_approval, is_default")
      .single();

    if (error) return { success: false, error: error.message };
    return { success: true, absenceType: data as AbsenceType };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "An error occurred" };
  }
}

// ---------------------------------------------------------------------------
// Update an absence type
// ---------------------------------------------------------------------------

export async function updateAbsenceType(
  id: string,
  input: AbsenceTypeInput
): Promise<{ success: boolean; error?: string; absenceType?: AbsenceType }> {
  try {
    const { supabase, membership } = await getCallerOrgMembership();

    if (!input.name.trim()) {
      return { success: false, error: "Name is required" };
    }

    const { data, error } = await supabase
      .from("absence_types")
      .update({
        name: input.name.trim(),
        is_paid: input.is_paid,
        requires_tracking: input.requires_tracking,
        deducts_from_entitlement: input.deducts_from_entitlement,
        requires_approval: input.requires_approval,
      })
      .eq("id", id)
      .eq("organisation_id", membership.organisation_id)
      .select("id, organisation_id, name, is_paid, requires_tracking, deducts_from_entitlement, requires_approval, is_default")
      .single();

    if (error) return { success: false, error: error.message };
    return { success: true, absenceType: data as AbsenceType };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "An error occurred" };
  }
}

// ---------------------------------------------------------------------------
// Delete a custom absence type
// ---------------------------------------------------------------------------

export async function deleteAbsenceType(
  id: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const { supabase, membership } = await getCallerOrgMembership();

    // Check it's not a default type
    const { data: existing } = await supabase
      .from("absence_types")
      .select("is_default")
      .eq("id", id)
      .eq("organisation_id", membership.organisation_id)
      .single();

    if (!existing) return { success: false, error: "Absence type not found" };
    if (existing.is_default) return { success: false, error: "Default absence types cannot be deleted" };

    // Check for linked absence reasons
    const { count } = await supabase
      .from("absence_reasons")
      .select("id", { count: "exact", head: true })
      .eq("absence_type_id", id);

    if (count && count > 0) {
      return { success: false, error: "This type cannot be deleted as it has absence reasons. Remove them first." };
    }

    const { error } = await supabase
      .from("absence_types")
      .delete()
      .eq("id", id)
      .eq("organisation_id", membership.organisation_id);

    if (error) return { success: false, error: error.message };
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "An error occurred" };
  }
}

// ===========================================================================
// Absence Reasons
// ===========================================================================

// ---------------------------------------------------------------------------
// Create a custom absence reason
// ---------------------------------------------------------------------------

export async function createAbsenceReason(
  input: AbsenceReasonCreateInput
): Promise<{ success: boolean; error?: string; reason?: AbsenceReason }> {
  try {
    const { supabase, membership } = await getCallerOrgMembership();

    if (!input.name.trim()) return { success: false, error: "Name is required" };
    if (!input.colour.trim()) return { success: false, error: "Colour is required" };

    const { data, error } = await supabase
      .from("absence_reasons")
      .insert({
        organisation_id: membership.organisation_id,
        absence_type_id: input.absence_type_id,
        name: input.name.trim(),
        colour: input.colour.trim(),
        is_default: false,
      })
      .select("id, organisation_id, absence_type_id, name, colour, is_default")
      .single();

    if (error) return { success: false, error: error.message };
    return { success: true, reason: data as AbsenceReason };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "An error occurred" };
  }
}

// ---------------------------------------------------------------------------
// Update an absence reason
// ---------------------------------------------------------------------------

export async function updateAbsenceReason(
  id: string,
  input: AbsenceReasonUpdateInput
): Promise<{ success: boolean; error?: string; reason?: AbsenceReason }> {
  try {
    const { supabase, membership } = await getCallerOrgMembership();

    if (!input.name.trim()) return { success: false, error: "Name is required" };
    if (!input.colour.trim()) return { success: false, error: "Colour is required" };

    // Check if default — block name changes
    const { data: existing } = await supabase
      .from("absence_reasons")
      .select("is_default, name")
      .eq("id", id)
      .eq("organisation_id", membership.organisation_id)
      .single();

    if (!existing) return { success: false, error: "Absence reason not found" };

    const updatePayload: Record<string, string> = { colour: input.colour.trim() };
    if (!existing.is_default) {
      updatePayload.name = input.name.trim();
    } else if (input.name.trim() !== existing.name) {
      return { success: false, error: "Cannot rename default absence reasons" };
    }

    const { data, error } = await supabase
      .from("absence_reasons")
      .update(updatePayload)
      .eq("id", id)
      .eq("organisation_id", membership.organisation_id)
      .select("id, organisation_id, absence_type_id, name, colour, is_default")
      .single();

    if (error) return { success: false, error: error.message };
    return { success: true, reason: data as AbsenceReason };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "An error occurred" };
  }
}

// ---------------------------------------------------------------------------
// Delete a custom absence reason
// ---------------------------------------------------------------------------

export async function deleteAbsenceReason(
  id: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const { supabase, membership } = await getCallerOrgMembership();

    const { data: existing } = await supabase
      .from("absence_reasons")
      .select("is_default")
      .eq("id", id)
      .eq("organisation_id", membership.organisation_id)
      .single();

    if (!existing) return { success: false, error: "Absence reason not found" };
    if (existing.is_default) return { success: false, error: "Default absence reasons cannot be deleted" };

    // Check for linked holiday bookings
    const { count } = await supabase
      .from("holiday_bookings")
      .select("id", { count: "exact", head: true })
      .eq("leave_reason_id", id);

    if (count && count > 0) {
      return { success: false, error: "This reason cannot be deleted as it has been used in holiday bookings." };
    }

    const { error } = await supabase
      .from("absence_reasons")
      .delete()
      .eq("id", id)
      .eq("organisation_id", membership.organisation_id);

    if (error) return { success: false, error: error.message };
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "An error occurred" };
  }
}

// ===========================================================================
// Holiday / Absence Profiles
// ===========================================================================

export type AbsenceProfile = {
  id: string;
  organisation_id: string;
  name: string;
  absence_type_id: string;
  type: string;
  allowance: number;
  measurement_mode: string;
  carry_over_max: number | null;
  carry_over_max_period: number | null;
  carry_over_min: number | null;
  borrow_ahead_max: number;
  borrow_ahead_max_period: number | null;
  absence_type_name?: string;
};

type AbsenceProfileInput = {
  name: string;
  absence_type_id: string;
  type: string;
  allowance: number;
  measurement_mode: string;
  carry_over_max: number | null;
  carry_over_max_period: number | null;
  carry_over_min: number | null;
  borrow_ahead_max: number;
  borrow_ahead_max_period: number | null;
};

const PROFILE_SELECT = "id, organisation_id, name, absence_type_id, type, allowance, measurement_mode, carry_over_max, carry_over_max_period, carry_over_min, borrow_ahead_max, borrow_ahead_max_period";

// ---------------------------------------------------------------------------
// Create a holiday profile
// ---------------------------------------------------------------------------

export async function createAbsenceProfile(
  input: AbsenceProfileInput
): Promise<{ success: boolean; error?: string; profile?: AbsenceProfile }> {
  try {
    const { supabase, membership } = await getCallerOrgMembership();

    if (!input.name.trim()) return { success: false, error: "Name is required" };
    if (!input.absence_type_id) return { success: false, error: "Absence type is required" };

    const { data, error } = await supabase
      .from("absence_profiles")
      .insert({
        organisation_id: membership.organisation_id,
        name: input.name.trim(),
        absence_type_id: input.absence_type_id,
        type: input.type,
        allowance: input.allowance,
        measurement_mode: input.measurement_mode,
        carry_over_max: input.carry_over_max,
        carry_over_max_period: input.carry_over_max_period,
        carry_over_min: input.carry_over_min,
        borrow_ahead_max: input.borrow_ahead_max,
        borrow_ahead_max_period: input.borrow_ahead_max_period,
      })
      .select(PROFILE_SELECT)
      .single();

    if (error) return { success: false, error: error.message };
    return { success: true, profile: data as AbsenceProfile };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "An error occurred" };
  }
}

// ---------------------------------------------------------------------------
// Update a holiday profile
// ---------------------------------------------------------------------------

export async function updateAbsenceProfile(
  id: string,
  input: AbsenceProfileInput
): Promise<{ success: boolean; error?: string; profile?: AbsenceProfile }> {
  try {
    const { supabase, membership } = await getCallerOrgMembership();

    if (!input.name.trim()) return { success: false, error: "Name is required" };

    const { data, error } = await supabase
      .from("absence_profiles")
      .update({
        name: input.name.trim(),
        absence_type_id: input.absence_type_id,
        type: input.type,
        allowance: input.allowance,
        measurement_mode: input.measurement_mode,
        carry_over_max: input.carry_over_max,
        carry_over_max_period: input.carry_over_max_period,
        carry_over_min: input.carry_over_min,
        borrow_ahead_max: input.borrow_ahead_max,
        borrow_ahead_max_period: input.borrow_ahead_max_period,
      })
      .eq("id", id)
      .eq("organisation_id", membership.organisation_id)
      .select(PROFILE_SELECT)
      .single();

    if (error) return { success: false, error: error.message };
    return { success: true, profile: data as AbsenceProfile };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "An error occurred" };
  }
}

// ---------------------------------------------------------------------------
// Delete a holiday profile
// ---------------------------------------------------------------------------

export async function deleteAbsenceProfile(
  id: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const { supabase, membership } = await getCallerOrgMembership();

    const { error } = await supabase
      .from("absence_profiles")
      .delete()
      .eq("id", id)
      .eq("organisation_id", membership.organisation_id);

    if (error) return { success: false, error: error.message };
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "An error occurred" };
  }
}

// ===========================================================================
// Employee Entitlement Adjustments (CLE-22)
// ===========================================================================

export async function adjustEmployeeEntitlement(
  memberId: string,
  absenceTypeId: string,
  yearStart: string,
  amount: number,
  reason: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const { supabase, membership } = await getCallerOrgMembership();

    if (!reason.trim()) return { success: false, error: "Reason is required" };
    if (amount === 0) return { success: false, error: "Adjustment amount cannot be zero" };

    // Verify member belongs to caller's org
    const { data: targetMember } = await supabase
      .from("members")
      .select("id")
      .eq("id", memberId)
      .eq("organisation_id", membership.organisation_id)
      .single();

    if (!targetMember) return { success: false, error: "Member not found in your organisation" };

    // Find the holiday year record
    const { data: record } = await supabase
      .from("holiday_year_records")
      .select("id, adjustment")
      .eq("member_id", memberId)
      .eq("absence_type_id", absenceTypeId)
      .eq("year_start", yearStart)
      .single();

    if (!record) return { success: false, error: "No holiday year record found for this period" };

    const newAdjustment = Number(record.adjustment) + amount;

    const { error } = await supabase
      .from("holiday_year_records")
      .update({ adjustment: newAdjustment })
      .eq("id", record.id);

    if (error) return { success: false, error: error.message };
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "An error occurred" };
  }
}
