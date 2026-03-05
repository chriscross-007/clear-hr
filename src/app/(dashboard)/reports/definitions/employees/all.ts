import type { StandardReport } from "../index";

const report: StandardReport = {
  id: "employees.all",
  group: "employees",
  groupLabel: "Employees",
  name: "All Members",
  description: "Every member in your organisation with full details.",
  defaultColumns: ["avatar", "first_name", "last_name", "email", "role", "profile", "team", "status"],
};

export default report;
