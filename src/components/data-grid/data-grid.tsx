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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FileDown, Download, ArrowUpDown, Filter as FilterIcon, ArrowUp, ArrowDown } from "lucide-react";
import { cn } from "@/lib/utils";

// Ensure the ColumnMeta augmentation from employee-columns is available here too
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
// Toolbar handle — lets parent render action buttons externally
// ---------------------------------------------------------------------------

export interface DataGridToolbarHandle {
  openCustomiser: () => void;
  openPdfDialog: () => void;
  exportCsv: () => void;
  pdfLoading: boolean;
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
  /** If provided, an "Export CSV" button is shown and this is called with the visible rows + prefs */
  onExportCsv?: (rows: T[], prefs: ColPref[], colLabels: Record<string, string>) => void;
  /** Called whenever the current page's rows change (e.g. for card view rendering) */
  onPageRowsChange?: (rows: T[]) => void;
  /** Initial filter state (applied once on mount) */
  initialFilters?: ColumnFiltersState;
  /** Initial sort state (applied once on mount) */
  initialSorting?: SortingState;
  /** Called whenever any saveable prefs change (columns, filters, groupBy, etc.) */
  onPrefsChange?: (snapshot: GridPrefs) => void;
  /** Column IDs to pin before the prefs-managed columns (e.g. ["select"]) */
  leadingColumnIds?: string[];
  /**
   * Optional renderer for content placed at the leading edge of each group header row
   * (e.g. a tri-state select-all checkbox for the group). When provided, the group
   * header is split into a fixed-width leading cell and a `colSpan - 1` label cell.
   * Receives the full filtered set of rows in the group, not just the visible page.
   */
  renderGroupHeaderPrefix?: (info: {
    groupValue: string;
    rowsInGroup: Row<T>[];
    count: number;
  }) => ReactNode;
  /**
   * When true, the toolbar, column header row and filter row remain pinned to
   * the top of the viewport as the body scrolls. The page itself is the scroll
   * context — the caller is responsible for providing any sticky page header
   * (e.g. a `<StickyPageHeader>`) that sits above the toolbar.
   *
   * By default the toolbar auto-pins directly below the `<StickyPageHeader>` by
   * reading the `--page-header-height` CSS variable it publishes. Pages that
   * don't use `<StickyPageHeader>`, or that want a manual override, can pass
   * `stickyHeaderTop` (px) to pin the toolbar at that exact distance from the
   * viewport top instead.
   */
  stickyHeader?: boolean;
  /**
   * Manual override for the toolbar pin position (px from viewport top). If
   * omitted, the toolbar auto-pins below `<StickyPageHeader>` via the
   * `--page-header-height` CSS variable. When set, the column header pins at
   * `stickyHeaderTop + 48` and the filter row at `stickyHeaderTop + 88`
   * (toolbar h-8 button + py-2 = 48; column header h-10 = 40 more).
   */
  stickyHeaderTop?: number;
  /** When true, hide Customise/PDF/CSV buttons from DataGrid toolbar (caller renders them externally via toolbarRef) */
  hideToolbarActions?: boolean;
  /** Ref populated with handlers to trigger customiser/PDF/CSV from outside DataGrid */
  toolbarRef?: React.MutableRefObject<DataGridToolbarHandle | null>;
  /**
   * CLE-194 — Body render mode. Defaults to `"table"` (the classic
   * per-column table with sortable headers + filter row). Set to `"cards"`
   * to render the same TanStack Table instance as a grid of cards using
   * `renderCard`; the table header + filter row are hidden and replaced
   * by Sort and Filters popovers in the toolbar. Sort/filter/customise/
   * pagination state is shared across modes, so flipping this prop
   * preserves the user's current view.
   */
  renderMode?: "table" | "cards";
  /**
   * Renderer for a single card in `renderMode="cards"`. Receives the row
   * data and the list of currently-visible column IDs so the caller can
   * mirror the Customise selection in the card body.
   */
  renderCard?: (row: T, visibleColumnIds: string[]) => ReactNode;
  /**
   * Optional Tailwind grid classes for the cards container. Defaults to
   * `grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4`.
   */
  cardsGridClassName?: string;
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
  onExportCsv,
  onPageRowsChange,
  initialFilters,
  initialSorting,
  onPrefsChange,
  leadingColumnIds,
  hideToolbarActions,
  toolbarRef,
  renderGroupHeaderPrefix,
  stickyHeader,
  stickyHeaderTop,
  renderMode = "table",
  renderCard,
  cardsGridClassName,
}: DataGridProps<T>) {
  const isCards = renderMode === "cards";
  // Toolbar pins directly below <StickyPageHeader> via the CSS var it
  // publishes. Downstream offsets:
  //   - toolbar height  = pt-2 (8) + h-8 button (32) + pb-4 (16) = 56
  //   - column header   = toolbar bottom → +56
  //   - filter row      = column header bottom → +56 + 40 (h-10) = +96,
  //                       minus 1px to overlap the tr border-b hairline
  // An explicit stickyHeaderTop overrides the CSS-var path for pages
  // without a <StickyPageHeader>.
  const toolbarBaseTop =
    stickyHeaderTop != null
      ? `${stickyHeaderTop}px`
      : `calc(4rem + var(--page-header-height, 77px))`;
  const stickyToolbarTopCss = `calc(var(--top-chrome-extra, 0px) + ${toolbarBaseTop})`;
  const stickyColumnHeaderTopCss = `calc(var(--top-chrome-extra, 0px) + ${toolbarBaseTop} + 56px)`;
  const stickyFilterRowTopCss = `calc(var(--top-chrome-extra, 0px) + ${toolbarBaseTop} + 95px)`;
  const [sorting, setSorting] = useState<SortingState>(initialSorting ?? []);
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
  }, []);
  const [showCustomiser, setShowCustomiser] = useState(false);
  const [showPdfDialog, setShowPdfDialog] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);

  // Reset to page 0 whenever filters change
  useEffect(() => { setPageIndex(0); }, [columnFilters]);

  const columnFiltersLiveRef = useRef(columnFilters);
  columnFiltersLiveRef.current = columnFilters;
  const sortingLiveRef = useRef(sorting);
  sortingLiveRef.current = sorting;

  const { prefs, updatePrefs, columnOrder, columnVisibility, groupBy, updateGroupBy, pdfPageBreak, updatePdfPageBreak, pdfRepeatHeaders, updatePdfRepeatHeaders, aggregateMetrics, updateAggregateMetrics } = useColumnPrefs(
    gridId, initialColPrefs, allCols, defaultCols, initialGroupBy, initialPdfPageBreak, initialPdfRepeatHeaders, initialAggregateMetrics,
    () => ({
      filters: columnFiltersLiveRef.current.length > 0
        ? Object.fromEntries(columnFiltersLiveRef.current.map((f) => [f.id, f.value]))
        : undefined,
      sorting: sortingLiveRef.current.length > 0
        ? sortingLiveRef.current.map((s) => ({ id: s.id, desc: s.desc }))
        : undefined,
    })
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
    const sortingSnapshot = sorting.length > 0 ? sorting.map((s) => ({ id: s.id, desc: s.desc })) : undefined;
    onPrefsChangeRef.current({
      columns: prefs,
      filters,
      sorting: sortingSnapshot,
      groupBy: groupBy || undefined,
      pdfPageBreak: pdfPageBreak || undefined,
      pdfRepeatHeaders: pdfRepeatHeaders || undefined,
      aggregateMetrics,
    });
  }, [prefs, columnFilters, sorting, groupBy, pdfPageBreak, pdfRepeatHeaders, aggregateMetrics]);

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

  // Expose toolbar actions to parent via ref
  useEffect(() => {
    if (!toolbarRef) return;
    toolbarRef.current = {
      openCustomiser: () => setShowCustomiser(true),
      openPdfDialog: () => setShowPdfDialog(true),
      exportCsv: () => {
        if (!onExportCsv) return;
        const rows = table.getPrePaginationRowModel().rows.map((r) => r.original);
        onExportCsv(rows, prefs, colLabels);
      },
      pdfLoading,
    };
  });

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

  // Per-group aggregates and group-end row IDs (computed across all pages).
  // `groupRows` is hoisted so the group-header prefix renderer (e.g. a select-all
  // checkbox) can see every filtered row in the group, not just the visible page.
  const lastRowIdOfGroup = new Set<string>();
  const groupAggregates = new Map<string, Map<string, AggValues>>();
  const allGroupCounts = new Map<string, number>();
  const groupRows = new Map<string, Row<T>[]>();
  if (groupBy) {
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
      {/* Toolbar. Bottom spacing (previously mb-4) is folded into the
          sticky box as pb-4 so the toolbar's opaque background covers
          the gap between itself and the column header — otherwise the
          column header slides up 16px before sticking. */}
      <div
        className={cn(
          "flex items-center justify-between gap-4",
          stickyHeader ? "sticky z-30 bg-background pt-2 pb-4" : "mb-4",
        )}
        // Auto-pins directly below <StickyPageHeader> via --page-header-height;
        // --top-chrome-extra shifts the whole stack down when a banner shows.
        style={stickyHeader ? { top: stickyToolbarTopCss } : undefined}
      >
        <div className="flex items-center gap-2">
          {!hideToolbarActions && <ColumnCustomiserTrigger onClick={() => setShowCustomiser(true)} />}
          {/* In cards mode the column header row + filter row are hidden,
              so sort and filter controls move into the toolbar as popovers.
              List mode continues to expose sort via header clicks and
              filters via the per-column input row underneath. */}
          {isCards && (
            <>
              <CardsSortControl table={table} colLabels={colLabels} />
              <CardsFilterControl table={table} colLabels={colLabels} />
            </>
          )}
          {columnFilters.length > 0 && (
            <Button variant="outline" size="sm" onClick={() => setColumnFilters([])}>
              Clear Filters
            </Button>
          )}
          {!hideToolbarActions && onExportPdf && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowPdfDialog(true)}
              disabled={pdfLoading}
            >
              <FileDown className="h-4 w-4 mr-2" />
              {pdfLoading ? "Generating..." : "Show PDF"}
            </Button>
          )}
          {!hideToolbarActions && onExportCsv && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const rows = table.getPrePaginationRowModel().rows.map((r) => r.original);
                onExportCsv(rows, prefs, colLabels);
              }}
            >
              <Download className="h-4 w-4 mr-2" />
              Export CSV
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

      {/* Body — table rows or card grid depending on renderMode. */}
      {isCards ? (
        <CardsBody
          table={table}
          renderCard={renderCard}
          cardsGridClassName={cardsGridClassName}
          groupBy={groupBy}
          allGroupCounts={allGroupCounts}
          colLabels={colLabels}
          emptyMessage={emptyMessage}
        />
      ) : (
      <div className="rounded-md border">
        <Table
          className="w-full"
          containerClassName={stickyHeader ? "overflow-x-visible" : undefined}
        >
          <TableHeader>
            {/* Column header row */}
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead
                    key={header.id}
                    className={cn(
                      header.column.columnDef.meta?.headerClassName ?? "",
                      stickyHeader && "sticky z-20 bg-background",
                    )}
                    style={stickyHeader ? { top: stickyColumnHeaderTopCss } : undefined}
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
                // Filter row uses fully-opaque bg-muted (was bg-muted/95)
                // — the previous transparency let scrolling data bleed
                // through the sticky filter bar.
                const stickyFilterCls = stickyHeader ? "sticky z-20 bg-muted" : "";
                const stickyFilterStyle = stickyHeader ? { top: stickyFilterRowTopCss } : undefined;
                if (!header.column.getCanFilter()) {
                  return (
                    <TableHead
                      key={`filter-${header.id}`}
                      className={cn(header.column.columnDef.meta?.headerClassName ?? "", stickyFilterCls)}
                      style={stickyFilterStyle}
                    />
                  );
                }
                const filterEl = header.column.columnDef.meta?.filterElement?.(
                  header.column as Column<T, unknown>
                );
                if (filterEl != null) {
                  return (
                    <TableHead
                      key={`filter-${header.id}`}
                      className={cn("py-2", stickyFilterCls)}
                      style={stickyFilterStyle}
                    >
                      {filterEl}
                    </TableHead>
                  );
                }
                return (
                  <TableHead
                    key={`filter-${header.id}`}
                    className={cn("py-2", stickyFilterCls)}
                    style={stickyFilterStyle}
                  >
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
                      const rowsInGroup = groupRows.get(groupValue) ?? [];
                      const labelCell = (
                        <TableCell
                          colSpan={renderGroupHeaderPrefix ? Math.max(1, colSpan - 1) : colSpan}
                          className="py-2 px-4 text-base font-bold"
                        >
                          {colLabels[groupBy] ?? groupBy}: {groupValue}{" "}
                          <span className="font-normal text-muted-foreground text-sm">({count})</span>
                        </TableCell>
                      );
                      result.push(
                        <TableRow key={`grp-${groupValue}-${row.id}`} className="bg-blue-50/60 dark:bg-blue-950/30 hover:bg-blue-50/60 dark:hover:bg-blue-950/30">
                          {renderGroupHeaderPrefix && (
                            <TableCell
                              className="w-10 py-2 px-2 text-center"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {renderGroupHeaderPrefix({ groupValue, rowsInGroup, count })}
                            </TableCell>
                          )}
                          {labelCell}
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
      )}

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
              <DialogTitle>Show PDF</DialogTitle>
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

// ---------------------------------------------------------------------------
// Cards mode helpers (CLE-194)
// ---------------------------------------------------------------------------

// Local shape for the subset of the TanStack table we lean on. Keeping this
// narrow avoids importing the fully-generic `Table<T>` type just to hand it
// down to the child components.
type CardsTableApi<T> = ReturnType<typeof useReactTable<T>>;

/**
 * Sort control shown in the DataGrid toolbar when `renderMode="cards"`. In
 * table mode the sort UI lives inside each column header — in cards mode we
 * replace it with a single popover: a Select listing every sortable column
 * plus asc/desc toggle buttons. Writes into the same TanStack sorting state
 * so flipping the view toggle preserves the user's current sort.
 */
function CardsSortControl<T>({
  table,
  colLabels,
}: {
  table: CardsTableApi<T>;
  colLabels: Record<string, string>;
}) {
  const sortableColumns = table
    .getAllLeafColumns()
    .filter((c) => c.getCanSort() && c.id !== "select");
  const sorting = table.getState().sorting;
  const active = sorting[0];
  const activeLabel = active ? colLabels[active.id] ?? active.id : null;
  const activeDir = active?.desc ? "desc" : "asc";

  function setSortColumn(id: string) {
    // Preserve the current direction when switching column.
    table.setSorting([{ id, desc: activeDir === "desc" }]);
  }
  function setSortDir(desc: boolean) {
    if (!active) return;
    table.setSorting([{ id: active.id, desc }]);
  }
  function clearSort() {
    table.setSorting([]);
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm">
          <ArrowUpDown className="h-4 w-4 mr-2" />
          {activeLabel ? `Sort: ${activeLabel} ${activeDir === "asc" ? "↑" : "↓"}` : "Sort"}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72">
        <div className="space-y-3">
          <div className="space-y-1">
            <div className="text-xs font-medium text-muted-foreground">Sort by</div>
            <Select
              value={active?.id ?? ""}
              onValueChange={(v) => setSortColumn(v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Choose a field" />
              </SelectTrigger>
              <SelectContent>
                {sortableColumns.map((col) => (
                  <SelectItem key={col.id} value={col.id}>
                    {colLabels[col.id] ?? col.id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <div className="text-xs font-medium text-muted-foreground">Direction</div>
            <div className="flex gap-2">
              <Button
                variant={activeDir === "asc" ? "default" : "outline"}
                size="sm"
                className="flex-1"
                onClick={() => setSortDir(false)}
                disabled={!active}
              >
                <ArrowUp className="h-4 w-4 mr-1" />
                Ascending
              </Button>
              <Button
                variant={activeDir === "desc" ? "default" : "outline"}
                size="sm"
                className="flex-1"
                onClick={() => setSortDir(true)}
                disabled={!active}
              >
                <ArrowDown className="h-4 w-4 mr-1" />
                Descending
              </Button>
            </div>
          </div>
          {active && (
            <Button variant="ghost" size="sm" onClick={clearSort} className="w-full">
              Clear sort
            </Button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Filter control shown in the DataGrid toolbar when `renderMode="cards"`. In
 * table mode filters live in the per-column input row underneath the header —
 * in cards mode we surface them all inside one popover, stacked vertically,
 * reusing each column's existing `meta.filterElement` widget so the filtering
 * behaviour is identical between views.
 */
function CardsFilterControl<T>({
  table,
  colLabels,
}: {
  table: CardsTableApi<T>;
  colLabels: Record<string, string>;
}) {
  const filterableColumns = table
    .getAllLeafColumns()
    .filter((c) => c.getCanFilter() && c.id !== "select");
  const activeCount = table.getState().columnFilters.length;

  if (filterableColumns.length === 0) return null;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm">
          <FilterIcon className="h-4 w-4 mr-2" />
          {activeCount > 0 ? `Filters (${activeCount})` : "Filters"}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 max-h-[70vh] overflow-y-auto">
        <div className="space-y-3">
          {filterableColumns.map((col) => {
            const filterEl = col.columnDef.meta?.filterElement?.(
              col as Column<T, unknown>
            );
            return (
              <div key={col.id} className="space-y-1">
                <div className="text-xs font-medium text-muted-foreground">
                  {colLabels[col.id] ?? col.id}
                </div>
                {filterEl ?? (
                  <Input
                    placeholder="Filter..."
                    className="h-8 text-sm"
                    value={(col.getFilterValue() as string) ?? ""}
                    onChange={(e) =>
                      col.setFilterValue(e.target.value || undefined)
                    }
                  />
                )}
              </div>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Body renderer for `renderMode="cards"`. Walks the current page's rows and
 * hands each one to the caller-supplied `renderCard`, wrapping the results in
 * a responsive grid. Group headers are emitted between rows when `groupBy`
 * is set so cards mode preserves the same visual grouping as table mode.
 */
function CardsBody<T>({
  table,
  renderCard,
  cardsGridClassName,
  groupBy,
  allGroupCounts,
  colLabels,
  emptyMessage,
}: {
  table: CardsTableApi<T>;
  renderCard?: (row: T, visibleColumnIds: string[]) => ReactNode;
  cardsGridClassName?: string;
  groupBy: string;
  allGroupCounts: Map<string, number>;
  colLabels: Record<string, string>;
  emptyMessage?: string;
}) {
  const pageRows = table.getRowModel().rows;
  const visibleColumnIds = table
    .getVisibleLeafColumns()
    .map((c) => c.id)
    .filter((id) => id !== "select");

  if (!renderCard) {
    return (
      <div className="py-8 text-center text-sm text-muted-foreground">
        Cards mode requires a <code>renderCard</code> prop.
      </div>
    );
  }
  if (pageRows.length === 0) {
    return (
      <p className="py-12 text-center text-muted-foreground">
        {emptyMessage ?? "No results found."}
      </p>
    );
  }

  const gridCls = cardsGridClassName ?? "grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4";

  if (!groupBy) {
    // pt-4 gives the top-row cards' selection ring room to render above the
    // card border without being clipped by the sticky toolbar's opaque
    // background. Matches the inter-row gap-4 spacing between card rows.
    return (
      <div className={cn(gridCls, "pt-4")}>
        {pageRows.map((row) => (
          <div key={row.id}>{renderCard(row.original, visibleColumnIds)}</div>
        ))}
      </div>
    );
  }

  // Grouped: emit a section header + card grid per group, in the order the
  // rows appear on the current page (sorted primary-by-groupBy upstream).
  const sections: { value: string; rows: typeof pageRows }[] = [];
  let current: (typeof sections)[number] | null = null;
  for (const row of pageRows) {
    const gv = String(row.getValue(groupBy) ?? "—");
    if (!current || current.value !== gv) {
      current = { value: gv, rows: [] };
      sections.push(current);
    }
    current.rows.push(row);
  }

  return (
    // pt-4 mirrors the ungrouped path — top-row cards need room for their
    // selection ring above the border, otherwise the sticky toolbar clips it.
    <div className="space-y-6 pt-4">
      {sections.map((section) => (
        <div key={section.value} className="space-y-3">
          <div className="text-base font-bold">
            {colLabels[groupBy] ?? groupBy}: {section.value}{" "}
            <span className="font-normal text-muted-foreground text-sm">
              ({allGroupCounts.get(section.value) ?? section.rows.length})
            </span>
          </div>
          <div className={gridCls}>
            {section.rows.map((row) => (
              <div key={row.id}>{renderCard(row.original, visibleColumnIds)}</div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
