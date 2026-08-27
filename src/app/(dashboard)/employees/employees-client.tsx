"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { type ColPref, saveGridPrefs } from "@/lib/grid-prefs-actions";
import { formatOptionForDisplay } from "@/components/custom-field-multiselect";
import type { GridPrefs } from "@/lib/grid-prefs";
import { type ColumnDef, type Row } from "@tanstack/react-table";
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
import { deleteEmployee } from "./actions";
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
import { StickyPageHeader } from "@/components/ui/sticky-page-header";
import { AddEmployeeDialog } from "./add-employee-dialog";
import type { Profile } from "./profile-actions";
import type { FieldDef } from "./custom-field-actions";
import { formatMemberForPdf } from "@/lib/format-member-pdf-row";
import { cn } from "@/lib/utils";

export type { Team, Member };

interface EmployeesClientProps {
  initialMembers: Member[];
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
  initialFilters?: Record<string, unknown>;
  initialSorting?: { id: string; desc: boolean }[];
  customFieldDefs: FieldDef[];
  currencySymbol: string;
  canSeeCurrency: boolean;
  userId: string;
  /** CLE-186 — Annual Leave absence_type id for the org (or null if absent). */
  holidayAbsenceTypeId: string | null;
  /** CLE-186 — Holiday (Annual Leave) approval profiles for the Bulk Edit
   *  sheet's Approval Profile picker. */
  holidayApprovalProfiles: { id: string; name: string; isDefault: boolean }[];
}

export function EmployeesClient({
  initialMembers,
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
  initialFilters,
  initialSorting,
  customFieldDefs,
  currencySymbol,
  canSeeCurrency,
  userId,
  holidayAbsenceTypeId,
  holidayApprovalProfiles,
}: EmployeesClientProps) {
  const { memberLabel } = useMemberLabel();
  const router = useRouter();

  // Debounced auto-save of filters + sorting (column prefs are saved by the hook separately)
  const prefsSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handlePrefsChange = (snap: GridPrefs) => {
    if (prefsSaveTimer.current) clearTimeout(prefsSaveTimer.current);
    prefsSaveTimer.current = setTimeout(() => {
      saveGridPrefs("employees", snap);
    }, 800);
  };

  const initialFiltersArray = useMemo(
    () => initialFilters ? Object.entries(initialFilters).map(([id, value]) => ({ id, value })) : undefined,
    [initialFilters]
  );

  const [members, setMembers] = useState(initialMembers);
  const [editingMember, setEditingMember] = useState<Member | null>(null);
  const [deletingMember, setDeletingMember] = useState<Member | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showCapacityDialog, setShowCapacityDialog] = useState(false);
  const [view, setView] = useState<"list" | "card">("list");
  const [bulkEditOpen, setBulkEditOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const handleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleSelectAll = (visibleIds: string[]) => {
    setSelectedIds(new Set(visibleIds));
  };

  const handleDeselectAll = () => {
    setSelectedIds(new Set());
  };

  // Add or remove every supplied id from the current selection (additive).
  // Used by the group-header tri-state checkbox so toggling one group never
  // discards selections made in other groups.
  const handleSetSelected = (ids: string[], selected: boolean) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (selected) {
        for (const id of ids) next.add(id);
      } else {
        for (const id of ids) next.delete(id);
      }
      return next;
    });
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

  const holidayProfileNames = [...new Set(members.map((m) => m.holiday_profile_name).filter(Boolean))] as string[];
  const workPatternNames = [...new Set(members.map((m) => m.work_pattern_name).filter(Boolean))] as string[];
  const approvalProfileNames = [...new Set(members.map((m) => m.approval_profile_name).filter(Boolean))] as string[];

  const baseColumns = buildEmployeeColumns({
    teams,
    adminProfiles,
    employeeProfiles,
    memberLabel,
    canAdd,
    currencySymbol,
    customFieldDefs,
    holidayProfileNames,
    workPatternNames,
    approvalProfileNames,
    // CLE-198 — Redact sensitive columns for viewers without the flag.
    canViewSensitiveFields: canSeeCurrency,
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
        holiday_profile: m.holiday_profile_name ?? "—",
        work_pattern: m.work_pattern_name ?? "—",
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

            // CLE-198 — Sensitive-field redaction, mirroring the
            // format-member-pdf-row.ts logic. See that file for the
            // canonical implementation.
            if (def.is_sensitive === true && !canSeeCurrency) {
              const pairs: [string, string][] = [[`cf_${def.field_key}`, "•••"]];
              if (def.field_type === "currency" || def.field_type === "number") {
                pairs.push([`_raw_cf_${def.field_key}`, ""]);
              }
              return pairs;
            }

            let display: string;
            if (def.input_mode === "multi_choice") {
              const arr = Array.isArray(val) ? val.filter((v): v is string => typeof v === "string") : [];
              display = arr.length === 0
                ? "—"
                : arr
                    .map((v) => formatOptionForDisplay(v, def.field_type, { currencySymbol, maxDecimalPlaces: def.max_decimal_places }))
                    .join(", ");
            }
            else if (def.input_mode === "single_choice") {
              display = val === undefined || val === null || val === ""
                ? "—"
                : formatOptionForDisplay(String(val), def.field_type, { currencySymbol, maxDecimalPlaces: def.max_decimal_places });
            }
            else if (def.field_type === "checkbox") display = val === true ? "Yes" : val === false ? "No" : "—";
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

  // CLE-194 — Card renderer. Sits inside DataGrid (renderMode="cards") so
  // sort/filter/customise/selection state is shared with the list view. The
  // card body mirrors the user's Customise selection: fixed header (avatar,
  // name, email) + label/value pairs for every other visible column. We
  // reuse the PDF row formatter (formatMemberForPdf) as the display source
  // so cards stay in lockstep with the list's cell rendering.
  const teamsMap = useMemo(() => Object.fromEntries(teams.map((t) => [t.id, t.name])), [teams]);
  const renderEmployeeCard = (m: Member, visibleColumnIds: string[]) => {
    // Lazy-import to avoid pulling PDF formatting into initial bundle;
    // this function only runs client-side after mount.
    // (formatMemberForPdf is a pure helper — safe to import top-level too,
    // but the module already has our imports at the top of the file.)
    const initials = [m.first_name, m.last_name]
      .map((n) => n?.charAt(0).toUpperCase())
      .join("");
    // Fields already shown in the fixed card header — never repeat in the
    // details list.
    const fixed = new Set(["select", "avatar", "first_name", "last_name", "email"]);
    const detailIds = visibleColumnIds.filter((id) => !fixed.has(id));
    const pdfRow = formatMemberForPdf(m, {
      teams,
      customFieldDefs,
      currencySymbol,
      memberLabel,
      // CLE-198 — canSeeCurrency was already sourced from
      // rights.canViewSensitiveFields at the page level, so we reuse
      // it here as the sensitive-fields redaction gate.
      canViewSensitiveFields: canSeeCurrency,
    });

    return (
      <div
        className={cn(
          "relative flex flex-col gap-3 rounded-lg border bg-card p-4 cursor-pointer hover:bg-muted/50",
          selectedIds.has(m.member_id) && "ring-2 ring-primary",
        )}
        onClick={() => router.push(`/members/${m.member_id}/calendar`)}
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
        <div className="flex flex-col items-center gap-2 text-center">
          {m.avatar_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={m.avatar_url}
              alt={`${m.first_name} ${m.last_name}`}
              className="h-24 w-24 rounded-full object-cover"
            />
          ) : (
            <div className="flex h-24 w-24 items-center justify-center rounded-full bg-muted">
              <span className="text-2xl font-medium text-muted-foreground">{initials}</span>
            </div>
          )}
          <div className="w-full">
            <p className="font-semibold leading-tight">{m.first_name} {m.last_name}</p>
            <p className="truncate text-sm text-muted-foreground">{m.email}</p>
          </div>
        </div>
        {detailIds.length > 0 && (
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs border-t pt-3">
            {detailIds.map((id) => {
              const label = allColLabels[id] ?? id;
              const value = pdfRow[id] ?? "—";
              return (
                <div key={id} className="contents">
                  <dt className="text-muted-foreground truncate">{label}</dt>
                  <dd className="truncate text-right">{value}</dd>
                </div>
              );
            })}
          </dl>
        )}
      </div>
    );
  };
  // teamsMap kept for potential future use in the card (e.g. team badge).
  void teamsMap;

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8">
      <StickyPageHeader>
        <h1 className="text-2xl font-bold">
          {capitalize(pluralize(memberLabel))} Directory
        </h1>
      </StickyPageHeader>
      {/* No pt- gap here: it lets the sticky DataGrid toolbar slide up by
          that amount before sticking. Toolbar's own py-2 provides the
          visual break beneath the header border. */}
      <div className="pb-8">

      {/* DataGrid — shared shell for list + card views. renderMode="cards"
          swaps the table body for a grid of cards but keeps the same
          sort/filter/customise state + pagination + PDF/CSV export. */}
      <div className="flex justify-center w-full">
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
          onRowClick={view === "list" ? (m) => router.push(`/members/${m.member_id}/calendar`) : undefined}
          emptyMessage={`No ${pluralize(memberLabel)} found.`}
          onExportPdf={handleExportPdf}
          leadingColumnIds={view === "list" ? ["select"] : undefined}
          initialFilters={initialFiltersArray}
          initialSorting={initialSorting}
          onPrefsChange={handlePrefsChange}
          stickyHeader
          renderMode={view === "card" ? "cards" : "table"}
          renderCard={renderEmployeeCard}
          renderGroupHeaderPrefix={({ rowsInGroup, groupValue }) => {
            const ids = rowsInGroup.map((r: Row<Member>) => r.original.member_id);
            const selectedInGroup = ids.filter((id) => selectedIds.has(id)).length;
            const allSelected = ids.length > 0 && selectedInGroup === ids.length;
            const someSelected = selectedInGroup > 0 && !allSelected;
            return (
              <Checkbox
                checked={allSelected ? true : someSelected ? "indeterminate" : false}
                onCheckedChange={(value) => handleSetSelected(ids, value === true)}
                onClick={(e) => e.stopPropagation()}
                aria-label={`Select all in ${groupValue}`}
              />
            );
          }}
        />
        </div>
      </div>

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
        holidayAbsenceTypeId={holidayAbsenceTypeId}
        holidayApprovalProfiles={holidayApprovalProfiles}
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
              // CLE-186 — update the Approver Profile column too
              if (updates.approval_profile_id !== undefined) {
                if (updates.approval_profile_id === null) {
                  updated.approval_profile_name = null;
                } else {
                  const found = holidayApprovalProfiles.find((p) => p.id === updates.approval_profile_id);
                  updated.approval_profile_name = found?.name ?? null;
                }
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
    </div>
  );
}
