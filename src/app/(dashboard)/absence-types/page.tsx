export const dynamic = "force-dynamic";

import { createClient } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";
import { AbsenceTypesClient } from "./absence-types-client";
import type { AbsenceType, AbsenceReason } from "../absence-actions";

export default async function AbsenceTypesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: membership } = await supabase
    .from("members")
    .select("id, organisation_id, role")
    .eq("user_id", user.id)
    .limit(1)
    .single();

  if (!membership) redirect("/login");
  if (membership.role !== "owner" && membership.role !== "admin") notFound();

  const [{ data: absenceTypes }, { data: absenceReasons }] = await Promise.all([
    supabase
      .from("absence_types")
      .select("id, organisation_id, name, colour, is_paid, requires_tracking, deducts_from_entitlement, requires_approval, is_default")
      .eq("organisation_id", membership.organisation_id)
      .order("is_default", { ascending: false })
      .order("name"),
    supabase
      .from("absence_reasons")
      .select("id, organisation_id, absence_type_id, name, colour, is_default, is_deprecated")
      .eq("organisation_id", membership.organisation_id)
      .order("is_default", { ascending: false })
      .order("name"),
  ]);

  return (
    <div className="w-full px-4 py-8 sm:px-6 lg:px-8">
      <AbsenceTypesClient
        initialTypes={(absenceTypes ?? []) as AbsenceType[]}
        initialReasons={(absenceReasons ?? []) as AbsenceReason[]}
      />
    </div>
  );
}
