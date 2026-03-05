import type { StandardReport } from "../index";

const report: StandardReport = {
  id: "employees.custom-fields",
  group: "employees",
  groupLabel: "Employees",
  name: "Custom Field Values",
  description: "All members showing their custom field data.",
  defaultColumns: ["first_name", "last_name", "email", "team"],
  // Custom field columns are appended dynamically on the report page
};

export default report;
