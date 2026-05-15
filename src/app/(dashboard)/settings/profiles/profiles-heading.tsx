"use client";

import { useMemberLabel } from "@/contexts/member-label-context";
import { capitalize, pluralize } from "@/lib/label-utils";

// CLE-191 — Profiles section heading. Client component so we can pull
// the dynamic member label from context (e.g. "colleague" → "Colleagues")
// for the strapline.

export function ProfilesHeading() {
  const { memberLabel } = useMemberLabel();
  const plural = capitalize(pluralize(memberLabel));
  return (
    <div className="mb-2">
      <h1 className="text-2xl font-bold">Profiles</h1>
      <p className="text-sm text-muted-foreground mt-0.5">
        Sets of rules that personalise {plural}.
      </p>
    </div>
  );
}
