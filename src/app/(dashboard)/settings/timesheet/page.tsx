export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { TimesheetSettingsForm } from "./timesheet-form";

// CLE-191 — /settings/timesheet. Shift / break / variance / time
// rounding rules. Lifts the Timesheet tab from the old dialog.

export default async function TimesheetSettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: caller } = await supabase
    .from("members")
    .select("organisation_id")
    .eq("user_id", user.id)
    .limit(1)
    .single();
  if (!caller) redirect("/organisation-setup");

  // CLE-196b-5 — Timesheet settings gated by canEditOrgSettings.
  const { getEffectiveRightsForUser } = await import("@/lib/rights-resolver");
  const resolved = await getEffectiveRightsForUser(user.id);
  if (!resolved?.rights.canEditOrgSettings) redirect("/dashboard");

  const { data: org } = await supabase
    .from("organisations")
    .select(
      "ts_max_shift_hours, ts_max_break_minutes, ts_shift_start_variance_minutes, ts_round_first_in_mins, ts_round_first_in_grace_mins, ts_round_break_out_mins, ts_round_break_out_grace_mins, ts_round_break_in_mins, ts_round_break_in_grace_mins, ts_round_last_out_mins, ts_round_last_out_grace_mins",
    )
    .eq("id", caller.organisation_id)
    .single();
  if (!org) redirect("/organisation-setup");

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <div>
        <h1 className="text-2xl font-bold">Timesheet</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Shift length, break length, shift-start variance, and clock rounding.
        </p>
      </div>
      <TimesheetSettingsForm
        initialMaxShiftHours={Number(org.ts_max_shift_hours ?? 12)}
        initialMaxBreakMinutes={Number(org.ts_max_break_minutes ?? 60)}
        initialShiftStartVariance={Number(org.ts_shift_start_variance_minutes ?? 30)}
        initialRoundFirstIn={org.ts_round_first_in_mins != null ? Number(org.ts_round_first_in_mins) : null}
        initialRoundFirstInGrace={org.ts_round_first_in_grace_mins != null ? Number(org.ts_round_first_in_grace_mins) : null}
        initialRoundBreakOut={org.ts_round_break_out_mins != null ? Number(org.ts_round_break_out_mins) : null}
        initialRoundBreakOutGrace={org.ts_round_break_out_grace_mins != null ? Number(org.ts_round_break_out_grace_mins) : null}
        initialRoundBreakIn={org.ts_round_break_in_mins != null ? Number(org.ts_round_break_in_mins) : null}
        initialRoundBreakInGrace={org.ts_round_break_in_grace_mins != null ? Number(org.ts_round_break_in_grace_mins) : null}
        initialRoundLastOut={org.ts_round_last_out_mins != null ? Number(org.ts_round_last_out_mins) : null}
        initialRoundLastOutGrace={org.ts_round_last_out_grace_mins != null ? Number(org.ts_round_last_out_grace_mins) : null}
      />
    </div>
  );
}
