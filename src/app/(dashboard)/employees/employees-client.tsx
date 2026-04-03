"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { type ColPref } from "@/lib/grid-prefs-actions";
import { type ColumnDef } from "@tanstack/react-table";
import { DataGrid } from "@/components/data-grid/data-grid";
import {
  buildEmployeeColumns,
  type Member,
  type Team,
  ALL_EMPLOYEE_COLS,
  DEFAULT_EMPLOYEE_COLS,
  EMPLOYEE_COL_LABELS,
  DATE_PRESET_LABELS,
} from "./employee-columns";
import Link from "next/link";
import { Plus, List, LayoutGrid, Pencil } from "lucide-react";
import { useMemberLabel } from "@/contexts/member-label-context";
import { capitalize, pluralize } from "@/lib/label-utils";
import { deleteEmployee, type BulkUpdatePayload } from "./actions";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EditEmployeeDialog } from "./edit-employee-dialog";
import { BulkEditSheet } from "./bulk-edit-sheet";
import { AddEmployeeDialog } from "./add-employee-dialog";
import type { Profile } from "./profile-actions";
import type { FieldDef } from "./custom-field-actions";
import { cn } from "@/lib/utils";

export type { Team, Member };

interface EmployeesClientProps {
  initialMembers: Member[];
  canEdit: boolean;
  canAdd: boolean;
  maxEmployees: number;
  isOwner: boolean;
  orgName: string;
  teams: Team[];
  adminProfiles: Profile[];
  employeeProfiles: Profile[];
  initialMemberId?: string;
  initialColumnPrefs: ColPref[];
  initialGroupBy?: string;
  initialPdfPageBreak?: boolean;
  initialPdfRepeatHeaders?: boolean;
  initialAggregateMetrics?: string[];
  customFieldDefs: FieldDef[];
  currencySymbol: string;
  canSeeCurrency: boolean;
  userId: string;
}

export function EmployeesClient({
  initialMembers,
  canEdit,
  canAdd,
  maxEmployees,
  isOwner,
  orgName,
  teams,
  adminProfiles,
  employeeProfiles,
  initialMemberId,
  initialColumnPrefs,
  initialGroupBy,
  initialPdfPageBreak,
  initialPdfRepeatHeaders,
  initialAggregateMetrics,
  customFieldDefs,
  currencySymbol,
  userId,
}: EmployeesClientProps) {
  const { memberLabel } = useMemberLabel();
  const router = useRouter();

  const [members, setMembers] = useState(initialMembers);
  const [editingMember, setEditingMember] = useState<Member | null>(null);
  const [deletingMember, setDeletingMember] = useState<Member | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showCapacityDialog, setShowCapacityDialog] = useState(false);
  const [view, setView] = useState<"list" | "card">("list");
  const [bulkEditOpen, setBulkEditOpen] = useState(false);
  const [cardRows, setCardRows] = useState<Member[]>(initialMembers);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const handleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleSelectAll = (visibleIds: string[]) => {
    setSelectedIds(new Set(visibleIds));
  };

  const handleDeselectAll = () => {
    setSelectedIds(new Set());
  };

  useEffect(() => {
    const saved = localStorage.getItem(`employee-directory-view-${userId}`) as "list" | "card" | null;
    if (saved === "card") setView("card");
  }, [userId]);

  useEffect(() => {
    localStorage.setItem(`employee-directory-view-${userId}`, view);
  }, [view, userId]);

  useEffect(() => {
    if (initialMemberId) {
      const member = initialMembers.find((m) => m.member_id === initialMemberId);
      if (member) setEditingMember(member);
    }
  }, [initialMemberId, initialMembers]);

  const atCapacity = members.length >= maxEmployees;

  const customFieldColIds = customFieldDefs.map((d) => `cf_${d.field_key}`);
  const allColIds = [...ALL_EMPLOYEE_COLS, ...customFieldColIds];
  const allColLabels: Record<string, string> = {
    ...EMPLOYEE_COL_LABELS,
    ...Object.fromEntries(customFieldDefs.map((d) => [`cf_${d.field_key}`, d.label])),
  };

  const baseColumns = buildEmployeeColumns({
    teams,
    adminProfiles,
    employeeProfiles,
    memberLabel,
    canAdd,
    currencySymbol,
    customFieldDefs,
    onDelete: (member) => setDeletingMember(member),
  });

  const selectColumn: ColumnDef<Member> = useMemo(() => ({
    id: "select",
    size: 40,
    enableSorting: false,
    enableColumnFilter: false,
    header: ({ table }) => {
      const pageIds = table.getRowModel().rows.map(r => r.original.member_id);
      const allSelected = pageIds.length > 0 && pageIds.every(id => selectedIds.has(id));
      const someSelected = pageIds.some(id => selectedIds.has(id));
      return (
        <Checkbox
          checked={allSelected ? true : someSelected ? "indeterminate" : false}
          onCheckedChange={(value) => {
            if (value) {
              handleSelectAll(pageIds);
            } else {
              handleDeselectAll();
            }
          }}
          onClick={(e) => e.stopPropagation()}
          aria-label="Select all"
        />
      );
    },
    cell: ({ row }) => (
      <Checkbox
        checked={selectedIds.has(row.original.member_id)}
        onCheckedChange={() => handleSelect(row.original.member_id)}
        onClick={(e) => e.stopPropagation()}
        aria-label="Select row"
      />
    ),
    meta: {
      headerClassName: "w-10",
      cellClassName: "w-10",
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [selectedIds]);

  const columns = [selectColumn, ...baseColumns];

  async function handleExportPdf(
    rows: Member[],
    prefs: ColPref[],
    colLabels: Record<string, string>,
    orientation: "portrait" | "landscape",
    groupBy?: string,
    pdfPageBreak?: boolean,
    pdfRepeatHeaders?: boolean,
    aggregateMetrics?: string[]
  ) {
    try {
      const [{ pdf }, { EmployeePDF }] = await Promise.all([
        import("@react-pdf/renderer"),
        import("./employee-pdf"),
      ]);

      const formattedRows = rows.map((m) => ({
        first_name: m.first_name,
        last_name: m.last_name,
        email: m.email,
        role: m.role === "admin" ? "Admin" : m.role === "owner" ? "Owner" : capitalize(memberLabel),
        profile: m.profile_name ?? "—",
        team: m.team_id
          ? (Object.fromEntries(teams.map((t) => [t.id, t.name]))[m.team_id] ?? "—")
          : "—",
        payroll_number: m.payroll_number ?? "—",
        status: m.accepted_at ? "Active" : m.invited_at ? "Invited" : "Not invited",
        last_log_in: m.last_log_in
          ? new Date(m.last_log_in).toLocaleString("en-GB", {
              day: "numeric",
              month: "short",
              year: "numeric",
              hour: "2-digit",
              minute: "2-digit",
              hour12: false,
            })
          : "—",
        ...Object.fromEntries(
          customFieldDefs.flatMap((def) => {
            const val = m.custom_fields?.[def.field_key];
            let display: string;
            if (def.field_type === "checkbox") display = val === true ? "Yes" : val === false ? "No" : "—";
            else if (def.field_type === "date" && val) {
              try { display = new Date(String(val)).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }); } catch { display = String(val); }
            } else if (val === undefined || val === null || val === "") {
              display = "—";
            } else if (def.field_type === "currency") {
              const num = Number(val);
              display = isNaN(num) ? String(val) : `${currencySymbol}${num.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
            } else if (def.field_type === "number") {
              const num = Number(val);
              if (isNaN(num)) display = String(val);
              else if (def.max_decimal_places === 0) display = String(Math.round(num));
              else if (def.max_decimal_places !== null && def.max_decimal_places !== undefined) display = num.toFixed(def.max_decimal_places);
              else display = String(val);
            } else {
              display = String(val);
            }
            const pairs: [string, string][] = [[`cf_${def.field_key}`, display]];
            if (def.field_type === "currency" || def.field_type === "number") {
              const num = Number(val);
              pairs.push([`_raw_cf_${def.field_key}`, val !== null && val !== undefined && val !== "" && !isNaN(num) ? String(num) : ""]);
            }
            return pairs;
          })
        ),
      } as Record<string, string>));

      const sortedRows = groupBy
        ? [...formattedRows].sort((a, b) => (a[groupBy] ?? "").localeCompare(b[groupBy] ?? ""))
        : formattedRows;

      const pdfColumns = prefs
        .filter((c) => c.visible && c.id !== "avatar")
        .map((c) => {
          const def = c.id.startsWith("cf_") ? customFieldDefs.find((d) => `cf_${d.field_key}` === c.id) : null;
          return {
            id: c.id,
            label: colLabels[c.id] ?? c.id,
            ...(def && (def.field_type === "number" || def.field_type === "currency") ? {
              aggregateFormat: def.field_type as "currency" | "number",
              aggregateCurrencySymbol: def.field_type === "currency" ? currencySymbol : undefined,
              aggregateDecimals: def.field_type === "number" ? def.max_decimal_places : 2,
            } : {}),
          };
        });

      const title = `${capitalize(pluralize(memberLabel))} Directory`;
      const blob = await pdf(
        <EmployeePDF
          rows={sortedRows}
          columns={pdfColumns}
          orgName={orgName}
          title={title}
          orientation={orientation}
          groupBy={groupBy}
          groupByLabel={groupBy ? (colLabels[groupBy] ?? groupBy) : undefined}
          pdfPageBreak={pdfPageBreak}
          pdfRepeatHeaders={pdfRepeatHeaders}
          aggregateMetrics={aggregateMetrics}
        />
      ).toBlob();

      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${title}.pdf`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("PDF generation failed:", err);
    }
  }

  // Toolbar slot: view toggle + add button + selection count
  const toolbar = (
    <div className="flex items-center gap-3">
      {selectedIds.size > 0 && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => setBulkEditOpen(true)}
        >
          <Pencil className="h-4 w-4 mr-2" />
          Bulk Edit ({selectedIds.size})
        </Button>
      )}
      <div className="flex overflow-hidden rounded-md border border-input text-sm">
        <button
          className={cn("flex items-center gap-1.5 px-3 py-1.5", view === "list" ? "bg-muted font-medium" : "hover:bg-muted/50")}
          onClick={() => setView("list")}
        >
          <List className="h-3.5 w-3.5" />
          List
        </button>
        <button
          className={cn("flex items-center gap-1.5 border-l border-input px-3 py-1.5", view === "card" ? "bg-muted font-medium" : "hover:bg-muted/50")}
          onClick={() => setView("card")}
        >
          <LayoutGrid className="h-3.5 w-3.5" />
          Card
        </button>
      </div>
      {canAdd && (
        <Button
          variant="outline"
          onClick={() => atCapacity ? setShowCapacityDialog(true) : setShowAddDialog(true)}
        >
          <Plus className="h-4 w-4 mr-2" />
          Add {capitalize(memberLabel)}
        </Button>
      )}
    </div>
  );

  // Resolve active filter label for PDF (passed to DATE_PRESET_LABELS)
  void DATE_PRESET_LABELS; // imported for re-export use in other files

  return (
    <div className="w-full px-4 py-8 sm:px-6 lg:px-8">
      <h1 className="text-2xl font-bold mb-6">
        {capitalize(pluralize(memberLabel))} Directory
      </h1>

      {/* DataGrid — always mounted so state (filters/sort) survives view toggle */}
      <div className={view !== "list" ? "hidden" : "flex justify-center w-full"}>
        <div className="w-full max-w-[90%] min-w-0">
        <DataGrid<Member>
          data={members}
          columns={columns}
          gridId="employees"
          allCols={allColIds}
          defaultCols={DEFAULT_EMPLOYEE_COLS}
          standardCols={ALL_EMPLOYEE_COLS}
          colLabels={allColLabels}
          initialColPrefs={initialColumnPrefs}
          initialGroupBy={initialGroupBy}
          initialPdfPageBreak={initialPdfPageBreak}
          initialPdfRepeatHeaders={initialPdfRepeatHeaders}
          initialAggregateMetrics={initialAggregateMetrics}
          userId={userId}
          toolbar={toolbar}
          onRowClick={canEdit ? (m) => setEditingMember(m) : undefined}
          emptyMessage={`No ${pluralize(memberLabel)} found.`}
          onExportPdf={handleExportPdf}
          onPageRowsChange={setCardRows}
          leadingColumnIds={["select"]}
        />
        </div>
      </div>

      {/* Card view */}
      {view === "card" && (
        <>
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Checkbox
                checked={
                  cardRows.length > 0 && cardRows.every(m => selectedIds.has(m.member_id))
                    ? true
                    : cardRows.some(m => selectedIds.has(m.member_id))
                    ? "indeterminate"
                    : false
                }
                onCheckedChange={(value) => {
                  if (value) {
                    handleSelectAll(cardRows.map(m => m.member_id));
                  } else {
                    handleDeselectAll();
                  }
                }}
                aria-label="Select all"
              />
              <span className="text-sm text-muted-foreground">Select all</span>
            </div>
            {toolbar}
          </div>
          <div className="mb-4">
            {cardRows.length ? (
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
                {cardRows.map((m) => {
                  const initials = [m.first_name, m.last_name]
                    .map((n) => n?.charAt(0).toUpperCase())
                    .join("");
                  return (
                    <div
                      key={m.member_id}
                      className={cn(
                        "relative flex flex-col items-center gap-3 rounded-lg border bg-card p-6 text-center cursor-pointer hover:bg-muted/50",
                        selectedIds.has(m.member_id) && "ring-2 ring-primary"
                      )}
                      onClick={() => router.push(`/employees/${m.member_id}/dashboard`)}
                    >
                      <div
                        className="absolute top-2 left-2 z-10"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Checkbox
                          checked={selectedIds.has(m.member_id)}
                          onCheckedChange={() => handleSelect(m.member_id)}
                          aria-label="Select member"
                        />
                      </div>
                      {m.avatar_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={m.avatar_url}
                          alt={`${m.first_name} ${m.last_name}`}
                          className="h-[7.5rem] w-[7.5rem] rounded-full object-cover"
                        />
                      ) : (
                        <div className="flex h-[7.5rem] w-[7.5rem] items-center justify-center rounded-full bg-muted">
                          <span className="text-3xl font-medium text-muted-foreground">{initials}</span>
                        </div>
                      )}
                      <div className="w-full">
                        <p className="font-semibold">{m.first_name} {m.last_name}</p>
                        <p className="truncate text-sm text-muted-foreground">{m.email}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="py-12 text-center text-muted-foreground">
                No {pluralize(memberLabel)} found.
              </p>
            )}
          </div>
        </>
      )}

      {/* Edit dialog */}
      <EditEmployeeDialog
        member={editingMember}
        open={!!editingMember}
        onOpenChange={(open) => !open && setEditingMember(null)}
        teams={teams}
        adminProfiles={adminProfiles}
        employeeProfiles={employeeProfiles}
        customFieldDefs={customFieldDefs}
        currencySymbol={currencySymbol}
        onSaved={(updated) => {
          setMembers((prev) =>
            prev.map((m) =>
              m.member_id === updated.member_id
                ? { ...m, first_name: updated.first_name, last_name: updated.last_name, role: updated.role, team_id: updated.team_id, payroll_number: updated.payroll_number, custom_fields: updated.custom_fields }
                : m
            )
          );
          setEditingMember(null);
          router.refresh();
        }}
        onAvatarChanged={(memberId, avatarUrl) => {
          setMembers((prev) =>
            prev.map((m) => m.member_id === memberId ? { ...m, avatar_url: avatarUrl } : m)
          );
          setEditingMember((prev) => prev && prev.member_id === memberId ? { ...prev, avatar_url: avatarUrl } : prev);
        }}
        onInviteStatusChanged={(memberId, invitedAt) => {
          setMembers((prev) =>
            prev.map((m) =>
              m.member_id === memberId ? { ...m, invited_at: invitedAt } : m
            )
          );
        }}
      />

      {/* Add dialog */}
      <AddEmployeeDialog
        open={showAddDialog}
        onOpenChange={setShowAddDialog}
        teams={teams}
        employeeProfiles={employeeProfiles}
        customFieldDefs={customFieldDefs}
        currencySymbol={currencySymbol}
        onAdded={(newMember) => {
          setMembers((prev) => [...prev, newMember]);
          setShowAddDialog(false);
          router.refresh();
        }}
      />

      {/* Capacity dialog */}
      <Dialog open={showCapacityDialog} onOpenChange={setShowCapacityDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{capitalize(memberLabel)} limit reached</DialogTitle>
            <DialogDescription>
              Please increase your {memberLabel} limit in Billing before adding more {pluralize(memberLabel)} to the directory.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            {isOwner ? (
              <Button asChild>
                <Link href="/billing">Go to Billing</Link>
              </Button>
            ) : (
              <Button variant="outline" onClick={() => setShowCapacityDialog(false)}>
                OK
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk edit sheet */}
      <BulkEditSheet
        open={bulkEditOpen}
        onOpenChange={setBulkEditOpen}
        selectedCount={selectedIds.size}
        selectedIds={selectedIds}
        teams={teams}
        memberLabel={memberLabel}
        customFieldDefs={customFieldDefs}
        currencySymbol={currencySymbol}
        onBulkUpdate={(updatedIds, updates) => {
          // Optimistic update — apply changes to local state immediately
          setMembers((prev) =>
            prev.map((member) => {
              if (!updatedIds.includes(member.member_id)) return member;
              const updated = { ...member };
              if (updates.team_id !== undefined) updated.team_id = updates.team_id;
              if (updates.role !== undefined) updated.role = updates.role;
              if (updates.custom_fields) {
                updated.custom_fields = {
                  ...member.custom_fields,
                  ...updates.custom_fields,
                };
              }
              return updated;
            })
          );
          // Background refresh to sync server state
          router.refresh();
        }}
      />

      {/* Delete confirmation */}
      <AlertDialog
        open={!!deletingMember}
        onOpenChange={(open) => !open && setDeletingMember(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {capitalize(memberLabel)}</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete{" "}
              <strong>
                {deletingMember?.first_name} {deletingMember?.last_name}
              </strong>
              ? This will permanently remove them from the organisation
              {deletingMember?.user_id ? " and delete their user account" : ""}. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteLoading}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleteLoading}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={async (e) => {
                e.preventDefault();
                if (!deletingMember) return;
                setDeleteLoading(true);
                const result = await deleteEmployee(deletingMember.member_id);
                setDeleteLoading(false);
                if (result.success) {
                  setMembers((prev) =>
                    prev.filter((m) => m.member_id !== deletingMember.member_id)
                  );
                  setDeletingMember(null);
                  router.refresh();
                }
              }}
            >
              {deleteLoading ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
