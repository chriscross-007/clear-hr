// CLE-167 — Holiday Profiles is superseded by the Profileless Holiday Management
// model (per-employee Holiday Periods on the employee's Holiday page). This route
// is kept as a redirect so any existing bookmarks land somewhere sensible. The
// folder will be deleted in the Phase 7 cleanup pass.

import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default function HolidayProfilesPage() {
  redirect("/employees");
}
