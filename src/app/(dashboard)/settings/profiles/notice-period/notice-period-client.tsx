"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import {
  saveNoticePeriodRules,
  checkBookingsInBreach,
} from "@/app/(dashboard)/notice-period-actions";
import { updateOrganisation } from "@/app/(dashboard)/organisation-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";

// CLE-191 — Notice Period profiles client. Phase 1 has exactly one
// profile (the Default), shown as a single row in the list. Clicking
// the row opens a popup with the rules editor; save commits both the
// rules (via saveNoticePeriodRules) and the block-or-warn flag (via
// updateOrganisation).

interface Rule {
  id?: string;
  min_booking_days: number;
  notice_days: number;
}

interface NoticePeriodClientProps {
  initialRules: Rule[];
  initialBlockRequests: boolean;
}

export function NoticePeriodClient({
  initialRules,
  initialBlockRequests,
}: NoticePeriodClientProps) {
  const router = useRouter();
  const [rules, setRules] = useState<Rule[]>(initialRules);
  const [blockRequests, setBlockRequests] = useState<boolean>(initialBlockRequests);
  const [editorOpen, setEditorOpen] = useState(false);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Notice period profiles</CardTitle>
        <p className="text-xs text-muted-foreground">
          Each profile is a list of rules of the form &ldquo;bookings of N+ days require X days&apos; notice&rdquo;.
        </p>
      </CardHeader>
      <CardContent>
        {/* Profile list — one row, the Default. */}
        <button
          type="button"
          onClick={() => setEditorOpen(true)}
          className="flex w-full items-center justify-between rounded-md border px-4 py-3 text-left transition-colors hover:bg-muted/50"
        >
          <div>
            <div className="text-sm font-semibold">Default</div>
            <div className="text-xs text-muted-foreground">
              {rules.length === 0
                ? "No rules set — notice is not required."
                : `${rules.length} rule${rules.length === 1 ? "" : "s"} · ${blockRequests ? "Hard block" : "Warn only"}`}
            </div>
          </div>
          <span className="text-xs text-muted-foreground">Edit →</span>
        </button>
      </CardContent>

      <RuleEditorDialog
        open={editorOpen}
        onOpenChange={setEditorOpen}
        rules={rules}
        blockRequests={blockRequests}
        onSaved={(nextRules, nextBlock) => {
          setRules(nextRules);
          setBlockRequests(nextBlock);
          setEditorOpen(false);
          router.refresh();
        }}
      />
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Rule editor dialog
// ---------------------------------------------------------------------------

interface RuleEditorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rules: Rule[];
  blockRequests: boolean;
  onSaved: (rules: Rule[], blockRequests: boolean) => void;
}

function RuleEditorDialog({
  open,
  onOpenChange,
  rules: initial,
  blockRequests: initialBlock,
  onSaved,
}: RuleEditorDialogProps) {
  const [draft, setDraft] = useState<Rule[]>(initial);
  const [block, setBlock] = useState(initialBlock);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [breachWarning, setBreachWarning] = useState<string | null>(null);

  // Reset draft to the latest snapshot every time the dialog opens.
  function handleOpenChange(next: boolean) {
    if (next) {
      setDraft(initial);
      setBlock(initialBlock);
      setError(null);
      setBreachWarning(null);
    }
    onOpenChange(next);
  }

  async function handleSave() {
    setSaving(true);
    setError(null);

    const rulesResult = await saveNoticePeriodRules(draft);
    if (!rulesResult.success) {
      setSaving(false);
      setError(rulesResult.error ?? "Failed to save notice rules");
      return;
    }

    const orgResult = await updateOrganisation({
      noticeRulesBlockRequests: block,
    });
    if (!orgResult.success) {
      setSaving(false);
      setError(orgResult.error ?? "Failed to save block flag");
      return;
    }

    // CLE-178 — surface how many existing bookings now breach the rules.
    // Informational; does not modify the bookings.
    let breachMsg: string | null = null;
    if (draft.length > 0) {
      try {
        const breachRes = await checkBookingsInBreach();
        if (breachRes.success && (breachRes.breachedCount ?? 0) > 0) {
          breachMsg = `Saved. ${breachRes.breachedCount} existing booking${
            breachRes.breachedCount === 1 ? "" : "s"
          } would breach the new rules.`;
        }
      } catch {
        // Non-fatal — the rule save itself succeeded.
      }
    }

    setSaving(false);
    setBreachWarning(breachMsg);
    onSaved(draft, block);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Default notice period profile</DialogTitle>
          <DialogDescription>
            Bookings of at least the listed length need at least the corresponding number of days&apos; notice.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div>
        )}
        {breachWarning && (
          <div className="rounded-md border border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30 p-3 text-sm text-amber-900 dark:text-amber-200">
            {breachWarning}
          </div>
        )}

        <div className="space-y-3">
          {draft.length > 0 && (
            <div className="flex items-center gap-2">
              <Label className="text-xs text-muted-foreground w-24">Booking length (days+)</Label>
              <Label className="text-xs text-muted-foreground w-24">Notice (days)</Label>
            </div>
          )}
          {draft.map((rule, i) => (
            <div key={rule.id ?? `new-${i}`} className="flex items-center gap-2">
              <Input
                type="number"
                min={1}
                className="w-24 h-8 text-sm"
                value={rule.min_booking_days}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10);
                  if (isNaN(val)) return;
                  setDraft((prev) => prev.map((r, j) => (j === i ? { ...r, min_booking_days: val } : r)));
                }}
              />
              <Input
                type="number"
                min={1}
                className="w-24 h-8 text-sm"
                value={rule.notice_days}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10);
                  if (isNaN(val)) return;
                  setDraft((prev) => prev.map((r, j) => (j === i ? { ...r, notice_days: val } : r)));
                }}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0"
                onClick={() => setDraft((prev) => prev.filter((_, j) => j !== i))}
              >
                <Trash2 className="h-3.5 w-3.5 text-destructive" />
              </Button>
            </div>
          ))}

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setDraft((prev) => [...prev, { min_booking_days: 1, notice_days: 7 }])}
          >
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            Add rule
          </Button>
        </div>

        <div className="flex items-start justify-between gap-3 rounded-md border bg-muted/30 p-3">
          <div>
            <Label className="text-sm font-medium">Block requests that breach the rules</Label>
            <p className="text-xs text-muted-foreground mt-1">
              When on, employees can&apos;t submit a request that breaks a notice rule. When off they see a warning and can still submit.
            </p>
          </div>
          <Switch checked={block} onCheckedChange={setBlock} />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
