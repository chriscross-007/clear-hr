"use client";

// CLE-191 — Timesheet Settings form. Lifted from the Timesheet tab of
// the old OrganisationEditDialog. Partial-update via updateOrganisation
// (name + member_label are now optional on that action).

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Info } from "lucide-react";
import { updateOrganisation } from "@/app/(dashboard)/organisation-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface TimesheetSettingsFormProps {
  initialMaxShiftHours: number;
  initialMaxBreakMinutes: number;
  initialShiftStartVariance: number;
  initialRoundFirstIn: number | null;
  initialRoundFirstInGrace: number | null;
  initialRoundBreakOut: number | null;
  initialRoundBreakOutGrace: number | null;
  initialRoundBreakIn: number | null;
  initialRoundBreakInGrace: number | null;
  initialRoundLastOut: number | null;
  initialRoundLastOutGrace: number | null;
}

export function TimesheetSettingsForm(props: TimesheetSettingsFormProps) {
  const router = useRouter();

  const [maxShiftHours, setMaxShiftHours] = useState(props.initialMaxShiftHours);
  const [maxBreakMinutes, setMaxBreakMinutes] = useState(props.initialMaxBreakMinutes);
  const [shiftStartVariance, setShiftStartVariance] = useState(props.initialShiftStartVariance);
  const [roundFirstIn, setRoundFirstIn] = useState<number | null>(props.initialRoundFirstIn);
  const [roundFirstInGrace, setRoundFirstInGrace] = useState<number | null>(props.initialRoundFirstInGrace);
  const [roundBreakOut, setRoundBreakOut] = useState<number | null>(props.initialRoundBreakOut);
  const [roundBreakOutGrace, setRoundBreakOutGrace] = useState<number | null>(props.initialRoundBreakOutGrace);
  const [roundBreakIn, setRoundBreakIn] = useState<number | null>(props.initialRoundBreakIn);
  const [roundBreakInGrace, setRoundBreakInGrace] = useState<number | null>(props.initialRoundBreakInGrace);
  const [roundLastOut, setRoundLastOut] = useState<number | null>(props.initialRoundLastOut);
  const [roundLastOutGrace, setRoundLastOutGrace] = useState<number | null>(props.initialRoundLastOutGrace);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);

  async function handleSave() {
    setSaving(true);
    setError(null);
    setSavedFlash(false);
    const result = await updateOrganisation({
      tsMaxShiftHours: maxShiftHours,
      tsMaxBreakMinutes: maxBreakMinutes,
      tsShiftStartVarianceMinutes: shiftStartVariance,
      tsRoundFirstInMins: roundFirstIn,
      tsRoundFirstInGraceMins: roundFirstInGrace,
      tsRoundBreakOutMins: roundBreakOut,
      tsRoundBreakOutGraceMins: roundBreakOutGrace,
      tsRoundBreakInMins: roundBreakIn,
      tsRoundBreakInGraceMins: roundBreakInGrace,
      tsRoundLastOutMins: roundLastOut,
      tsRoundLastOutGraceMins: roundLastOutGrace,
    });
    setSaving(false);
    if (!result.success) {
      setError(result.error ?? "Failed to save");
      return;
    }
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 2500);
    router.refresh();
  }

  const rows: {
    label: string;
    interval: number | null;
    setInterval: (v: number | null) => void;
    grace: number | null;
    setGrace: (v: number | null) => void;
  }[] = [
    { label: "1st IN", interval: roundFirstIn, setInterval: setRoundFirstIn, grace: roundFirstInGrace, setGrace: setRoundFirstInGrace },
    { label: "Break OUT", interval: roundBreakOut, setInterval: setRoundBreakOut, grace: roundBreakOutGrace, setGrace: setRoundBreakOutGrace },
    { label: "Break IN", interval: roundBreakIn, setInterval: setRoundBreakIn, grace: roundBreakInGrace, setGrace: setRoundBreakInGrace },
    { label: "Last OUT", interval: roundLastOut, setInterval: setRoundLastOut, grace: roundLastOutGrace, setGrace: setRoundLastOutGrace },
  ];

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div>
      )}
      {savedFlash && (
        <div className="rounded-md bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 p-3 text-sm text-green-700 dark:text-green-300">
          Saved.
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Shift detection</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <div className="flex items-center gap-1.5">
              <Label htmlFor="ts-max-shift-hours">Maximum Shift Length (hours)</Label>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Info className="h-4 w-4 text-muted-foreground cursor-help" />
                </TooltipTrigger>
                <TooltipContent side="right" className="max-w-xs">
                  <p>The longest a single shift can be. Clockings beyond this duration from a shift start are treated as a new shift.</p>
                </TooltipContent>
              </Tooltip>
            </div>
            <Input
              id="ts-max-shift-hours"
              type="number"
              min={1}
              max={24}
              step={1}
              value={maxShiftHours}
              onChange={(e) => setMaxShiftHours(Number(e.target.value))}
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-1.5">
              <Label htmlFor="ts-max-break-minutes">Maximum Break Length (minutes)</Label>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Info className="h-4 w-4 text-muted-foreground cursor-help" />
                </TooltipTrigger>
                <TooltipContent side="right" className="max-w-xs">
                  <p>The maximum gap between clockings that can be treated as a break. Longer gaps indicate the end of a shift.</p>
                </TooltipContent>
              </Tooltip>
            </div>
            <Input
              id="ts-max-break-minutes"
              type="number"
              min={1}
              max={480}
              step={1}
              value={maxBreakMinutes}
              onChange={(e) => setMaxBreakMinutes(Number(e.target.value))}
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-1.5">
              <Label htmlFor="ts-shift-start-variance">Shift Start Variance (minutes)</Label>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Info className="h-4 w-4 text-muted-foreground cursor-help" />
                </TooltipTrigger>
                <TooltipContent side="right" className="max-w-xs">
                  <p>How many minutes either side of a scheduled shift start a clocking can be treated as a shift start.</p>
                </TooltipContent>
              </Tooltip>
            </div>
            <Input
              id="ts-shift-start-variance"
              type="number"
              min={0}
              max={120}
              step={1}
              value={shiftStartVariance}
              onChange={(e) => setShiftStartVariance(Number(e.target.value))}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Time rounding</CardTitle>
          <p className="text-xs text-muted-foreground">
            Round clocking times when calculating hours. Clock-in times round forward (later); clock-out times round backward (earlier). Leave blank for no rounding.
          </p>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border border-border divide-y divide-border text-sm">
            <div className="flex items-center px-3 py-1.5 gap-3 bg-muted/40">
              <span className="w-24 shrink-0" />
              <span className="w-20 text-right text-xs text-muted-foreground font-medium">Interval</span>
              <span className="w-20 text-right text-xs text-muted-foreground font-medium">Grace</span>
            </div>
            {rows.map(({ label, interval, setInterval, grace, setGrace }) => (
              <div key={label} className="flex items-center px-3 py-2 gap-3">
                <span className="text-muted-foreground w-24 shrink-0">{label}</span>
                <Input
                  type="number"
                  min={1}
                  max={60}
                  step={1}
                  placeholder="None"
                  value={interval ?? ""}
                  onChange={(e) => {
                    const v = e.target.value;
                    setInterval(v === "" ? null : Math.max(1, Math.min(60, parseInt(v, 10))));
                  }}
                  className="h-7 w-20 text-right"
                />
                <Input
                  type="number"
                  min={0}
                  max={30}
                  step={1}
                  placeholder="0"
                  value={grace ?? ""}
                  onChange={(e) => {
                    const v = e.target.value;
                    setGrace(v === "" ? null : Math.max(0, Math.min(30, parseInt(v, 10))));
                  }}
                  className="h-7 w-20 text-right"
                  disabled={!interval}
                />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={saving}>
          {saving ? "Saving…" : "Save changes"}
        </Button>
      </div>
    </div>
  );
}
