"use client";

// CLE-231 — Required certifications picker on the Employment page,
// beside the Right to Work toggle. HR ticks which certificate subtypes
// this member must supply; each ticked subtype becomes a placeholder
// row on the member's Documents → Certifications tab until a document
// is uploaded against it.
//
// Only certificate subtypes with "Can be required" on appear here
// (listTrackablePerMemberSubtypes). setMemberExpectedDocuments refuses
// anything else server-side. Persisted via the same action the old
// "+ Add subtype" popover on the Documents tab used, so the audit
// shape (member.expected_documents_added / _removed) is unchanged.

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { Award, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useMemberLabel } from "@/contexts/member-label-context";
import {
  listTrackablePerMemberSubtypes,
  getMemberExpectedDocuments,
  setMemberExpectedDocuments,
  type TrackableSubtype,
} from "@/app/(dashboard)/members/[memberId]/docs/document-actions";
import { dispatchMemberDocsChanged } from "@/lib/member-docs-events";

interface Props {
  memberId: string;
  canEdit: boolean;
}

export function RequiredCertificationsSection({ memberId, canEdit }: Props) {
  const { memberLabel } = useMemberLabel();
  const [available, setAvailable] = useState<TrackableSubtype[] | null>(null);
  const [initial, setInitial] = useState<string[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const load = useCallback(async () => {
    const [avRes, exRes] = await Promise.all([
      listTrackablePerMemberSubtypes(),
      getMemberExpectedDocuments(memberId),
    ]);
    if (!avRes.success) { setError(avRes.error); return; }
    if (!exRes.success) { setError(exRes.error); return; }
    setAvailable(avRes.subtypes);
    setInitial(exRes.subtypeIds);
    setSelected(new Set(exRes.subtypeIds));
  }, [memberId]);

  useEffect(() => { void load(); }, [load]);

  const dirty = useMemo(() => {
    if (selected.size !== initial.length) return true;
    return initial.some((id) => !selected.has(id));
  }, [selected, initial]);

  function toggle(id: string, on: boolean) {
    setSuccess(null);
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id); else next.delete(id);
      return next;
    });
  }

  function handleSave() {
    setError(null);
    setSuccess(null);
    startTransition(async () => {
      const res = await setMemberExpectedDocuments(memberId, Array.from(selected));
      if (!res.success) { setError(res.error ?? "Failed to save"); return; }
      // Sidebar traffic light + Certifications card listen for this.
      dispatchMemberDocsChanged(memberId);
      await load();
      setSuccess("Saved.");
    });
  }

  return (
    <div className="rounded-lg border bg-card p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Award className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">Required certifications</h2>
      </div>
      <p className="text-xs text-muted-foreground">
        Certificates this {memberLabel} must supply. Each one appears on
        their Documents → Certifications tab until it&apos;s uploaded.
        Certificates you don&apos;t need to chase can be filed under Other.
      </p>

      {available === null && !error ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : available && available.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No certificate types can be required yet. Turn on &quot;Can be
          required&quot; for a certificate in Settings → Document Definitions.
        </p>
      ) : (
        <div className="space-y-1 rounded-md border p-2">
          {(available ?? []).map((s) => (
            <label
              key={s.id}
              className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted/40"
            >
              <Checkbox
                checked={selected.has(s.id)}
                onCheckedChange={(v) => toggle(s.id, v === true)}
                disabled={!canEdit || pending}
              />
              {s.name}
            </label>
          ))}
        </div>
      )}

      {error && <div className="rounded-md bg-destructive/10 p-2 text-xs text-destructive">{error}</div>}
      {success && !dirty && (
        <div className="rounded-md bg-green-500/10 p-2 text-xs text-green-700 dark:text-green-400">{success}</div>
      )}

      {canEdit && (
        <div className="flex justify-end">
          <Button size="sm" onClick={handleSave} disabled={pending || !dirty}>
            {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save
          </Button>
        </div>
      )}
    </div>
  );
}
