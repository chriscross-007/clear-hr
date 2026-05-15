import { redirect } from "next/navigation";

// CLE-191 — /settings/profiles index. Default to Rights as the most-
// commonly-edited profile type.
export default function ProfilesIndexPage() {
  redirect("/settings/profiles/rights");
}
