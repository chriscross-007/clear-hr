import type { StandardReport } from "../index";

const report: StandardReport = {
  id: "holiday",
  group: "holiday",
  groupLabel: "Holiday",
  name: "Holiday Bookings",
  description: "All holiday and absence bookings with status, dates and approval details.",
  defaultColumns: ["employee", "team", "leave_type", "start_date", "end_date", "days", "status", "requested", "actioned_by"],
};

export default report;
