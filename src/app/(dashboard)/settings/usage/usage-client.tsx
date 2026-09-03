"use client";

import { useState, useTransition } from "react";
import { Loader2, RefreshCw, ImageDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  getStorageUsage,
  migrateExternalAvatarsToStorage,
  type AvatarMigrationResult,
  type UsageResult,
} from "./usage-actions";

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
  const [migrating, startMigrating] = useTransition();
  const [migration, setMigration] = useState<AvatarMigrationResult | null>(null);

  function migrateAvatars() {
    setError(null);
    setMigration(null);
    startMigrating(async () => {
      const res = await migrateExternalAvatarsToStorage();
      if (!res.success) { setError(res.error); return; }
      setMigration(res.result);
      // Refresh usage so the avatar bucket total picks up the new
      // bytes immediately.
      const u = await getStorageUsage();
      if (u.success) setUsage(u.usage);
      setRefreshedAt(new Date().toLocaleString("en-GB", {
        day: "2-digit", month: "short", year: "numeric",
        hour: "2-digit", minute: "2-digit", hour12: false,
      }));
    });
  }

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
        <div className="mt-4 rounded-md border bg-muted/20 p-3 space-y-2">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium">Migrate external avatar URLs</p>
              <p className="text-xs text-muted-foreground">
                One-shot. Downloads any member avatar hosted on a third-party service
                and stores it in the <code>member-avatars</code> bucket, then rewrites
                the column. Idempotent — safe to run multiple times.
              </p>
            </div>
            <Button size="sm" variant="outline" onClick={migrateAvatars} disabled={migrating}>
              {migrating ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <ImageDown className="mr-1.5 h-4 w-4" />}
              Run
            </Button>
          </div>
          {migration && (
            <div className="text-xs">
              Scanned {migration.scanned} · migrated {migration.migrated} · already in bucket {migration.skipped}
              {migration.failed.length > 0 && (
                <div className="mt-2 rounded-md bg-destructive/10 p-2 text-destructive">
                  <p className="font-medium mb-1">{migration.failed.length} failed:</p>
                  <ul className="list-disc pl-5 space-y-0.5">
                    {migration.failed.slice(0, 20).map((f, i) => (
                      <li key={i}>{f.name}: {f.error}</li>
                    ))}
                    {migration.failed.length > 20 && (
                      <li>… and {migration.failed.length - 20} more</li>
                    )}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
