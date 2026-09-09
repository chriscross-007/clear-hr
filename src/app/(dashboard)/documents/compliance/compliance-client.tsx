"use client";

// CLE-207 — Compliance dashboard client. Filters + row list.

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { AlertCircle, ChevronLeft, ChevronRight, ExternalLink, Filter, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DocumentDetailsDialog } from "@/components/documents/document-details-dialog";
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
  // §7b.13 — Compliance row click opens the shared Document Details
  // dialog for real doc rows; synthetic not_uploaded rows route to
  // the target member's per-member docs page for upload instead.
  const [detailsDocId, setDetailsDocId] = useState<string | null>(null);
  // Pagination — client-side; row list is already fetched in full.
  // Persist the page-size preference in localStorage so the next visit
  // keeps whatever the user last picked.
  const [pageSize, setPageSize] = useState<number>(() => {
    if (typeof window === "undefined") return 25;
    const stored = window.localStorage.getItem("clearhr.compliance.pageSize");
    const n = stored ? parseInt(stored, 10) : NaN;
    return [10, 25, 50, 100, 250].includes(n) ? n : 25;
  });
  const [page, setPage] = useState<number>(1);
  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem("clearhr.compliance.pageSize", String(pageSize));
    }
  }, [pageSize]);

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

  // Reset to page 1 whenever the visible-row set changes (filters,
  // member-name query, or reload). Keeps the pager out of "page 7 of
  // 3" territory.
  useEffect(() => {
    setPage(1);
  }, [rows, memberQuery, pageSize]);

  const totalRows = visible.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
  const currentPage = Math.min(page, totalPages);
  const startIdx = (currentPage - 1) * pageSize;
  const endIdx = Math.min(startIdx + pageSize, totalRows);
  const paged = visible.slice(startIdx, endIdx);

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

      {detailsDocId && (
        <DocumentDetailsDialog
          documentId={detailsDocId}
          canUpdate={crossUserAccess !== "self"}
          onClose={() => setDetailsDocId(null)}
          onSaved={async () => { await reload(); }}
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
              {paged.map((r) => (
                <tr
                  key={r.key}
                  className="cursor-pointer border-b last:border-b-0 hover:bg-muted/30"
                  onClick={() => {
                    if (r.documentId) setDetailsDocId(r.documentId);
                    else window.location.assign(`/members/${r.memberId}/docs`);
                  }}
                >
                  <td className="px-4 py-2 font-medium">
                    <Link
                      href={`/members/${r.memberId}/docs`}
                      className="hover:underline"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {r.memberName}
                    </Link>
                  </td>
                  <td className="px-4 py-2">{r.subtypeName}</td>
                  <td className="px-4 py-2">
                    <div className="flex flex-wrap gap-1">
                      {r.statuses.map((s) => (
                        <span
                          key={s}
                          className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_ALL_TONE[s].className}`}
                        >
                          {STATUS_ALL_LABEL[s]}
                        </span>
                      ))}
                    </div>
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
                      <Link
                        href={`/members/${r.memberId}/docs`}
                        className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs hover:bg-accent"
                        onClick={(e) => e.stopPropagation()}
                      >
                        Open <ExternalLink className="h-3 w-3" />
                      </Link>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {/* Pager */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-2 text-xs text-muted-foreground">
            <div className="flex items-center gap-2">
              <span>Rows per page</span>
              <Select value={String(pageSize)} onValueChange={(v) => setPageSize(parseInt(v, 10))}>
                <SelectTrigger className="h-7 w-20 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[10, 25, 50, 100, 250].map((n) => (
                    <SelectItem key={n} value={String(n)}>{n}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-3">
              <span>
                {totalRows === 0
                  ? "0 of 0"
                  : `${startIdx + 1}–${endIdx} of ${totalRows}`}
              </span>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0"
                  disabled={currentPage <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  aria-label="Previous page"
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="tabular-nums">
                  Page {currentPage} of {totalPages}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0"
                  disabled={currentPage >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  aria-label="Next page"
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
