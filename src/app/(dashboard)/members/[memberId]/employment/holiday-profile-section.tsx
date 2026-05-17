"use client";

// CLE-194 Phase 2 — Holiday Profile picker on the Employment tab. One
// selector per member. New members inherit the org's Default profile
// automatically via the assign_holiday_profile_on_member_insert trigger.
// Picking a profile may auto-create the first Holiday Period if the
// member also has a start_date (or the org runs a Fixed Day calendar).

import { useEffect, useState } from "react";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  getHolidayProfiles,
  getMemberHolidayProfileAssignment,
  setMemberHolidayProfile,
  type HolidayProfile,
} from "@/app/(dashboard)/holiday-profile-actions";

interface Props {
  memberId: string;
  canEdit: boolean;
}

export function HolidayProfileSection({ memberId, canEdit }: Props) {
  const [profiles, setProfiles] = useState<HolidayProfile[]>([]);
  const [current, setCurrent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [pRes, aRes] = await Promise.all([
        getHolidayProfiles(),
        getMemberHolidayProfileAssignment(memberId),
      ]);
      if (cancelled) return;
      if (!pRes.success) setError(pRes.error ?? "Failed to load profiles");
      else if (!aRes.success) setError(aRes.error ?? "Failed to load assignment");
      setProfiles(pRes.profiles ?? []);
      setCurrent(aRes.profileId ?? null);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [memberId]);

  async function handleChange(value: string) {
    setError(null);
    setSaving(true);
    const res = await setMemberHolidayProfile(memberId, value);
    setSaving(false);
    if (!res.success) {
      setError(res.error ?? "Failed to save");
      return;
    }
    setCurrent(value);
  }

  if (loading) {
    return (
      <div className="space-y-2">
        <Label>Holiday Profile</Label>
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    );
  }

  if (profiles.length === 0) {
    return (
      <div className="space-y-2">
        <Label>Holiday Profile</Label>
        <p className="text-sm text-muted-foreground">
          No Holiday Profiles configured. Set them up in Settings → Profiles → Holiday Profiles.
        </p>
      </div>
    );
  }

  const fallback = profiles.find((p) => p.isDefault)?.id ?? profiles[0]?.id ?? "";
  const value = current ?? fallback;

  return (
    <div className="space-y-2">
      <div>
        <Label>Holiday Profile</Label>
        <p className="text-xs text-muted-foreground mt-0.5">
          Drives the 7 values snapshotted onto each new Holiday Period for this member.
        </p>
      </div>
      {error && (
        <div className="rounded-md bg-destructive/10 p-2 text-sm text-destructive">{error}</div>
      )}
      <div className="flex items-center gap-2">
        <Select value={value} onValueChange={handleChange} disabled={!canEdit || saving}>
          <SelectTrigger className="w-full sm:max-w-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {profiles.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
                {p.isDefault && (
                  <span className="ml-2 text-xs text-muted-foreground">(default)</span>
                )}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {saving && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
      </div>
    </div>
  );
}
