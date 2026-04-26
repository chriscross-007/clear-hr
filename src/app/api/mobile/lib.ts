import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export function getAdminClient(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } },
  );
}

/**
 * Verifies a `Authorization: Bearer <token>` header against Supabase auth and
 * returns the caller's admin client + user + organisation_id (resolved from
 * their members row). Used by every /api/mobile/* route.
 */
export async function verifyCaller(request: Request): Promise<
  | { error: string; status: number }
  | { admin: SupabaseClient; user: { id: string; email?: string | null }; organisationId: string }
> {
  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) return { error: "Missing token", status: 401 };

  const admin = getAdminClient();
  const { data: { user }, error: authErr } = await admin.auth.getUser(token);
  if (authErr || !user) return { error: "Invalid token", status: 401 };

  const { data: membership } = await admin
    .from("members")
    .select("organisation_id")
    .eq("user_id", user.id)
    .limit(1)
    .single();
  if (!membership) return { error: "No organisation", status: 403 };

  return { admin, user, organisationId: membership.organisation_id as string };
}
