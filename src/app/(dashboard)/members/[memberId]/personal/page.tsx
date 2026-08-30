export const dynamic = "force-dynamic";

import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getEffectiveRightsForUser } from "@/lib/rights-resolver";
import { PlaceholderSection } from "../placeholder";

export default async function PersonalPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const resolved = await getEffectiveRightsForUser(user.id);
  if (!resolved || !resolved.rights.tabs.personal?.view) notFound();
  return <PlaceholderSection title="Personal" />;
}
