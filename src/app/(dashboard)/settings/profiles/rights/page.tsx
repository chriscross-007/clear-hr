import { redirect } from "next/navigation";

// CLE-197 — Legacy path redirected to the new Rights Profiles editor
// at /settings/rights-profiles. The placeholder that lived here during
// the CLE-196 cutover is gone.
export default function LegacyRightsProfilesRedirect() {
  redirect("/settings/rights-profiles");
}
