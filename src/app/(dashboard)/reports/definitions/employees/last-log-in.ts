import type { StandardReport } from "../index";

const report: StandardReport = {
  id: "employees.last-log-in",
  group: "employees",
  groupLabel: "Employees",
  name: "Last Log-in",
  description: "Active members sorted by their most recent login date.",
  defaultColumns: ["avatar", "first_name", "last_name", "email", "role", "team", "last_log_in"],
  defaultFilters: { status: "Active" },
};

export default report;
