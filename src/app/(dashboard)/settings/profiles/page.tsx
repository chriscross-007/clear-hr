import { redirect } from "next/navigation";

// CLE-197 — /settings/profiles index. Rights Profiles now live at
// /settings/rights-profiles; the legacy Rights sub-page redirects
// there. Default this index to Working Patterns instead, which is
// the next-most-touched profile type.
export default function ProfilesIndexPage() {
  redirect("/settings/profiles/working-pattern");
}
