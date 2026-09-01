"use client";

// CLE-207 — Compliance dashboard client. Filters + row list.

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { AlertCircle, ExternalLink, Filter, ShieldCheck, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { VerifyDialog } from "@/components/documents/verify-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StickyPageHeader } from "@/components/ui/sticky-page-header";
import { STATUS_LABEL, STATUS_TONE, type DocumentStatus } from "@/lib/document-status";
import type { ComplianceRow } from "../compliance-actions";
import { getComplianceRows } from "../compliance-actions";

const STATUS_OPTIONS: (DocumentStatus | "not_uploaded")[] = [
  "expired",
  "overdue_review",
  "expiring_soon",
  "pending_verification",
  "not_uploaded",
  "verified",
];

const STATUS_ALL_LABEL: Record<DocumentStatus | "not_uploaded", string> = {
  ...STATUS_LABEL,
  not_uploaded: "Not uploaded",
};

const STATUS_ALL_TONE: Record<DocumentStatus | "not_uploaded", { className: string }> = {
  ...STATUS_TONE,
  not_uploaded: { className: "bg-slate-200 text-slate-800 dark:bg-slate-800 dark:text-slate-300" },
};

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso + "T00:00:00Z").toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

interface Props {
  initialRows: ComplianceRow[];
  initialError: string | null;
  subtypes: Array<{ id: string; type: string; name: string; retentionClass: string }>;
  crossUserAccess: "self" | "team" | "all";
}

export function ComplianceClient({ initialRows, initialError, subtypes, crossUserAccess }: Props) {
  const [rows, setRows] = useState<ComplianceRow[]>(initialRows);
  const [error, setError] = useState<string | null>(initialError);
  const [subtypeFilter, setSubtypeFilter] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<Set<DocumentStatus | "not_uploaded">>(new Set());
  const [memberQuery, setMemberQuery] = useState<string>("");
  const [pending, startTransition] = useTransition();
  const [verifying, setVerifying] = useState<ComplianceRow | null>(null);

  async function reload() {
    const res = await getComplianceRows({
      subtypeId: subtypeFilter || undefined,
      status: statusFilter.size > 0 ? Array.from(statusFilter) : undefined,
      includeAllStatuses: statusFilter.size > 0,
    });
    if (!res.success) {
      setError(res.error ?? "Failed to reload");
      return;
    }
    setError(null);
    setRows(res.rows);
  }

  const applyFilters = () => {
    startTransition(async () => {
      const res = await getComplianceRows({
        subtypeId: subtypeFilter || undefined,
        status: statusFilter.size > 0 ? Array.from(statusFilter) : undefined,
        includeAllStatuses: statusFilter.size > 0,
      });
      if (!res.success) {
        setError(res.error ?? "Failed to reload");
        return;
      }
      setError(null);
      setRows(res.rows);
    });
  };

  function toggleStatus(s: DocumentStatus | "not_uploaded") {
    setStatusFilter((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
  }

  const visible = useMemo(() => {
    const q = memberQuery.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => r.memberName.toLowerCase().includes(q));
  }, [rows, memberQuery]);

  const scopeLabel = crossUserAccess === "self" ? "Your own documents"
    : crossUserAccess === "team" ? "Your team"
    : "Whole organisation";

  return (
    <div className="w-full px-4 py-8 sm:px-6 lg:px-8">
      <StickyPageHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">Documents — Compliance</h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              {scopeLabel} · {rows.length} row{rows.length === 1 ? "" : "s"}
              {statusFilter.size === 0 && " (attention needed)"}
            </p>
          </div>
        </div>
      </StickyPageHeader>

      {/* Filter row */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Select value={subtypeFilter || "__all__"} onValueChange={(v) => setSubtypeFilter(v === "__all__" ? "" : v)}>
          <SelectTrigger className="w-56">
            <SelectValue placeholder="All subtypes" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">All subtypes</SelectItem>
            {subtypes.map((s) => (
              <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="flex flex-wrap items-center gap-1">
          {STATUS_OPTIONS.map((s) => {
            const on = statusFilter.has(s);
            return (
              <button
                key={s}
                type="button"
                onClick={() => toggleStatus(s)}
                className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs transition-colors ${
                  on
                    ? STATUS_ALL_TONE[s].className + " border-transparent"
                    : "border-input bg-background text-muted-foreground hover:bg-accent"
                }`}
              >
                {STATUS_ALL_LABEL[s]}
              </button>
            );
          })}
        </div>

        <Input
          placeholder="Filter by member name…"
          value={memberQuery}
          onChange={(e) => setMemberQuery(e.target.value)}
          className="w-56"
        />

        <Button variant="outline" size="sm" onClick={applyFilters} disabled={pending}>
          <Filter className="mr-1.5 h-4 w-4" />
          Apply
        </Button>

        <Button
          variant="ghost"
          size="sm"
          disabled={
            pending ||
            (!subtypeFilter && statusFilter.size === 0 && !memberQuery)
          }
          onClick={() => {
            setSubtypeFilter("");
            setStatusFilter(new Set());
            setMemberQuery("");
            startTransition(async () => {
              const res = await getComplianceRows();
              if (!res.success) {
                setError(res.error ?? "Failed to reload");
                return;
              }
              setError(null);
              setRows(res.rows);
            });
          }}
        >
          <XCircle className="mr-1.5 h-4 w-4" />
          Clear filters
        </Button>
      </div>

      {error && (
        <div className="mt-4 rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div>
      )}

      {verifying?.documentId && (
        <VerifyDialog
          mode={verifying.verifiedOn ? "renew" : "verify"}
          documentId={verifying.documentId}
          initialNextReviewOn={verifying.nextReviewOn}
          headerLabel={`${verifying.memberName} — ${verifying.subtypeName}`}
          onClose={() => setVerifying(null)}
          onSaved={async () => {
            setVerifying(null);
            await reload();
          }}
        />
      )}

      {visible.length === 0 ? (
        <p className="mt-8 text-center text-sm text-muted-foreground">
          Nothing needs attention.
        </p>
      ) : (
        <div className="mt-4 rounded-md border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                <th className="px-4 py-2 font-medium">Member</th>
                <th className="px-4 py-2 font-medium">Subtype</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium hidden md:table-cell">Expires</th>
                <th className="px-4 py-2 font-medium hidden md:table-cell">Next review</th>
                <th className="px-4 py-2 font-medium hidden lg:table-cell">File</th>
                <th className="px-4 py-2 text-right" />
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => (
                <tr key={r.key} className="border-b last:border-b-0 hover:bg-muted/30">
                  <td className="px-4 py-2 font-medium">
                    <Link href={`/members/${r.memberId}/docs`} className="hover:underline">
                      {r.memberName}
                    </Link>
                  </td>
                  <td className="px-4 py-2">{r.subtypeName}</td>
                  <td className="px-4 py-2">
                    <span
                      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_ALL_TONE[r.status].className}`}
                    >
                      {STATUS_ALL_LABEL[r.status]}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-muted-foreground hidden md:table-cell">
                    {fmtDate(r.expiresOn)}
                  </td>
                  <td className="px-4 py-2 text-muted-foreground hidden md:table-cell">
                    {fmtDate(r.nextReviewOn)}
                  </td>
                  <td className="px-4 py-2 text-muted-foreground hidden lg:table-cell max-w-xs truncate">
                    {r.fileName ?? (
                      <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-400">
                        <AlertCircle className="h-3.5 w-3.5" />
                        Not uploaded
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <div className="flex items-center justify-end gap-1">
                      {r.documentId && (r.status === "pending_verification" || r.status === "expiring_soon" || r.status === "expired" || r.status === "overdue_review") && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setVerifying(r)}
                          title={r.status === "pending_verification" ? "Verify" : "Renew"}
                        >
                          <ShieldCheck className="mr-1 h-3.5 w-3.5" />
                          {r.status === "pending_verification" ? "Verify" : "Renew"}
                        </Button>
                      )}
                      <Link
                        href={`/members/${r.memberId}/docs`}
                        className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs hover:bg-accent"
                      >
                        Open <ExternalLink className="h-3 w-3" />
                      </Link>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
