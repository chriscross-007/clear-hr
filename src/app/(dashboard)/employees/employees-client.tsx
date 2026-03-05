"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { type ColPref } from "@/lib/grid-prefs-actions";
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
import { Plus, List, LayoutGrid } from "lucide-react";
import { useMemberLabel } from "@/contexts/member-label-context";
import { capitalize, pluralize } from "@/lib/label-utils";
import { deleteEmployee } from "./actions";
import { Button } from "@/components/ui/button";
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
  const [cardRows, setCardRows] = useState<Member[]>(initialMembers);

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

  const columns = buildEmployeeColumns({
    teams,
    adminProfiles,
    employeeProfiles,
    memberLabel,
    canAdd,
    currencySymbol,
    customFieldDefs,
    onDelete: (member) => setDeletingMember(member),
  });

  async function handleExportPdf(
    rows: Member[],
    prefs: ColPref[],
    colLabels: Record<string, string>,
    orientation: "portrait" | "landscape",
    groupBy?: string
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
          customFieldDefs.map((def) => {
            const val = m.custom_fields?.[def.field_key];
            if (def.field_type === "checkbox") return [`cf_${def.field_key}`, val === true ? "Yes" : val === false ? "No" : "—"];
            if (def.field_type === "date" && val) {
              try { return [`cf_${def.field_key}`, new Date(String(val)).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })]; } catch { return [`cf_${def.field_key}`, String(val)]; }
            }
            if (val === undefined || val === null || val === "") return [`cf_${def.field_key}`, "—"];
            if (def.field_type === "currency") {
              const num = Number(val);
              return [`cf_${def.field_key}`, isNaN(num) ? String(val) : `${currencySymbol}${num.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`];
            }
            if (def.field_type === "number") {
              const num = Number(val);
              if (isNaN(num)) return [`cf_${def.field_key}`, String(val)];
              if (def.max_decimal_places === 0) return [`cf_${def.field_key}`, String(Math.round(num))];
              if (def.max_decimal_places !== null && def.max_decimal_places !== undefined) return [`cf_${def.field_key}`, num.toFixed(def.max_decimal_places)];
              return [`cf_${def.field_key}`, String(val)];
            }
            return [`cf_${def.field_key}`, String(val)];
          })
        ),
      } as Record<string, string>));

      const sortedRows = groupBy
        ? [...formattedRows].sort((a, b) => (a[groupBy] ?? "").localeCompare(b[groupBy] ?? ""))
        : formattedRows;

      const pdfColumns = prefs
        .filter((c) => c.visible && c.id !== "avatar")
        .map((c) => ({ id: c.id, label: colLabels[c.id] ?? c.id }));

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

  // Toolbar slot: view toggle + add button
  const toolbar = (
    <div className="flex items-center gap-3">
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
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <h1 className="text-2xl font-bold mb-6">
        {capitalize(pluralize(memberLabel))} Directory
      </h1>

      {/* DataGrid — always mounted so state (filters/sort) survives view toggle */}
      <div className={view !== "list" ? "hidden" : ""}>
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
          userId={userId}
          toolbar={toolbar}
          onRowClick={canEdit ? (m) => setEditingMember(m) : undefined}
          emptyMessage={`No ${pluralize(memberLabel)} found.`}
          onExportPdf={handleExportPdf}
          onPageRowsChange={setCardRows}
        />
      </div>

      {/* Card view */}
      {view === "card" && (
        <>
          <div className="mb-4 flex justify-end">
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
                      className="flex flex-col items-center gap-3 rounded-lg border bg-card p-6 text-center cursor-pointer hover:bg-muted/50"
                      onClick={() => router.push(`/employees/${m.member_id}/dashboard`)}
                    >
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
