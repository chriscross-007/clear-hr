"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ProfileExplainer } from "../profile-explainer";
import { useMemberLabel } from "@/contexts/member-label-context";

// CLE-191 — Holiday profiles stub. The Phase 2 issue introduces the
// `holiday_profiles` table and migrates the per-member cog values onto
// a profile-id FK. Until that lands, holiday defaults still live as
// columns on `members` (snapshotted from org defaults at create time),
// editable via the cog on the member's Holiday page. Auth + role gate
// is enforced by `../layout.tsx` so this page can be a client component.

export default function HolidayProfilesStubPage() {
  const { memberLabel } = useMemberLabel();
  return (
    <div className="space-y-6">
      <ProfileExplainer
        kind="seed"
        note="Holiday values are baked into each new Holiday Period at creation. Changes to a Holiday Profile won't retroactively rewrite existing periods."
      />
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Coming in Phase 2</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            Holiday Profiles aren&apos;t wired up yet. While Phase 2 is in
            progress, edit per-{memberLabel} holiday defaults from the cog on
            the {memberLabel}&apos;s Holiday page; new-{memberLabel} defaults
            still flow from the org-level Default Cascade values on the
            existing Organisation dialog.
          </p>
          <p>
            When the Phase 2 entity lands, this page becomes the same list +
            popup CRUD as the other profile types.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
