"use client";

// CLE-198 follow-up — Small picker card on the Employment page that
// shows the member's current User Rights profile and lets an admin
// with `canEditRightsProfiles` swap them to any other profile. The DB
// trigger (`ensure_at_least_two_rights_editors_on_member`) still
// enforces bus-factor — the picker will surface the error message
// verbatim if the caller tries to drop the count of rights-editors
// below 2.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { setMemberRightsProfile } from "@/app/(dashboard)/settings/rights-profiles/actions";
import { ShieldCheck } from "lucide-react";

interface Props {
  memberId: string;
  memberName: string;
  currentProfileId: string | null;
  profiles: { id: string; name: string }[];
  canEdit: boolean;
}

export function UserRightsPicker({
  memberId,
  memberName,
  currentProfileId,
  profiles,
  canEdit,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [value, setValue] = useState(currentProfileId ?? "");

  const currentName =
    profiles.find((p) => p.id === (currentProfileId ?? ""))?.name ?? "Unassigned";

  function handleChange(next: string) {
    setError(null);
    setValue(next);
    startTransition(async () => {
      const r = await setMemberRightsProfile(memberId, next);
      if (!r.success) {
        setError(r.error ?? "Failed to change User Rights");
        // Revert local state; the server didn't accept the change.
        setValue(currentProfileId ?? "");
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="rounded-lg border bg-card p-4 space-y-3">
      <div className="flex items-center gap-2">
        <ShieldCheck className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">User Rights</h2>
      </div>
      {canEdit ? (
        <>
          <p className="text-xs text-muted-foreground">
            The profile driving what {memberName} can do in ClearHR. Changes take
            effect immediately.
          </p>
          <Select value={value} onValueChange={handleChange} disabled={pending}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Choose a profile" />
            </SelectTrigger>
            <SelectContent>
              {profiles.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {error && (
            <div className="rounded-md border border-destructive bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </div>
          )}
        </>
      ) : (
        <p className="text-sm">
          <span className="text-muted-foreground">Assigned profile:</span>{" "}
          <span className="font-medium">{currentName}</span>
        </p>
      )}
    </div>
  );
}
