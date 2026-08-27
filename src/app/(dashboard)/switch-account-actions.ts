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
  // Rights Profiles v2 — display the User Rights profile name
  // (e.g. "Admin", "HR", "Manager", "Employee" or any custom
  // profile) rather than the legacy members.role string.
  profile_name: string | null;
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
      .select("id, first_name, last_name, email, rights_profiles(name)")
      .eq("organisation_id", membership.organisation_id)
      .not("user_id", "is", null)
      .order("first_name");

    if (error) return { success: false, error: error.message };

    // Flatten the joined rights_profiles.name into profile_name so the
    // client renders the same label the user sees in Settings → User
    // Rights, not the legacy members.role string.
    type Row = {
      id: string;
      first_name: string;
      last_name: string;
      email: string;
      rights_profiles: { name: string } | null;
    };
    const rows = (data ?? []) as unknown as Row[];
    const members: SwitchableMember[] = rows.map((r) => ({
      id: r.id,
      first_name: r.first_name,
      last_name: r.last_name,
      email: r.email,
      profile_name: r.rights_profiles?.name ?? null,
    }));
    return { success: true, members };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : "An error occurred",
    };
  }
}
