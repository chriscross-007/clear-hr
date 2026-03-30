"use client";

import { useState, useEffect, useRef, type ReactNode } from "react";
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
  type ColumnFiltersState,
  type Column,
  type RowData,
  type Row,
} from "@tanstack/react-table";
import { useColumnPrefs } from "@/hooks/use-column-prefs";
import { type ColPref } from "@/lib/grid-prefs-actions";
import type { GridPrefs } from "@/lib/grid-prefs";
import {
  ColumnCustomiserTrigger,
  ColumnCustomiserDialog,
} from "@/components/ui/column-customiser";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FileDown } from "lucide-react";
import { cn } from "@/lib/utils";

// Ensure the ColumnMeta augmentation from employee-columns is available here too
// eslint-disable-next-line @typescript-eslint/no-unused-vars
declare module "@tanstack/react-table" {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData extends RowData, TValue> {
    filterElement?: (column: Column<TData, unknown>) => ReactNode;
    headerClassName?: string;
    cellClassName?: string;
    getAggregateValue?: (row: TData) => number | null;
    aggregateFormat?: "currency" | "number";
    aggregateCurrencySymbol?: string;
    aggregateDecimals?: number | null;
  }
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface DataGridProps<T> {
  data: T[];
  columns: ColumnDef<T>[];
  gridId: string;
  /** All possible column IDs (standard + custom) in canonical order */
  allCols: string[];
  /** Column IDs visible by default and used as the "reset" target */
  defaultCols: string[];
  /** Optional: standard (non-custom) col IDs — used by column customiser reset */
  standardCols?: string[];
  colLabels: Record<string, string>;
  initialColPrefs: ColPref[];
  /** Initial group-by column ID (persisted with column prefs) */
  initialGroupBy?: string;
  initialPdfPageBreak?: boolean;
  initialPdfRepeatHeaders?: boolean;
  initialAggregateMetrics?: string[];
  userId: string;
  /** Right-side toolbar slot for page-specific controls */
  toolbar?: ReactNode;
  onRowClick?: (row: T) => void;
  emptyMessage?: string;
  /** If provided, a "Download PDF" button is shown and this is called with the visible rows + prefs */
  onExportPdf?: (
    rows: T[],
    prefs: ColPref[],
    colLabels: Record<string, string>,
    orientation: "portrait" | "landscape",
    groupBy?: string,
    pdfPageBreak?: boolean,
    pdfRepeatHeaders?: boolean,
    aggregateMetrics?: string[]
  ) => Promise<void>;
  /** Called whenever the current page's rows change (e.g. for card view rendering) */
  onPageRowsChange?: (rows: T[]) => void;
  /** Initial filter state (applied once on mount) */
  initialFilters?: ColumnFiltersState;
  /** Called whenever any saveable prefs change (columns, filters, groupBy, etc.) */
  onPrefsChange?: (snapshot: GridPrefs) => void;
  /** Column IDs to pin before the prefs-managed columns (e.g. ["select"]) */
  leadingColumnIds?: string[];
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function DataGrid<T extends object>({
  data,
  columns,
  gridId,
  allCols,
  defaultCols,
  standardCols,
  colLabels,
  initialColPrefs,
  initialGroupBy,
  initialPdfPageBreak,
  initialPdfRepeatHeaders,
  initialAggregateMetrics,
  toolbar,
  onRowClick,
  emptyMessage,
  onExportPdf,
  onPageRowsChange,
  initialFilters,
  onPrefsChange,
  leadingColumnIds,
}: DataGridProps<T>) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>(initialFilters ?? []);
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(50);

  // Hydrate page size from localStorage after mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem("grid_page_size");
      if (stored) {
        const n = parseInt(stored, 10);
        if ([10, 25, 50, 100, 250].includes(n)) setPageSize(n);
      }
    } catch { /* localStorage unavailable */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [showCustomiser, setShowCustomiser] = useState(false);
  const [showPdfDialog, setShowPdfDialog] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);

  // Reset to page 0 whenever filters change
  useEffect(() => { setPageIndex(0); }, [columnFilters]);

  const { prefs, updatePrefs, columnOrder, columnVisibility, groupBy, updateGroupBy, pdfPageBreak, updatePdfPageBreak, pdfRepeatHeaders, updatePdfRepeatHeaders, aggregateMetrics, updateAggregateMetrics } = useColumnPrefs(
    gridId, initialColPrefs, allCols, defaultCols, initialGroupBy, initialPdfPageBreak, initialPdfRepeatHeaders, initialAggregateMetrics
  );

  // When groupBy is set, keep it as the primary sort so groups are contiguous
  useEffect(() => {
    if (groupBy) {
      setSorting((prev) => {
        const rest = prev.filter((s) => s.id !== groupBy);
        return [{ id: groupBy, desc: false }, ...rest];
      });
    } else {
      setSorting((prev) => prev.filter((s) => s.id !== groupBy));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupBy]);

  const effectiveColumnOrder = leadingColumnIds?.length
    ? [...leadingColumnIds, ...columnOrder]
    : columnOrder;

  const table = useReactTable({
    data,
    columns,
    state: { sorting, columnFilters, columnOrder: effectiveColumnOrder, columnVisibility, pagination: { pageIndex, pageSize } },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onPaginationChange: (updater) => {
      const next = typeof updater === "function" ? updater({ pageIndex, pageSize }) : updater;
      setPageIndex(next.pageIndex);
      if (next.pageSize !== pageSize) setPageSize(next.pageSize);
    },
    onColumnOrderChange: () => {},
    onColumnVisibilityChange: () => {},
    enableMultiSort: true,
    enableSortingRemoval: false,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  });

  // Notify parent of current page rows (for card view etc.)
  useEffect(() => {
    if (!onPageRowsChange) return;
    onPageRowsChange(table.getRowModel().rows.map((r) => r.original));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table.getRowModel().rows.length, sorting, columnFilters, pageIndex, pageSize]);

  // Notify parent of the latest saveable prefs snapshot
  const onPrefsChangeRef = useRef(onPrefsChange);
  onPrefsChangeRef.current = onPrefsChange;
  useEffect(() => {
    if (!onPrefsChangeRef.current) return;
    const filters = columnFilters.length > 0
      ? Object.fromEntries(columnFilters.map((f) => [f.id, f.value]))
      : undefined;
    onPrefsChangeRef.current({
      columns: prefs,
      filters,
      groupBy: groupBy || undefined,
      pdfPageBreak: pdfPageBreak || undefined,
      pdfRepeatHeaders: pdfRepeatHeaders || undefined,
      aggregateMetrics,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefs, columnFilters, groupBy, pdfPageBreak, pdfRepeatHeaders, aggregateMetrics]);

  async function handleExportPdf(orientation: "portrait" | "landscape") {
    if (!onExportPdf) return;
    setPdfLoading(true);
    setShowPdfDialog(false);
    try {
      const rows = table.getPrePaginationRowModel().rows.map((r) => r.original);
      await onExportPdf(rows, prefs, colLabels, orientation, groupBy || undefined, pdfPageBreak || undefined, pdfRepeatHeaders || undefined, aggregateMetrics);
    } finally {
      setPdfLoading(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Aggregate helpers
  // ---------------------------------------------------------------------------
  type AggValues = { sum: number; avg: number; count: number; min: number; max: number };

  const visibleLeafCols = table.getVisibleLeafColumns();
  // Check ALL columns (not just visible) so the aggregate options stay accessible in the
  // customiser even when the user has hidden their numeric/currency columns.
  const hasAggregates = table.getAllLeafColumns().some((col) => col.columnDef.meta?.getAggregateValue);

  function fmtAgg(value: number, meta: { aggregateFormat?: "currency" | "number"; aggregateCurrencySymbol?: string; aggregateDecimals?: number | null }): string {
    const fmt = meta.aggregateFormat;
    const sym = meta.aggregateCurrencySymbol ?? "£";
    const dp = meta.aggregateDecimals;
    if (fmt === "currency") return `${sym}${value.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    if (dp === 0) return String(Math.round(value));
    if (dp !== null && dp !== undefined) return value.toFixed(dp);
    return parseFloat(value.toFixed(4)).toString();
  }

  function computeAggs(rows: Row<T>[]): Map<string, AggValues> {
    const result = new Map<string, AggValues>();
    for (const col of visibleLeafCols) {
      if (!col.columnDef.meta?.getAggregateValue) continue;
      const values = rows
        .map((r) => col.columnDef.meta!.getAggregateValue!(r.original))
        .filter((v): v is number => v !== null);
      if (values.length === 0) continue;
      const sum = values.reduce((a, b) => a + b, 0);
      result.set(col.id, { sum, avg: sum / values.length, count: values.length, min: Math.min(...values), max: Math.max(...values) });
    }
    return result;
  }

  function renderAggRow(key: string, label: string, aggs: Map<string, AggValues>): ReactNode {
    return (
      <TableRow key={key} className="bg-muted/70 hover:bg-muted/70 border-t-2 border-border">
        {visibleLeafCols.map((col, colIdx) => {
          const a = aggs.get(col.id);
          if (!col.columnDef.meta?.getAggregateValue || !a) {
            return (
              <TableCell key={col.id} className={cn("py-2 text-xs", col.columnDef.meta?.cellClassName ?? "")}>
                {colIdx === 0 && <span className="font-semibold text-muted-foreground">{label}</span>}
              </TableCell>
            );
          }
          return (
            <TableCell key={col.id} className={cn("py-1.5 align-top text-xs", col.columnDef.meta?.cellClassName ?? "")}>
              <div className="space-y-0.5 text-muted-foreground font-medium tabular-nums">
                {aggregateMetrics.includes("sum") && <div>Sum: {fmtAgg(a.sum, col.columnDef.meta)}</div>}
                {aggregateMetrics.includes("avg") && <div>Avg: {fmtAgg(a.avg, col.columnDef.meta)}</div>}
                {aggregateMetrics.includes("count") && <div>Count: {a.count}</div>}
                {aggregateMetrics.includes("min") && <div>Min: {fmtAgg(a.min, col.columnDef.meta)}</div>}
                {aggregateMetrics.includes("max") && <div>Max: {fmtAgg(a.max, col.columnDef.meta)}</div>}
              </div>
            </TableCell>
          );
        })}
      </TableRow>
    );
  }

  const allFilteredRows = table.getPrePaginationRowModel().rows;
  const grandTotalAggs = hasAggregates ? computeAggs(allFilteredRows) : null;

  // Per-group aggregates and group-end row IDs (computed across all pages)
  const lastRowIdOfGroup = new Set<string>();
  const groupAggregates = new Map<string, Map<string, AggValues>>();
  const allGroupCounts = new Map<string, number>();
  if (groupBy) {
    const groupRows = new Map<string, Row<T>[]>();
    const groupLastRow = new Map<string, string>();
    for (const row of allFilteredRows) {
      const gv = String(row.getValue(groupBy) ?? "—");
      allGroupCounts.set(gv, (allGroupCounts.get(gv) ?? 0) + 1);
      if (!groupRows.has(gv)) groupRows.set(gv, []);
      groupRows.get(gv)!.push(row);
      groupLastRow.set(gv, row.id);
    }
    for (const id of groupLastRow.values()) lastRowIdOfGroup.add(id);
    if (hasAggregates) {
      for (const [gv, gRows] of groupRows) groupAggregates.set(gv, computeAggs(gRows));
    }
  }

  const filteredCount = table.getFilteredRowModel().rows.length;

  return (
    <div>
      {/* Toolbar */}
      <div className="mb-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <ColumnCustomiserTrigger onClick={() => setShowCustomiser(true)} />
          {columnFilters.length > 0 && (
            <Button variant="outline" size="sm" onClick={() => setColumnFilters([])}>
              Clear Filters
            </Button>
          )}
          {onExportPdf && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowPdfDialog(true)}
              disabled={pdfLoading}
            >
              <FileDown className="h-4 w-4 mr-2" />
              {pdfLoading ? "Generating..." : "Download PDF"}
            </Button>
          )}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground whitespace-nowrap">
            <span className="font-medium text-foreground">{filteredCount}</span>{" "}
            selected · out of{" "}
            <span className="font-medium text-foreground">{data.length}</span>
          </span>
          {toolbar}
        </div>
      </div>

      {/* Table */}
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            {/* Column header row */}
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead
                    key={header.id}
                    className={header.column.columnDef.meta?.headerClassName ?? ""}
                  >
                    {header.isPlaceholder
                      ? null
                      : flexRender(header.column.columnDef.header, header.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
            {/* Filter row */}
            <TableRow className="bg-muted/50 hover:bg-muted/50">
              {table.getHeaderGroups()[0]?.headers.map((header) => {
                if (!header.column.getCanFilter()) {
                  return (
                    <TableHead
                      key={`filter-${header.id}`}
                      className={cn(header.column.columnDef.meta?.headerClassName ?? "")}
                    />
                  );
                }
                const filterEl = header.column.columnDef.meta?.filterElement?.(
                  header.column as Column<T, unknown>
                );
                if (filterEl != null) {
                  return (
                    <TableHead key={`filter-${header.id}`} className="py-2">
                      {filterEl}
                    </TableHead>
                  );
                }
                return (
                  <TableHead key={`filter-${header.id}`} className="py-2">
                    <Input
                      placeholder="Filter..."
                      className="h-8 text-sm"
                      value={(header.column.getFilterValue() as string) ?? ""}
                      onChange={(e) =>
                        header.column.setFilterValue(e.target.value || undefined)
                      }
                    />
                  </TableHead>
                );
              })}
            </TableRow>
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length ? (
              (() => {
                const pageRows = table.getRowModel().rows;
                let lastGroupValue: string | null = null;
                const colSpan = visibleLeafCols.length;
                const result: ReactNode[] = [];

                for (let i = 0; i < pageRows.length; i++) {
                  const row = pageRows[i];

                  if (groupBy) {
                    const groupValue = String(row.getValue(groupBy) ?? "—");
                    if (groupValue !== lastGroupValue) {
                      lastGroupValue = groupValue;
                      const count = allGroupCounts.get(groupValue) ?? 0;
                      result.push(
                        <TableRow key={`grp-${groupValue}-${row.id}`} className="bg-blue-50/60 dark:bg-blue-950/30 hover:bg-blue-50/60 dark:hover:bg-blue-950/30">
                          <TableCell colSpan={colSpan} className="py-2 px-4 text-base font-bold">
                            {colLabels[groupBy] ?? groupBy}: {groupValue}{" "}
                            <span className="font-normal text-muted-foreground text-sm">({count})</span>
                          </TableCell>
                        </TableRow>
                      );
                    }
                  }

                  result.push(
                    <TableRow
                      key={row.id}
                      className={onRowClick ? "cursor-pointer" : ""}
                      onClick={() => onRowClick?.(row.original)}
                    >
                      {row.getVisibleCells().map((cell) => (
                        <TableCell
                          key={cell.id}
                          className={cell.column.columnDef.meta?.cellClassName ?? ""}
                        >
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </TableCell>
                      ))}
                    </TableRow>
                  );

                  // Insert group subtotal after the last row of each group (across all pages)
                  if (groupBy && hasAggregates && aggregateMetrics.length > 0 && lastRowIdOfGroup.has(row.id)) {
                    const gv = String(row.getValue(groupBy) ?? "—");
                    const groupAggs = groupAggregates.get(gv);
                    if (groupAggs && groupAggs.size > 0) {
                      result.push(renderAggRow(`subtotal-${gv}`, "Subtotal", groupAggs));
                    }
                  }
                }

                // Grand total after the last row on this page
                if (grandTotalAggs && grandTotalAggs.size > 0 && pageRows.length > 0 && aggregateMetrics.length > 0) {
                  result.push(renderAggRow("grand-total", "Grand Total", grandTotalAggs));
                }

                return result;
              })()
            ) : (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-24 text-center">
                  {emptyMessage ?? "No results found."}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      <div className="mt-4 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span>Rows per page</span>
          <select
            className="h-8 rounded-md border border-input bg-background px-2 text-sm"
            value={pageSize}
            onChange={(e) => {
              const n = parseInt(e.target.value, 10);
              setPageSize(n);
              setPageIndex(0);
              try { localStorage.setItem("grid_page_size", String(n)); } catch { /* unavailable */ }
            }}
          >
            {[10, 25, 50, 100, 250].map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">
            Page {pageIndex + 1} of {Math.max(1, table.getPageCount())}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPageIndex((p) => p - 1)}
            disabled={!table.getCanPreviousPage()}
          >
            ← Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPageIndex((p) => p + 1)}
            disabled={!table.getCanNextPage()}
          >
            Next →
          </Button>
        </div>
      </div>

      {/* Column customiser */}
      <ColumnCustomiserDialog
        open={showCustomiser}
        onOpenChange={setShowCustomiser}
        prefs={prefs}
        colLabels={colLabels}
        defaultCols={defaultCols}
        allStandardCols={standardCols}
        onChange={updatePrefs}
        allColIds={onExportPdf ? allCols : undefined}
        groupBy={groupBy}
        onGroupByChange={onExportPdf ? updateGroupBy : undefined}
        pdfPageBreak={onExportPdf ? pdfPageBreak : undefined}
        onPdfPageBreakChange={onExportPdf ? updatePdfPageBreak : undefined}
        pdfRepeatHeaders={onExportPdf ? pdfRepeatHeaders : undefined}
        onPdfRepeatHeadersChange={onExportPdf ? updatePdfRepeatHeaders : undefined}
        hasAggregateColumns={onExportPdf ? hasAggregates : undefined}
        aggregateMetrics={onExportPdf ? aggregateMetrics : undefined}
        onAggregateMetricsChange={onExportPdf ? updateAggregateMetrics : undefined}
      />

      {/* PDF orientation dialog */}
      {onExportPdf && (
        <Dialog open={showPdfDialog} onOpenChange={setShowPdfDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Download PDF</DialogTitle>
              <DialogDescription>
                Choose the page orientation for your report.
              </DialogDescription>
            </DialogHeader>
            <div className="flex gap-3 justify-center py-4">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => handleExportPdf("portrait")}
              >
                Portrait
              </Button>
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => handleExportPdf("landscape")}
              >
                Landscape
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
