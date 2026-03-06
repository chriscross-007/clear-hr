import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
} from "@react-pdf/renderer";

export interface ActiveFilter {
  label: string;
  value: string;
}

export interface PdfColumn {
  id: string;
  label: string;
  aggregateFormat?: "currency" | "number";
  aggregateCurrencySymbol?: string;
  aggregateDecimals?: number | null;
}

interface EmployeePDFProps {
  rows: Record<string, string>[];
  columns: PdfColumn[];
  orgName: string;
  title: string;
  orientation: "portrait" | "landscape";
  filters?: ActiveFilter[];
  /** Column ID to group by. Rows must be pre-sorted by this column. */
  groupBy?: string;
  /** Display label for the group-by column (e.g. "Team") */
  groupByLabel?: string;
  /** Insert a page break before each group (except the first) */
  pdfPageBreak?: boolean;
  /** Repeat the column header row at the top of each page */
  pdfRepeatHeaders?: boolean;
  /** Which aggregate metrics to show (sum, avg, count, min, max). Defaults to all. */
  aggregateMetrics?: string[];
}

const COLUMN_WEIGHTS: Record<string, number> = {
  first_name:     14,
  last_name:      14,
  email:          24,
  role:           10,
  profile:        13,
  team:           13,
  payroll_number: 11,
  status:         10,
  last_log_in:    17,
};

const styles = StyleSheet.create({
  page: {
    padding: 30,
    fontSize: 9,
    fontFamily: "Helvetica",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  orgName: {
    fontSize: 12,
    fontFamily: "Helvetica-Bold",
  },
  date: {
    fontSize: 9,
    color: "#666",
  },
  title: {
    fontSize: 14,
    fontFamily: "Helvetica-Bold",
    marginBottom: 4,
  },
  filters: {
    flexDirection: "row" as const,
    flexWrap: "wrap" as const,
    marginBottom: 8,
    gap: 2,
  },
  filterText: {
    fontSize: 7,
    color: "#666",
  },
  table: {
    width: "100%",
  },
  tableRow: {
    flexDirection: "row",
    borderBottomWidth: 0.5,
    borderBottomColor: "#ddd",
    minHeight: 20,
  },
  tableRowAlt: {
    backgroundColor: "#f9f9f9",
  },
  tableHeader: {
    flexDirection: "row",
    backgroundColor: "#f0f0f0",
    borderBottomWidth: 1,
    borderBottomColor: "#999",
    minHeight: 22,
    alignItems: "center",
  },
  groupHeader: {
    flexDirection: "row",
    backgroundColor: "#e8f0fe",
    borderBottomWidth: 0.5,
    borderBottomColor: "#aac",
    borderTopWidth: 0.5,
    borderTopColor: "#aac",
    minHeight: 18,
    alignItems: "center",
    paddingVertical: 3,
    paddingHorizontal: 6,
    marginTop: 4,
  },
  groupHeaderText: {
    fontFamily: "Helvetica-Bold",
    fontSize: 11,
    color: "#334",
  },
  cellView: {
    paddingVertical: 4,
    paddingHorizontal: 4,
    overflow: "hidden",
  },
  headerCell: {
    fontFamily: "Helvetica-Bold",
    fontSize: 8,
  },
  cell: {
    fontSize: 8,
  },
  aggRow: {
    flexDirection: "row",
    backgroundColor: "#f0f0f0",
    borderTopWidth: 1.5,
    borderTopColor: "#bbb",
    borderBottomWidth: 0.5,
    borderBottomColor: "#ccc",
    minHeight: 18,
  },
  aggGrandRow: {
    flexDirection: "row",
    backgroundColor: "#e8e8e8",
    borderTopWidth: 2,
    borderTopColor: "#888",
    borderBottomWidth: 0.5,
    borderBottomColor: "#bbb",
    minHeight: 18,
  },
  aggLabel: {
    fontFamily: "Helvetica-Bold",
    fontSize: 7,
    color: "#555",
  },
  aggValue: {
    fontSize: 7,
    color: "#444",
  },
  footer: {
    position: "absolute",
    bottom: 20,
    left: 30,
    right: 30,
    textAlign: "center",
    fontSize: 8,
    color: "#999",
  },
});

// Approximate max chars based on flex weight — prevents text wrapping into adjacent columns
function truncate(text: string, flexWeight: number): string {
  const maxChars = Math.floor(flexWeight * 1.8);
  return text.length > maxChars ? text.slice(0, maxChars - 1) + "…" : text;
}

export function EmployeePDF({
  rows,
  columns,
  orgName,
  title,
  orientation,
  filters,
  groupBy,
  groupByLabel,
  pdfPageBreak,
  pdfRepeatHeaders,
  aggregateMetrics,
}: EmployeePDFProps) {
  const activeMetrics = aggregateMetrics ?? ["sum", "avg", "count", "min", "max"];
  function colFlex(id: string) {
    return COLUMN_WEIGHTS[id] ?? 10;
  }

  const now = new Date().toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  // ---------------------------------------------------------------------------
  // Aggregate computation
  // ---------------------------------------------------------------------------
  type AggCell = { sum: number; avg: number; count: number; min: number; max: number };
  const aggCols = columns.filter((c) => c.aggregateFormat);
  const hasAggregates = aggCols.length > 0;

  function fmtAgg(value: number, col: PdfColumn): string {
    const fmt = col.aggregateFormat;
    const sym = col.aggregateCurrencySymbol ?? "£";
    const dp = col.aggregateDecimals;
    if (fmt === "currency") return `${sym}${value.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    if (dp === 0) return String(Math.round(value));
    if (dp !== null && dp !== undefined) return value.toFixed(dp);
    return parseFloat(value.toFixed(4)).toString();
  }

  function computePdfAggs(subset: Record<string, string>[]): Map<string, AggCell> {
    const result = new Map<string, AggCell>();
    for (const col of aggCols) {
      const rawKey = `_raw_${col.id}`;
      const values = subset
        .map((r) => { const raw = r[rawKey]; if (!raw) return null; const n = Number(raw); return isNaN(n) ? null : n; })
        .filter((v): v is number => v !== null);
      if (values.length === 0) continue;
      const sum = values.reduce((a, b) => a + b, 0);
      result.set(col.id, { sum, avg: sum / values.length, count: values.length, min: Math.min(...values), max: Math.max(...values) });
    }
    return result;
  }

  // Pre-compute group aggregates and grand total
  const groupAggs = new Map<string, Map<string, AggCell>>();
  const totalAggs = hasAggregates ? computePdfAggs(rows) : new Map<string, AggCell>();
  if (hasAggregates && groupBy) {
    const rowsByGroup = new Map<string, Record<string, string>[]>();
    for (const row of rows) {
      const gv = row[groupBy] ?? "—";
      if (!rowsByGroup.has(gv)) rowsByGroup.set(gv, []);
      rowsByGroup.get(gv)!.push(row);
    }
    for (const [gv, gRows] of rowsByGroup) groupAggs.set(gv, computePdfAggs(gRows));
  }

  // ---------------------------------------------------------------------------
  // Build flat render list: group headers, rows, subtotals, grand total
  // ---------------------------------------------------------------------------
  type RenderItem =
    | { kind: "group"; value: string; count: number; isFirst: boolean }
    | { kind: "row"; row: Record<string, string>; altIndex: number }
    | { kind: "aggregate"; label: string; cells: Map<string, AggCell>; isGrand: boolean };

  // Pre-compute per-group row counts
  const groupCounts = new Map<string, number>();
  if (groupBy) {
    for (const row of rows) {
      const v = row[groupBy] ?? "—";
      groupCounts.set(v, (groupCounts.get(v) ?? 0) + 1);
    }
  }

  const items: RenderItem[] = [];
  let lastGroupValue: string | null = null;
  let altIndex = 0;

  for (const row of rows) {
    if (groupBy) {
      const groupValue = row[groupBy] ?? "—";
      if (groupValue !== lastGroupValue) {
        // Push subtotal for previous group
        if (lastGroupValue !== null && hasAggregates && activeMetrics.length > 0) {
          const prevAggs = groupAggs.get(lastGroupValue);
          if (prevAggs && prevAggs.size > 0) {
            items.push({ kind: "aggregate", label: "Subtotal", cells: prevAggs, isGrand: false });
          }
        }
        items.push({ kind: "group", value: groupValue, count: groupCounts.get(groupValue) ?? 0, isFirst: lastGroupValue === null });
        lastGroupValue = groupValue;
        altIndex = 0;
      }
    }
    items.push({ kind: "row", row, altIndex: altIndex++ });
  }

  // Subtotal for last group
  if (groupBy && lastGroupValue !== null && hasAggregates && activeMetrics.length > 0) {
    const lastAggs = groupAggs.get(lastGroupValue);
    if (lastAggs && lastAggs.size > 0) {
      items.push({ kind: "aggregate", label: "Subtotal", cells: lastAggs, isGrand: false });
    }
  }

  // Grand total
  if (hasAggregates && totalAggs.size > 0 && activeMetrics.length > 0) {
    items.push({ kind: "aggregate", label: "Grand Total", cells: totalAggs, isGrand: true });
  }

  return (
    <Document>
      <Page size="A4" orientation={orientation} style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.orgName}>{orgName}</Text>
          <Text style={styles.date}>Printed: {now}</Text>
        </View>
        <Text style={styles.title}>{title}</Text>

        {filters && filters.length > 0 && (
          <View style={styles.filters} fixed={false}>
            <Text style={styles.filterText}>
              Filtered by: {filters.map((f) => `${f.label}: ${f.value}`).join("  |  ")}
            </Text>
          </View>
        )}

        <View style={styles.table}>
          <View style={styles.tableHeader} fixed={pdfRepeatHeaders}>
            {columns.map((col) => (
              <View key={col.id} style={[styles.cellView, { flex: colFlex(col.id) }]}>
                <Text style={styles.headerCell}>{col.label}</Text>
              </View>
            ))}
          </View>

          {items.map((item, i) => {
            if (item.kind === "group") {
              const prefix = groupByLabel ? `${groupByLabel}: ` : "";
              return (
                <View key={`group-${i}`} style={styles.groupHeader} wrap={false} break={pdfPageBreak && !item.isFirst}>
                  <Text style={styles.groupHeaderText}>{prefix}{item.value} ({item.count})</Text>
                </View>
              );
            }
            if (item.kind === "aggregate") {
              return (
                <View key={`agg-${i}`} style={item.isGrand ? styles.aggGrandRow : styles.aggRow} wrap={false}>
                  {columns.map((col, colIdx) => {
                    const a = item.cells.get(col.id);
                    if (!col.aggregateFormat || !a) {
                      return (
                        <View key={col.id} style={[styles.cellView, { flex: colFlex(col.id) }]}>
                          {colIdx === 0 && <Text style={styles.aggLabel}>{item.label}</Text>}
                        </View>
                      );
                    }
                    return (
                      <View key={col.id} style={[styles.cellView, { flex: colFlex(col.id) }]}>
                        {activeMetrics.includes("sum") && <Text style={styles.aggLabel}>Sum: {fmtAgg(a.sum, col)}</Text>}
                        {activeMetrics.includes("avg") && <Text style={styles.aggValue}>Avg: {fmtAgg(a.avg, col)}</Text>}
                        {activeMetrics.includes("count") && <Text style={styles.aggValue}>Count: {a.count}</Text>}
                        {activeMetrics.includes("min") && <Text style={styles.aggValue}>Min: {fmtAgg(a.min, col)}</Text>}
                        {activeMetrics.includes("max") && <Text style={styles.aggValue}>Max: {fmtAgg(a.max, col)}</Text>}
                      </View>
                    );
                  })}
                </View>
              );
            }
            return (
              <View
                key={`row-${i}`}
                style={[styles.tableRow, item.altIndex % 2 === 1 ? styles.tableRowAlt : {}]}
                wrap={false}
              >
                {columns.map((col) => (
                  <View key={col.id} style={[styles.cellView, { flex: colFlex(col.id) }]}>
                    <Text style={styles.cell}>{truncate(item.row[col.id] ?? "", colFlex(col.id))}</Text>
                  </View>
                ))}
              </View>
            );
          })}
        </View>

        <Text
          style={styles.footer}
          render={({ pageNumber, totalPages }) =>
            `Page ${pageNumber} of ${totalPages}`
          }
          fixed
        />
      </Page>
    </Document>
  );
}
