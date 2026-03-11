"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { hasPlanFeature } from "@/lib/plan-config";
import type { ColPref } from "@/lib/grid-prefs-actions";

// ---------------------------------------------------------------------------
// Caller helper
// ---------------------------------------------------------------------------

async function getCallerMembership() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new Error("Not authenticated");

  const { data: membership } = await supabase
    .from("members")
    .select("id, organisation_id, role, permissions")
    .eq("user_id", user.id)
    .limit(1)
    .single();

  if (!membership) throw new Error("No organisation");

  const { data: org } = await supabase
    .from("organisations")
    .select("plan")
    .eq("id", membership.organisation_id)
    .single();

  return { supabase, user, membership, plan: (org?.plan ?? "lite") as string };
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CustomReport = {
  id: string;
  organisation_id: string;
  created_by: string;
  name: string;
  based_on: string;
  shared: boolean;
  prefs: { columns?: ColPref[]; filters?: Record<string, unknown>; groupBy?: string; pdfPageBreak?: boolean; pdfRepeatHeaders?: boolean; aggregateMetrics?: string[] };
  created_at: string;
  updated_at: string;
};

// ---------------------------------------------------------------------------
// Custom reports
// ---------------------------------------------------------------------------

export async function getCustomReports(): Promise<{
  success: boolean;
  error?: string;
  reports?: CustomReport[];
}> {
  try {
    const { supabase } = await getCallerMembership();
    const { data, error } = await supabase
      .from("custom_reports")
      .select("*")
      .order("name");
    if (error) return { success: false, error: error.message };
    return { success: true, reports: (data ?? []) as CustomReport[] };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "An error occurred" };
  }
}

export async function createCustomReport(input: {
  name: string;
  based_on: string;
  shared?: boolean;
  prefs?: { columns?: ColPref[]; filters?: Record<string, unknown>; groupBy?: string; pdfPageBreak?: boolean; pdfRepeatHeaders?: boolean; aggregateMetrics?: string[] };
}): Promise<{ success: boolean; error?: string; report?: CustomReport }> {
  try {
    const { supabase, membership, plan } = await getCallerMembership();

    if (!hasPlanFeature(plan, "custom_reports")) {
      return { success: false, error: "Custom reports require a Pro or higher plan" };
    }

    if (membership.role !== "owner" && membership.role !== "admin") {
      return { success: false, error: "Only owners and admins can create custom reports" };
    }

    const { data, error } = await supabase
      .from("custom_reports")
      .insert({
        organisation_id: membership.organisation_id,
        created_by: membership.id,
        name: input.name.trim(),
        based_on: input.based_on,
        shared: input.shared ?? false,
        prefs: input.prefs ?? {},
      })
      .select("*")
      .single();

    if (error) return { success: false, error: error.message };
    revalidatePath("/", "layout");
    return { success: true, report: data as CustomReport };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "An error occurred" };
  }
}

export async function updateCustomReport(
  id: string,
  input: {
    name?: string;
    shared?: boolean;
    prefs?: { columns?: ColPref[]; filters?: Record<string, unknown>; groupBy?: string; pdfPageBreak?: boolean; pdfRepeatHeaders?: boolean; aggregateMetrics?: string[] };
  }
): Promise<{ success: boolean; error?: string }> {
  try {
    const { supabase } = await getCallerMembership();

    const update: Record<string, unknown> = {};
    if (input.name !== undefined) update.name = input.name.trim();
    if (input.shared !== undefined) update.shared = input.shared;
    if (input.prefs !== undefined) update.prefs = input.prefs;

    const { error } = await supabase
      .from("custom_reports")
      .update(update)
      .eq("id", id);

    if (error) return { success: false, error: error.message };
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "An error occurred" };
  }
}

export async function deleteCustomReport(id: string): Promise<{ success: boolean; error?: string }> {
  try {
    const { supabase } = await getCallerMembership();
    const { error } = await supabase.from("custom_reports").delete().eq("id", id);
    if (error) return { success: false, error: error.message };
    revalidatePath("/", "layout");
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "An error occurred" };
  }
}

// ---------------------------------------------------------------------------
// Favourites
// ---------------------------------------------------------------------------

export async function getFavourites(): Promise<{ success: boolean; error?: string; ids?: string[] }> {
  try {
    const { supabase, user } = await getCallerMembership();
    const { data, error } = await supabase
      .from("report_favourites")
      .select("report_id")
      .eq("user_id", user.id);
    if (error) return { success: false, error: error.message };
    return { success: true, ids: (data ?? []).map((r: { report_id: string }) => r.report_id) };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "An error occurred" };
  }
}

export async function toggleFavourite(reportId: string): Promise<{
  success: boolean;
  error?: string;
  isFavourited?: boolean;
}> {
  try {
    const { supabase, user } = await getCallerMembership();

    // Check if already favourited
    const { data: existing } = await supabase
      .from("report_favourites")
      .select("report_id")
      .eq("user_id", user.id)
      .eq("report_id", reportId)
      .maybeSingle();

    if (existing) {
      const { error } = await supabase
        .from("report_favourites")
        .delete()
        .eq("user_id", user.id)
        .eq("report_id", reportId);
      if (error) return { success: false, error: error.message };
      revalidatePath("/", "layout");
      return { success: true, isFavourited: false };
    } else {
      const { error } = await supabase
        .from("report_favourites")
        .insert({ user_id: user.id, report_id: reportId });
      if (error) return { success: false, error: error.message };
      revalidatePath("/", "layout");
      return { success: true, isFavourited: true };
    }
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "An error occurred" };
  }
}
