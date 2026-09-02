"use client";

import { useState, useTransition } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getStorageUsage, type UsageResult } from "./usage-actions";

function fmtBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 * 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(1)} MB`;
  return `${(b / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function UsageClient({
  initial,
  initialError,
}: {
  initial: UsageResult | null;
  initialError: string | null;
}) {
  const [usage, setUsage] = useState<UsageResult | null>(initial);
  const [error, setError] = useState<string | null>(initialError);
  const [pending, startTransition] = useTransition();
  const [refreshedAt, setRefreshedAt] = useState<string>(() =>
    new Date().toLocaleString("en-GB", {
      day: "2-digit", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit", hour12: false,
    }),
  );

  function refresh() {
    setError(null);
    startTransition(async () => {
      const res = await getStorageUsage();
      if (!res.success) { setError(res.error); return; }
      setUsage(res.usage);
      setRefreshedAt(new Date().toLocaleString("en-GB", {
        day: "2-digit", month: "short", year: "numeric",
        hour: "2-digit", minute: "2-digit", hour12: false,
      }));
    });
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
        <div>
          <CardTitle className="text-base">Storage buckets</CardTitle>
          <p className="text-xs text-muted-foreground mt-0.5">Last refreshed: {refreshedAt}</p>
        </div>
        <Button size="sm" variant="outline" onClick={refresh} disabled={pending}>
          {pending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-1.5 h-4 w-4" />}
          Refresh
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {error && <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}

        {usage && (
          <>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">Bucket</th>
                  <th className="py-2 pr-3 font-medium text-right">Files</th>
                  <th className="py-2 pr-3 font-medium text-right">Size</th>
                </tr>
              </thead>
              <tbody>
                {usage.buckets.map((b) => (
                  <tr key={b.bucket} className="border-b last:border-b-0">
                    <td className="py-2 pr-3">
                      <div className="font-medium">{b.label}</div>
                      <div className="text-xs text-muted-foreground">{b.bucket}</div>
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">{b.fileCount.toLocaleString("en-GB")}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{fmtBytes(b.totalBytes)}</td>
                  </tr>
                ))}
                <tr className="border-t-2 font-medium">
                  <td className="py-2 pr-3">Total</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{usage.totalFiles.toLocaleString("en-GB")}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{fmtBytes(usage.totalBytes)}</td>
                </tr>
              </tbody>
            </table>
          </>
        )}
      </CardContent>
    </Card>
  );
}
