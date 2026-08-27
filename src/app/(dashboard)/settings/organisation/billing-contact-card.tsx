"use client";

// CLE-199 — Billing contact card on the Organisation settings page.
// Shows current holder + a Transfer button. Transfer opens a dialog
// with a list of members whose profile grants `canManageBilling`;
// selecting one atomically swaps the flag. Only surfaced to viewers
// with `canManageBilling` themselves.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CreditCard } from "lucide-react";
import { transferBillingContact, type BillingContactRow } from "./billing-contact-actions";

interface Props {
  current: BillingContactRow | null;
  candidates: BillingContactRow[];
  canManage: boolean;
}

export function BillingContactCard({ current, candidates, canManage }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const currentLabel = current
    ? `${current.firstName} ${current.lastName}`
    : "Not set";
  const currentEmail = current?.email ?? "";

  // Exclude the current holder from the dropdown — no point offering
  // to "transfer" to the person who already holds it.
  const eligible = candidates.filter((c) => c.memberId !== current?.memberId);

  function handleTransfer() {
    if (!selected) return;
    setError(null);
    startTransition(async () => {
      const r = await transferBillingContact(selected);
      if (!r.success) {
        setError(r.error ?? "Transfer failed");
        return;
      }
      setOpen(false);
      setSelected("");
      router.refresh();
    });
  }

  return (
    <div className="rounded-lg border bg-card p-4 space-y-3">
      <div className="flex items-center gap-2">
        <CreditCard className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">Billing contact</h2>
      </div>
      <p className="text-xs text-muted-foreground">
        The person who receives billing emails and whose card is on file for the subscription.
      </p>
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm">
          <div className="font-medium">{currentLabel}</div>
          {currentEmail && (
            <div className="text-xs text-muted-foreground">{currentEmail}</div>
          )}
        </div>
        {canManage && (
          <div className="flex flex-col items-end gap-1">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setOpen(true)}
              disabled={eligible.length === 0}
              title={
                eligible.length === 0
                  ? "No other members have Manage Billing on their profile"
                  : undefined
              }
            >
              Transfer
            </Button>
            {eligible.length === 0 && (
              <p className="text-xs text-muted-foreground text-right max-w-[16rem]">
                Grant Manage Billing to another profile first, then a member on
                that profile becomes eligible.
              </p>
            )}
          </div>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Transfer billing contact</DialogTitle>
            <DialogDescription>
              Only members whose profile grants Manage Billing can hold this role.
              The new holder receives billing emails immediately.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Select value={selected} onValueChange={setSelected}>
              <SelectTrigger>
                <SelectValue placeholder="Choose the new billing contact" />
              </SelectTrigger>
              <SelectContent>
                {eligible.length === 0 ? (
                  <div className="p-2 text-xs text-muted-foreground">
                    No other eligible members. Grant Manage Billing to another
                    profile first.
                  </div>
                ) : (
                  eligible.map((c) => (
                    <SelectItem key={c.memberId} value={c.memberId}>
                      {c.firstName} {c.lastName} ({c.email})
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
            {error && (
              <div className="rounded-md border border-destructive bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {error}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={handleTransfer} disabled={pending || !selected}>
              {pending ? "Transferring…" : "Transfer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
