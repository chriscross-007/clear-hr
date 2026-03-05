"use client";

import { useState, useEffect, type ReactNode } from "react";
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
} from "@tanstack/react-table";
import { useColumnPrefs } from "@/hooks/use-column-prefs";
import { type ColPref } from "@/lib/grid-prefs-actions";
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
    groupBy?: string
  ) => Promise<void>;
  /** Called whenever the current page's rows change (e.g. for card view rendering) */
  onPageRowsChange?: (rows: T[]) => void;
  /** Initial filter state (applied once on mount) */
  initialFilters?: ColumnFiltersState;
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
  toolbar,
  onRowClick,
  emptyMessage,
  onExportPdf,
  onPageRowsChange,
  initialFilters,
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

  const { prefs, updatePrefs, columnOrder, columnVisibility, groupBy, updateGroupBy } = useColumnPrefs(
    gridId, initialColPrefs, allCols, defaultCols, initialGroupBy
  );

  const table = useReactTable({
    data,
    columns,
    state: { sorting, columnFilters, columnOrder, columnVisibility, pagination: { pageIndex, pageSize } },
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

  async function handleExportPdf(orientation: "portrait" | "landscape") {
    if (!onExportPdf) return;
    setPdfLoading(true);
    setShowPdfDialog(false);
    try {
      const rows = table.getPrePaginationRowModel().rows.map((r) => r.original);
      await onExportPdf(rows, prefs, colLabels, orientation, groupBy || undefined);
    } finally {
      setPdfLoading(false);
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
              table.getRowModel().rows.map((row) => (
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
              ))
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
