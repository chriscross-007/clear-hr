"use client";

// CLE-219 Ticket D — Acknowledgements tab on the Compliance
// dashboard. One row per ack-required document in the tenant, with a
// per-doc "Remind outstanding" bulk action + a drill-down that lists
// the outstanding Members.
//
// The tab exists to answer HR's question: "Have all the Members who
// need to click 'I have read this' actually clicked it, and for the
// ones who haven't, can I nudge them?"

import { useMemo, useState, useTransition } from "react";
import { AlertCircle, BellRing, ChevronRight, Filter, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { StickyPageHeader } from "@/components/ui/sticky-page-header";
import { DocumentDetailsDialog } from "@/components/documents/document-details-dialog";
import { ComplianceTabs } from "./compliance-tabs";
import type { AcknowledgementCoverageRow, DocumentCoverageRow } from "../acknowledgement-actions";
import { getDocumentCoverage, remindOutstanding } from "../acknowledgement-actions";

interface Props {
  initialRows: AcknowledgementCoverageRow[];
  initialError: string | null;
  subtypes: Array<{ id: string; type: string; name: string; retentionClass: string }>;
  crossUserAccess: "self" | "team" | "all";
  canUpdateDocs: boolean;
}

type ScopeFilter = "all" | "member" | "organisation";

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

/** "3 hours ago" / "2 days ago" for a past ISO timestamp. Kept tiny
 *  and dependency-free — no need for a full relative-time lib for
 *  one label. */
function fmtRelative(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const secs = Math.max(0, Math.floor((now - then) / 1000));
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins} min${mins === 1 ? "" : "s"} ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function fmtDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.ceil(seconds / 60);
  if (mins < 60) return `${mins} min`;
  const hours = Math.ceil(mins / 60);
  return `${hours}h`;
}

/** 24h throttle window in ms — mirrored from the server so the button
 *  disables client-side without a round-trip. Server is authoritative
 *  either way; this is UI hygiene. */
const REMIND_THROTTLE_MS = 24 * 60 * 60 * 1000;

function isWithinThrottle(iso: string | null): { throttled: boolean; retryAfterSeconds: number } {
  if (!iso) return { throttled: false, retryAfterSeconds: 0 };
  const elapsed = Date.now() - new Date(iso).getTime();
  if (elapsed >= REMIND_THROTTLE_MS) return { throttled: false, retryAfterSeconds: 0 };
  return { throttled: true, retryAfterSeconds: Math.ceil((REMIND_THROTTLE_MS - elapsed) / 1000) };
}

export function AcknowledgementsClient({
  initialRows,
  initialError,
  subtypes,
  crossUserAccess,
  canUpdateDocs,
}: Props) {
  const [rows, setRows] = useState<AcknowledgementCoverageRow[]>(initialRows);
  const [error, setError] = useState<string | null>(initialError);
  const [subtypeFilter, setSubtypeFilter] = useState<string>("");
  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>("all");
  const [query, setQuery] = useState<string>("");
  const [pending, startTransition] = useTransition();
  const [detailsDocId, setDetailsDocId] = useState<string | null>(null);

  // Drill-down state — clicking a row's outstanding count opens a
  // dialog listing the outstanding Members for that doc. Loaded on
  // demand via getDocumentCoverage; not fetched up-front.
  const [drillDownDocId, setDrillDownDocId] = useState<string | null>(null);
  const [drillDownRows, setDrillDownRows] = useState<DocumentCoverageRow[]>([]);
  const [drillDownLoading, setDrillDownLoading] = useState(false);

  const scopeLabel = crossUserAccess === "self" ? "Your own documents"
    : crossUserAccess === "team" ? "Your team"
    : "Whole organisation";

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows
      .filter((r) => {
        if (subtypeFilter && r.subtypeId !== subtypeFilter) return false;
        if (scopeFilter !== "all" && r.ownerScope !== scopeFilter) return false;
        if (!q) return true;
        return (
          r.fileName.toLowerCase().includes(q) ||
          (r.ownerMemberName ?? "").toLowerCase().includes(q) ||
          r.subtypeName.toLowerCase().includes(q)
        );
      })
      // Chris's rule (spec §7): outstanding count descending, then
      // alphabetic ascending on subtype + filename.
      .sort((a, b) => {
        if (b.outstanding !== a.outstanding) return b.outstanding - a.outstanding;
        const s = a.subtypeName.localeCompare(b.subtypeName);
        if (s !== 0) return s;
        return a.fileName.localeCompare(b.fileName);
      });
  }, [rows, subtypeFilter, scopeFilter, query]);

  // Updates the given doc's row in-place after a remind. Used by both
  // the per-row button and the bulk button.
  const stampReminded = (documentId: string) => {
    const nowIso = new Date().toISOString();
    setRows((prev) =>
      prev.map((r) => (r.documentId === documentId ? { ...r, lastRemindedAt: nowIso } : r)),
    );
  };

  const remindOne = (documentId: string) => {
    startTransition(async () => {
      const res = await remindOutstanding(documentId);
      if (!res.success) {
        setError(res.error);
        return;
      }
      setError(null);
      stampReminded(documentId);
    });
  };

  const remindAll = () => {
    const targets = visible.filter(
      (r) => r.outstanding > 0 && !isWithinThrottle(r.lastRemindedAt).throttled,
    );
    if (targets.length === 0) return;
    startTransition(async () => {
      let failures = 0;
      for (const t of targets) {
        const res = await remindOutstanding(t.documentId);
        if (res.success) stampReminded(t.documentId);
        else failures += 1;
      }
      setError(failures > 0 ? `${failures} reminder${failures === 1 ? "" : "s"} failed to send` : null);
    });
  };

  const openDrillDown = async (documentId: string) => {
    setDrillDownDocId(documentId);
    setDrillDownRows([]);
    setDrillDownLoading(true);
    const res = await getDocumentCoverage(documentId);
    setDrillDownLoading(false);
    if (res.success) setDrillDownRows(res.coverage.outstandingMembers);
  };

  const totalOutstanding = useMemo(
    () => rows.reduce((sum, r) => sum + r.outstanding, 0),
    [rows],
  );
  const bulkActionable = visible.filter(
    (r) => r.outstanding > 0 && !isWithinThrottle(r.lastRemindedAt).throttled,
  ).length;

  return (
    <div className="w-full px-4 py-8 sm:px-6 lg:px-8">
      <StickyPageHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">Documents — Compliance</h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              {scopeLabel} · {rows.length} ack-required document{rows.length === 1 ? "" : "s"}
              {totalOutstanding > 0 && ` · ${totalOutstanding} outstanding`}
            </p>
          </div>
          {canUpdateDocs && (
            <Button
              variant="outline"
              size="sm"
              disabled={pending || bulkActionable === 0}
              onClick={remindAll}
              title={
                bulkActionable === 0
                  ? "No documents currently need reminders (all caught up, or all within 24h throttle)"
                  : `Send reminders for ${bulkActionable} document${bulkActionable === 1 ? "" : "s"}`
              }
            >
              <BellRing className="mr-1.5 h-4 w-4" />
              Remind all outstanding{bulkActionable > 0 ? ` (${bulkActionable})` : ""}
            </Button>
          )}
        </div>
        <ComplianceTabs active="acknowledgements" />
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

        <Select value={scopeFilter} onValueChange={(v) => setScopeFilter(v as ScopeFilter)}>
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All scopes</SelectItem>
            <SelectItem value="member">Member docs</SelectItem>
            <SelectItem value="organisation">Org docs</SelectItem>
          </SelectContent>
        </Select>

        <Input
          placeholder="Search by owner or file name…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-64"
        />

        <Button
          variant="ghost"
          size="sm"
          disabled={pending || (!subtypeFilter && scopeFilter === "all" && !query)}
          onClick={() => {
            setSubtypeFilter("");
            setScopeFilter("all");
            setQuery("");
          }}
        >
          <XCircle className="mr-1.5 h-4 w-4" />
          Clear filters
        </Button>

        {pending && (
          <span className="ml-2 inline-flex items-center gap-1 text-xs text-muted-foreground">
            <Filter className="h-3.5 w-3.5 animate-pulse" /> Working…
          </span>
        )}
      </div>

      {error && (
        <div className="mt-4 rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div>
      )}

      {detailsDocId && (
        <DocumentDetailsDialog
          documentId={detailsDocId}
          canUpdate={canUpdateDocs}
          onClose={() => setDetailsDocId(null)}
        />
      )}

      {rows.length === 0 ? (
        <p className="mt-8 text-center text-sm text-muted-foreground">
          No acknowledgement-required documents in your organisation.
        </p>
      ) : visible.length === 0 ? (
        <p className="mt-8 text-center text-sm text-muted-foreground">
          No documents match the current filters.
        </p>
      ) : totalOutstanding === 0 ? (
        <>
          <p className="mt-4 rounded-md border bg-emerald-50 p-4 text-sm text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100">
            All caught up — every ack-required document is fully acknowledged.
          </p>
          <CoverageTable
            rows={visible}
            canUpdateDocs={canUpdateDocs}
            pending={pending}
            onRowClick={(id) => setDetailsDocId(id)}
            onDrillDown={openDrillDown}
            onRemind={remindOne}
          />
        </>
      ) : (
        <CoverageTable
          rows={visible}
          canUpdateDocs={canUpdateDocs}
          pending={pending}
          onRowClick={(id) => setDetailsDocId(id)}
          onDrillDown={openDrillDown}
          onRemind={remindOne}
        />
      )}

      {/* Drill-down — outstanding Members for a single doc */}
      <Dialog open={drillDownDocId !== null} onOpenChange={(o) => { if (!o) setDrillDownDocId(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Outstanding acknowledgements</DialogTitle>
          </DialogHeader>
          <div className="overflow-y-auto max-h-[60vh] px-1">
            {drillDownLoading ? (
              <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p>
            ) : drillDownRows.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">Everyone is up to date.</p>
            ) : (
              <ul className="divide-y">
                {drillDownRows.map((r) => (
                  <li key={r.memberId} className="flex items-center justify-between py-2">
                    <div>
                      <div className="text-sm font-medium">{r.memberName}</div>
                      <div className="text-xs text-muted-foreground">{r.teamName ?? "No team"}</div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Extracted table subcomponent so the two happy-path branches
// (with/without the "all caught up" banner) share one renderer.
// ---------------------------------------------------------------------------

function CoverageTable({
  rows,
  canUpdateDocs,
  pending,
  onRowClick,
  onDrillDown,
  onRemind,
}: {
  rows: AcknowledgementCoverageRow[];
  canUpdateDocs: boolean;
  pending: boolean;
  onRowClick: (id: string) => void;
  onDrillDown: (id: string) => void;
  onRemind: (id: string) => void;
}) {
  return (
    <div className="mt-4 rounded-md border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/50 text-left text-xs uppercase text-muted-foreground">
            <th className="px-4 py-2 font-medium">Subtype</th>
            <th className="px-4 py-2 font-medium">File</th>
            <th className="px-4 py-2 font-medium">Scope</th>
            <th className="px-4 py-2 font-medium">Owner</th>
            <th className="px-4 py-2 font-medium hidden md:table-cell">Uploaded</th>
            <th className="px-4 py-2 font-medium text-right">Acknowledged</th>
            <th className="px-4 py-2 font-medium text-right">Outstanding</th>
            <th className="px-4 py-2 font-medium hidden lg:table-cell">Last reminded</th>
            <th className="px-4 py-2 text-right" />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const throttle = isWithinThrottle(r.lastRemindedAt);
            const canRemind =
              canUpdateDocs && r.outstanding > 0 && !throttle.throttled && !pending;
            return (
              <tr
                key={r.documentId}
                className="cursor-pointer border-b last:border-b-0 hover:bg-muted/30"
                onClick={() => onRowClick(r.documentId)}
              >
                <td className="px-4 py-2 font-medium">{r.subtypeName}</td>
                <td className="px-4 py-2 max-w-xs truncate">{r.fileName}</td>
                <td className="px-4 py-2 text-muted-foreground">
                  {r.ownerScope === "member" ? "Member" : "Organisation"}
                </td>
                <td className="px-4 py-2 text-muted-foreground">
                  {r.ownerMemberName ?? "—"}
                </td>
                <td className="px-4 py-2 text-muted-foreground hidden md:table-cell">
                  {fmtDate(r.uploadedAt)}
                </td>
                <td className="px-4 py-2 text-right tabular-nums">
                  {r.totalAcknowledged} of {r.totalExpected}
                </td>
                <td className="px-4 py-2 text-right">
                  {r.outstanding > 0 ? (
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium text-amber-700 hover:bg-amber-100 dark:text-amber-400 dark:hover:bg-amber-950"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDrillDown(r.documentId);
                      }}
                    >
                      {r.outstanding}
                      <ChevronRight className="h-3 w-3" />
                    </button>
                  ) : (
                    <span className="tabular-nums text-muted-foreground">0</span>
                  )}
                </td>
                <td className="px-4 py-2 text-muted-foreground hidden lg:table-cell">
                  {r.lastRemindedAt ? fmtRelative(r.lastRemindedAt) : "—"}
                </td>
                <td className="px-4 py-2 text-right">
                  {canUpdateDocs && r.outstanding > 0 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={!canRemind}
                      title={
                        throttle.throttled
                          ? `Reminded recently — try again in ${fmtDuration(throttle.retryAfterSeconds)}`
                          : "Send reminder to outstanding acknowledgers"
                      }
                      onClick={(e) => {
                        e.stopPropagation();
                        onRemind(r.documentId);
                      }}
                    >
                      <BellRing className="mr-1 h-3.5 w-3.5" />
                      Remind
                    </Button>
                  )}
                  {r.outstanding === 0 && (
                    <span className="inline-flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-400">
                      <AlertCircle className="h-3 w-3" /> Complete
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
