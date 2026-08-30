export const dynamic = "force-dynamic";

import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getEffectiveRightsForUser } from "@/lib/rights-resolver";
import { DocsClient } from "./docs-client";

export default async function DocsPage({
  params,
}: {
  params: Promise<{ memberId: string }>;
}) {
  const { memberId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const resolved = await getEffectiveRightsForUser(user.id);
  if (!resolved || !resolved.rights.tabs.documents?.view) notFound();
  return <DocsClient memberId={memberId} />;
}
