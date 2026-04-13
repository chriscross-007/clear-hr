"use client";

import React, { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowUpDown, Download, FileDown, Star, Save, Plus, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { ColumnCustomiserTrigger, ColumnCustomiserDialog } from "@/components/ui/column-customiser";
import type { ColPref } from "@/lib/grid-prefs-actions";
import { saveGridPrefs } from "@/lib/grid-prefs-actions";
import { useColumnPrefs } from "@/hooks/use-column-prefs";
import type { GridPrefs } from "@/lib/grid-prefs";
import { toggleFavourite, createCustomReport } from "@/app/(dashboard)/reports/actions";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type HolidayBookingRow = {
  id: string;
  first_name: string;
  last_name: string;
  payroll_number: string | null;
  team_name: string;
  team_id: string | null;
  leave_type: string;
  leave_colour: string;
  leave_reason_id: string;
  start_date: string;
  end_date: string;
  days: number;
  status: string;
  created_at: string;
  actioned_by: string | null;
  actioned_at: string | null;
};

interface HolidayReportClientProps {
  rows: HolidayBookingRow[];
  teams: { id: string; name: string }[];
  absenceReasons: { id: string; name: string; colour: string }[];
  defaultFrom: string;
  defaultTo: string;
  orgName: string;
  initialFavourited: boolean;
  initialPrefs: GridPrefs;
  canCreateCustom: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

const STATUS_BADGE: Record<string, { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
  pending: { label: "Pending", variant: "outline" },
  approved: { label: "Approved", variant: "default" },
  rejected: { label: "Rejected", variant: "destructive" },
  cancelled: { label: "Cancelled", variant: "secondary" },
};

const ALL_STATUSES = ["approved", "pending", "cancelled", "rejected"];

type SortKey = "payroll_number" | "first_name" | "last_name" | "team_name" | "leave_type" | "start_date" | "end_date" | "days" | "status" | "created_at" | "actioned_by" | "actioned_at";

const ALL_COL_IDS: SortKey[] = ["payroll_number", "first_name", "last_name", "team_name", "leave_type", "start_date", "end_date", "days", "status", "created_at", "actioned_by", "actioned_at"];

const COL_LABELS: Record<string, string> = {
  payroll_number: "Payroll #",
  first_name: "First Name",
  last_name: "Last Name",
  team_name: "Team",
  leave_type: "Leave Type",
  start_date: "Start Date",
  end_date: "End Date",
  days: "Days",
  status: "Status",
  created_at: "Requested",
  actioned_by: "Approved/Rejected By",
  actioned_at: "Approved/Rejected When",
};

// ---------------------------------------------------------------------------
// Column definitions — data-driven rendering
// ---------------------------------------------------------------------------

type ColDef = {
  id: SortKey;
  headerClassName?: string;
  render: (r: HolidayBookingRow) => React.ReactNode;
  csvValue: (r: HolidayBookingRow) => string;
};

const COL_DEFS: ColDef[] = [
  { id: "payroll_number", render: (r) => r.payroll_number ?? "—", csvValue: (r) => `"${r.payroll_number ?? ""}"` },
  { id: "first_name", render: (r) => <span className="font-medium">{r.first_name}</span>, csvValue: (r) => `"${r.first_name}"` },
  { id: "last_name", render: (r) => <span className="font-medium">{r.last_name}</span>, csvValue: (r) => `"${r.last_name}"` },
  { id: "team_name", render: (r) => r.team_name, csvValue: (r) => `"${r.team_name}"` },
  {
    id: "leave_type",
    render: (r) => (
      <div className="flex items-center gap-2">
        <span className="inline-block h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: r.leave_colour }} />
        {r.leave_type}
      </div>
    ),
    csvValue: (r) => `"${r.leave_type}"`,
  },
  { id: "start_date", render: (r) => <span className="whitespace-nowrap">{fmtDate(r.start_date)}</span>, csvValue: (r) => r.start_date },
  { id: "end_date", render: (r) => <span className="whitespace-nowrap">{fmtDate(r.end_date)}</span>, csvValue: (r) => r.end_date },
  { id: "days", headerClassName: "text-right", render: (r) => <span className="text-right block">{r.days}</span>, csvValue: (r) => String(r.days) },
  {
    id: "status",
    render: (r) => { const b = STATUS_BADGE[r.status] ?? STATUS_BADGE.pending; return <Badge variant={b.variant}>{b.label}</Badge>; },
    csvValue: (r) => r.status,
  },
  { id: "created_at", render: (r) => <span className="whitespace-nowrap text-muted-foreground">{fmtDateTime(r.created_at)}</span>, csvValue: (r) => `"${fmtDateTime(r.created_at)}"` },
  { id: "actioned_by", render: (r) => r.actioned_by ?? "", csvValue: (r) => `"${r.actioned_by ?? ""}"` },
  { id: "actioned_at", render: (r) => r.actioned_at ? <span className="whitespace-nowrap text-muted-foreground">{fmtDateTime(r.actioned_at)}</span> : "", csvValue: (r) => r.actioned_at ? `"${fmtDateTime(r.actioned_at)}"` : "" },
];

const COL_DEF_MAP = new Map(COL_DEFS.map((c) => [c.id, c]));

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function HolidayReportClient({ rows, teams, absenceReasons, defaultFrom, defaultTo, orgName, initialFavourited, initialPrefs, canCreateCustom }: HolidayReportClientProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // Restore saved filters
  const savedFilters = initialPrefs.filters as Record<string, unknown> | undefined;

  // Filters
  const [teamFilter, setTeamFilter] = useState((savedFilters?.teamFilter as string) ?? "__all__");
  const [reasonFilter, setReasonFilter] = useState((savedFilters?.reasonFilter as string) ?? "__all__");
  const [dateFrom, setDateFrom] = useState((savedFilters?.dateFrom as string) ?? defaultFrom);
  const [dateTo, setDateTo] = useState((savedFilters?.dateTo as string) ?? defaultTo);
  const [statusFilters, setStatusFilters] = useState<Set<string>>(
    savedFilters?.statuses && Array.isArray(savedFilters.statuses)
      ? new Set(savedFilters.statuses as string[])
      : new Set(ALL_STATUSES)
  );
  const [payrollFilter, setPayrollFilter] = useState((savedFilters?.payrollFilter as string) ?? "");
  const [firstNameFilter, setFirstNameFilter] = useState((savedFilters?.firstNameFilter as string) ?? "");
  const [lastNameFilter, setLastNameFilter] = useState((savedFilters?.lastNameFilter as string) ?? "");
  const [approvedByFilter, setApprovedByFilter] = useState((savedFilters?.approvedByFilter as string) ?? "__all__");

  // Distinct approver names for dropdown
  const approverNames = useMemo(() => {
    const names = new Set<string>();
    for (const r of rows) {
      if (r.actioned_by) names.add(r.actioned_by);
    }
    return Array.from(names).sort();
  }, [rows]);

  // Column customisation — persisted via useColumnPrefs (auto-saves to user_grid_preferences)
  const {
    prefs: colPrefs, updatePrefs: setColPrefs,
    groupBy, updateGroupBy: setGroupBy,
    pdfPageBreak, updatePdfPageBreak: setPdfPageBreak,
    pdfRepeatHeaders, updatePdfRepeatHeaders: setPdfRepeatHeaders,
    aggregateMetrics, updateAggregateMetrics: setAggregateMetrics,
  } = useColumnPrefs(
    "holiday-report",
    initialPrefs.columns ?? [],
    ALL_COL_IDS as unknown as string[],
    undefined,
    initialPrefs.groupBy,
    initialPrefs.pdfPageBreak,
    initialPrefs.pdfRepeatHeaders,
    initialPrefs.aggregateMetrics ?? ["sum", "count"],
  );
  const [showCustomiser, setShowCustomiser] = useState(false);

  // Sort (restore from saved)
  const [sortKey, setSortKey] = useState<SortKey>(
    (savedFilters?.sortKey as SortKey) ?? "start_date"
  );
  const [sortAsc, setSortAsc] = useState(
    savedFilters?.sortAsc !== undefined ? (savedFilters.sortAsc as boolean) : true
  );

  // PDF export
  const [showPdfDialog, setShowPdfDialog] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);

  // Save / Save As / Favourite
  const [favourited, setFavourited] = useState(initialFavourited);
  const [saveLoading, setSaveLoading] = useState(false);
  const [showSaveAsDialog, setShowSaveAsDialog] = useState(false);
  const [saveAsName, setSaveAsName] = useState("Holiday Bookings (copy)");
  const [saveAsShared, setSaveAsShared] = useState("private");
  const [saveAsLoading, setSaveAsLoading] = useState(false);
  const [saveAsError, setSaveAsError] = useState<string | null>(null);

  function getCurrentPrefs(): GridPrefs {
    return {
      columns: colPrefs,
      filters: {
        teamFilter,
        reasonFilter,
        dateFrom,
        dateTo,
        statuses: Array.from(statusFilters),
        payrollFilter,
        firstNameFilter,
        lastNameFilter,
        approvedByFilter,
        sortKey,
        sortAsc,
      },
      groupBy: groupBy || undefined,
      pdfPageBreak: pdfPageBreak || undefined,
      pdfRepeatHeaders: pdfRepeatHeaders || undefined,
      aggregateMetrics,
    };
  }

  function handleToggleFavourite() {
    startTransition(async () => {
      const result = await toggleFavourite("holiday");
      if (result.success) {
        setFavourited(result.isFavourited ?? !favourited);
        router.refresh();
      }
    });
  }

  async function handleSave() {
    setSaveLoading(true);
    await saveGridPrefs("holiday-report", getCurrentPrefs());
    setSaveLoading(false);
  }

  async function handleSaveAs() {
    if (!saveAsName.trim()) return;
    setSaveAsLoading(true);
    setSaveAsError(null);
    const result = await createCustomReport({
      name: saveAsName.trim(),
      based_on: "holiday",
      shared: saveAsShared === "shared",
      prefs: getCurrentPrefs(),
    });
    setSaveAsLoading(false);
    if (!result.success) {
      setSaveAsError(result.error ?? "Failed to create report");
    } else {
      setShowSaveAsDialog(false);
      setSaveAsName("");
      router.refresh();
    }
  }

  // Ordered visible columns derived from prefs
  const orderedCols = useMemo(() => {
    return colPrefs
      .filter((c) => c.visible && COL_DEF_MAP.has(c.id as SortKey))
      .map((c) => COL_DEF_MAP.get(c.id as SortKey)!);
  }, [colPrefs]);

  function toggleStatus(s: string) {
    setStatusFilters((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
  }

  function handleSort(key: SortKey) {
    if (sortKey === key) setSortAsc((v) => !v);
    else { setSortKey(key); setSortAsc(true); }
  }

  // Filtered rows
  const filtered = useMemo(() => {
    const payrollLc = payrollFilter.toLowerCase();
    const firstNameLc = firstNameFilter.toLowerCase();
    const lastNameLc = lastNameFilter.toLowerCase();
    return rows.filter((r) => {
      if (teamFilter !== "__all__" && r.team_id !== teamFilter) return false;
      if (reasonFilter !== "__all__" && r.leave_reason_id !== reasonFilter) return false;
      if (!statusFilters.has(r.status)) return false;
      if (dateFrom && r.end_date < dateFrom) return false;
      if (dateTo && r.start_date > dateTo) return false;
      if (payrollLc && !(r.payroll_number ?? "").toLowerCase().includes(payrollLc)) return false;
      if (firstNameLc && !r.first_name.toLowerCase().includes(firstNameLc)) return false;
      if (lastNameLc && !r.last_name.toLowerCase().includes(lastNameLc)) return false;
      if (approvedByFilter !== "__all__" && r.actioned_by !== approvedByFilter) return false;
      return true;
    });
  }, [rows, teamFilter, reasonFilter, statusFilters, dateFrom, dateTo, payrollFilter, firstNameFilter, lastNameFilter, approvedByFilter]);

  // Sorted rows (group-by column is primary sort when active)
  const sorted = useMemo(() => {
    const dir = sortAsc ? 1 : -1;
    return [...filtered].sort((a, b) => {
      // Primary sort by group column when grouping
      if (groupBy && groupBy !== sortKey) {
        const ga = String(a[groupBy as SortKey] ?? "");
        const gb = String(b[groupBy as SortKey] ?? "");
        const gc = ga.localeCompare(gb);
        if (gc !== 0) return gc;
      }
      const va = a[sortKey] ?? "";
      const vb = b[sortKey] ?? "";
      if (typeof va === "number" && typeof vb === "number") return (va - vb) * dir;
      return String(va).localeCompare(String(vb)) * dir;
    });
  }, [filtered, sortKey, sortAsc, groupBy]);

  // Grouped rows
  const groups = useMemo(() => {
    if (!groupBy) return null;
    const map = new Map<string, HolidayBookingRow[]>();
    for (const r of sorted) {
      const key = String(r[groupBy as SortKey] ?? "—");
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(r);
    }
    return map;
  }, [sorted, groupBy]);

  // Summary
  const summary = useMemo(() => {
    const totalDays = filtered.reduce((sum, r) => sum + r.days, 0);
    const byStatus: Record<string, { count: number; days: number }> = {};
    for (const r of filtered) {
      if (!byStatus[r.status]) byStatus[r.status] = { count: 0, days: 0 };
      byStatus[r.status].count++;
      byStatus[r.status].days += r.days;
    }
    return { total: filtered.length, totalDays, byStatus };
  }, [filtered]);

  // CSV export (respects column order and visibility)
  function exportCsv() {
    const csvRows = [
      orderedCols.map((c) => COL_LABELS[c.id]).join(","),
      ...sorted.map((r) => orderedCols.map((c) => c.csvValue(r)).join(",")),
    ];
    const blob = new Blob([csvRows.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `holiday-report-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // PDF export
  async function handleExportPdf(orientation: "portrait" | "landscape") {
    setPdfLoading(true);
    setShowPdfDialog(false);
    try {
      const [{ pdf }, { EmployeePDF }] = await Promise.all([
        import("@react-pdf/renderer"),
        import("@/app/(dashboard)/employees/employee-pdf"),
      ]);

      // Format rows as Record<string, string> for the generic PDF component
      const formattedRows: Record<string, string>[] = sorted.map((r) => ({
        payroll_number: r.payroll_number ?? "—",
        first_name: r.first_name,
        last_name: r.last_name,
        team_name: r.team_name,
        leave_type: r.leave_type,
        start_date: fmtDate(r.start_date),
        end_date: fmtDate(r.end_date),
        days: String(r.days),
        _raw_days: String(r.days),
        status: STATUS_BADGE[r.status]?.label ?? r.status,
        created_at: fmtDateTime(r.created_at),
        actioned_by: r.actioned_by ?? "—",
        actioned_at: r.actioned_at ? fmtDateTime(r.actioned_at) : "—",
      }));

      const pdfColumns = orderedCols.map((c) => ({
        id: c.id,
        label: COL_LABELS[c.id] ?? c.id,
        ...(c.id === "days" ? { aggregateFormat: "number" as const, aggregateDecimals: 0 } : {}),
      }));

      const pdfRows = groupBy
        ? [...formattedRows].sort((a, b) => (a[groupBy] ?? "").localeCompare(b[groupBy] ?? ""))
        : formattedRows;

      const blob = await pdf(
        <EmployeePDF
          rows={pdfRows}
          columns={pdfColumns}
          orgName={orgName}
          title="Holiday Report"
          orientation={orientation}
          groupBy={groupBy || undefined}
          groupByLabel={groupBy ? (COL_LABELS[groupBy] ?? groupBy) : undefined}
          pdfPageBreak={pdfPageBreak || undefined}
          pdfRepeatHeaders={pdfRepeatHeaders || undefined}
          aggregateMetrics={aggregateMetrics}
        />
      ).toBlob();

      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `holiday-report-${new Date().toISOString().slice(0, 10)}.pdf`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("PDF generation failed:", err);
    } finally {
      setPdfLoading(false);
    }
  }

  const sortIcon = (key: SortKey) => (
    <ArrowUpDown className={`ml-1 h-3 w-3 inline-block ${sortKey === key ? "text-foreground" : "text-muted-foreground/40"}`} />
  );

  // Find the "days" column index position for subtotal alignment
  const daysColIndex = orderedCols.findIndex((c) => c.id === "days");

  function renderAggregateRow(groupRows: HolidayBookingRow[], label: string) {
    const totalDays = groupRows.reduce((s, r) => s + r.days, 0);
    const count = groupRows.length;
    const parts: string[] = [];
    if (aggregateMetrics.includes("count")) parts.push(`${count} bookings`);
    if (aggregateMetrics.includes("sum")) parts.push(`${totalDays} days`);
    if (aggregateMetrics.includes("avg")) parts.push(`avg ${count > 0 ? (totalDays / count).toFixed(1) : "0"}`);
    if (aggregateMetrics.includes("min")) parts.push(`min ${count > 0 ? Math.min(...groupRows.map((r) => r.days)) : 0}`);
    if (aggregateMetrics.includes("max")) parts.push(`max ${count > 0 ? Math.max(...groupRows.map((r) => r.days)) : 0}`);
    if (parts.length === 0) return null;

    return (
      <TableRow className="bg-muted/30">
        {daysColIndex > 0 && <TableCell colSpan={daysColIndex} className="text-right text-xs font-medium text-muted-foreground">{label}</TableCell>}
        {daysColIndex === 0 && <TableCell className="text-right text-xs font-medium text-muted-foreground">{label}</TableCell>}
        <TableCell colSpan={orderedCols.length - (daysColIndex > 0 ? daysColIndex : 1)} className="text-xs font-medium text-muted-foreground">
          {parts.join(" · ")}
        </TableCell>
      </TableRow>
    );
  }

  function renderDataRow(r: HolidayBookingRow) {
    return (
      <TableRow key={r.id}>
        {orderedCols.map((col) => (
          <TableCell key={col.id} className={col.headerClassName}>{col.render(r)}</TableCell>
        ))}
      </TableRow>
    );
  }

  return (
    <>
      {/* Row 1: Title + Customise / Show PDF / Export CSV */}
      <div className="flex items-center justify-between mb-2">
        <div>
          <h1 className="text-2xl font-bold">Holiday Bookings</h1>
          <p className="text-sm text-muted-foreground mt-1">Holiday Requests and Bookings</p>
        </div>
        <div className="flex items-center gap-2">
          <ColumnCustomiserTrigger onClick={() => setShowCustomiser(true)} />
          <Button variant="outline" size="sm" onClick={() => setShowPdfDialog(true)} disabled={pdfLoading}>
            <FileDown className="h-4 w-4 mr-2" />
            {pdfLoading ? "Generating..." : "Show PDF"}
          </Button>
          <Button variant="outline" size="sm" onClick={exportCsv}>
            <Download className="h-4 w-4 mr-2" />
            Export CSV
          </Button>
        </div>
      </div>

      {/* Row 2: Favourite / Save / Save As */}
      <div className="flex items-center justify-end gap-2 mb-6">
        <Button
          variant="ghost"
          size="sm"
          onClick={handleToggleFavourite}
          disabled={isPending}
          className={favourited ? "text-amber-500 hover:text-amber-600" : "text-muted-foreground"}
        >
          <Star className={`h-4 w-4 mr-1.5 ${favourited ? "fill-current" : ""}`} />
          {favourited ? "Favourited" : "Favourite"}
        </Button>
        <Button variant="outline" size="sm" onClick={handleSave} disabled={saveLoading}>
          <Save className="h-4 w-4 mr-1.5" />
          {saveLoading ? "Saving..." : "Save"}
        </Button>
        {canCreateCustom && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => { setSaveAsName("Holiday Bookings (copy)"); setShowSaveAsDialog(true); }}
          >
            <Plus className="h-4 w-4 mr-1.5" />
            Save As...
          </Button>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-4 mb-6">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Payroll #</Label>
          <Input className="w-28" value={payrollFilter} onChange={(e) => setPayrollFilter(e.target.value)} placeholder="Search..." />
        </div>

        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">First Name</Label>
          <Input className="w-28" value={firstNameFilter} onChange={(e) => setFirstNameFilter(e.target.value)} placeholder="Search..." />
        </div>

        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Last Name</Label>
          <Input className="w-28" value={lastNameFilter} onChange={(e) => setLastNameFilter(e.target.value)} placeholder="Search..." />
        </div>

        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Team</Label>
          <Select value={teamFilter} onValueChange={setTeamFilter}>
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All Teams</SelectItem>
              {teams.map((t) => (
                <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Leave Type</Label>
          <Select value={reasonFilter} onValueChange={setReasonFilter}>
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All Types</SelectItem>
              {absenceReasons.map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  <span className="inline-block h-2 w-2 rounded-full mr-1.5" style={{ backgroundColor: r.colour }} />
                  {r.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">From</Label>
          <Input type="date" className="w-36" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
        </div>

        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">To</Label>
          <Input type="date" className="w-36" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
        </div>

        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Status</Label>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="w-44 justify-between font-normal h-9">
                {statusFilters.size === ALL_STATUSES.length
                  ? "All statuses"
                  : statusFilters.size === 1
                    ? STATUS_BADGE[Array.from(statusFilters)[0]]?.label ?? Array.from(statusFilters)[0]
                    : `${statusFilters.size} statuses`}
                <ChevronDown className="ml-2 h-3.5 w-3.5 opacity-50" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {ALL_STATUSES.map((s) => (
                <DropdownMenuCheckboxItem
                  key={s}
                  checked={statusFilters.has(s)}
                  onCheckedChange={() => toggleStatus(s)}
                  onSelect={(e) => e.preventDefault()}
                >
                  {STATUS_BADGE[s]?.label ?? s}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Approved By</Label>
          <Select value={approvedByFilter} onValueChange={setApprovedByFilter}>
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All</SelectItem>
              {approverNames.map((name) => (
                <SelectItem key={name} value={name}>{name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              {orderedCols.map((col) => (
                <TableHead
                  key={col.id}
                  className={`cursor-pointer select-none ${col.headerClassName ?? ""}`}
                  onClick={() => handleSort(col.id)}
                >
                  {COL_LABELS[col.id]}{sortIcon(col.id)}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.length === 0 ? (
              <TableRow>
                <TableCell colSpan={orderedCols.length} className="h-24 text-center text-muted-foreground">
                  No bookings match the current filters.
                </TableCell>
              </TableRow>
            ) : groups ? (
              // Grouped rendering
              Array.from(groups.entries()).map(([groupValue, groupRows]) => (
                <React.Fragment key={groupValue}>
                  <TableRow className="bg-muted/50">
                    <TableCell colSpan={orderedCols.length} className="font-bold text-sm py-2">
                      {COL_LABELS[groupBy] ?? groupBy}: {groupValue}
                    </TableCell>
                  </TableRow>
                  {groupRows.map(renderDataRow)}
                  {aggregateMetrics.length > 0 && renderAggregateRow(groupRows, "Subtotal")}
                </React.Fragment>
              ))
            ) : (
              // Flat rendering
              sorted.map(renderDataRow)
            )}
            {/* Grand total when grouping */}
            {groups && aggregateMetrics.length > 0 && sorted.length > 0 && renderAggregateRow(sorted, "Total")}
          </TableBody>
        </Table>
      </div>

      {/* Summary */}
      {sorted.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-1 text-sm text-muted-foreground">
          <span><strong>{summary.total}</strong> bookings</span>
          <span><strong>{summary.totalDays}</strong> total days</span>
          <span className="text-muted-foreground/60">|</span>
          {ALL_STATUSES.map((s) => {
            const st = summary.byStatus[s];
            if (!st) return null;
            return (
              <span key={s}>
                {STATUS_BADGE[s]?.label}: <strong>{st.count}</strong> ({st.days} days)
              </span>
            );
          })}
        </div>
      )}

      <ColumnCustomiserDialog
        open={showCustomiser}
        onOpenChange={setShowCustomiser}
        prefs={colPrefs}
        colLabels={COL_LABELS}
        defaultCols={ALL_COL_IDS}
        onChange={setColPrefs}
        allColIds={ALL_COL_IDS}
        groupBy={groupBy}
        onGroupByChange={setGroupBy}
        hasAggregateColumns
        aggregateMetrics={aggregateMetrics}
        onAggregateMetricsChange={setAggregateMetrics}
        pdfPageBreak={pdfPageBreak}
        onPdfPageBreakChange={setPdfPageBreak}
        pdfRepeatHeaders={pdfRepeatHeaders}
        onPdfRepeatHeadersChange={setPdfRepeatHeaders}
      />

      <Dialog open={showPdfDialog} onOpenChange={setShowPdfDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Show PDF</DialogTitle>
            <DialogDescription>
              Choose the page orientation for your report.
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-3 justify-center py-4">
            <Button variant="outline" className="flex-1" onClick={() => handleExportPdf("portrait")}>
              Portrait
            </Button>
            <Button variant="outline" className="flex-1" onClick={() => handleExportPdf("landscape")}>
              Landscape
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Save As dialog */}
      <Dialog open={showSaveAsDialog} onOpenChange={setShowSaveAsDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save as Custom Report</DialogTitle>
            <DialogDescription>
              Create a new custom report with the current filters, columns and settings.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="save-as-name">Report name</Label>
              <Input
                id="save-as-name"
                value={saveAsName}
                onChange={(e) => setSaveAsName(e.target.value)}
                placeholder="My Holiday Report"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="save-as-shared">Visibility</Label>
              <Select value={saveAsShared} onValueChange={setSaveAsShared}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="private">Private (only me)</SelectItem>
                  <SelectItem value="shared">Shared (all admins)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {saveAsError && (
              <p className="text-sm text-destructive">{saveAsError}</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowSaveAsDialog(false)} disabled={saveAsLoading}>
              Cancel
            </Button>
            <Button onClick={handleSaveAs} disabled={saveAsLoading || !saveAsName.trim()}>
              {saveAsLoading ? "Creating..." : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
