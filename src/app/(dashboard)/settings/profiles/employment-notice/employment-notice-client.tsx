"use client";

// CLE-239 — Employment Notice profiles list + popup CRUD. Same shape as
// the other Profile tabs: drag-reorder (Default pinned), Copy as new,
// Default name-locked + undeleteable.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Loader2, Copy, GripVertical } from "lucide-react";
import {
  createEmploymentNoticeProfile,
  deleteEmploymentNoticeProfile,
  getEmploymentNoticeProfiles,
  reorderEmploymentNoticeProfiles,
  updateEmploymentNoticeProfile,
} from "@/app/(dashboard)/employment-notice-actions";
import {
  formatNotice,
  type EmploymentNoticeProfile,
  type EmploymentNoticeProfileInput,
  type NoticeUnit,
} from "@/lib/employment-notice";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useMemberLabel } from "@/contexts/member-label-context";
import { capitalize, pluralize } from "@/lib/label-utils";
import { PROFILE_TYPES } from "../profile-types";
import { useListReorder } from "../use-list-reorder";
import { cn } from "@/lib/utils";

const LABEL = PROFILE_TYPES.employmentNotice.label;

function probationText(amount: number | null, unit: NoticeUnit | null): string {
  return amount === null ? "—" : formatNotice(amount, unit);
}

export function EmploymentNoticeClient({ initialProfiles }: { initialProfiles: EmploymentNoticeProfile[] }) {
  const router = useRouter();
  const { memberLabel } = useMemberLabel();
  const membersPluralCap = capitalize(pluralize(memberLabel));
  const [profiles, setProfiles] = useState<EmploymentNoticeProfile[]>(initialProfiles);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<EmploymentNoticeProfile | null>(null);
  const [copyFrom, setCopyFrom] = useState<EmploymentNoticeProfile | null>(null);
  const [deleting, setDeleting] = useState<EmploymentNoticeProfile | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [reorderError, setReorderError] = useState<string | null>(null);

  const { rowProps, rowClassExtra } = useListReorder<EmploymentNoticeProfile>({
    items: profiles,
    setItems: setProfiles,
    onReorder: (orderedIds) =>
      reorderEmploymentNoticeProfiles(orderedIds.filter((id) => !profiles.find((p) => p.id === id)?.isDefault)),
    canDrag: (p) => !p.isDefault,
    onError: setReorderError,
  });

  async function refresh() {
    const r = await getEmploymentNoticeProfiles();
    if (r.success) setProfiles(r.profiles);
  }

  async function handleDelete() {
    if (!deleting) return;
    setDeleteLoading(true);
    setDeleteError(null);
    const res = await deleteEmploymentNoticeProfile(deleting.id);
    setDeleteLoading(false);
    if (!res.success) {
      setDeleteError(res.error);
      return;
    }
    await refresh();
    setDeleting(null);
    router.refresh();
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{LABEL}</CardTitle>
          <p className="text-xs text-muted-foreground">
            The notice a {memberLabel.toLowerCase()} must give to leave, and the notice the organisation must give to end their employment. Click a row to edit.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          {reorderError && <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{reorderError}</div>}

          <div className="flex justify-end">
            <Button
              type="button"
              size="sm"
              onClick={() => {
                setEditing(null);
                setCopyFrom(null);
                setEditorOpen(true);
              }}
            >
              <Plus className="mr-1 h-3.5 w-3.5" />
              New profile
            </Button>
          </div>

          {profiles.length > 0 && (
            <div className="flex items-center gap-2 px-3">
              <span className="w-4 shrink-0" />
              <span className="flex-1 text-xs font-medium text-muted-foreground">Name</span>
              <span className="w-28 text-center text-xs font-medium text-muted-foreground">{capitalize(memberLabel)} gives</span>
              <span className="w-28 text-center text-xs font-medium text-muted-foreground">Organisation gives</span>
              <span className="w-28 text-center text-xs font-medium text-muted-foreground">In probation</span>
              <span className="w-20 text-center text-xs font-medium text-muted-foreground">{membersPluralCap}</span>
              <span className="w-7" />
              <span className="w-7" />
            </div>
          )}

          {profiles.map((p, idx) => (
            <div
              key={p.id}
              {...rowProps(idx)}
              className={cn(
                "flex cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5 transition-colors hover:bg-muted/50",
                rowClassExtra(idx),
              )}
              onClick={() => {
                setEditing(p);
                setCopyFrom(null);
                setEditorOpen(true);
              }}
            >
              {p.isDefault ? (
                <span className="w-4 shrink-0" />
              ) : (
                <GripVertical className="h-4 w-4 shrink-0 cursor-grab text-muted-foreground active:cursor-grabbing" onClick={(e) => e.stopPropagation()} />
              )}
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <span className="truncate text-sm font-semibold">{p.name}</span>
                {p.isDefault && <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">Default</span>}
              </div>
              <span className="w-28 text-center text-sm">{formatNotice(p.memberAmount, p.memberUnit)}</span>
              <span className="w-28 text-center text-sm">
                {formatNotice(p.employerAmount, p.employerUnit)}
                {p.employerStatutoryFloor && <span className="block text-[10px] text-muted-foreground">or legal minimum</span>}
              </span>
              <span className="w-28 text-center text-xs text-muted-foreground">
                {p.probationMemberAmount === null && p.probationEmployerAmount === null
                  ? "—"
                  : `${probationText(p.probationMemberAmount, p.probationMemberUnit)} / ${probationText(p.probationEmployerAmount, p.probationEmployerUnit)}`}
              </span>
              <span className="w-20 text-center text-sm tabular-nums">{p.memberCount}</span>
              <div className="flex w-7 justify-center" onClick={(e) => e.stopPropagation()}>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  title="Copy as new"
                  onClick={() => {
                    setEditing(null);
                    setCopyFrom(p);
                    setEditorOpen(true);
                  }}
                >
                  <Copy className="h-3.5 w-3.5" />
                </Button>
              </div>
              <div className="flex w-7 justify-center" onClick={(e) => e.stopPropagation()}>
                {!p.isDefault && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    aria-label="Delete profile"
                    onClick={() => {
                      setDeleteError(null);
                      setDeleting(p);
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
                  </Button>
                )}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {editorOpen && (
        <EditorDialog
          editing={editing}
          template={copyFrom}
          onClose={() => {
            setEditorOpen(false);
            setCopyFrom(null);
          }}
          onSaved={async () => {
            await refresh();
            setEditorOpen(false);
            setCopyFrom(null);
            router.refresh();
          }}
        />
      )}

      <AlertDialog
        open={!!deleting}
        onOpenChange={(o) => {
          if (!o) {
            setDeleting(null);
            setDeleteError(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {LABEL} profile</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteError ? (
                <span className="text-destructive">{deleteError}</span>
              ) : (deleting?.memberCount ?? 0) > 0 ? (
                <>
                  {deleting?.memberCount} {pluralize(memberLabel.toLowerCase())} are on <strong>{deleting?.name}</strong>. Move them to another profile on their Employment tab first.
                </>
              ) : (
                <>
                  Delete <strong>{deleting?.name}</strong>?
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteLoading}>Cancel</AlertDialogCancel>
            {!deleteError && (deleting?.memberCount ?? 0) === 0 && (
              <AlertDialogAction
                disabled={deleteLoading}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={(e) => {
                  e.preventDefault();
                  void handleDelete();
                }}
              >
                {deleteLoading ? "Deleting…" : "Delete"}
              </AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// ---------------------------------------------------------------------------

function NoticeInput({
  id,
  label,
  amount,
  unit,
  onAmount,
  onUnit,
  optional,
}: {
  id: string;
  label: string;
  amount: string;
  unit: NoticeUnit;
  onAmount: (v: string) => void;
  onUnit: (u: NoticeUnit) => void;
  optional?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex gap-2">
        <Input
          id={id}
          type="number"
          min={0}
          max={120}
          step={1}
          className="w-24"
          value={amount}
          placeholder={optional ? "—" : undefined}
          onChange={(e) => onAmount(e.target.value)}
        />
        <select
          className="h-9 rounded-md border bg-background px-2 text-sm"
          value={unit}
          onChange={(e) => onUnit(e.target.value as NoticeUnit)}
          aria-label={`${label} unit`}
        >
          <option value="week">{Number(amount) === 1 ? "week" : "weeks"}</option>
          <option value="month">{Number(amount) === 1 ? "month" : "months"}</option>
        </select>
      </div>
    </div>
  );
}

function EditorDialog({
  editing,
  template,
  onClose,
  onSaved,
}: {
  editing: EmploymentNoticeProfile | null;
  template: EmploymentNoticeProfile | null;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const { memberLabel } = useMemberLabel();
  const source = editing ?? template;
  const initial = {
    name: editing ? editing.name : template ? `${template.name} (Copy)` : "",
    memberAmount: String(source?.memberAmount ?? 1),
    memberUnit: (source?.memberUnit ?? "month") as NoticeUnit,
    employerAmount: String(source?.employerAmount ?? 1),
    employerUnit: (source?.employerUnit ?? "month") as NoticeUnit,
    floor: source?.employerStatutoryFloor ?? true,
    probMemberAmount: source?.probationMemberAmount === null || source?.probationMemberAmount === undefined ? "" : String(source.probationMemberAmount),
    probMemberUnit: (source?.probationMemberUnit ?? "week") as NoticeUnit,
    probEmployerAmount:
      source?.probationEmployerAmount === null || source?.probationEmployerAmount === undefined ? "" : String(source.probationEmployerAmount),
    probEmployerUnit: (source?.probationEmployerUnit ?? "week") as NoticeUnit,
  };
  const [v, setV] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof typeof v>(k: K, val: (typeof v)[K]) => setV((s) => ({ ...s, [k]: val }));
  const dirty = !editing || JSON.stringify(v) !== JSON.stringify(initial);
  const valid = v.name.trim() !== "" && v.memberAmount !== "" && v.employerAmount !== "";

  async function save() {
    setSaving(true);
    setError(null);
    const input: EmploymentNoticeProfileInput = {
      name: v.name,
      memberAmount: Number(v.memberAmount),
      memberUnit: v.memberUnit,
      employerAmount: Number(v.employerAmount),
      employerUnit: v.employerUnit,
      employerStatutoryFloor: v.floor,
      probationMemberAmount: v.probMemberAmount === "" ? null : Number(v.probMemberAmount),
      probationMemberUnit: v.probMemberAmount === "" ? null : v.probMemberUnit,
      probationEmployerAmount: v.probEmployerAmount === "" ? null : Number(v.probEmployerAmount),
      probationEmployerUnit: v.probEmployerAmount === "" ? null : v.probEmployerUnit,
    };
    const res = editing ? await updateEmploymentNoticeProfile(editing.id, input) : await createEmploymentNoticeProfile(input);
    setSaving(false);
    if (!res.success) {
      setError(res.error);
      return;
    }
    await onSaved();
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? `Edit ${LABEL} profile` : `New ${LABEL} profile`}</DialogTitle>
          <DialogDescription>Notice terms for everyone on this profile.</DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] space-y-4 overflow-y-auto px-1">
          <div className="space-y-1.5">
            <Label htmlFor="en-name">Name</Label>
            <Input
              id="en-name"
              value={v.name}
              maxLength={80}
              disabled={!!editing?.isDefault}
              onChange={(e) => set("name", e.target.value)}
              placeholder="e.g. Senior Staff"
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <NoticeInput
              id="en-member"
              label={`${capitalize(memberLabel)} gives`}
              amount={v.memberAmount}
              unit={v.memberUnit}
              onAmount={(x) => set("memberAmount", x)}
              onUnit={(u) => set("memberUnit", u)}
            />
            <NoticeInput
              id="en-employer"
              label="Organisation gives"
              amount={v.employerAmount}
              unit={v.employerUnit}
              onAmount={(x) => set("employerAmount", x)}
              onUnit={(u) => set("employerUnit", u)}
            />
          </div>
          <div className="flex items-start justify-between gap-3 rounded-md border p-3">
            <div>
              <Label htmlFor="en-floor">Never less than the legal minimum</Label>
              <p className="text-xs text-muted-foreground">
                The organisation&apos;s notice is at least the statutory minimum: 1 week after one month&apos;s service, then 1 week per full year, up to 12
                weeks. ClearHR works it out from each start date.
              </p>
            </div>
            <Switch id="en-floor" checked={v.floor} onCheckedChange={(c) => set("floor", c)} />
          </div>
          <div className="space-y-2">
            <p className="text-sm font-medium">During probation (optional)</p>
            <p className="text-xs text-muted-foreground">Leave blank to use the figures above.</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <NoticeInput
                id="en-pm"
                label={`${capitalize(memberLabel)} gives`}
                amount={v.probMemberAmount}
                unit={v.probMemberUnit}
                onAmount={(x) => set("probMemberAmount", x)}
                onUnit={(u) => set("probMemberUnit", u)}
                optional
              />
              <NoticeInput
                id="en-pe"
                label="Organisation gives"
                amount={v.probEmployerAmount}
                unit={v.probEmployerUnit}
                onAmount={(x) => set("probEmployerAmount", x)}
                onUnit={(u) => set("probEmployerUnit", u)}
                optional
              />
            </div>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" disabled={saving || !dirty || !valid} onClick={() => void save()}>
            {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            {editing ? "Save" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
