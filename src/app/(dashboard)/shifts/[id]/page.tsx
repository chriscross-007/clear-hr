export const dynamic = "force-dynamic";

import { createClient } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";
import { ShiftDefinitionClient } from "./shift-definition-client";

export default async function ShiftDefinitionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: membership } = await supabase
    .from("members")
    .select("id, organisation_id, role")
    .eq("user_id", user.id)
    .limit(1)
    .single();

  if (!membership) redirect("/login");
  if (membership.role !== "owner" && membership.role !== "admin") notFound();

  const isNew = id === "new";

  // For new shifts, return a blank shell
  if (isNew) {
    return (
      <ShiftDefinitionClient
        organisationId={membership.organisation_id}
        shiftDef={null}
        breaks={[]}
        overtimeAfterRules={[]}
        overtimeBands={[]}
      />
    );
  }

  const [
    { data: shiftDef },
    { data: rawBreaks },
    { data: overtimeAfterRules },
    { data: overtimeBands },
  ] = await Promise.all([
    supabase
      .from("shift_definitions")
      .select("id, name, is_open_shift, planned_start, planned_end, crosses_midnight, break_type, active, sort_order")
      .eq("id", id)
      .eq("organisation_id", membership.organisation_id)
      .maybeSingle(),
    supabase
      .from("shift_definitions")
      .select("breaks")
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("overtime_after_rules")
      .select("id, period, threshold_hours, sort_order")
      .eq("shift_definition_id", id)
      .order("sort_order"),
    supabase
      .from("overtime_bands")
      .select("id, name, from_hour, to_hour, rate_multiplier, sort_order")
      .eq("shift_definition_id", id)
      .order("sort_order"),
  ]);

  if (!shiftDef) notFound();

  const breaks = (rawBreaks?.breaks ?? []) as {
    start: string;
    end: string;
    duration_mins: number;
  }[];

  return (
    <ShiftDefinitionClient
      organisationId={membership.organisation_id}
      shiftDef={{
        id: shiftDef.id,
        name: shiftDef.name,
        isOpenShift: shiftDef.is_open_shift,
        plannedStart: shiftDef.planned_start,
        plannedEnd: shiftDef.planned_end,
        crossesMidnight: shiftDef.crosses_midnight,
        breakType: shiftDef.break_type,
        active: shiftDef.active,
        sortOrder: shiftDef.sort_order,
      }}
      breaks={breaks}
      overtimeAfterRules={(overtimeAfterRules ?? []) as {
        id: string;
        period: string;
        threshold_hours: number;
        sort_order: number;
      }[]}
      overtimeBands={(overtimeBands ?? []) as {
        id: string;
        name: string;
        from_hour: number;
        to_hour: number | null;
        rate_multiplier: number;
        sort_order: number;
      }[]}
    />
  );
}
