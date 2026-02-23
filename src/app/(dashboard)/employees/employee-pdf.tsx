import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
} from "@react-pdf/renderer";

interface EmployeePDFRow {
  first_name: string;
  last_name: string;
  payroll_number: string;
  role: string;
  team: string;
  email: string;
  status: string;
  last_log_in: string;
}

export interface ActiveFilter {
  label: string;
  value: string;
}

interface EmployeePDFProps {
  rows: EmployeePDFRow[];
  orgName: string;
  title: string;
  orientation: "portrait" | "landscape";
  filters?: ActiveFilter[];
}

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
    alignItems: "center",
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
  headerCell: {
    fontFamily: "Helvetica-Bold",
    fontSize: 8,
    paddingVertical: 4,
    paddingHorizontal: 4,
  },
  cell: {
    fontSize: 8,
    paddingVertical: 4,
    paddingHorizontal: 4,
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

const portraitWidths = {
  first_name: "11%",
  last_name: "11%",
  payroll_number: "10%",
  role: "9%",
  team: "11%",
  email: "22%",
  status: "10%",
  last_log_in: "16%",
};

const landscapeWidths = {
  first_name: "12%",
  last_name: "12%",
  payroll_number: "10%",
  role: "8%",
  team: "12%",
  email: "22%",
  status: "9%",
  last_log_in: "15%",
};

const columns = [
  { key: "first_name" as const, label: "First Name" },
  { key: "last_name" as const, label: "Last Name" },
  { key: "payroll_number" as const, label: "Payroll #" },
  { key: "role" as const, label: "Role" },
  { key: "team" as const, label: "Team" },
  { key: "email" as const, label: "Email" },
  { key: "status" as const, label: "Status" },
  { key: "last_log_in" as const, label: "Last Log-in" },
];

export function EmployeePDF({
  rows,
  orgName,
  title,
  orientation,
  filters,
}: EmployeePDFProps) {
  const widths = orientation === "landscape" ? landscapeWidths : portraitWidths;
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
              <Text
                key={col.key}
                style={[styles.headerCell, { width: widths[col.key] }]}
              >
                {col.label}
              </Text>
            ))}
          </View>

          {rows.map((row, i) => (
            <View
              key={i}
              style={[styles.tableRow, i % 2 === 1 ? styles.tableRowAlt : {}]}
              wrap={false}
            >
              {columns.map((col) => (
                <Text
                  key={col.key}
                  style={[styles.cell, { width: widths[col.key] }]}
                >
                  {row[col.key]}
                </Text>
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
