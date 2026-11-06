export const dynamic = 'force-dynamic';

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// `?next=` (2026-11-06) — used by the login page's "This link was sent to
// someone else" notice to sign out and come back to the same link.
// Internal paths only.
export default async function LogoutPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const supabase = await createClient();
  await supabase.auth.signOut();
  const safe = typeof next === "string" && next.startsWith("/") && !next.startsWith("//") ? next : "/";
  redirect(safe);
}
