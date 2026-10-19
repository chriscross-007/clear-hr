"use client";

// CLE-230 — "Visible to" section for organisation documents, shown in the
// Document Details dialog to callers who can manage org docs.
//
// Audience rules live in src/lib/org-doc-audience.ts:
//   Everyone, or Selected = (Team filter AND User Rights filter) OR
//   on the Always-include list. Ticks within one filter = any of them.

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  getOrgDocumentAudience,
  setOrgDocumentAudience,
  type AudienceOptionMember,
  type AudienceOptionProfile,
  type AudienceOptionTeam,
} from "@/app/(dashboard)/documents/organisation/org-document-actions";
import { memberInAudience, type OrgDocAudience } from "@/lib/org-doc-audience";
import { useMemberLabel } from "@/contexts/member-label-context";
import { capitalize, pluralize } from "@/lib/label-utils";

type Options = {
  audience: OrgDocAudience;
  teams: AudienceOptionTeam[];
  profiles: AudienceOptionProfile[];
  members: AudienceOptionMember[];
};

function countAudience(a: OrgDocAudience, members: AudienceOptionMember[]): number {
  return members.filter(
    (m) => m.canView && memberInAudience(a, { id: m.id, teamId: m.teamId, rightsProfileId: m.rightsProfileId }),
  ).length;
}

function summarise(a: OrgDocAudience, o: Options): string[] {
  if (a.mode === "all") return ["Everyone"];
  const lines: string[] = [];
  const teamNames = o.teams.filter((t) => a.teamIds.includes(t.id)).map((t) => t.name);
  const profileNames = o.profiles.filter((p) => a.rightsProfileIds.includes(p.id)).map((p) => p.name);
  if (teamNames.length) lines.push(`Teams: ${teamNames.join(", ")}`);
  if (profileNames.length) lines.push(`User Rights: ${profileNames.join(", ")}`);
  if (a.includeMemberIds.length) {
    const names = o.members.filter((m) => a.includeMemberIds.includes(m.id)).map((m) => m.name);
    lines.push(`Always include: ${names.join(", ")}`);
  }
  return lines;
}

export function OrgDocAudienceSection({
  documentId,
  onSaved,
}: {
  documentId: string;
  onSaved: () => Promise<void> | void;
}) {
  const { memberLabel } = useMemberLabel();
  const membersWord = pluralize(memberLabel);
  const [options, setOptions] = useState<Options | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  const load = useCallback(async () => {
    const res = await getOrgDocumentAudience(documentId);
    if (!res.success) { setError(res.error); return; }
    setError(null);
    setOptions({ audience: res.audience, teams: res.teams, profiles: res.profiles, members: res.members });
  }, [documentId]);

  useEffect(() => { void load(); }, [load]);

  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <p className="text-base font-semibold">Visible to</p>
        {options && (
          <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
            Change
          </Button>
        )}
      </div>
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
      {!options && !error && <Loader2 className="mt-2 h-4 w-4 animate-spin text-muted-foreground" />}
      {options && (
        <div className="mt-1 space-y-0.5 text-sm">
          {summarise(options.audience, options).map((l) => (
            <p key={l}>{l}</p>
          ))}
          <p className="text-xs text-muted-foreground">
            {countAudience(options.audience, options.members)} {membersWord} can see this
            {options.audience.mode === "selected" && ", plus anyone who manages organisation documents"}.
          </p>
        </div>
      )}

      {editing && options && (
        <AudienceEditor
          documentId={documentId}
          options={options}
          membersWord={membersWord}
          onClose={() => setEditing(false)}
          onSaved={async () => {
            setEditing(false);
            await load();
            await onSaved();
          }}
        />
      )}
    </div>
  );
}

function AudienceEditor({
  documentId,
  options,
  membersWord,
  onClose,
  onSaved,
}: {
  documentId: string;
  options: Options;
  membersWord: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [draft, setDraft] = useState<OrgDocAudience>(options.audience);
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const dirty = JSON.stringify(draft) !== JSON.stringify(options.audience);
  const emptySelection =
    draft.mode === "selected" &&
    draft.teamIds.length === 0 &&
    draft.rightsProfileIds.length === 0 &&
    draft.includeMemberIds.length === 0;
  const count = useMemo(() => countAudience(draft, options.members), [draft, options.members]);

  function toggle(key: "teamIds" | "rightsProfileIds" | "includeMemberIds", id: string, on: boolean) {
    setDraft((d) => ({
      ...d,
      [key]: on ? Array.from(new Set([...d[key], id])) : d[key].filter((x) => x !== id),
    }));
  }

  const filteredMembers = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? options.members.filter((m) => m.name.toLowerCase().includes(q)) : options.members;
  }, [search, options.members]);

  // Tri-state "All" box over the rows currently listed (respects the
  // search box, so "all matching" when a search is active).
  const shownIds = filteredMembers.map((m) => m.id);
  const shownSelected = shownIds.filter((id) => draft.includeMemberIds.includes(id)).length;
  const allState: boolean | "indeterminate" =
    shownIds.length > 0 && shownSelected === shownIds.length
      ? true
      : shownSelected > 0
        ? "indeterminate"
        : false;
  function toggleAllShown(on: boolean) {
    setDraft((d) => ({
      ...d,
      includeMemberIds: on
        ? Array.from(new Set([...d.includeMemberIds, ...shownIds]))
        : d.includeMemberIds.filter((id) => !shownIds.includes(id)),
    }));
  }

  function save() {
    setError(null);
    startTransition(async () => {
      const res = await setOrgDocumentAudience(documentId, draft);
      if (!res.success) { setError(res.error); return; }
      await onSaved();
    });
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-[40rem]">
        <DialogHeader>
          <DialogTitle>Who can see this document?</DialogTitle>
          <DialogDescription>
            Anyone who manages organisation documents can always see it.
          </DialogDescription>
        </DialogHeader>

        <div className="overflow-y-auto max-h-[60vh] px-1 space-y-5">
          {error && <div className="rounded-md bg-destructive/10 p-2 text-sm text-destructive">{error}</div>}

          <RadioGroup
            value={draft.mode}
            onValueChange={(v) => setDraft((d) => ({ ...d, mode: v === "selected" ? "selected" : "all" }))}
            className="flex gap-6"
          >
            <label className="flex items-center gap-2 text-sm">
              <RadioGroupItem value="all" id="aud-all" /> Everyone
            </label>
            <label className="flex items-center gap-2 text-sm">
              <RadioGroupItem value="selected" id="aud-selected" /> Selected {membersWord}
            </label>
          </RadioGroup>

          {draft.mode === "selected" && (
            <>
              <p className="text-xs text-muted-foreground">
                {capitalize(membersWord)} must match <strong>every</strong> filter you set (ticking several
                teams means any of those teams). People on the Always include list can see it regardless.
              </p>

              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                <div>
                  <Label className="text-xs uppercase text-muted-foreground">Teams</Label>
                  <div className="mt-2 space-y-1.5">
                    {options.teams.length === 0 && <p className="text-xs text-muted-foreground">No teams set up.</p>}
                    {options.teams.map((t) => (
                      <label key={t.id} className="flex items-center gap-2 text-sm">
                        <Checkbox
                          checked={draft.teamIds.includes(t.id)}
                          onCheckedChange={(v) => toggle("teamIds", t.id, v === true)}
                        />
                        {t.name}
                      </label>
                    ))}
                  </div>
                </div>
                <div>
                  <Label className="text-xs uppercase text-muted-foreground">User Rights</Label>
                  <div className="mt-2 space-y-1.5">
                    {options.profiles.map((p) => (
                      <label key={p.id} className="flex items-center gap-2 text-sm">
                        <Checkbox
                          checked={draft.rightsProfileIds.includes(p.id)}
                          onCheckedChange={(v) => toggle("rightsProfileIds", p.id, v === true)}
                        />
                        {p.name}
                      </label>
                    ))}
                  </div>
                </div>
              </div>

              <div>
                <Label className="text-xs uppercase text-muted-foreground">Always include</Label>
                <div className="relative mt-2">
                  <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search by name"
                    className="pl-8"
                  />
                </div>
                <div className="mt-2 max-h-48 space-y-1.5 overflow-y-auto rounded-md border p-2">
                  {filteredMembers.length > 0 && (
                    <label className="flex items-center gap-2 border-b pb-1.5 text-sm font-medium">
                      <Checkbox
                        checked={allState}
                        onCheckedChange={() => toggleAllShown(allState !== true)}
                      />
                      {search.trim() ? `All matching ${membersWord}` : `All ${membersWord}`}
                    </label>
                  )}
                  {filteredMembers.map((m) => (
                    <label key={m.id} className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={draft.includeMemberIds.includes(m.id)}
                        onCheckedChange={(v) => toggle("includeMemberIds", m.id, v === true)}
                      />
                      <span className={m.canView ? "" : "text-muted-foreground"}>{m.name}</span>
                      {!m.canView && (
                        <span className="text-xs text-muted-foreground">(User Rights don&apos;t allow organisation documents)</span>
                      )}
                    </label>
                  ))}
                  {filteredMembers.length === 0 && <p className="text-xs text-muted-foreground">No matches.</p>}
                </div>
              </div>
            </>
          )}

          <p className="text-sm">
            <strong>{count}</strong> {membersWord} will be able to see this
            {draft.mode === "selected" && ", plus anyone who manages organisation documents"}.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>Cancel</Button>
          <Button onClick={save} disabled={pending || !dirty || emptySelection}>
            {pending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
