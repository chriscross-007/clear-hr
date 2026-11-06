"use client";

// CLE-239 — Employment Notice profile picker on the Employment tab's
// Contract group. Saves on change (audited server-side) and shows the
// profile's terms, flagging when the organisation's notice is below the
// statutory minimum for this person's length of service.

import { useEffect, useState } from "react";
import { AlertTriangle, Check, Loader2 } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useMemberLabel } from "@/contexts/member-label-context";
import { capitalize } from "@/lib/label-utils";
import {
  getEmploymentNoticeProfiles,
  getMemberEmploymentNotice,
  setMemberEmploymentNoticeProfile,
} from "@/app/(dashboard)/employment-notice-actions";
import { belowStatutory, formatNotice, type EmploymentNoticeProfile } from "@/lib/employment-notice";

export function EmploymentNoticeSection({ memberId, canEdit }: { memberId: string; canEdit: boolean }) {
  const { memberLabel } = useMemberLabel();
  const [profiles, setProfiles] = useState<EmploymentNoticeProfile[]>([]);
  const [current, setCurrent] = useState<string | null>(null);
  const [statutoryWeeks, setStatutoryWeeks] = useState<number | null>(null);
  const [firstName, setFirstName] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([getEmploymentNoticeProfiles(), getMemberEmploymentNotice(memberId)]).then(([p, m]) => {
      if (cancelled) return;
      if (!p.success) setError(p.error);
      else setProfiles(p.profiles);
      if (m.success) {
        setCurrent(m.profileId);
        setStatutoryWeeks(m.statutoryWeeks);
        setFirstName(m.memberName);
      } else if (p.success) setError(m.error);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [memberId]);

  async function handleChange(value: string) {
    setError(null);
    setSaving(true);
    setJustSaved(false);
    const res = await setMemberEmploymentNoticeProfile(memberId, value);
    setSaving(false);
    if (!res.success) {
      setError(res.error);
      return;
    }
    setCurrent(value);
    setJustSaved(true);
    setTimeout(() => setJustSaved(false), 2000);
  }

  if (loading) {
    return (
      <div className="space-y-2">
        <Label>Employment Notice Profile</Label>
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    );
  }

  if (profiles.length === 0) {
    return (
      <div className="space-y-2">
        <Label>Employment Notice Profile</Label>
        <p className="text-sm text-muted-foreground">{error ?? "No profiles set up yet. Add them in Settings → Profiles → Employment Notice."}</p>
      </div>
    );
  }

  const value = current ?? profiles.find((p) => p.isDefault)?.id ?? profiles[0].id;
  const profile = profiles.find((p) => p.id === value) ?? null;
  const flag = profile && belowStatutory(profile, statutoryWeeks);

  return (
    <div className="space-y-2">
      <div>
        <Label>Employment Notice Profile</Label>
        <p className="mt-0.5 text-xs text-muted-foreground">How much notice this {memberLabel.toLowerCase()} and the organisation must give.</p>
      </div>
      {error && <div className="rounded-md bg-destructive/10 p-2 text-sm text-destructive">{error}</div>}
      <div className="flex items-center gap-2">
        <Select value={value} onValueChange={handleChange} disabled={!canEdit || saving}>
          <SelectTrigger className="w-full sm:max-w-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {profiles.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
                {p.isDefault && <span className="ml-2 text-xs text-muted-foreground">(default)</span>}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {saving && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
        {justSaved && <Check className="h-4 w-4 text-green-600" aria-label="Saved" />}
      </div>
      {profile && (
        <ul className="space-y-0.5 text-xs text-muted-foreground">
          <li>
            {capitalize(memberLabel)} gives <strong className="text-foreground">{formatNotice(profile.memberAmount, profile.memberUnit)}</strong> ·
            Organisation gives <strong className="text-foreground">{formatNotice(profile.employerAmount, profile.employerUnit)}</strong>
            {profile.employerStatutoryFloor ? ", or the legal minimum if greater" : ""}
          </li>
          {(profile.probationMemberAmount !== null || profile.probationEmployerAmount !== null) && (
            <li>
              During probation:{" "}
              {formatNotice(profile.probationMemberAmount ?? profile.memberAmount, profile.probationMemberUnit ?? profile.memberUnit)} /{" "}
              {formatNotice(profile.probationEmployerAmount ?? profile.employerAmount, profile.probationEmployerUnit ?? profile.employerUnit)}
            </li>
          )}
          {statutoryWeeks !== null && statutoryWeeks > 0 && (
            <li>
              Legal minimum the organisation must give {firstName || `this ${memberLabel.toLowerCase()}`} today:{" "}
              {formatNotice(statutoryWeeks, "week")}
            </li>
          )}
        </ul>
      )}
      {flag && (
        <p className="flex items-start gap-1.5 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {profile!.employerStatutoryFloor
            ? `The legal minimum (${formatNotice(statutoryWeeks!, "week")}) is more than this profile's ${formatNotice(profile!.employerAmount, profile!.employerUnit)}, so the legal minimum applies.`
            : `This profile's ${formatNotice(profile!.employerAmount, profile!.employerUnit)} is less than the legal minimum of ${formatNotice(statutoryWeeks!, "week")} for this ${memberLabel.toLowerCase()}.`}
        </p>
      )}
    </div>
  );
}
