"use server";

import { createClient } from "@/lib/supabase/server";

export type ColPref = { id: string; visible: boolean };

export async function saveGridPrefs(
  gridId: string,
  prefs: ColPref[]
): Promise<{ success: boolean; error?: string }> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) return { success: false, error: "Not authenticated" };

    const { error } = await supabase
      .from("user_grid_preferences")
      .upsert(
        { user_id: user.id, grid_id: gridId, prefs, updated_at: new Date().toISOString() },
        { onConflict: "user_id,grid_id" }
      );

    if (error) return { success: false, error: error.message };
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "An error occurred" };
  }
}
