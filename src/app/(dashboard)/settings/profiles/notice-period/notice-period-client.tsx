"use client";

// CLE-194 — Notice Period profiles list + popup CRUD. Multiple profiles
// per org with one is_default. Each member points at exactly one profile
// (auto-seeded on insert; admin can change via the Employment page). The
// Default profile is undeleteable.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Loader2, Copy, GripVertical } from "lucide-react";
import {
  getNoticePeriodProfiles,
  createNoticePeriodProfile,
  updateNoticePeriodProfile,
  deleteNoticePeriodProfile,
  saveNoticePeriodRulesForProfile,
  checkBookingsInBreachForProfile,
  reorderNoticePeriodProfiles,
  type NoticePeriodProfile,
} from "@/app/(dashboard)/notice-period-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
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

type DraftRule = {
  id?: string;
  min_booking_days: number;
  notice_days: number;
};

export function NoticePeriodClient({
  initialProfiles,
}: {
  initialProfiles: NoticePeriodProfile[];
}) {
  const router = useRouter();
  const { memberLabel } = useMemberLabel();
  const membersPluralCap = capitalize(pluralize(memberLabel));
  const [profiles, setProfiles] = useState<NoticePeriodProfile[]>(initialProfiles);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<NoticePeriodProfile | null>(null);
  const [copyFrom, setCopyFrom] = useState<NoticePeriodProfile | null>(null);
  const [deleting, setDeleting] = useState<NoticePeriodProfile | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [reorderError, setReorderError] = useState<string | null>(null);

  const { rowProps, rowClassExtra } = useListReorder<NoticePeriodProfile>({
    items: profiles,
    setItems: setProfiles,
    // Default is pinned at the top — only non-default profile ids go to
    // the server. Filter accordingly.
    onReorder: (orderedIds) =>
      reorderNoticePeriodProfiles(orderedIds.filter((id) => {
        const p = profiles.find((pp) => pp.id === id);
        return p && !p.isDefault;
      })),
    canDrag: (p) => !p.isDefault,
    onError: setReorderError,
  });

  function openCreate() {
    setEditing(null);
    setCopyFrom(null);
    setEditorOpen(true);
  }

  function openEdit(p: NoticePeriodProfile) {
    setEditing(p);
    setCopyFrom(null);
    setEditorOpen(true);
  }

  function openCopy(p: NoticePeriodProfile) {
    setEditing(null);
    setCopyFrom(p);
    setEditorOpen(true);
  }

  async function handleDelete() {
    if (!deleting) return;
    setDeleteLoading(true);
    setDeleteError(null);
    const res = await deleteNoticePeriodProfile(deleting.id);
    setDeleteLoading(false);
    if (!res.success) {
      setDeleteError(res.error ?? "Failed to delete");
      return;
    }
    // Refresh list — also refreshes member counts on the Default since
    // members on the deleted profile got re-pointed.
    const refresh = await getNoticePeriodProfiles();
    if (refresh.success) setProfiles(refresh.profiles ?? []);
    setDeleting(null);
    router.refresh();
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{PROFILE_TYPES.noticePeriod.label}</CardTitle>
          <p className="text-xs text-muted-foreground">
            Each profile is a list of rules of the form &ldquo;bookings of N+ days require X days&apos; notice&rdquo;. Click a row to edit.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          {reorderError && (
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{reorderError}</div>
          )}

          <div className="flex justify-end">
            <Button type="button" size="sm" onClick={openCreate}>
              <Plus className="mr-1 h-3.5 w-3.5" />
              New profile
            </Button>
          </div>

          {profiles.length === 0 && (
            <p className="text-sm text-muted-foreground">No {PROFILE_TYPES.noticePeriod.label} profiles defined.</p>
          )}

          {profiles.length > 0 && (
            <div className="flex items-center px-3 gap-2">
              <span className="w-4 shrink-0" />
              <span className="text-xs text-muted-foreground font-medium flex-1">Name</span>
              <span className="text-xs text-muted-foreground font-medium w-28 text-center">Holiday Lengths</span>
              <span className="text-xs text-muted-foreground font-medium w-24 text-center">Block?</span>
              <span className="text-xs text-muted-foreground font-medium w-20 text-center">{membersPluralCap}</span>
              <span className="w-7" />
              <span className="w-7" />
            </div>
          )}

          {profiles.map((p, idx) => {
            const drag = rowProps(idx);
            return (
              <div
                key={p.id}
                {...drag}
                className={cn(
                  "flex items-center rounded-md border px-3 py-1.5 gap-2 cursor-pointer hover:bg-muted/50 transition-colors",
                  rowClassExtra(idx),
                )}
                onClick={() => openEdit(p)}
              >
                {p.isDefault ? (
                  // Default is pinned at top — no grip, but reserve space so
                  // the columns line up with non-default rows.
                  <span className="w-4 shrink-0" />
                ) : (
                  <GripVertical
                    className="h-4 w-4 shrink-0 text-muted-foreground cursor-grab active:cursor-grabbing"
                    onClick={(e) => e.stopPropagation()}
                  />
                )}
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <span className="text-sm font-semibold truncate">{p.name}</span>
                  {p.isDefault && (
                    <span className="rounded bg-muted px-1.5 py-0.5 text-xs font-normal text-muted-foreground shrink-0">
                      Default
                    </span>
                  )}
                </div>
                <span className="text-sm w-28 text-center tabular-nums">{p.rules.length}</span>
                <span className="text-xs w-24 text-center text-muted-foreground">
                  {p.blockRequests ? "Hard block" : "Warn only"}
                </span>
                <span className="text-sm w-20 text-center tabular-nums">{p.memberCount}</span>
                <div className="w-7 flex justify-center" onClick={(e) => e.stopPropagation()}>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    title="Copy as new"
                    onClick={() => openCopy(p)}
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <div className="w-7 flex justify-center" onClick={(e) => e.stopPropagation()}>
                  {!p.isDefault && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
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
            );
          })}
        </CardContent>
      </Card>

      <ProfileEditorDialog
        open={editorOpen}
        onOpenChange={setEditorOpen}
        editing={editing}
        template={copyFrom}
        onSaved={(saved) => {
          setProfiles((prev) => {
            const exists = prev.some((p) => p.id === saved.id);
            return exists
              ? prev.map((p) => (p.id === saved.id ? saved : p))
              : [...prev, saved];
          });
          setEditorOpen(false);
          setCopyFrom(null);
          router.refresh();
        }}
      />

      <AlertDialog
        open={!!deleting}
        onOpenChange={(open) => {
          if (!open) {
            setDeleting(null);
            setDeleteError(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {PROFILE_TYPES.noticePeriod.label} profile</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteError ? (
                <span className="text-destructive">{deleteError}</span>
              ) : (
                <>
                  Delete <strong>{deleting?.name}</strong>?
                  {(deleting?.memberCount ?? 0) > 0 && (
                    <>
                      {" "}
                      {deleting?.memberCount} {membersPluralCap.toLowerCase()} currently on this profile will be re-assigned to the Default.
                    </>
                  )}
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteLoading}>Cancel</AlertDialogCancel>
            {!deleteError && (
              <AlertDialogAction
                disabled={deleteLoading}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={(e) => {
                  e.preventDefault();
                  handleDelete();
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
// Editor dialog
// ---------------------------------------------------------------------------

interface ProfileEditorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: NoticePeriodProfile | null;
  /** When set, the editor opens in "create from template" mode: rules +
   *  block flag pre-populated from the source, name suffixed with " (Copy)",
   *  save creates a brand-new (non-default) profile. */
  template?: NoticePeriodProfile | null;
  onSaved: (profile: NoticePeriodProfile) => void;
}

function ProfileEditorDialog({
  open,
  onOpenChange,
  editing,
  template,
  onSaved,
}: ProfileEditorDialogProps) {
  const { memberLabel } = useMemberLabel();
  const membersPlural = pluralize(memberLabel);
  const [name, setName] = useState("");
  const [draft, setDraft] = useState<DraftRule[]>([]);
  const [block, setBlock] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [breachWarning, setBreachWarning] = useState<string | null>(null);
  // Dirty-check snapshot.
  const [initialSnapshot, setInitialSnapshot] = useState<string>("");

  useEffect(() => {
    if (!open) return;
    let seedName: string;
    let seedRules: DraftRule[];
    let seedBlock: boolean;
    if (editing) {
      seedName = editing.name;
      seedRules = editing.rules.map((r) => ({
        id: r.id,
        min_booking_days: r.min_booking_days,
        notice_days: r.notice_days,
      }));
      seedBlock = editing.blockRequests;
    } else if (template) {
      seedName = `${template.name} (Copy)`;
      // Drop original rule ids — the copy's rules are brand-new rows.
      seedRules = template.rules.map((r) => ({
        min_booking_days: r.min_booking_days,
        notice_days: r.notice_days,
      }));
      seedBlock = template.blockRequests;
    } else {
      seedName = "";
      seedRules = [];
      seedBlock = false;
    }
    setName(seedName);
    setDraft(seedRules);
    setBlock(seedBlock);
    setInitialSnapshot(
      JSON.stringify({ name: seedName, rules: seedRules, block: seedBlock }),
    );
    setError(null);
    setBreachWarning(null);
  }, [open, editing, template]);

  const dirty =
    JSON.stringify({ name, rules: draft, block }) !== initialSnapshot;

  async function handleSave() {
    setSaving(true);
    setError(null);
    setBreachWarning(null);

    const trimmed = name.trim();
    if (!trimmed) {
      setSaving(false);
      setError("Name is required");
      return;
    }

    // Save (or create) the profile carrier first, then sync rules.
    let profileId = editing?.id;
    if (!profileId) {
      const createRes = await createNoticePeriodProfile(trimmed);
      if (!createRes.success || !createRes.profileId) {
        setSaving(false);
        setError(createRes.error ?? "Failed to create profile");
        return;
      }
      profileId = createRes.profileId;
    } else {
      // Update name + block flag on the existing profile.
      const patch: { name?: string; blockRequests?: boolean } = {};
      if (trimmed !== editing!.name) patch.name = trimmed;
      if (block !== editing!.blockRequests) patch.blockRequests = block;
      if (Object.keys(patch).length > 0) {
        const updRes = await updateNoticePeriodProfile(profileId, patch);
        if (!updRes.success) {
          setSaving(false);
          setError(updRes.error ?? "Failed to save");
          return;
        }
      }
    }

    // Always also push block flag for newly-created profiles.
    if (!editing) {
      const updRes = await updateNoticePeriodProfile(profileId, { blockRequests: block });
      if (!updRes.success) {
        setSaving(false);
        setError(updRes.error ?? "Failed to save block flag");
        return;
      }
    }

    // Sync rules
    const rulesRes = await saveNoticePeriodRulesForProfile(profileId, draft);
    if (!rulesRes.success) {
      setSaving(false);
      setError(rulesRes.error ?? "Failed to save rules");
      return;
    }

    // Optional breach check — only meaningful when rules exist
    let breachMsg: string | null = null;
    if (draft.length > 0) {
      try {
        const breachRes = await checkBookingsInBreachForProfile(profileId);
        if (breachRes.success && (breachRes.breachedCount ?? 0) > 0) {
          breachMsg = `Saved. ${breachRes.breachedCount} existing booking${
            breachRes.breachedCount === 1 ? "" : "s"
          } on this profile would breach the new rules.`;
        }
      } catch {
        /* non-fatal */
      }
    }

    // Re-fetch the profile so member counts + ids land correctly
    const refresh = await getNoticePeriodProfiles();
    setSaving(false);
    setBreachWarning(breachMsg);
    const saved = (refresh.success ? refresh.profiles ?? [] : []).find((p) => p.id === profileId);
    if (!saved) {
      setError("Saved, but failed to reload");
      return;
    }
    onSaved(saved);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {editing
              ? `Edit ${PROFILE_TYPES.noticePeriod.label} profile`
              : `New ${PROFILE_TYPES.noticePeriod.label} profile`}
          </DialogTitle>
          <DialogDescription>
            Bookings of at least the listed length need at least the corresponding number of days&apos; notice.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 overflow-y-auto max-h-[60vh] px-1">
          {error && (
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div>
          )}
          {breachWarning && (
            <div className="rounded-md border border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30 p-3 text-sm text-amber-900 dark:text-amber-200">
              {breachWarning}
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="np-name">Name</Label>
            <Input
              id="np-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Default, Senior staff"
              maxLength={50}
              autoFocus
              disabled={editing?.isDefault}
              className="font-semibold"
            />
            {editing?.isDefault && (
              <p className="text-xs text-muted-foreground">
                The Default profile&apos;s name can&apos;t be changed.
              </p>
            )}
          </div>

          <div className="space-y-3">
            {draft.length > 0 && (
              <div className="flex items-center gap-2">
                <Label className="text-xs text-muted-foreground w-24">Booking length (days+)</Label>
                <Label className="text-xs text-muted-foreground w-24">Notice (days)</Label>
              </div>
            )}
            {draft.map((rule, i) => (
              <div key={rule.id ?? `new-${i}`} className="flex items-center gap-2">
                <Input
                  type="number"
                  min={1}
                  className="w-24 h-8 text-sm"
                  value={rule.min_booking_days}
                  onChange={(e) => {
                    const val = parseInt(e.target.value, 10);
                    if (isNaN(val)) return;
                    setDraft((prev) => prev.map((r, j) => (j === i ? { ...r, min_booking_days: val } : r)));
                  }}
                />
                <Input
                  type="number"
                  min={1}
                  className="w-24 h-8 text-sm"
                  value={rule.notice_days}
                  onChange={(e) => {
                    const val = parseInt(e.target.value, 10);
                    if (isNaN(val)) return;
                    setDraft((prev) => prev.map((r, j) => (j === i ? { ...r, notice_days: val } : r)));
                  }}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0"
                  onClick={() => setDraft((prev) => prev.filter((_, j) => j !== i))}
                >
                  <Trash2 className="h-3.5 w-3.5 text-destructive" />
                </Button>
              </div>
            ))}

            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setDraft((prev) => [...prev, { min_booking_days: 1, notice_days: 7 }])}
            >
              <Plus className="h-3.5 w-3.5 mr-1.5" />
              Add Holiday Length
            </Button>
          </div>

          <div className="flex items-start justify-between gap-3 rounded-md border bg-muted/30 p-3">
            <div>
              <Label className="text-sm font-medium">Block requests that breach the rules</Label>
              <p className="text-xs text-muted-foreground mt-1">
                When on, {membersPlural} on this profile can&apos;t submit a request that breaks a notice rule. When off they see a warning and can still submit.
              </p>
            </div>
            <Switch checked={block} onCheckedChange={setBlock} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={saving || !name.trim() || (editing !== null && !dirty)}
          >
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {editing ? "Save changes" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
