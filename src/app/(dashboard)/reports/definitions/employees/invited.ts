import type { StandardReport } from "../index";

const report: StandardReport = {
  id: "employees.invited",
  group: "employees",
  groupLabel: "Employees",
  name: "Invited",
  description: "Members who have been sent an invite but have not yet accepted.",
  defaultColumns: ["avatar", "first_name", "last_name", "email", "role", "team", "status"],
  defaultFilters: { status: "Invited" },
};

export default report;
