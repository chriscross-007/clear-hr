"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Check, X, Loader2, Info, CalendarDays, ChevronDown, ChevronUp, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  approveBooking,
  rejectBooking,
  bulkApproveBookings,
  bulkRejectBookings,
  type ApprovalRow,
} from "../approvals-actions";
import { Checkbox } from "@/components/ui/checkbox";
import { TeamCalendar, type TeamMember, type TeamBooking, type TeamBankHoliday } from "@/components/team-calendar";
import { useMemberLabel } from "@/contexts/member-label-context";
import { capitalize, pluralize } from "@/lib/label-utils";
import { CompletionStatusBadge } from "@/components/completion-status-badge";
import { StickyPageHeader } from "@/components/ui/sticky-page-header";
import { BookingHistoryPopover } from "@/components/booking-history-popover";
import type { CompletionStatus } from "../sick-booking-types";

interface ApprovalsClientProps {
  pendingRows: ApprovalRow[];
  allRows: ApprovalRow[];
  calendarMembers: (TeamMember & { teamId: string | null })[];
  calendarBookings: TeamBooking[];
  calendarBankHolidays: TeamBankHoliday[];
  bankHolidayColour?: string;
  /** CLE-192 — passed through to the inline TeamCalendar so the focus
   *  arrows skip bank holidays only when the org doesn't deduct them. */
  bankHolidayHandling?: "additional" | "deducted";
}

function fmtDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00Z");
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  const date = d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });
  return `${date} ${time}`;
}

function fmtDateRange(start: string, end: string | null, startHalf: string | null, endHalf: string | null): string {
  if (end === null) {
    let label = `${fmtDate(start)} – Open`;
    if (startHalf) label += ` (${startHalf.toUpperCase()})`;
    return label;
  }
  const sameDay = start === end;
  let label = sameDay ? fmtDate(start) : `${fmtDate(start)} – ${fmtDate(end)}`;
  if (startHalf) label += ` (${startHalf.toUpperCase()})`;
  if (!sameDay && endHalf) label += ` to (${endHalf.toUpperCase()})`;
  return label;
}

/** CLE-186 — "L1 → L2 → L3" indicator under the status badge.
 *  Renders only when the booking's profile has more than one level. The
 *  current level is bold; past (approved) and future (not yet activated)
 *  levels are faded. Approved → strikethrough as well, so the eye can
 *  separate "done" from "upcoming". */
function LevelLadder(props: {
  currentLevel: number;
  totalLevels: number;
  history: {
    level: number;
    status: "pending" | "approved" | "rejected" | "withdrawn";
    decided_at: string | null;
    decided_by_name: string | null;
    routed_to: "main" | "delegate" | null;
  }[];
}) {
  if (props.totalLevels <= 1) return null;
  const byLevel = new Map(props.history.map((h) => [h.level, h]));
  const rungs = Array.from({ length: props.totalLevels }, (_, i) => {
    const level = i + 1;
    const entry = byLevel.get(level);
    if (level === props.currentLevel) {
      return { level, className: "text-foreground font-medium" };
    }
    if (entry?.status === "approved") {
      return { level, className: "text-muted-foreground/60 line-through" };
    }
    if (entry?.status === "rejected") {
      return { level, className: "text-red-600/60 line-through" };
    }
    // Future level (not yet activated) or skipped — render faint.
    return { level, className: "text-muted-foreground/50" };
  });
  return (
    <div
      className="flex items-center gap-1 text-[11px] text-muted-foreground"
      title={`Level ${props.currentLevel} of ${props.totalLevels}`}
    >
      {rungs.map((r, i) => (
        <span key={r.level} className="flex items-center gap-1">
          <span className={r.className}>L{r.level}</span>
          {i < rungs.length - 1 && <span className="text-muted-foreground/40">→</span>}
        </span>
      ))}
    </div>
  );
}

const STATUS_BADGE: Record<string, { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
  pending: { label: "Pending", variant: "outline" },
  approved: { label: "Approved", variant: "default" },
  rejected: { label: "Rejected", variant: "destructive" },
  cancelled: { label: "Cancelled", variant: "secondary" },
};

/** CLE-185 — clickable column header that toggles asc/desc for one
 *  ApprovalsTable column. Shows an arrow when active. */
function SortableHeader({
  label,
  col,
  sort,
  onSort,
}: {
  label: string;
  col: "created_at" | "member_name" | "reason_name" | "start_date" | "amount" | "status";
  sort: { col: string; dir: "asc" | "desc" };
  onSort: (col: "created_at" | "member_name" | "reason_name" | "start_date" | "amount" | "status") => void;
}) {
  const active = sort.col === col;
  const Icon = active ? (sort.dir === "asc" ? ChevronUp : ChevronDown) : ChevronsUpDown;
  return (
    <TableHead>
      <button
        type="button"
        className="inline-flex items-center gap-1 text-left hover:text-foreground"
        onClick={() => onSort(col)}
        aria-label={`Sort by ${label}`}
      >
        <span>{label}</span>
        <Icon className={`h-3.5 w-3.5 ${active ? "text-foreground" : "text-muted-foreground/60"}`} />
      </button>
    </TableHead>
  );
}

/** CLE-185 — small multi-select filter popover for column headers. */
function MultiSelectFilter({
  label,
  options,
  selected,
  onToggle,
  capitalise,
}: {
  label: string;
  options: string[];
  selected: Set<string>;
  onToggle: (value: string) => void;
  capitalise?: boolean;
}) {
  const active = selected.size > 0;
  const summary =
    selected.size === 0
      ? `Any ${label}`
      : selected.size === 1
        ? capitalise
          ? capitalize([...selected][0])
          : [...selected][0]
        : `${selected.size} selected`;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={`inline-flex w-full items-center justify-between gap-1 rounded-md border h-7 px-2 text-xs ${active ? "border-primary text-foreground" : "border-input text-muted-foreground"}`}
        >
          <span className="truncate">{summary}</span>
          <ChevronDown className="h-3 w-3 shrink-0 opacity-60" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 p-0">
        <div className="max-h-64 overflow-y-auto py-1">
          {options.length === 0 && (
            <div className="px-3 py-2 text-sm text-muted-foreground">No options</div>
          )}
          {options.map((opt) => {
            const checked = selected.has(opt);
            return (
              <button
                key={opt}
                type="button"
                onClick={() => onToggle(opt)}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-muted/40"
              >
                <span
                  className={`flex h-4 w-4 items-center justify-center rounded border ${checked ? "bg-primary border-primary" : "border-input"}`}
                >
                  {checked && <Check className="h-3 w-3 text-primary-foreground" />}
                </span>
                <span className="flex-1 truncate">{capitalise ? capitalize(opt) : opt}</span>
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

type SortCol = "created_at" | "member_name" | "reason_name" | "start_date" | "amount" | "status";
type SortState = { col: SortCol; dir: "asc" | "desc" };
const ALL_STATUSES = ["pending", "approved", "rejected", "cancelled"] as const;
type RequestedPreset = "all" | "today" | "thisweek" | "thismonth";

/** Resolve a RequestedPreset to a [fromISO, toISO] inclusive range covering
 *  the user's local-time day boundaries. Pretty UTC-flexible: we treat
 *  audit-style created_at strings as ISO timestamps and compare to local
 *  midnight boundaries. */
function getRequestedWindow(preset: RequestedPreset): { from: Date; to: Date } | null {
  if (preset === "all") return null;
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  if (preset === "today") {
    return { from: startOfDay, to: endOfDay };
  }
  if (preset === "thisweek") {
    // ISO weeks start Monday
    const day = startOfDay.getDay(); // Sun=0, Mon=1, ...
    const daysBack = day === 0 ? 6 : day - 1;
    const weekStart = new Date(startOfDay);
    weekStart.setDate(weekStart.getDate() - daysBack);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);
    weekEnd.setHours(23, 59, 59, 999);
    return { from: weekStart, to: weekEnd };
  }
  // thismonth
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
  return { from: monthStart, to: monthEnd };
}

export function ApprovalsClient({ pendingRows, allRows, calendarMembers, calendarBookings, calendarBankHolidays, bankHolidayColour, bankHolidayHandling = "additional" }: ApprovalsClientProps) {
  const router = useRouter();
  const { memberLabel } = useMemberLabel();
  const singularLabel = memberLabel.toLowerCase();
  const pluralLabel = pluralize(memberLabel).toLowerCase();
  const [approvingRow, setApprovingRow] = useState<ApprovalRow | null>(null);
  const [approveNote, setApproveNote] = useState("");
  const [approveLoading, setApproveLoading] = useState(false);
  // CLE-192 — surface server errors so the dialog doesn't silently swallow
  // failures (e.g. "Insufficient permissions" when the caller isn't the
  // routed approver). Cleared every time the dialog opens.
  const [approveError, setApproveError] = useState<string | null>(null);
  const [rejectingRow, setRejectingRow] = useState<ApprovalRow | null>(null);
  const [rejectNote, setRejectNote] = useState("");
  const [rejectLoading, setRejectLoading] = useState(false);
  const [rejectError, setRejectError] = useState<string | null>(null);
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);

  // CLE-185 — single-list view with multi-column sort and filter. Page
  // opens with Status filtered to "pending" so the admin lands on what
  // most needs attention.
  const [statusFilter, setStatusFilter] = useState<Set<string>>(new Set(["pending"]));
  const [memberFilter, setMemberFilter] = useState("");
  const [reasonFilter, setReasonFilter] = useState<Set<string>>(new Set());
  const [requestedPreset, setRequestedPreset] = useState<RequestedPreset>("all");
  const [sort, setSort] = useState<SortState>({ col: "created_at", dir: "desc" });

  // CLE-185 — the ApprovalsTable embeds many Radix Popovers (history button
  // per row + filter dropdowns) whose internally-generated aria-controls
  // IDs were intermittently mismatching between SSR and the first client
  // render, producing a hydration warning. Defer the table to a
  // post-mount render so the popovers never SSR; the page header still
  // SSRs normally.
  const [hasMounted, setHasMounted] = useState(false);
  useEffect(() => {
    setHasMounted(true);
  }, []);

  // The set of booking ids the caller is actually authorised to approve
  // (server-side filtered). Used to enable/disable per-row controls when
  // a non-routed admin views the list.
  const approvableIds = useMemo(
    () => new Set(pendingRows.map((r) => r.id)),
    [pendingRows],
  );

  // Bulk selection — kept only for rows the caller can approve
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkApproveOpen, setBulkApproveOpen] = useState(false);
  const [bulkRejectOpen, setBulkRejectOpen] = useState(false);
  const [bulkNote, setBulkNote] = useState("");
  const [bulkLoading, setBulkLoading] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const clearSelection = () => setSelectedIds(new Set());

  const selectedRows = allRows.filter((r) => selectedIds.has(r.id));

  // Unique reason names across the org's rows — drives the Reason filter
  const allReasonNames = useMemo(() => {
    const set = new Set<string>();
    for (const r of allRows) set.add(r.reason_name);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [allRows]);

  // Apply filters + sort
  const visibleRows = useMemo(() => {
    const memberQ = memberFilter.trim().toLowerCase();
    const window = getRequestedWindow(requestedPreset);
    const filtered = allRows.filter((r) => {
      if (statusFilter.size > 0 && !statusFilter.has(r.status)) return false;
      if (memberQ && !r.member_name.toLowerCase().includes(memberQ)) return false;
      if (reasonFilter.size > 0 && !reasonFilter.has(r.reason_name)) return false;
      if (window) {
        const t = new Date(r.created_at).getTime();
        if (t < window.from.getTime() || t > window.to.getTime()) return false;
      }
      return true;
    });
    const dir = sort.dir === "asc" ? 1 : -1;
    const cmp = (a: ApprovalRow, b: ApprovalRow): number => {
      switch (sort.col) {
        case "created_at":
          return (a.created_at > b.created_at ? 1 : a.created_at < b.created_at ? -1 : 0) * dir;
        case "member_name":
          return a.member_name.localeCompare(b.member_name) * dir;
        case "reason_name":
          return a.reason_name.localeCompare(b.reason_name) * dir;
        case "start_date":
          return (a.start_date > b.start_date ? 1 : a.start_date < b.start_date ? -1 : 0) * dir;
        case "amount": {
          const av = a.measurement_mode === "hours" ? a.hours_deducted : a.days_deducted;
          const bv = b.measurement_mode === "hours" ? b.hours_deducted : b.days_deducted;
          return ((av ?? 0) - (bv ?? 0)) * dir;
        }
        case "status":
          return a.status.localeCompare(b.status) * dir;
      }
    };
    return [...filtered].sort(cmp);
  }, [allRows, statusFilter, memberFilter, reasonFilter, requestedPreset, sort]);

  // Select-all targets the visible AND approvable rows only.
  const selectableVisibleIds = useMemo(
    () => visibleRows.filter((r) => approvableIds.has(r.id)).map((r) => r.id),
    [visibleRows, approvableIds],
  );
  const allSelectedVisible =
    selectableVisibleIds.length > 0 &&
    selectableVisibleIds.every((id) => selectedIds.has(id));
  const toggleSelectAll = () => {
    if (allSelectedVisible) {
      // Deselect all visible selectable
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const id of selectableVisibleIds) next.delete(id);
        return next;
      });
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const id of selectableVisibleIds) next.add(id);
        return next;
      });
    }
  };

  const toggleStatus = (status: string) => {
    setStatusFilter((prev) => {
      const next = new Set(prev);
      if (next.has(status)) next.delete(status);
      else next.add(status);
      return next;
    });
  };

  const toggleReason = (reason: string) => {
    setReasonFilter((prev) => {
      const next = new Set(prev);
      if (next.has(reason)) next.delete(reason);
      else next.add(reason);
      return next;
    });
  };

  function handleSort(col: SortCol) {
    setSort((prev) =>
      prev.col === col
        ? { col, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { col, dir: "asc" },
    );
  }

  async function handleBulkApprove() {
    setBulkLoading(true);
    const ids = Array.from(selectedIds);
    const result = await bulkApproveBookings(ids, bulkNote);
    setBulkLoading(false);
    if (result.success) {
      setBulkApproveOpen(false);
      setBulkNote("");
      setToastMessage(`${result.processed ?? ids.length} request${(result.processed ?? ids.length) === 1 ? "" : "s"} approved`);
      clearSelection();
      router.refresh();
      setTimeout(() => setToastMessage(null), 4000);
    }
  }

  async function handleBulkReject() {
    setBulkLoading(true);
    const ids = Array.from(selectedIds);
    const result = await bulkRejectBookings(ids, bulkNote);
    setBulkLoading(false);
    if (result.success) {
      setBulkRejectOpen(false);
      setBulkNote("");
      setToastMessage(`${result.processed ?? ids.length} request${(result.processed ?? ids.length) === 1 ? "" : "s"} rejected`);
      clearSelection();
      router.refresh();
      setTimeout(() => setToastMessage(null), 4000);
    }
  }

  async function handleApprove() {
    if (!approvingRow) return;
    setApproveLoading(true);
    setApproveError(null);
    const result = await approveBooking(approvingRow.id, approveNote);
    setApproveLoading(false);
    if (result.success) {
      setApprovingRow(null);
      setApproveNote("");
      setApproveError(null);
      router.refresh();
    } else {
      // CLE-192 — surface the server error so the admin sees why the
      // dialog isn't closing (typically "Insufficient permissions"
      // when the caller isn't the routed approver).
      setApproveError(result.error ?? "Failed to approve booking");
    }
  }

  async function handleReject() {
    if (!rejectingRow) return;
    setRejectLoading(true);
    setRejectError(null);
    const result = await rejectBooking(rejectingRow.id, rejectNote);
    setRejectLoading(false);
    if (result.success) {
      setRejectingRow(null);
      setRejectNote("");
      setRejectError(null);
      router.refresh();
    } else {
      setRejectError(result.error ?? "Failed to reject booking");
    }
  }

  const pendingCount = pendingRows.length;
  const totalCount = allRows.length;

  return (
    <>
      <StickyPageHeader>
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">Absence Approvals</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              {visibleRows.length} of {totalCount} request{totalCount === 1 ? "" : "s"}
              {pendingCount > 0 && (
                <> · <strong>{pendingCount}</strong> awaiting your decision</>
              )}
            </p>
          </div>
          <div
            className={`flex items-center gap-2 transition-opacity duration-150 ${selectedIds.size > 0 ? "opacity-100" : "opacity-0 pointer-events-none"}`}
            aria-hidden={selectedIds.size === 0}
          >
            <span className="text-sm">
              <strong>{selectedIds.size}</strong> request{selectedIds.size === 1 ? "" : "s"} selected
            </span>
            <Button
              size="sm"
              variant="outline"
              className="text-green-600 border-green-200 hover:bg-green-50 dark:hover:bg-green-950/30"
              onClick={() => { setBulkNote(""); setBulkApproveOpen(true); }}
            >
              <Check className="h-3.5 w-3.5 mr-1" />
              Approve Selected
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="text-red-600 border-red-200 hover:bg-red-50 dark:hover:bg-red-950/30"
              onClick={() => { setBulkNote(""); setBulkRejectOpen(true); }}
            >
              <X className="h-3.5 w-3.5 mr-1" />
              Reject Selected
            </Button>
            <Button size="sm" variant="ghost" onClick={clearSelection}>
              Clear selection
            </Button>
          </div>
        </div>
      </StickyPageHeader>

      <div className="mt-4 space-y-3">
        {toastMessage && (
          <div className="rounded-md bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 p-3 text-sm text-green-800 dark:text-green-200">
            {toastMessage}
          </div>
        )}
        {hasMounted ? (
          <ApprovalsTable
            rows={visibleRows}
            approvableIds={approvableIds}
            selectedIds={selectedIds}
            onToggleSelect={toggleSelect}
            onToggleSelectAll={toggleSelectAll}
            allSelected={allSelectedVisible}
            onApprove={(row) => { setApproveNote(""); setApproveError(null); setApprovingRow(row); }}
            onReject={(row) => { setRejectNote(""); setRejectError(null); setRejectingRow(row); }}
            emptyMessage={
              statusFilter.size > 0 || memberFilter.trim() || reasonFilter.size > 0
                ? "No requests match the current filters."
                : "No requests found."
            }
            expandedRowId={expandedRowId}
            onToggleCalendar={(rowId) => setExpandedRowId((prev) => prev === rowId ? null : rowId)}
            calendarMembers={calendarMembers}
            calendarBookings={calendarBookings}
            calendarBankHolidays={calendarBankHolidays}
            bankHolidayColour={bankHolidayColour}
            bankHolidayHandling={bankHolidayHandling}
            sort={sort}
            onSort={handleSort}
            statusFilter={statusFilter}
            onToggleStatus={toggleStatus}
            memberFilter={memberFilter}
            onChangeMemberFilter={setMemberFilter}
            reasonFilter={reasonFilter}
            onToggleReason={toggleReason}
            allReasonNames={allReasonNames}
            requestedPreset={requestedPreset}
            onChangeRequestedPreset={setRequestedPreset}
          />
        ) : (
          <div className="flex justify-center w-full">
            <div className="w-auto max-w-[90%] min-w-0">
              <div className="rounded-md border h-32 flex items-center justify-center text-sm text-muted-foreground">
                Loading requests…
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Approve dialog. CLE-189 — when the request was raised over a
          notice or cover warning, render a prominent warning above the
          note input so the admin has to consciously confirm. The Approve
          button label changes to "Approve anyway" in that case for the
          same reason. */}
      <Dialog open={!!approvingRow} onOpenChange={(open) => { if (!open) setApprovingRow(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Approve Holiday Request</DialogTitle>
            <DialogDescription>
              {approvingRow && (
                <>
                  <strong>{approvingRow.member_name}</strong> —{" "}
                  {fmtDateRange(approvingRow.start_date, approvingRow.end_date, approvingRow.start_half, approvingRow.end_half)}{" "}
                  ({approvingRow.reason_name})
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          {approvingRow && (approvingRow.notice_violation_at_submit || approvingRow.cover_violation_at_submit) && (
            <div className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-700 p-3 text-sm text-amber-900 dark:text-amber-200">
              <p className="font-semibold mb-1">This request was submitted despite a warning.</p>
              <ul className="list-disc list-inside space-y-0.5">
                {approvingRow.notice_violation_at_submit && (
                  <li>Notice period rules — the booking didn&apos;t meet the minimum notice required.</li>
                )}
                {approvingRow.cover_violation_at_submit && (
                  <li>Team cover — approving would push the team below the Min Cover on one or more days.</li>
                )}
              </ul>
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="approve-note">Add a note for the {singularLabel} (optional)</Label>
            <Textarea
              id="approve-note"
              value={approveNote}
              onChange={(e) => setApproveNote(e.target.value)}
              rows={3}
              placeholder="Optional"
            />
          </div>
          {approveError && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              {approveError}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setApprovingRow(null)} disabled={approveLoading}>
              Cancel
            </Button>
            <Button
              className="bg-green-600 text-white hover:bg-green-700"
              onClick={handleApprove}
              disabled={approveLoading}
            >
              {approveLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {approvingRow && (approvingRow.notice_violation_at_submit || approvingRow.cover_violation_at_submit)
                ? "Approve anyway"
                : "Approve"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reject dialog */}
      <Dialog open={!!rejectingRow} onOpenChange={(open) => { if (!open) setRejectingRow(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject Holiday Request</DialogTitle>
            <DialogDescription>
              {rejectingRow && (
                <>
                  <strong>{rejectingRow.member_name}</strong> —{" "}
                  {fmtDateRange(rejectingRow.start_date, rejectingRow.end_date, rejectingRow.start_half, rejectingRow.end_half)}{" "}
                  ({rejectingRow.reason_name})
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="reject-note">Reason for rejection (shown to {singularLabel})</Label>
            <Textarea
              id="reject-note"
              value={rejectNote}
              onChange={(e) => setRejectNote(e.target.value)}
              rows={3}
              placeholder="Optional"
            />
          </div>
          {rejectError && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              {rejectError}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectingRow(null)} disabled={rejectLoading}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleReject}
              disabled={rejectLoading}
            >
              {rejectLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Reject Request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk Approve dialog */}
      <Dialog open={bulkApproveOpen} onOpenChange={setBulkApproveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Approve {selectedRows.length} Holiday Request{selectedRows.length === 1 ? "" : "s"}</DialogTitle>
            <DialogDescription>
              You are about to approve the following requests. An approval email will be sent to each {singularLabel}.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <ul className="text-sm space-y-1 max-h-40 overflow-y-auto">
              {selectedRows.slice(0, 5).map((r) => (
                <li key={r.id} className="text-muted-foreground">
                  <strong className="text-foreground">{r.member_name}</strong> — {fmtDateRange(r.start_date, r.end_date, r.start_half, r.end_half)}
                </li>
              ))}
              {selectedRows.length > 5 && (
                <li className="text-muted-foreground italic">...and {selectedRows.length - 5} more</li>
              )}
            </ul>
            {/* CLE-189 — surface the count of selected requests that
                were raised over a notice or cover warning so the admin
                can't bulk-approve them blind. */}
            {(() => {
              const flagged = selectedRows.filter(
                (r) => r.notice_violation_at_submit || r.cover_violation_at_submit,
              );
              if (flagged.length === 0) return null;
              return (
                <div className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-700 p-3 text-sm text-amber-900 dark:text-amber-200">
                  <strong>{flagged.length}</strong> of these {flagged.length === 1 ? "request was" : "requests were"} submitted despite a notice or cover warning. Approving will go ahead anyway.
                </div>
              );
            })()}
            <div className="space-y-2 pt-1">
              <Label htmlFor="bulk-approve-note">Add a note (shown to all {pluralLabel})</Label>
              <Textarea
                id="bulk-approve-note"
                value={bulkNote}
                onChange={(e) => setBulkNote(e.target.value)}
                rows={3}
                placeholder="Optional"
                className="mt-1"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkApproveOpen(false)} disabled={bulkLoading}>Cancel</Button>
            <Button
              className="bg-green-600 hover:bg-green-700 text-white"
              onClick={handleBulkApprove}
              disabled={bulkLoading}
            >
              {bulkLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Approve All
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk Reject dialog */}
      <Dialog open={bulkRejectOpen} onOpenChange={setBulkRejectOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject {selectedRows.length} Holiday Request{selectedRows.length === 1 ? "" : "s"}</DialogTitle>
            <DialogDescription>
              You are about to reject the following requests. A rejection email will be sent to each {singularLabel}.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <ul className="text-sm space-y-1 max-h-40 overflow-y-auto">
              {selectedRows.slice(0, 5).map((r) => (
                <li key={r.id} className="text-muted-foreground">
                  <strong className="text-foreground">{r.member_name}</strong> — {fmtDateRange(r.start_date, r.end_date, r.start_half, r.end_half)}
                </li>
              ))}
              {selectedRows.length > 5 && (
                <li className="text-muted-foreground italic">...and {selectedRows.length - 5} more</li>
              )}
            </ul>
            <div className="space-y-2 pt-1">
              <Label htmlFor="bulk-reject-note">Reason for rejection (shown to all {pluralLabel})</Label>
              <Textarea
                id="bulk-reject-note"
                value={bulkNote}
                onChange={(e) => setBulkNote(e.target.value)}
                rows={3}
                placeholder="Optional"
                className="mt-1"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkRejectOpen(false)} disabled={bulkLoading}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={handleBulkReject}
              disabled={bulkLoading}
            >
              {bulkLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Reject All
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ---------------------------------------------------------------------------
// Overlap-sorted members for inline calendar
// ---------------------------------------------------------------------------

function getOverlapDays(aStart: string, aEnd: string | null, bStart: string, bEnd: string | null): number {
  // Treat open-ended bookings as extending to a far-future date
  const aEndEff = aEnd ?? "9999-12-31";
  const bEndEff = bEnd ?? "9999-12-31";
  const s = aStart > bStart ? aStart : bStart;
  const e = aEndEff < bEndEff ? aEndEff : bEndEff;
  if (s > e) return 0;
  const ms = Date.parse(e + "T00:00:00Z") - Date.parse(s + "T00:00:00Z");
  return Math.floor(ms / 86_400_000) + 1;
}

function sortMembersForApproval(
  row: ApprovalRow,
  members: (TeamMember & { teamId: string | null })[],
  bookings: TeamBooking[],
): (TeamMember & { teamId: string | null })[] {
  const requestor = members.find((m) => m.id === row.member_id);
  const teamId = requestor?.teamId ?? null;

  // Filter to same team (if requestor has a team), otherwise show all
  const teamMembers = teamId
    ? members.filter((m) => m.teamId === teamId)
    : members;

  // For each member, compute: approved overlap days, pending overlap days,
  // and earliest overlapping pending booking created_at
  const approvedOverlap = new Map<string, number>();
  const pendingOverlap = new Map<string, number>();
  const earliestPendingCreatedAt = new Map<string, string>();

  for (const m of teamMembers) {
    let approvedDays = 0;
    let pendingDays = 0;
    let earliestCa: string | null = null;

    for (const b of bookings) {
      if (b.member_id !== m.id) continue;
      const overlap = getOverlapDays(row.start_date, row.end_date, b.start_date, b.end_date);
      if (overlap === 0) continue;

      if (b.status === "approved") {
        approvedDays += overlap;
      } else if (b.status === "pending") {
        pendingDays += overlap;
        if (b.created_at && (!earliestCa || b.created_at < earliestCa)) {
          earliestCa = b.created_at;
        }
      }
    }

    approvedOverlap.set(m.id, approvedDays);
    pendingOverlap.set(m.id, pendingDays);
    if (earliestCa) earliestPendingCreatedAt.set(m.id, earliestCa);
  }

  // Assign each member to a group:
  // 1 = approved overlap, 2 = pending overlap (no approved), 3 = no overlap
  function getGroup(id: string): number {
    if ((approvedOverlap.get(id) ?? 0) > 0) return 1;
    if ((pendingOverlap.get(id) ?? 0) > 0) return 2;
    return 3;
  }

  return [...teamMembers].sort((a, b) => {
    const gA = getGroup(a.id);
    const gB = getGroup(b.id);
    if (gA !== gB) return gA - gB;

    if (gA === 1) {
      // Group 1: descending by approved overlap days
      return (approvedOverlap.get(b.id) ?? 0) - (approvedOverlap.get(a.id) ?? 0);
    }
    if (gA === 2) {
      // Group 2: ascending by earliest pending created_at
      const caA = earliestPendingCreatedAt.get(a.id) ?? "";
      const caB = earliestPendingCreatedAt.get(b.id) ?? "";
      return caA < caB ? -1 : caA > caB ? 1 : 0;
    }
    // Group 3: alphabetical by name
    return a.name.localeCompare(b.name);
  });
}

// ---------------------------------------------------------------------------
// Shared table component
// ---------------------------------------------------------------------------

function ApprovalsTable({
  rows,
  approvableIds,
  selectedIds,
  onToggleSelect,
  onToggleSelectAll,
  allSelected,
  onApprove,
  onReject,
  emptyMessage,
  expandedRowId,
  onToggleCalendar,
  calendarMembers,
  calendarBookings,
  calendarBankHolidays,
  bankHolidayColour,
  bankHolidayHandling,
  sort,
  onSort,
  statusFilter,
  onToggleStatus,
  memberFilter,
  onChangeMemberFilter,
  reasonFilter,
  onToggleReason,
  allReasonNames,
  requestedPreset,
  onChangeRequestedPreset,
}: {
  rows: ApprovalRow[];
  approvableIds: Set<string>;
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onToggleSelectAll: () => void;
  allSelected: boolean;
  onApprove: (row: ApprovalRow) => void;
  onReject: (row: ApprovalRow) => void;
  emptyMessage: string;
  expandedRowId?: string | null;
  onToggleCalendar?: (rowId: string) => void;
  calendarMembers?: (TeamMember & { teamId: string | null })[];
  calendarBookings?: TeamBooking[];
  calendarBankHolidays?: TeamBankHoliday[];
  bankHolidayColour?: string;
  bankHolidayHandling?: "additional" | "deducted";
  sort: SortState;
  onSort: (col: SortCol) => void;
  statusFilter: Set<string>;
  onToggleStatus: (status: string) => void;
  memberFilter: string;
  onChangeMemberFilter: (v: string) => void;
  reasonFilter: Set<string>;
  onToggleReason: (reason: string) => void;
  allReasonNames: string[];
  requestedPreset: RequestedPreset;
  onChangeRequestedPreset: (p: RequestedPreset) => void;
}) {
  const { memberLabel } = useMemberLabel();
  // 1 select + 1 actions + 7 content columns = 9
  const colSpanTotal = 9;
  return (
    <div className="flex justify-center w-full">
      <div className="w-auto max-w-[90%] min-w-0">
        <div className="rounded-md border">
          {/* containerClassName="overflow-visible" disables the Table's own
              vertical scroll context so the sticky thead anchors to the page
              (just under the StickyPageHeader band — top-[184px] tucks the
              thead a few pixels under the band's bottom border so no row
              data peeks through as it scrolls past) rather than the
              non-scrolling table container. */}
          <Table containerClassName="overflow-visible">
            <TableHeader className="[&_th]:sticky [&_th]:bg-background [&_th]:z-20">
              <TableRow className="[&_th]:top-[160px]">
                <TableHead className="w-10">
                  <Checkbox
                    checked={allSelected}
                    onCheckedChange={onToggleSelectAll}
                    aria-label="Select all approvable on this page"
                  />
                </TableHead>
                <SortableHeader label="Requested" col="created_at" sort={sort} onSort={onSort} />
                <SortableHeader label={capitalize(memberLabel)} col="member_name" sort={sort} onSort={onSort} />
                <SortableHeader label="Reason" col="reason_name" sort={sort} onSort={onSort} />
                <SortableHeader label="Dates" col="start_date" sort={sort} onSort={onSort} />
                <SortableHeader label="Days/Hours" col="amount" sort={sort} onSort={onSort} />
                <TableHead>Notes</TableHead>
                <SortableHeader label="Status" col="status" sort={sort} onSort={onSort} />
                <TableHead className="w-32">Actions</TableHead>
              </TableRow>
              {/* Filter row — same sticky band, offset to sit below the header */}
              <TableRow className="[&_th]:top-[200px] [&_th]:border-b">
                <TableHead />
                <TableHead>
                  <select
                    value={requestedPreset}
                    onChange={(e) => onChangeRequestedPreset(e.target.value as RequestedPreset)}
                    className="h-7 w-full rounded-md border border-input bg-background px-2 text-xs"
                  >
                    <option value="all">Any time</option>
                    <option value="today">Today</option>
                    <option value="thisweek">This week</option>
                    <option value="thismonth">This month</option>
                  </select>
                </TableHead>
                <TableHead>
                  <Input
                    value={memberFilter}
                    onChange={(e) => onChangeMemberFilter(e.target.value)}
                    placeholder="Filter…"
                    className="h-7 text-xs"
                  />
                </TableHead>
                <TableHead>
                  <MultiSelectFilter
                    label="reason"
                    options={allReasonNames}
                    selected={reasonFilter}
                    onToggle={onToggleReason}
                  />
                </TableHead>
                <TableHead />
                <TableHead />
                <TableHead />
                <TableHead>
                  <MultiSelectFilter
                    label="status"
                    options={[...ALL_STATUSES]}
                    selected={statusFilter}
                    onToggle={onToggleStatus}
                    capitalise
                  />
                </TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={colSpanTotal} className="h-24 text-center text-muted-foreground">
                    {emptyMessage}
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row) => {
                  const unit = row.measurement_mode === "hours" ? "hours" : "days";
                  const val = row.measurement_mode === "hours" ? row.hours_deducted : row.days_deducted;
                  const badge = STATUS_BADGE[row.status] ?? STATUS_BADGE.pending;
                  const canActOnRow = row.status === "pending" && approvableIds.has(row.id);
                  return (
                    <React.Fragment key={row.id}>
                    <TableRow>
                      <TableCell className="w-10" onClick={(e) => e.stopPropagation()}>
                        {canActOnRow && (
                          <Checkbox
                            checked={selectedIds.has(row.id)}
                            onCheckedChange={() => onToggleSelect(row.id)}
                            aria-label={`Select request from ${row.member_name}`}
                          />
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">{fmtDateTime(row.created_at)}</TableCell>
                      <TableCell className="font-medium">{row.member_name}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span
                            className="inline-block h-2.5 w-2.5 rounded-full shrink-0"
                            style={{ backgroundColor: row.reason_colour }}
                          />
                          {row.reason_name}
                        </div>
                      </TableCell>
                      <TableCell>
                        {fmtDateRange(row.start_date, row.end_date, row.start_half, row.end_half)}
                      </TableCell>
                      <TableCell>{val ?? "—"} {val !== null ? unit : ""}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {/* Wrap in a fixed-width container so children's
                            truncate actually applies. A bare max-w on td
                            is unreliable under table-layout: auto. */}
                        <div className="w-[16rem] max-w-[16rem] space-y-0.5">
                          {(() => {
                            // CLE-185 — for terminal statuses, surface who
                            // decided + when. Prefer the level_history entry
                            // (has decided_at + decided_by_name); fall back
                            // to approver_name on legacy bookings.
                            if (row.status === "pending") return null;
                            const verb =
                              row.status === "approved"
                                ? "Approved"
                                : row.status === "rejected"
                                  ? "Rejected"
                                  : row.status === "cancelled"
                                    ? "Cancelled"
                                    : null;
                            if (!verb) return null;
                            const matched = [...row.level_history]
                              .reverse()
                              .find((h) => h.status === row.status);
                            const who = matched?.decided_by_name ?? row.approver_name ?? null;
                            const when = matched?.decided_at ?? null;
                            if (!who && !when) return null;
                            return (
                              <p className="text-foreground truncate">
                                {verb}
                                {who && <> by <span className="font-medium">{who}</span></>}
                                {when && <> · {fmtDateTime(when)}</>}
                              </p>
                            );
                          })()}
                          {row.employee_note && <p className="truncate italic">{row.member_name}: {row.employee_note}</p>}
                          {row.approver_note && <p className="truncate">{row.approver_name ?? "Approver"}: {row.approver_note}</p>}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-1">
                          <div className="flex items-center gap-1.5">
                            <Badge variant={badge.variant}>{badge.label}</Badge>
                            {row.completion_status && row.completion_status !== "complete" && (
                              <CompletionStatusBadge status={row.completion_status as CompletionStatus} />
                            )}
                          </div>
                          {/* CLE-183/186 — level context for multi-level
                              approvals. LevelLadder hides itself when the
                              profile only has one level. */}
                          {row.status === "pending" && row.current_approval_level !== null && (
                            <LevelLadder
                              currentLevel={row.current_approval_level}
                              totalLevels={row.profile_total_levels ?? 0}
                              history={row.level_history}
                            />
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                          {/* CLE-185 — History popover on every row */}
                          <BookingHistoryPopover bookingId={row.id} />
                          {/* CLE-185 — Info / team-availability calendar on every row */}
                          <Button
                            size="sm"
                            variant={expandedRowId === row.id ? "secondary" : "ghost"}
                            title="View team availability"
                            onClick={() => onToggleCalendar?.(row.id)}
                          >
                            <Info className="h-3.5 w-3.5" />
                          </Button>
                          {/* Calendar deep-link — opens the requester's
                              planner with this booking auto-expanded so
                              the admin can see it in the context of
                              their own holiday history. */}
                          <Button
                            size="sm"
                            variant="ghost"
                            title="Open in employee calendar"
                            asChild
                          >
                            <Link href={`/members/${row.member_id}/calendar?bookingId=${row.id}`}>
                              <CalendarDays className="h-3.5 w-3.5" />
                            </Link>
                          </Button>
                          {canActOnRow && (
                            <>
                              <Button
                                size="sm"
                                variant="outline"
                                className="text-green-600 border-green-200 hover:bg-green-50 dark:hover:bg-green-950/30"
                                onClick={() => onApprove(row)}
                              >
                                <Check className="h-3.5 w-3.5 mr-1" />
                                Approve
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="text-red-600 border-red-200 hover:bg-red-50 dark:hover:bg-red-950/30"
                                onClick={() => onReject(row)}
                              >
                                <X className="h-3.5 w-3.5 mr-1" />
                                Reject
                              </Button>
                            </>
                          )}
                          {/* CLE-189/191 — snapshot warning badges. Sit
                              outside the canActOnRow branch so the
                              warning context renders for every viewer,
                              not just the routed approver. CLE-192 also
                              opens up canActOnRow for these rows via
                              the server-side approvableIds query, so
                              the buttons + badges typically appear
                              together. */}
                          {row.notice_violation_at_submit && (
                            <Badge
                              variant="outline"
                              className="border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-300"
                              title="Submitted despite a notice-period warning"
                            >
                              Notice
                            </Badge>
                          )}
                          {row.cover_violation_at_submit && (
                            <Badge
                              variant="outline"
                              className="border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-300"
                              title="Submitted despite a team-cover warning"
                            >
                              Cover
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                    {expandedRowId === row.id && calendarMembers && calendarBookings && calendarBankHolidays && (() => {
                      const sorted = sortMembersForApproval(row, calendarMembers, calendarBookings);
                      return (
                        <TableRow>
                          <TableCell colSpan={colSpanTotal} className="p-4 bg-muted/30">
                            <div className="flex flex-col items-center gap-2">
                              {/* CLE-192 — surface the team name above the
                                  inline calendar so admins immediately
                                  know which team's availability they're
                                  looking at. Falls back to "No team" for
                                  members not assigned to a team. */}
                              <div className="text-sm font-semibold text-foreground self-start">
                                Team: <span className="font-normal">{row.team_name ?? "—"}</span>
                              </div>
                              <div className="w-fit overflow-x-auto">
                                <TeamCalendar
                                  members={sorted}
                                  bookings={calendarBookings}
                                  bankHolidays={calendarBankHolidays}
                                  bankHolidayColour={bankHolidayColour}
                                  highlightMemberId={row.member_id}
                                  focusRange={{ startDate: row.start_date, endDate: row.end_date }}
                                  requiredCover={row.cover_context?.minCover}
                                  offendingDates={row.cover_context?.offendingDates}
                                  coverMode
                                  bankHolidayHandling={bankHolidayHandling}
                                />
                              </div>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })()}
                  </React.Fragment>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}
