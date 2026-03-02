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

interface EmployeePDFProps {
  rows: Record<string, string>[];
  columns: { id: string; label: string }[];
  orgName: string;
  title: string;
  orientation: "portrait" | "landscape";
  filters?: ActiveFilter[];
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
}: EmployeePDFProps) {
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
          <View style={styles.tableHeader}>
            {columns.map((col) => (
              <View key={col.id} style={[styles.cellView, { flex: colFlex(col.id) }]}>
                <Text style={styles.headerCell}>{col.label}</Text>
              </View>
            ))}
          </View>

          {rows.map((row, i) => (
            <View
              key={i}
              style={[styles.tableRow, i % 2 === 1 ? styles.tableRowAlt : {}]}
              wrap={false}
            >
              {columns.map((col) => (
                <View key={col.id} style={[styles.cellView, { flex: colFlex(col.id) }]}>
                  <Text style={styles.cell}>{truncate(row[col.id] ?? "", colFlex(col.id))}</Text>
                </View>
              ))}
            </View>
          ))}
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
