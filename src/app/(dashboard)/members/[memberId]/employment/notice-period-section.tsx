"use client";

// CLE-194 — Notice Period profile picker on the Employment tab. One
// selector per member (notice rules are member-scoped, not absence-type
// scoped). New members inherit the org's Default profile automatically
// via the assign_notice_profile_on_member_insert trigger.

import { useEffect, useState } from "react";
import { Label } from "@/components/ui/label";
import { Loader2, Check } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  getNoticePeriodProfiles,
  getMemberNoticeProfileAssignment,
  setMemberNoticeProfile,
  type NoticePeriodProfile,
} from "@/app/(dashboard)/notice-period-actions";

interface Props {
  memberId: string;
  canEdit: boolean;
}

export function NoticePeriodSection({ memberId, canEdit }: Props) {
  const [profiles, setProfiles] = useState<NoticePeriodProfile[]>([]);
  const [current, setCurrent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [pRes, aRes] = await Promise.all([
        getNoticePeriodProfiles(),
        getMemberNoticeProfileAssignment(memberId),
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
    setJustSaved(false);
    const res = await setMemberNoticeProfile(memberId, value);
    setSaving(false);
    if (!res.success) {
      setError(res.error ?? "Failed to save");
      return;
    }
    setCurrent(value);
    setJustSaved(true);
    setTimeout(() => setJustSaved(false), 2000);
  }

  if (loading) {
    return (
      <div className="space-y-2">
        <Label>Notice Period Profile</Label>
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    );
  }

  if (profiles.length === 0) {
    return (
      <div className="space-y-2">
        <Label>Notice Period Profile</Label>
        <p className="text-sm text-muted-foreground">
          No notice period profiles configured. Set them up in Settings → Profiles → Holiday Notice.
        </p>
      </div>
    );
  }

  // Default profile is always selected if no assignment exists.
  const fallback = profiles.find((p) => p.isDefault)?.id ?? profiles[0]?.id ?? "";
  const value = current ?? fallback;

  return (
    <div className="space-y-2">
      <div>
        <Label>Notice Period Profile</Label>
        <p className="text-xs text-muted-foreground mt-0.5">
          Which notice rules apply when this member submits a request.
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
        {!saving && justSaved && (
          <span className="inline-flex items-center gap-1 text-xs text-green-600">
            <Check className="h-3.5 w-3.5" />
            Saved
          </span>
        )}
      </div>
    </div>
  );
}
