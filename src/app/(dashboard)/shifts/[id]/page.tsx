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

  // Fetch org rates for the band rate selector
  const { data: rawRates } = await supabase
    .from("rates")
    .select("id, name, rate_multiplier")
    .eq("organisation_id", membership.organisation_id)
    .order("sort_order");

  const rates = (rawRates ?? []) as { id: string; name: string; rate_multiplier: number }[];

  const isNew = id === "new";

  // For new shifts, return a blank shell
  if (isNew) {
    return (
      <ShiftDefinitionClient
        organisationId={membership.organisation_id}
        shiftDef={null}
        breakRules={[]}
        overtimeAfterRules={[]}
        overtimeBands={[]}
        rates={rates}
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
      .select("break_rules")
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("overtime_after_rules")
      .select("id, period, threshold_hours, sort_order")
      .eq("shift_definition_id", id)
      .order("sort_order"),
    supabase
      .from("overtime_bands")
      .select("id, rate_id, from_time, to_time, min_time, sort_order")
      .eq("shift_definition_id", id)
      .order("sort_order"),
  ]);

  if (!shiftDef) notFound();

  const breakRules = (rawBreaks?.break_rules ?? []) as {
    band_start:    string;
    band_end:      string;
    allowed_break: string;
    penalty_break: string | null;
    paid:          boolean;
    rate_id:       string | null;
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
      breakRules={breakRules}
      overtimeAfterRules={(overtimeAfterRules ?? []) as {
        id: string;
        period: string;
        threshold_hours: number;
        sort_order: number;
      }[]}
      overtimeBands={(overtimeBands ?? []).map((b) => ({
        id:         b.id as string,
        rate_id:    (b.rate_id ?? null) as string | null,
        from_time:  ((b.from_time as string) ?? "00:00").slice(0, 5),
        to_time:    b.to_time ? (b.to_time as string).slice(0, 5) : null,
        min_time:   b.min_time ? (b.min_time as string).slice(0, 5) : null,
        sort_order: b.sort_order as number,
      }))}
      rates={rates}
    />
  );
}
