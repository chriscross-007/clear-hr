export const dynamic = "force-dynamic";

import { createClient } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";
import { HolidayProfilesClient } from "./holiday-profiles-client";
import type { AbsenceProfile, AbsenceType } from "../absence-actions";

export default async function HolidayProfilesPage() {
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

  const [{ data: profiles }, { data: absenceTypes }] = await Promise.all([
    supabase
      .from("absence_profiles")
      .select("id, organisation_id, name, absence_type_id, type, allowance, measurement_mode, carry_over_max, carry_over_max_period, carry_over_min, borrow_ahead_max, borrow_ahead_max_period, absence_types(name)")
      .eq("organisation_id", membership.organisation_id)
      .order("name"),
    supabase
      .from("absence_types")
      .select("id, organisation_id, name, is_paid, requires_tracking, deducts_from_entitlement, requires_approval, is_default")
      .eq("organisation_id", membership.organisation_id)
      .order("name"),
  ]);

  // Flatten the joined absence_types(name) into absence_type_name
  const profilesWithTypeName = (profiles ?? []).map((p) => {
    const joined = p.absence_types as unknown as { name: string } | null;
    return {
      id: p.id,
      organisation_id: p.organisation_id,
      name: p.name,
      absence_type_id: p.absence_type_id,
      type: p.type,
      allowance: p.allowance,
      measurement_mode: p.measurement_mode,
      carry_over_max: p.carry_over_max,
      carry_over_max_period: p.carry_over_max_period,
      carry_over_min: p.carry_over_min,
      borrow_ahead_max: p.borrow_ahead_max,
      borrow_ahead_max_period: p.borrow_ahead_max_period,
      absence_type_name: joined?.name ?? "—",
    } as AbsenceProfile;
  });

  return (
    <div className="w-full px-4 py-8 sm:px-6 lg:px-8">
      <HolidayProfilesClient
        initialProfiles={profilesWithTypeName}
        absenceTypes={(absenceTypes ?? []) as AbsenceType[]}
      />
    </div>
  );
}
