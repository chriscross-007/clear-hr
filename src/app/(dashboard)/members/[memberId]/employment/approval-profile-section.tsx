"use client";

// CLE-186 — Approval Profile picker on the employee's Employment tab.
//
// One selector per absence type that has at least one profile defined for
// the org. The selector shows the available profiles (incl. the org's
// default, badged) plus an "Any admin (legacy)" option that clears the
// per-employee pointer. New employees inherit the org's default profile
// automatically via the seed_approval_profile_on_member_insert trigger.

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
  getApprovalProfilesForOrg,
  getOrgAbsenceTypesForApprovals,
  getMemberApprovalProfileAssignments,
  setMemberApprovalProfile,
  type ApprovalProfile,
} from "@/app/(dashboard)/approval-profile-actions";

const LEGACY_VALUE = "__legacy__";

interface Props {
  memberId: string;
  canEdit: boolean;
}

export function ApprovalProfileSection({ memberId, canEdit }: Props) {
  const [profiles, setProfiles] = useState<ApprovalProfile[]>([]);
  const [absenceTypes, setAbsenceTypes] = useState<{ id: string; name: string }[]>([]);
  const [assignments, setAssignments] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [savingTypeId, setSavingTypeId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [pRes, tRes, aRes] = await Promise.all([
        getApprovalProfilesForOrg(),
        getOrgAbsenceTypesForApprovals(),
        getMemberApprovalProfileAssignments(memberId),
      ]);
      if (cancelled) return;
      if (!pRes.success) setError(pRes.error ?? "Failed to load profiles");
      else if (!tRes.success) setError(tRes.error ?? "Failed to load absence types");
      else if (!aRes.success) setError(aRes.error ?? "Failed to load member assignments");
      setProfiles(pRes.profiles);
      setAbsenceTypes(tRes.absenceTypes);
      setAssignments(aRes.assignments);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [memberId]);

  // Group profiles by absence_type so we know which types have a picker.
  const profilesByType = new Map<string, ApprovalProfile[]>();
  for (const p of profiles) {
    const list = profilesByType.get(p.absenceTypeId) ?? [];
    list.push(p);
    profilesByType.set(p.absenceTypeId, list);
  }

  const renderableTypes = absenceTypes
    .filter((t) => (profilesByType.get(t.id)?.length ?? 0) > 0)
    .sort((a, b) => a.name.localeCompare(b.name));

  async function handleChange(absenceTypeId: string, value: string) {
    setError(null);
    setSavingTypeId(absenceTypeId);
    const newProfileId = value === LEGACY_VALUE ? null : value;
    const result = await setMemberApprovalProfile(memberId, absenceTypeId, newProfileId);
    setSavingTypeId(null);
    if (!result.success) {
      setError(result.error ?? "Failed to save");
      return;
    }
    setAssignments((prev) => {
      const next = { ...prev };
      if (newProfileId === null) delete next[absenceTypeId];
      else next[absenceTypeId] = newProfileId;
      return next;
    });
  }

  if (loading) {
    return (
      <div className="space-y-2">
        <Label>Approval Profile</Label>
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    );
  }

  if (renderableTypes.length === 0) {
    return (
      <div className="space-y-2">
        <Label>Approval Profile</Label>
        <p className="text-sm text-muted-foreground">
          No approval profiles configured. Set them up in Organisation Settings → Approvals.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div>
        <Label>Approval Profile</Label>
        <p className="text-xs text-muted-foreground mt-0.5">
          Which approver ladder applies when this employee submits a request.
          New employees inherit the default profile automatically.
        </p>
      </div>
      {error && (
        <div className="rounded-md bg-destructive/10 p-2 text-sm text-destructive">{error}</div>
      )}
      <div className="space-y-3">
        {renderableTypes.map((t) => {
          const typeProfiles = profilesByType.get(t.id) ?? [];
          const current = assignments[t.id] ?? LEGACY_VALUE;
          const isSaving = savingTypeId === t.id;
          return (
            <div key={t.id} className="grid grid-cols-1 sm:grid-cols-[12rem_1fr] gap-2 sm:items-center">
              <div className="text-sm font-medium">{t.name}</div>
              <div className="flex items-center gap-2">
                <Select
                  value={current}
                  onValueChange={(v) => handleChange(t.id, v)}
                  disabled={!canEdit || isSaving}
                >
                  <SelectTrigger className="w-full sm:max-w-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {typeProfiles.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                        {p.isDefault && (
                          <span className="ml-2 text-xs text-muted-foreground">(default)</span>
                        )}
                      </SelectItem>
                    ))}
                    <SelectItem value={LEGACY_VALUE}>
                      Any admin (no profile)
                    </SelectItem>
                  </SelectContent>
                </Select>
                {isSaving && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
