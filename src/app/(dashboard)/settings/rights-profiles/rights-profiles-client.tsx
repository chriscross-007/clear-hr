"use client";

// CLE-197 — Rights Profiles v2 list + editor. Grouped-by-rank blocks
// with per-row Edit / Copy / Delete. Editor is a Dialog matching the
// mockup: identity + grouped switches + 10×2 tab matrix + impact
// preview. Every save round-trips through the server actions; reads
// go live via the resolver so changes take effect immediately.

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Copy, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  createRightsProfile,
  updateRightsProfile,
  deleteRightsProfile,
  copyRightsProfile,
  getBlankProfilePayload,
  type RightsProfileDto,
  type RightsProfileWritePayload,
} from "./actions";
// CLE-197 — Import the shared runtime + types from `rights-types.ts`
// rather than `rights-resolver.ts`; the resolver pulls in server-only
// modules (next/headers, service-role client) that Turbopack won't
// tolerate in a "use client" bundle.
import { TAB_KEYS, type Rank, type TabKey, type CrossUserAccess, type TabAccess } from "@/lib/rights-types";
import { cn } from "@/lib/utils";

const RANKS = ["admin", "hr", "manager", "employee"] as const satisfies readonly Rank[];

const RANK_LABEL: Record<Rank, string> = {
  admin: "Admin",
  hr: "HR",
  manager: "Manager",
  employee: "Employee",
};

const TAB_LABEL: Record<TabKey, string> = {
  planner: "Planner",
  timesheet: "Timesheet",
  dashboard: "Dashboard",
  holiday: "Holiday",
  employment: "Employment",
  personal: "Personal",
  contacts: "Contacts",
  documents: "Documents",
  expenses: "Expenses",
  history: "History",
};

const ACCESS_LABEL: Record<CrossUserAccess, string> = {
  self: "Self only",
  team: "My team",
  all: "Everyone",
};

// Grouped switch definitions. Each field key maps to a payload key so
// the toggle drives the corresponding write.
type PayloadFlagKey =
  | "canCreateUsers" | "canInviteUsers" | "canDeleteUsers"
  | "canApproveHolidays" | "canOverrideHolidayRules"
  | "canRunReports" | "canRunAdminReports"
  | "canManageTeams" | "canEditOrgSettings" | "canEditRightsProfiles"
  | "canManageBilling" | "canViewAuditLogs"
  | "canViewSensitiveFields" | "canEditSensitiveFields";

interface SwitchDef { key: PayloadFlagKey; label: string }

const GROUPS: { name: string; items: SwitchDef[] }[] = [
  {
    name: "User management",
    items: [
      { key: "canCreateUsers", label: "Create users" },
      { key: "canInviteUsers", label: "Invite users" },
      { key: "canDeleteUsers", label: "Delete users" },
    ],
  },
  {
    name: "Holiday",
    items: [
      { key: "canApproveHolidays", label: "Approve holidays" },
      { key: "canOverrideHolidayRules", label: "Override notice/cover rules" },
    ],
  },
  {
    name: "Reports",
    items: [
      { key: "canRunReports", label: "Run standard reports" },
      { key: "canRunAdminReports", label: "Run Admin-only reports" },
    ],
  },
  {
    name: "Governance",
    items: [
      { key: "canManageTeams", label: "Manage teams" },
      { key: "canEditOrgSettings", label: "Edit organisation settings" },
      { key: "canEditRightsProfiles", label: "Edit User Rights" },
      { key: "canManageBilling", label: "Manage billing" },
      { key: "canViewAuditLogs", label: "View audit logs" },
    ],
  },
  {
    name: "Sensitive data",
    items: [
      { key: "canViewSensitiveFields", label: "View sensitive fields" },
      { key: "canEditSensitiveFields", label: "Edit sensitive fields" },
    ],
  },
];

// Convert a full DTO into the write payload shape (drops id/memberCount).
function dtoToPayload(dto: RightsProfileDto): RightsProfileWritePayload {
  return {
    name: dto.name,
    rank: dto.rank,
    isDefault: dto.isDefault,
    crossUserAccess: dto.crossUserAccess,
    canCreateUsers: dto.canCreateUsers,
    canInviteUsers: dto.canInviteUsers,
    canDeleteUsers: dto.canDeleteUsers,
    canApproveHolidays: dto.canApproveHolidays,
    canOverrideHolidayRules: dto.canOverrideHolidayRules,
    canRunReports: dto.canRunReports,
    canRunAdminReports: dto.canRunAdminReports,
    canManageTeams: dto.canManageTeams,
    canEditOrgSettings: dto.canEditOrgSettings,
    canEditRightsProfiles: dto.canEditRightsProfiles,
    canManageBilling: dto.canManageBilling,
    canViewAuditLogs: dto.canViewAuditLogs,
    canViewSensitiveFields: dto.canViewSensitiveFields,
    canEditSensitiveFields: dto.canEditSensitiveFields,
    tabs: dto.tabs,
  };
}

// Count granted / revoked flags between two payloads. Used by the
// impact preview when saving an edit.
function diffPayloads(
  before: RightsProfileWritePayload,
  after: RightsProfileWritePayload
): { granted: number; revoked: number } {
  let granted = 0;
  let revoked = 0;
  for (const g of GROUPS) {
    for (const item of g.items) {
      if (before[item.key] !== after[item.key]) {
        if (after[item.key]) granted++;
        else revoked++;
      }
    }
  }
  for (const t of TAB_KEYS) {
    (["view", "update"] as const).forEach((mode) => {
      if (before.tabs[t]?.[mode] !== after.tabs[t]?.[mode]) {
        if (after.tabs[t]?.[mode]) granted++;
        else revoked++;
      }
    });
  }
  if (before.crossUserAccess !== after.crossUserAccess) granted++; // treat as one change
  return { granted, revoked };
}

interface Props {
  initialProfiles: RightsProfileDto[];
}

export function RightsProfilesClient({ initialProfiles }: Props) {
  const [profiles, setProfiles] = useState(initialProfiles);
  const [editing, setEditing] = useState<
    | { mode: "new"; payload: RightsProfileWritePayload }
    | { mode: "edit"; id: string; payload: RightsProfileWritePayload; original: RightsProfileDto }
    | null
  >(null);
  const [deleteTarget, setDeleteTarget] = useState<RightsProfileDto | null>(null);
  const [pending, startTransition] = useTransition();
  const [rowError, setRowError] = useState<string | null>(null);
  const router = useRouter();

  const grouped = useMemo(() => {
    const out: Record<Rank, RightsProfileDto[]> = { admin: [], hr: [], manager: [], employee: [] };
    for (const p of profiles) out[p.rank].push(p);
    return out;
  }, [profiles]);

  async function refresh() {
    router.refresh();
  }

  async function handleNew(rank: Rank) {
    const payload = await getBlankProfilePayload(rank);
    setEditing({ mode: "new", payload });
  }

  function handleEdit(p: RightsProfileDto) {
    setEditing({ mode: "edit", id: p.id, payload: dtoToPayload(p), original: p });
  }

  async function handleCopy(p: RightsProfileDto) {
    setRowError(null);
    startTransition(async () => {
      const r = await copyRightsProfile(p.id);
      if (!r.success) setRowError(r.error ?? "Copy failed");
      else refresh();
    });
  }

  async function handleDeleteConfirmed() {
    if (!deleteTarget) return;
    setRowError(null);
    startTransition(async () => {
      const r = await deleteRightsProfile(deleteTarget.id);
      if (!r.success) setRowError(r.error ?? "Delete failed");
      else {
        setProfiles((prev) => prev.filter((p) => p.id !== deleteTarget.id));
        setDeleteTarget(null);
        refresh();
      }
    });
  }

  async function handleSave() {
    if (!editing) return;
    setRowError(null);
    startTransition(async () => {
      const r =
        editing.mode === "new"
          ? await createRightsProfile(editing.payload)
          : await updateRightsProfile(editing.id, editing.payload);
      if (!r.success) setRowError(r.error ?? "Save failed");
      else {
        setEditing(null);
        refresh();
      }
    });
  }

  return (
    <>
      {rowError && (
        <div className="rounded-md border border-destructive bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {rowError}
        </div>
      )}

      {RANKS.map((rank) => {
        const rows = grouped[rank];
        return (
          <section key={rank} className="space-y-3">
            <div className="flex items-baseline justify-between border-b pb-2">
              <h2 className="text-lg font-semibold">{RANK_LABEL[rank]}</h2>
              <Button variant="outline" size="sm" onClick={() => handleNew(rank)}>
                <Plus className="h-4 w-4 mr-1" />
                New profile
              </Button>
            </div>
            {rows.length === 0 ? (
              <p className="py-2 text-sm text-muted-foreground">
                No profiles at this rank yet.
              </p>
            ) : (
              <ul className="divide-y rounded-md border">
                {rows.map((p) => (
                  <ProfileRow
                    key={p.id}
                    profile={p}
                    onEdit={() => handleEdit(p)}
                    onCopy={() => handleCopy(p)}
                    onDelete={() => setDeleteTarget(p)}
                    disabled={pending}
                  />
                ))}
              </ul>
            )}
          </section>
        );
      })}

      {editing && (
        <EditorDialog
          state={editing}
          onChange={(payload) =>
            setEditing((prev) => (prev ? { ...prev, payload } : prev))
          }
          onSave={handleSave}
          onCancel={() => setEditing(null)}
          saving={pending}
        />
      )}

      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this profile?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget?.memberCount ?? 0} member
              {(deleteTarget?.memberCount ?? 0) === 1 ? "" : "s"} currently assigned.
              You&apos;ll need to reassign them before this can be deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteConfirmed} disabled={pending}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// ---------------------------------------------------------------------------
// Row
// ---------------------------------------------------------------------------

function ProfileRow({
  profile,
  onEdit,
  onCopy,
  onDelete,
  disabled,
}: {
  profile: RightsProfileDto;
  onEdit: () => void;
  onCopy: () => void;
  onDelete: () => void;
  disabled: boolean;
}) {
  const cannotDelete = profile.isDefault || profile.memberCount > 0;
  const deleteReason = profile.isDefault
    ? "Default profiles can't be deleted"
    : profile.memberCount > 0
      ? `${profile.memberCount} member${profile.memberCount === 1 ? "" : "s"} assigned`
      : undefined;

  return (
    <li
      className="flex items-center justify-between gap-3 px-4 py-3 cursor-pointer hover:bg-muted/50"
      onClick={onEdit}
    >
      <div className="flex items-center gap-2 min-w-0">
        <span className="font-medium truncate">{profile.name}</span>
        {profile.isDefault && (
          <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
            Default
          </span>
        )}
      </div>
      <div className="flex items-center gap-3">
        <span className="text-xs text-muted-foreground whitespace-nowrap">
          {profile.memberCount} member{profile.memberCount === 1 ? "" : "s"}
        </span>
        <Button
          variant="ghost"
          size="sm"
          onClick={(e) => {
            e.stopPropagation();
            onCopy();
          }}
          disabled={disabled}
          aria-label="Copy profile"
        >
          <Copy className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          disabled={disabled || cannotDelete}
          title={deleteReason}
          aria-label="Delete profile"
        >
          <Trash2 className={cn("h-4 w-4", cannotDelete && "opacity-40")} />
        </Button>
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Editor dialog
// ---------------------------------------------------------------------------

function EditorDialog({
  state,
  onChange,
  onSave,
  onCancel,
  saving,
}: {
  state:
    | { mode: "new"; payload: RightsProfileWritePayload }
    | { mode: "edit"; id: string; payload: RightsProfileWritePayload; original: RightsProfileDto };
  onChange: (payload: RightsProfileWritePayload) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const { payload } = state;
  const isEdit = state.mode === "edit";
  const memberCount = isEdit ? state.original.memberCount : 0;

  const diff = isEdit ? diffPayloads(dtoToPayload(state.original), payload) : { granted: 0, revoked: 0 };
  const hasImpact = isEdit && memberCount > 0 && (diff.granted + diff.revoked) > 0;

  function update<K extends keyof RightsProfileWritePayload>(k: K, v: RightsProfileWritePayload[K]) {
    onChange({ ...payload, [k]: v });
  }
  function updateTab(t: TabKey, patch: Partial<TabAccess>) {
    onChange({
      ...payload,
      tabs: { ...payload.tabs, [t]: { ...payload.tabs[t], ...patch } },
    });
  }
  function toggleColumnAll(field: keyof TabAccess) {
    const allOn = TAB_KEYS.every((k) => payload.tabs[k][field]);
    const next = { ...payload.tabs };
    for (const k of TAB_KEYS) next[k] = { ...next[k], [field]: !allOn };
    onChange({ ...payload, tabs: next });
  }
  const allView = TAB_KEYS.every((k) => payload.tabs[k].view);
  const allUpdate = TAB_KEYS.every((k) => payload.tabs[k].update);

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onCancel(); }}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit User Rights profile" : "New User Rights profile"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? `${memberCount} member${memberCount === 1 ? "" : "s"} currently assigned. Changes apply live.`
              : "Choose a rank and matrix — new profile becomes selectable after Save."}
          </DialogDescription>
        </DialogHeader>

        <div className="overflow-y-auto max-h-[65vh] px-1 space-y-6">
          {/* Identity */}
          <div className="grid grid-cols-[120px_1fr] gap-x-4 gap-y-3 items-center text-sm">
            <Label htmlFor="rp-name" className="text-muted-foreground">Name</Label>
            <Input
              id="rp-name"
              value={payload.name}
              onChange={(e) => update("name", e.target.value)}
              placeholder="e.g. HR Admin"
            />

            <Label className="text-muted-foreground">Rank</Label>
            <Select
              value={payload.rank}
              onValueChange={(v) => update("rank", v as Rank)}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {RANKS.map((r) => (
                  <SelectItem key={r} value={r}>{RANK_LABEL[r]}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Label className="text-muted-foreground">Access</Label>
            <RadioGroup
              value={payload.crossUserAccess}
              onValueChange={(v) => update("crossUserAccess", v as CrossUserAccess)}
              className="flex gap-4"
            >
              {(["self", "team", "all"] as const).map((k) => (
                <label key={k} className="flex items-center gap-2 text-sm">
                  <RadioGroupItem value={k} id={`access-${k}`} />
                  {ACCESS_LABEL[k]}
                </label>
              ))}
            </RadioGroup>
          </div>

          <hr />

          {/* Two-column body: switches on left, tab matrix on right */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Switches */}
            <div className="space-y-5">
              {GROUPS.map((g) => (
                <div key={g.name}>
                  <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2">
                    {g.name}
                  </div>
                  <div className="space-y-2">
                    {g.items.map((it) => (
                      <label key={it.key} className="flex items-center gap-3 text-sm">
                        <Switch
                          checked={payload[it.key] as boolean}
                          onCheckedChange={(v) => update(it.key, v)}
                        />
                        {it.label}
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {/* Tab matrix */}
            <div>
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2">
                Employee tabs
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2 font-medium text-xs text-muted-foreground">Tab</th>
                    <th className="text-center py-2 font-medium text-xs text-muted-foreground w-16">View</th>
                    <th className="text-center py-2 font-medium text-xs text-muted-foreground w-16">Update</th>
                  </tr>
                </thead>
                <tbody>
                  {TAB_KEYS.map((t) => (
                    <tr key={t}>
                      <td className="py-1.5">{TAB_LABEL[t]}</td>
                      <td className="text-center">
                        <Checkbox
                          checked={payload.tabs[t].view}
                          onCheckedChange={(v) => updateTab(t, { view: v === true })}
                        />
                      </td>
                      <td className="text-center">
                        <Checkbox
                          checked={payload.tabs[t].update}
                          onCheckedChange={(v) => updateTab(t, { update: v === true })}
                        />
                      </td>
                    </tr>
                  ))}
                  <tr className="border-t bg-muted/40">
                    <td className="py-1.5 text-xs font-medium text-muted-foreground">All</td>
                    <td className="text-center">
                      <Checkbox
                        checked={allView}
                        onCheckedChange={() => toggleColumnAll("view")}
                        aria-label="Toggle View for all tabs"
                      />
                    </td>
                    <td className="text-center">
                      <Checkbox
                        checked={allUpdate}
                        onCheckedChange={() => toggleColumnAll("update")}
                        aria-label="Toggle Update for all tabs"
                      />
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {hasImpact && (
            <div
              className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm dark:bg-amber-950/30 dark:border-amber-800"
            >
              <div className="font-medium text-amber-800 dark:text-amber-200">
                Impact on save
              </div>
              <div className="text-amber-700 dark:text-amber-300 mt-0.5 text-xs">
                {memberCount} member{memberCount === 1 ? "" : "s"} will pick up the change immediately.
                {diff.granted > 0 && <> {diff.granted} right{diff.granted === 1 ? "" : "s"} granted.</>}
                {diff.revoked > 0 && <> {diff.revoked} right{diff.revoked === 1 ? "" : "s"} revoked.</>}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={saving}>Cancel</Button>
          <Button onClick={onSave} disabled={saving || !payload.name.trim()}>
            {saving ? "Saving…" : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
