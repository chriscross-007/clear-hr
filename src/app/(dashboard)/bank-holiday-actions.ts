"use server";

import { createClient } from "@/lib/supabase/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { headers } from "next/headers";

function getAdminClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }
  );
}

export async function getOrgCountryCode(): Promise<string> {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return "england-and-wales";
    const { data: member } = await supabase
      .from("members")
      .select("organisation_id")
      .eq("user_id", user.id)
      .limit(1)
      .single();
    if (!member) return "england-and-wales";
    const admin = getAdminClient();
    const { data: org } = await admin
      .from("organisations")
      .select("country_code")
      .eq("id", member.organisation_id)
      .single();
    return org?.country_code ?? "england-and-wales";
  } catch {
    return "england-and-wales";
  }
}

export type BankHolidayEntry = {
  id: string;
  date: string;
  name: string;
};

export async function seedBankHolidays(): Promise<{
  success: boolean;
  error?: string;
  inserted?: number;
  skipped?: number;
}> {
  try {
    const headersList = await headers();
    const host = headersList.get("host") ?? "localhost:3000";
    const protocol = host.includes("localhost") ? "http" : "https";

    // Forward the caller's cookies so the API route can verify auth
    const cookieHeader = headersList.get("cookie") ?? "";

    const res = await fetch(`${protocol}://${host}/api/admin/seed-bank-holidays`, {
      method: "POST",
      headers: { cookie: cookieHeader },
    });

    const data = await res.json();
    if (!res.ok) return { success: false, error: data.error ?? "Failed to seed" };
    return { success: true, inserted: data.inserted, skipped: data.skipped };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "An error occurred" };
  }
}

export async function getBankHolidays(): Promise<{
  success: boolean;
  error?: string;
  holidays?: BankHolidayEntry[];
}> {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: "Not authenticated" };

    const { data: member } = await supabase
      .from("members")
      .select("organisation_id")
      .eq("user_id", user.id)
      .limit(1)
      .single();

    if (!member) return { success: false, error: "No organisation" };

    const admin = getAdminClient();

    // Get org's country_code
    const { data: org } = await admin
      .from("organisations")
      .select("country_code")
      .eq("id", member.organisation_id)
      .single();

    const countryCode = org?.country_code ?? "england-and-wales";

    // Fetch bank holidays: shared (org_id = null) for this country + org-specific
    const { data, error } = await admin
      .from("bank_holidays")
      .select("id, date, name, is_excluded, organisation_id")
      .eq("country_code", countryCode)
      .or(`organisation_id.is.null,organisation_id.eq.${member.organisation_id}`)
      .order("date", { ascending: true });

    if (error) return { success: false, error: error.message };

    // Filter out excluded holidays
    const excluded = new Set<string>();
    const holidays: BankHolidayEntry[] = [];
    for (const bh of data ?? []) {
      if (bh.organisation_id && bh.is_excluded) {
        excluded.add(bh.date);
      } else if (!excluded.has(bh.date)) {
        holidays.push({ id: bh.id, date: bh.date, name: bh.name });
      }
    }

    return { success: true, holidays };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "An error occurred" };
  }
}
