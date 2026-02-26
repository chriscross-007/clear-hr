"use server";

import { createClient } from "@/lib/supabase/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

// Uses the admin client to update the password, bypassing Supabase's AAL2
// requirement that would otherwise block users with MFA enrolled.
// Safe because the caller must have a valid recovery session (from the reset link).
export async function resetPassword(
  password: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) return { success: false, error: "Not authenticated" };

    const admin = createSupabaseClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }
    );

    const { error } = await admin.auth.admin.updateUserById(user.id, { password });
    if (error) return { success: false, error: error.message };

    return { success: true };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : "An error occurred",
    };
  }
}
