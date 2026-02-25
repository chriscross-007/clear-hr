"use server";

import { createClient } from "@/lib/supabase/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

function createAdminClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    }
  );
}

export type SwitchableMember = {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  role: string;
};

export async function getSwitchableMembers(): Promise<{
  success: boolean;
  error?: string;
  members?: SwitchableMember[];
}> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error("Not authenticated");

    const { data: membership } = await supabase
      .from("members")
      .select("organisation_id")
      .eq("user_id", user.id)
      .limit(1)
      .single();

    if (!membership) throw new Error("No organisation");

    const admin = createAdminClient();
    const { data, error } = await admin
      .from("members")
      .select("id, first_name, last_name, email, role")
      .eq("organisation_id", membership.organisation_id)
      .not("user_id", "is", null)
      .order("first_name");

    if (error) return { success: false, error: error.message };

    return { success: true, members: data as SwitchableMember[] };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : "An error occurred",
    };
  }
}
