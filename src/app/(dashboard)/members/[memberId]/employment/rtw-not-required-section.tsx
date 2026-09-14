"use client";

// CLE-207 — Right-to-Work toggle on the Employment page.
// Owned by Employee Records but the compliance dashboard reads it to
// exclude opted-out members from RTW-flagged subtypes.
//
// UI reads as "Right to Work evidence required" (ON by default) while
// the underlying DB column is still `members.rtw_not_required` — we
// just invert at the boundary. Turning the toggle OFF requires a
// reason (why does this individual not need an RTW check?).

import { useState, useTransition } from "react";
import { Loader2, ShieldCheck } from "lucide-react";
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
  // The visible toggle is the inverse of the stored column. `true` =
  // RTW required (default). `false` = opted out; a reason must be
  // captured before saving.
  const [rtwRequired, setRtwRequired] = useState<boolean>(!initial.rtwNotRequired);
  const [reason, setReason] = useState<string>(initial.reason ?? "");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const initialRequired = !initial.rtwNotRequired;
  const hasChanges =
    rtwRequired !== initialRequired ||
    (!rtwRequired && (reason.trim() !== (initial.reason ?? "").trim()));

  function handleSave() {
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      const res = await setRtwNotRequired(memberId, {
        rtwNotRequired: !rtwRequired,
        reason: !rtwRequired ? reason.trim() : null,
      });
      if (!res.success) {
        setError(res.error ?? "Failed to save");
        return;
      }
      setSuccess("Saved.");
      router.refresh();
      // CLE-215 — the Required Documents card renders an RTW
      // aggregate row whose presence depends on rtw_not_required.
      // Poke it to reload after this save so the row appears or
      // disappears without waiting for a full page reload.
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("clearhr:rtw-changed", { detail: { memberId } }),
        );
      }
    });
  }

  return (
    <div className="rounded-lg border bg-card p-4 space-y-3">
      <div className="flex items-center gap-2">
        <ShieldCheck className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">Right to Work</h2>
      </div>
      <p className="text-xs text-muted-foreground">
        Most workers must produce evidence of their right to work in the UK.
        Leave this on unless a documented determination says otherwise
        (rare — e.g. overseas contractor engaged outside employment).
      </p>

      <div className="flex items-center justify-between rounded-md border p-3">
        <div>
          <p className="text-sm font-medium">Right to Work evidence required</p>
          <p className="text-xs text-muted-foreground">
            On by default. Turning off requires a reason.
          </p>
        </div>
        <Switch
          checked={rtwRequired}
          onCheckedChange={(v) => setRtwRequired(v)}
          disabled={!canEdit || pending}
        />
      </div>

      {!rtwRequired && (
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
          <Button size="sm" onClick={handleSave} disabled={pending || !hasChanges || (!rtwRequired && !reason.trim())}>
            {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save
          </Button>
        </div>
      )}
    </div>
  );
}
