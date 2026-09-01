"use client";

// CLE-207 — Shared Verify/Renew dialog used by both the per-member
// Documents surface and the org-wide compliance dashboard so HR can
// clear rows without hopping through to each employee's page.

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  verifyMemberDocument,
  renewMemberDocument,
} from "@/app/(dashboard)/members/[memberId]/docs/document-actions";

interface Props {
  mode: "verify" | "renew";
  documentId: string;
  /** Pre-fills the next-review picker. Optional. */
  initialNextReviewOn?: string | null;
  /** Rendered in the dialog header. Typically the file name. */
  headerLabel?: string;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}

export function VerifyDialog({
  mode,
  documentId,
  initialNextReviewOn,
  headerLabel,
  onClose,
  onSaved,
}: Props) {
  const [verifiedOn, setVerifiedOn] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [nextReviewOn, setNextReviewOn] = useState<string>(initialNextReviewOn ?? "");
  const [notes, setNotes] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleSave() {
    setError(null);
    startTransition(async () => {
      const fn = mode === "verify" ? verifyMemberDocument : renewMemberDocument;
      const res = await fn(documentId, {
        verifiedOn,
        verificationNotes: notes || null,
        nextReviewOn: nextReviewOn || null,
      });
      if (!res.success) { setError(res.error ?? "Failed to save"); return; }
      await onSaved();
    });
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{mode === "verify" ? "Verify document" : "Renew verification"}</DialogTitle>
          <DialogDescription>
            {headerLabel && <span className="mb-1 block truncate font-medium">{headerLabel}</span>}
            {mode === "verify"
              ? "Record that you've sighted this document. Adds a Verify entry to the audit trail."
              : "Record a re-sight of the same document. Adds a Renew entry to the audit trail."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {error && <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}

          <div className="space-y-2">
            <Label>Verified on</Label>
            <Input type="date" value={verifiedOn} onChange={(e) => setVerifiedOn(e.target.value)} />
          </div>

          <div className="space-y-2">
            <Label>Next review on <span className="text-muted-foreground font-normal">(optional)</span></Label>
            <Input type="date" value={nextReviewOn} onChange={(e) => setNextReviewOn(e.target.value)} />
            <p className="text-xs text-muted-foreground">
              Auto-fills from the subtype&apos;s review cadence when left blank.
            </p>
          </div>

          <div className="space-y-2">
            <Label>Notes <span className="text-muted-foreground font-normal">(private, never audited)</span></Label>
            <Textarea
              rows={3}
              maxLength={1000}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Anything else HR should know about this check…"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>Cancel</Button>
          <Button onClick={handleSave} disabled={pending || !verifiedOn}>
            {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {mode === "verify" ? "Verify" : "Renew"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
