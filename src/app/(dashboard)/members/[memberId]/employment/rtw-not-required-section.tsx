"use client";

// CLE-207 — Right-to-Work opt-out toggle on the Employment page.
// Owned by Employee Records but the compliance dashboard reads it to
// exclude opted-out members from RTW-flagged subtypes.

import { useState, useTransition } from "react";
import { Loader2, ShieldOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { setRtwNotRequired } from "@/app/(dashboard)/documents/compliance-actions";
import { useRouter } from "next/navigation";

interface Props {
  memberId: string;
  initial: {
    rtwNotRequired: boolean;
    reason: string | null;
  };
  canEdit: boolean;
}

export function RtwNotRequiredSection({ memberId, initial, canEdit }: Props) {
  const router = useRouter();
  const [rtwNotRequired, setRtwNotRequiredState] = useState<boolean>(initial.rtwNotRequired);
  const [reason, setReason] = useState<string>(initial.reason ?? "");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const hasChanges =
    rtwNotRequired !== initial.rtwNotRequired ||
    (rtwNotRequired && (reason.trim() !== (initial.reason ?? "").trim()));

  function handleSave() {
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      const res = await setRtwNotRequired(memberId, {
        rtwNotRequired,
        reason: rtwNotRequired ? reason.trim() : null,
      });
      if (!res.success) {
        setError(res.error ?? "Failed to save");
        return;
      }
      setSuccess("Saved.");
      router.refresh();
    });
  }

  return (
    <div className="rounded-lg border bg-card p-4 space-y-3">
      <div className="flex items-center gap-2">
        <ShieldOff className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">Right-to-Work opt-out</h2>
      </div>
      <p className="text-xs text-muted-foreground">
        Documents dashboard skips this member on Right-to-Work-flagged subtypes when this is on.
        Use only when a documented determination applies (rare — most workers require an RTW check).
      </p>

      <div className="flex items-center justify-between rounded-md border p-3">
        <div>
          <p className="text-sm font-medium">RTW check not required</p>
          <p className="text-xs text-muted-foreground">
            Off by default. Turning on requires a reason.
          </p>
        </div>
        <Switch
          checked={rtwNotRequired}
          onCheckedChange={(v) => setRtwNotRequiredState(v)}
          disabled={!canEdit || pending}
        />
      </div>

      {rtwNotRequired && (
        <div className="space-y-2">
          <Label>Reason <span className="text-destructive">*</span></Label>
          <Textarea
            rows={3}
            maxLength={1000}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            disabled={!canEdit || pending}
            placeholder="e.g. Overseas contractor — client engagement, not employment."
          />
        </div>
      )}

      {error && <div className="rounded-md bg-destructive/10 p-2 text-xs text-destructive">{error}</div>}
      {success && !hasChanges && (
        <div className="rounded-md bg-green-500/10 p-2 text-xs text-green-700 dark:text-green-400">{success}</div>
      )}

      {canEdit && (
        <div className="flex justify-end">
          <Button size="sm" onClick={handleSave} disabled={pending || !hasChanges || (rtwNotRequired && !reason.trim())}>
            {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save
          </Button>
        </div>
      )}
    </div>
  );
}
