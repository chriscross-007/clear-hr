"use client";

// CLE-209 — Admin manual trigger for the documents nightly sweep.

import { useState, useTransition } from "react";
import { Loader2, PlayCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { runDocumentsSweepManual } from "./sweep-actions";
import type { SweepResult } from "@/lib/documents/sweep";

export function RunSweepButton() {
  const [result, setResult] = useState<SweepResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ranAt, setRanAt] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleRun() {
    setError(null);
    startTransition(async () => {
      const res = await runDocumentsSweepManual();
      if (!res.success) { setError(res.error); return; }
      setResult(res.result);
      setRanAt(new Date().toLocaleString("en-GB", {
        day: "2-digit", month: "short", year: "numeric",
        hour: "2-digit", minute: "2-digit", hour12: false,
      }));
    });
  }

  return (
    <div className="rounded-md border bg-muted/20 p-4 space-y-3">
      <div>
        <h2 className="text-sm font-semibold">Nightly documents sweep</h2>
        <p className="text-xs text-muted-foreground">
          Purges deleted documents past their 30-day Trash grace and writes
          audit rows for docs that expired or became overdue for review overnight.
          Runs automatically at 02:00 UTC. Use this button to run it now against
          your organisation only.
        </p>
      </div>

      <div className="flex items-center gap-3">
        <Button size="sm" variant="outline" onClick={handleRun} disabled={pending}>
          {pending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <PlayCircle className="mr-1.5 h-4 w-4" />}
          Run sweep now
        </Button>
        {ranAt && <span className="text-xs text-muted-foreground">Last run: {ranAt}</span>}
      </div>

      {error && <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}

      {result && (
        <div className="grid grid-cols-3 gap-2 text-center">
          <Stat label="Expired" value={result.expired} tone="orange" />
          <Stat label="Overdue review" value={result.overdueReview} tone="purple" />
          <Stat label="Purged" value={result.purged} tone="red" />
        </div>
      )}

      {result?.errors && result.errors.length > 0 && (
        <div className="rounded-md bg-destructive/10 p-3 text-xs text-destructive">
          <p className="font-medium mb-1">{result.errors.length} error(s):</p>
          <ul className="list-disc pl-5 space-y-0.5">
            {result.errors.map((e, i) => <li key={i}>{e}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: "orange" | "purple" | "red" }) {
  const cls =
    tone === "orange" ? "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300"
      : tone === "purple" ? "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300"
      : "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300";
  return (
    <div className={`rounded-md p-2 ${cls}`}>
      <div className="text-lg font-bold tabular-nums">{value}</div>
      <div className="text-[10px] uppercase tracking-wide">{label}</div>
    </div>
  );
}
