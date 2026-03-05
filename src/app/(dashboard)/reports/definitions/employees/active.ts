import type { StandardReport } from "../index";

const report: StandardReport = {
  id: "employees.active",
  group: "employees",
  groupLabel: "Employees",
  name: "Active",
  description: "Members who have accepted their invite and are actively using the system.",
  defaultColumns: ["avatar", "first_name", "last_name", "email", "role", "profile", "team", "status"],
  defaultFilters: { status: "Active" },
};

export default report;
