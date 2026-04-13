import allReport from "./employees/all";
import invitedReport from "./employees/invited";
import activeReport from "./employees/active";
import lastLogInReport from "./employees/last-log-in";
import customFieldsReport from "./employees/custom-fields";
import holidayBookingsReport from "./holiday/bookings";

export interface StandardReport {
  id: string;
  group: string;
  groupLabel: string;
  name: string;
  description: string;
  defaultColumns: string[];
  defaultFilters?: Record<string, unknown>;
}

export const ALL_STANDARD_REPORTS: StandardReport[] = [
  allReport,
  invitedReport,
  activeReport,
  lastLogInReport,
  customFieldsReport,
  holidayBookingsReport,
];

/** Reports grouped by their `group` key, preserving insertion order */
export const REPORT_GROUPS: Record<string, StandardReport[]> = {};
for (const report of ALL_STANDARD_REPORTS) {
  if (!REPORT_GROUPS[report.group]) {
    REPORT_GROUPS[report.group] = [];
  }
  REPORT_GROUPS[report.group].push(report);
}
