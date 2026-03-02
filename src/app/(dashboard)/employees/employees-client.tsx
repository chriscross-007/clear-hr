"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
  type ColumnFiltersState,
} from "@tanstack/react-table";
import { useColumnPrefs } from "@/hooks/use-column-prefs";
import { type ColPref } from "@/app/(dashboard)/employees/grid-prefs-actions";
import {
  ColumnCustomiserTrigger,
  ColumnCustomiserDialog,
} from "@/components/ui/column-customiser";
import Link from "next/link";
import { Plus, ArrowUpDown, ArrowUp, ArrowDown, Trash2, FileDown, List, LayoutGrid } from "lucide-react";
import { useMemberLabel } from "@/contexts/member-label-context";
import { capitalize, pluralize } from "@/lib/label-utils";
import { deleteEmployee } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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

export type Team = {
  id: string;
  name: string;
};

export type Member = {
  member_id: string;
  user_id: string | null;
  first_name: string;
  last_name: string;
  email: string;
  role: string;
  invited_at: string | null;
  accepted_at: string | null;
  team_id: string | null;
  last_log_in: string | null;
  payroll_number: string | null;
  profile_name: string | null;
  custom_fields: Record<string, unknown>;
  avatar_url: string | null;
};

function RoleBadge({ role, memberLabel }: { role: string; memberLabel: string }) {
  if (role === "owner") {
    return (
      <span className="inline-flex items-center rounded-full bg-blue-500/10 px-2 py-1 text-xs font-medium text-blue-700 dark:text-blue-400">
        Owner
      </span>
    );
  }
  if (role === "admin") {
    return (
      <span className="inline-flex items-center rounded-full bg-red-500/10 px-2 py-1 text-xs font-medium text-red-700 dark:text-red-400">
        Admin
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full bg-green-500/10 px-2 py-1 text-xs font-medium text-green-700 dark:text-green-400">
      {capitalize(memberLabel)}
    </span>
  );
}

function InviteStatus({ member }: { member: Member }) {
  if (member.accepted_at) {
    return (
      <span className="inline-flex items-center rounded-full bg-green-500/10 px-2 py-1 text-xs font-medium text-green-700 dark:text-green-400">
        Active
      </span>
    );
  }
  if (member.invited_at) {
    return (
      <span className="inline-flex items-center rounded-full bg-amber-500/10 px-2 py-1 text-xs font-medium text-amber-700 dark:text-amber-400">
        Invited
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full bg-muted px-2 py-1 text-xs font-medium text-muted-foreground">
      Not invited
    </span>
  );
}

function getDateRange(preset: string): { from: string; to: string } | null {
  const now = new Date();
  if (preset === "this_week") {
    const monday = new Date(now);
    monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    return { from: monday.toISOString().slice(0, 10), to: sunday.toISOString().slice(0, 10) };
  }
  if (preset === "last_week") {
    const monday = new Date(now);
    monday.setDate(now.getDate() - ((now.getDay() + 6) % 7) - 7);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    return { from: monday.toISOString().slice(0, 10), to: sunday.toISOString().slice(0, 10) };
  }
  if (preset === "this_month") {
    const from = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
    const to = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);
    return { from, to };
  }
  if (preset === "last_month") {
    const from = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().slice(0, 10);
    const to = new Date(now.getFullYear(), now.getMonth(), 0).toISOString().slice(0, 10);
    return { from, to };
  }
  if (preset === "this_year") {
    return { from: `${now.getFullYear()}-01-01`, to: `${now.getFullYear()}-12-31` };
  }
  if (preset === "last_year") {
    const y = now.getFullYear() - 1;
    return { from: `${y}-01-01`, to: `${y}-12-31` };
  }
  if (preset === "next_week") {
    const monday = new Date(now);
    monday.setDate(now.getDate() - ((now.getDay() + 6) % 7) + 7);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    return { from: monday.toISOString().slice(0, 10), to: sunday.toISOString().slice(0, 10) };
  }
  if (preset === "next_month") {
    const from = new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString().slice(0, 10);
    const to = new Date(now.getFullYear(), now.getMonth() + 2, 0).toISOString().slice(0, 10);
    return { from, to };
  }
  if (preset === "next_year") {
    const y = now.getFullYear() + 1;
    return { from: `${y}-01-01`, to: `${y}-12-31` };
  }
  return null;
}

const DATE_PRESET_LABELS: Record<string, string> = {
  this_week: "This Week",
  last_week: "Last Week",
  next_week: "Next Week",
  this_month: "This Month",
  last_month: "Last Month",
  next_month: "Next Month",
  this_year: "This Year",
  last_year: "Last Year",
  next_year: "Next Year",
};

const DEFAULT_EMPLOYEE_COLS = [
  "first_name", "last_name", "email", "role", "profile",
  "team", "payroll_number", "status", "last_log_in",
];

const EMPLOYEE_COL_LABELS: Record<string, string> = {
  first_name: "First Name",
  last_name: "Last Name",
  email: "Email",
  role: "Role",
  profile: "Profile",
  team: "Team",
  payroll_number: "Payroll #",
  status: "Status",
  last_log_in: "Last Log-in",
};

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
  customFieldDefs,
  currencySymbol,
  userId,
}: EmployeesClientProps) {
  const { memberLabel } = useMemberLabel();
  const router = useRouter();
  const teamMap = Object.fromEntries(teams.map((t) => [t.id, t.name]));
  const [members, setMembers] = useState(initialMembers);
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [editingMember, setEditingMember] = useState<Member | null>(null);
  const [deletingMember, setDeletingMember] = useState<Member | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showCapacityDialog, setShowCapacityDialog] = useState(false);
  const [showPdfDialog, setShowPdfDialog] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [showCustomiser, setShowCustomiser] = useState(false);
  const [view, setView] = useState<"list" | "card">("list");
  useEffect(() => {
    const saved = localStorage.getItem(`employee-directory-view-${userId}`) as "list" | "card" | null;
    if (saved === "card") setView("card");
  }, [userId]);
  useEffect(() => {
    localStorage.setItem(`employee-directory-view-${userId}`, view);
  }, [view, userId]);

  const [pageSize, setPageSize] = useState(50);
  const [pageIndex, setPageIndex] = useState(0);
  useEffect(() => {
    const saved = localStorage.getItem(`employee-directory-page-size-${userId}`);
    if (saved) {
      const n = parseInt(saved, 10);
      if ([10, 25, 50, 100, 250].includes(n)) setPageSize(n);
    }
  }, [userId]);
  useEffect(() => {
    localStorage.setItem(`employee-directory-page-size-${userId}`, String(pageSize));
  }, [pageSize, userId]);
  useEffect(() => {
    setPageIndex(0);
  }, [columnFilters]);
  const atCapacity = members.length >= maxEmployees;

  const customFieldColIds = customFieldDefs.map((d) => `cf_${d.field_key}`);
  const allDefaultCols = [...DEFAULT_EMPLOYEE_COLS, ...customFieldColIds];
  const allColLabels: Record<string, string> = {
    ...EMPLOYEE_COL_LABELS,
    ...Object.fromEntries(customFieldDefs.map((d) => [`cf_${d.field_key}`, d.label])),
  };

  const { prefs, updatePrefs, resetPrefs, columnOrder, columnVisibility } = useColumnPrefs(
    "employees", initialColumnPrefs, allDefaultCols
  );

  useEffect(() => {
    if (initialMemberId) {
      const member = initialMembers.find((m) => m.member_id === initialMemberId);
      if (member) setEditingMember(member);
    }
  }, [initialMemberId, initialMembers]);

  async function handleDownloadPdf(orientation: "portrait" | "landscape") {
    setPdfLoading(true);
    setShowPdfDialog(false);
    try {
      const [{ pdf }, { EmployeePDF }] = await Promise.all([
        import("@react-pdf/renderer"),
        import("./employee-pdf"),
      ]);

      // Build active filters list
      const activeFilters: { label: string; value: string }[] = [];
      const filterLabels: Record<string, string> = {
        ...allColLabels,
        last_log_in: "Last Log-in",
      };
      for (const cf of columnFilters) {
        const label = filterLabels[cf.id] ?? cf.id;
        const cfDef = customFieldDefs.find((d) => `cf_${d.field_key}` === cf.id);
        if (cfDef && (cfDef.field_type === "number" || cfDef.field_type === "currency")) {
          const nf = cf.value as { op?: string; val?: string; val2?: string };
          if (nf?.op && nf?.val) {
            const opLabel = nf.op === "gt" ? ">" : nf.op === "lt" ? "<" : "between";
            const val = nf.op === "between" ? `${nf.val}${nf.val2 ? ` and ${nf.val2}` : ""}` : nf.val;
            activeFilters.push({ label, value: `${opLabel} ${val}` });
          }
          continue;
        }
        if (cf.id === "last_log_in" || (cfDef && cfDef.field_type === "date")) {
          const dv = cf.value as { preset?: string; from?: string; to?: string };
          let filterStr = "";
          if (dv.preset && dv.preset !== "custom") {
            filterStr = DATE_PRESET_LABELS[dv.preset] ?? dv.preset;
          } else {
            const parts: string[] = [];
            if (dv.from) parts.push(`from ${dv.from}`);
            if (dv.to) parts.push(`to ${dv.to}`);
            filterStr = parts.join(" ");
          }
          if (filterStr) activeFilters.push({ label, value: filterStr });
        } else {
          activeFilters.push({ label, value: String(cf.value) });
        }
      }

      const allRowData = table.getPrePaginationRowModel().rows.map((row) => {
        const m = row.original;
        return {
          first_name: m.first_name,
          last_name: m.last_name,
          email: m.email,
          role: m.role === "admin" ? "Admin" : m.role === "owner" ? "Owner" : capitalize(memberLabel),
          profile: m.profile_name ?? "—",
          team: m.team_id ? teamMap[m.team_id] ?? "—" : "—",
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
          // Custom field values
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
        } as Record<string, string>;
      });

      const pdfColumns = prefs
        .filter((c) => c.visible)
        .map((c) => ({ id: c.id, label: allColLabels[c.id] ?? c.id }));

      const title = `${capitalize(pluralize(memberLabel))} Directory`;
      const blob = await pdf(
        <EmployeePDF
          rows={allRowData}
          columns={pdfColumns}
          orgName={orgName}
          title={title}
          orientation={orientation}
          filters={activeFilters.length > 0 ? activeFilters : undefined}
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
    } finally {
      setPdfLoading(false);
    }
  }

  const columns: ColumnDef<Member>[] = [
    {
      id: "avatar",
      size: 64,
      enableSorting: false,
      enableColumnFilter: false,
      header: () => null,
      cell: ({ row }) => {
        const m = row.original;
        const initials = [m.first_name, m.last_name].map((n) => n?.charAt(0).toUpperCase()).join("");
        return m.avatar_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={m.avatar_url}
            alt={`${m.first_name} ${m.last_name}`}
            className="h-12 w-12 rounded-full object-cover shrink-0"
          />
        ) : (
          <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center shrink-0">
            <span className="text-sm font-medium text-muted-foreground">{initials}</span>
          </div>
        );
      },
    },
    {
      accessorKey: "first_name",
      sortingFn: (rowA, rowB) =>
        rowA.original.first_name.localeCompare(rowB.original.first_name, undefined, { sensitivity: "base" }),
      header: ({ column }) => (
        <Button
          variant="ghost"
          className="-ml-4"
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => {
            e.preventDefault();
            if (e.shiftKey) {
              setSorting((old) => {
                const idx = old.findIndex((s) => s.id === column.id);
                return idx >= 0
                  ? old.map((s, i) => i === idx ? { ...s, desc: !s.desc } : s)
                  : [...old, { id: column.id, desc: false }];
              });
            } else {
              setSorting((old) => {
                const existing = old.find((s) => s.id === column.id);
                return [{ id: column.id, desc: existing ? !existing.desc : false }];
              });
            }
          }}
        >
          First Name
          {column.getIsSorted() === "asc" ? (
            <ArrowUp className="ml-2 h-4 w-4" />
          ) : column.getIsSorted() === "desc" ? (
            <ArrowDown className="ml-2 h-4 w-4" />
          ) : (
            <ArrowUpDown className="ml-2 h-4 w-4 opacity-40" />
          )}
        </Button>
      ),
    },
    {
      accessorKey: "last_name",
      sortingFn: (rowA, rowB) =>
        rowA.original.last_name.localeCompare(rowB.original.last_name, undefined, { sensitivity: "base" }),
      header: ({ column }) => (
        <Button
          variant="ghost"
          className="-ml-4"
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => {
            e.preventDefault();
            if (e.shiftKey) {
              setSorting((old) => {
                const idx = old.findIndex((s) => s.id === column.id);
                return idx >= 0
                  ? old.map((s, i) => i === idx ? { ...s, desc: !s.desc } : s)
                  : [...old, { id: column.id, desc: false }];
              });
            } else {
              setSorting((old) => {
                const existing = old.find((s) => s.id === column.id);
                return [{ id: column.id, desc: existing ? !existing.desc : false }];
              });
            }
          }}
        >
          Last Name
          {column.getIsSorted() === "asc" ? (
            <ArrowUp className="ml-2 h-4 w-4" />
          ) : column.getIsSorted() === "desc" ? (
            <ArrowDown className="ml-2 h-4 w-4" />
          ) : (
            <ArrowUpDown className="ml-2 h-4 w-4 opacity-40" />
          )}
        </Button>
      ),
    },
    {
      accessorKey: "payroll_number",
      sortingFn: (rowA, rowB) =>
        (rowA.original.payroll_number ?? "").localeCompare(rowB.original.payroll_number ?? "", undefined, { sensitivity: "base" }),
      header: ({ column }) => (
        <Button
          variant="ghost"
          className="-ml-4"
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => {
            e.preventDefault();
            if (e.shiftKey) {
              setSorting((old) => {
                const idx = old.findIndex((s) => s.id === column.id);
                return idx >= 0
                  ? old.map((s, i) => i === idx ? { ...s, desc: !s.desc } : s)
                  : [...old, { id: column.id, desc: false }];
              });
            } else {
              setSorting((old) => {
                const existing = old.find((s) => s.id === column.id);
                return [{ id: column.id, desc: existing ? !existing.desc : false }];
              });
            }
          }}
        >
          Payroll #
          {column.getIsSorted() === "asc" ? (
            <ArrowUp className="ml-2 h-4 w-4" />
          ) : column.getIsSorted() === "desc" ? (
            <ArrowDown className="ml-2 h-4 w-4" />
          ) : (
            <ArrowUpDown className="ml-2 h-4 w-4 opacity-40" />
          )}
        </Button>
      ),
      cell: ({ row }) => row.original.payroll_number ?? "—",
    },
    {
      id: "role",
      accessorFn: (row) =>
        row.role === "admin" ? "Admin" : row.role === "owner" ? "Owner" : capitalize(memberLabel),
      header: ({ column }) => (
        <Button
          variant="ghost"
          className="-ml-4"
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => {
            e.preventDefault();
            if (e.shiftKey) {
              setSorting((old) => {
                const idx = old.findIndex((s) => s.id === column.id);
                return idx >= 0
                  ? old.map((s, i) => i === idx ? { ...s, desc: !s.desc } : s)
                  : [...old, { id: column.id, desc: false }];
              });
            } else {
              setSorting((old) => {
                const existing = old.find((s) => s.id === column.id);
                return [{ id: column.id, desc: existing ? !existing.desc : false }];
              });
            }
          }}
        >
          Role
          {column.getIsSorted() === "asc" ? (
            <ArrowUp className="ml-2 h-4 w-4" />
          ) : column.getIsSorted() === "desc" ? (
            <ArrowDown className="ml-2 h-4 w-4" />
          ) : (
            <ArrowUpDown className="ml-2 h-4 w-4 opacity-40" />
          )}
        </Button>
      ),
      cell: ({ row }) => <RoleBadge role={row.original.role} memberLabel={memberLabel} />,
    },
    {
      id: "profile",
      accessorFn: (row) => row.profile_name ?? "—",
      sortingFn: (rowA, rowB) => {
        const a = rowA.original.profile_name ?? "";
        const b = rowB.original.profile_name ?? "";
        return a.localeCompare(b, undefined, { sensitivity: "base" });
      },
      header: ({ column }) => (
        <Button
          variant="ghost"
          className="-ml-4"
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => {
            e.preventDefault();
            if (e.shiftKey) {
              setSorting((old) => {
                const idx = old.findIndex((s) => s.id === column.id);
                return idx >= 0
                  ? old.map((s, i) => i === idx ? { ...s, desc: !s.desc } : s)
                  : [...old, { id: column.id, desc: false }];
              });
            } else {
              setSorting((old) => {
                const existing = old.find((s) => s.id === column.id);
                return [{ id: column.id, desc: existing ? !existing.desc : false }];
              });
            }
          }}
        >
          Profile
          {column.getIsSorted() === "asc" ? (
            <ArrowUp className="ml-2 h-4 w-4" />
          ) : column.getIsSorted() === "desc" ? (
            <ArrowDown className="ml-2 h-4 w-4" />
          ) : (
            <ArrowUpDown className="ml-2 h-4 w-4 opacity-40" />
          )}
        </Button>
      ),
      cell: ({ row }) => row.original.profile_name ?? "—",
    },
    {
      id: "team",
      accessorFn: (row) => (row.team_id ? teamMap[row.team_id] ?? "—" : "—"),
      sortingFn: (rowA, rowB) => {
        const a = rowA.getValue<string>("team");
        const b = rowB.getValue<string>("team");
        return a.localeCompare(b, undefined, { sensitivity: "base" });
      },
      header: ({ column }) => (
        <Button
          variant="ghost"
          className="-ml-4"
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => {
            e.preventDefault();
            if (e.shiftKey) {
              setSorting((old) => {
                const idx = old.findIndex((s) => s.id === column.id);
                return idx >= 0
                  ? old.map((s, i) => i === idx ? { ...s, desc: !s.desc } : s)
                  : [...old, { id: column.id, desc: false }];
              });
            } else {
              setSorting((old) => {
                const existing = old.find((s) => s.id === column.id);
                return [{ id: column.id, desc: existing ? !existing.desc : false }];
              });
            }
          }}
        >
          Team
          {column.getIsSorted() === "asc" ? (
            <ArrowUp className="ml-2 h-4 w-4" />
          ) : column.getIsSorted() === "desc" ? (
            <ArrowDown className="ml-2 h-4 w-4" />
          ) : (
            <ArrowUpDown className="ml-2 h-4 w-4 opacity-40" />
          )}
        </Button>
      ),
    },
    {
      accessorKey: "email",
      sortingFn: (rowA, rowB) =>
        rowA.original.email.localeCompare(rowB.original.email, undefined, { sensitivity: "base" }),
      header: ({ column }) => (
        <Button
          variant="ghost"
          className="-ml-4"
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => {
            e.preventDefault();
            if (e.shiftKey) {
              setSorting((old) => {
                const idx = old.findIndex((s) => s.id === column.id);
                return idx >= 0
                  ? old.map((s, i) => i === idx ? { ...s, desc: !s.desc } : s)
                  : [...old, { id: column.id, desc: false }];
              });
            } else {
              setSorting((old) => {
                const existing = old.find((s) => s.id === column.id);
                return [{ id: column.id, desc: existing ? !existing.desc : false }];
              });
            }
          }}
        >
          Email Address
          {column.getIsSorted() === "asc" ? (
            <ArrowUp className="ml-2 h-4 w-4" />
          ) : column.getIsSorted() === "desc" ? (
            <ArrowDown className="ml-2 h-4 w-4" />
          ) : (
            <ArrowUpDown className="ml-2 h-4 w-4 opacity-40" />
          )}
        </Button>
      ),
    },
    {
      id: "status",
      accessorFn: (row) =>
        row.accepted_at ? "Active" : row.invited_at ? "Invited" : "Not invited",
      header: "Status",
      cell: ({ row }) => <InviteStatus member={row.original} />,
    },
    {
      id: "last_log_in",
      accessorFn: (row) =>
        row.last_log_in
          ? new Date(row.last_log_in).toLocaleString("en-GB", {
              day: "numeric",
              month: "short",
              year: "numeric",
              hour: "2-digit",
              minute: "2-digit",
              hour12: false,
            })
          : "—",
      header: ({ column }) => (
        <Button
          variant="ghost"
          className="-ml-4"
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => {
            e.preventDefault();
            if (e.shiftKey) {
              setSorting((old) => {
                const idx = old.findIndex((s) => s.id === column.id);
                return idx >= 0
                  ? old.map((s, i) => i === idx ? { ...s, desc: !s.desc } : s)
                  : [...old, { id: column.id, desc: false }];
              });
            } else {
              setSorting((old) => {
                const existing = old.find((s) => s.id === column.id);
                return [{ id: column.id, desc: existing ? !existing.desc : false }];
              });
            }
          }}
        >
          Last Log-in
          {column.getIsSorted() === "asc" ? (
            <ArrowUp className="ml-2 h-4 w-4" />
          ) : column.getIsSorted() === "desc" ? (
            <ArrowDown className="ml-2 h-4 w-4" />
          ) : (
            <ArrowUpDown className="ml-2 h-4 w-4 opacity-40" />
          )}
        </Button>
      ),
      sortingFn: (rowA, rowB) => {
        const a = rowA.original.last_log_in;
        const b = rowB.original.last_log_in;
        if (!a && !b) return 0;
        if (!a) return -1;
        if (!b) return 1;
        return new Date(a).getTime() - new Date(b).getTime();
      },
      filterFn: (row, _columnId, filterValue: { preset?: string; from?: string; to?: string }) => {
        if (!filterValue) return true;
        let from: string | undefined;
        let to: string | undefined;
        if (!filterValue.preset || filterValue.preset === "custom") {
          from = filterValue.from;
          to = filterValue.to;
        } else {
          const range = getDateRange(filterValue.preset);
          if (!range) return true;
          from = range.from;
          to = range.to;
        }
        if (!from && !to) return true;
        const logIn = row.original.last_log_in;
        if (!logIn) return false;
        const date = logIn.slice(0, 10);
        if (from && date < from) return false;
        if (to && date > to) return false;
        return true;
      },
    },
    ...customFieldDefs.map((def): ColumnDef<Member> => ({
      id: `cf_${def.field_key}`,
      accessorFn: (row) => {
        const val = row.custom_fields?.[def.field_key];
        if (def.field_type === "checkbox") return val === true ? "Yes" : val === false ? "No" : "—";
        if (def.field_type === "date" && val) {
          try { return new Date(String(val)).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }); } catch { return String(val); }
        }
        if (val === undefined || val === null || val === "") return "—";
        if (def.field_type === "currency") {
          const num = Number(val);
          return isNaN(num) ? String(val) : `${currencySymbol}${num.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        }
        if (def.field_type === "number") {
          const num = Number(val);
          if (isNaN(num)) return String(val);
          if (def.max_decimal_places === 0) return String(Math.round(num));
          if (def.max_decimal_places !== null && def.max_decimal_places !== undefined) return num.toFixed(def.max_decimal_places);
          return String(val);
        }
        return String(val);
      },
      header: ({ column }) => (
        <Button
          variant="ghost"
          className="-ml-4"
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => {
            e.preventDefault();
            if (e.shiftKey) {
              setSorting((old) => {
                const idx = old.findIndex((s) => s.id === column.id);
                return idx >= 0
                  ? old.map((s, i) => i === idx ? { ...s, desc: !s.desc } : s)
                  : [...old, { id: column.id, desc: false }];
              });
            } else {
              setSorting((old) => {
                const existing = old.find((s) => s.id === column.id);
                return [{ id: column.id, desc: existing ? !existing.desc : false }];
              });
            }
          }}
        >
          {def.label}
          {column.getIsSorted() === "asc" ? (
            <ArrowUp className="ml-2 h-4 w-4" />
          ) : column.getIsSorted() === "desc" ? (
            <ArrowDown className="ml-2 h-4 w-4" />
          ) : (
            <ArrowUpDown className="ml-2 h-4 w-4 opacity-40" />
          )}
        </Button>
      ),
      ...(def.field_type === "number" || def.field_type === "currency" ? {
        filterFn: (row: { original: Member }, _columnId: string, filterValue: { op?: string; val?: string; val2?: string }) => {
          if (!filterValue?.op || !filterValue?.val) return true;
          const raw = row.original.custom_fields?.[def.field_key];
          const num = Number(raw);
          if (isNaN(num)) return false;
          const val = Number(filterValue.val);
          if (isNaN(val)) return true;
          if (filterValue.op === "gt") return num > val;
          if (filterValue.op === "lt") return num < val;
          if (filterValue.op === "between") {
            const val2 = Number(filterValue.val2);
            return num >= val && (isNaN(val2) || num <= val2);
          }
          return true;
        },
      } : def.field_type === "date" ? {
        filterFn: (row: { original: Member }, _columnId: string, filterValue: { preset?: string; from?: string; to?: string }) => {
          if (!filterValue) return true;
          let from: string | undefined;
          let to: string | undefined;
          if (!filterValue.preset || filterValue.preset === "custom") {
            from = filterValue.from;
            to = filterValue.to;
          } else {
            const range = getDateRange(filterValue.preset);
            if (!range) return true;
            from = range.from;
            to = range.to;
          }
          if (!from && !to) return true;
          const raw = row.original.custom_fields?.[def.field_key];
          if (!raw) return false;
          let dateStr: string;
          try { dateStr = new Date(String(raw)).toISOString().slice(0, 10); } catch { return false; }
          if (from && dateStr < from) return false;
          if (to && dateStr > to) return false;
          return true;
        },
      } : {}),
    })),
    ...(canAdd
      ? [
          {
            id: "actions",
            cell: ({ row }: { row: { original: Member } }) =>
              row.original.role !== "owner" ? (
                <div className="flex justify-end">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={(e) => {
                      e.stopPropagation();
                      setDeletingMember(row.original);
                    }}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              ) : null,
          } satisfies ColumnDef<Member>,
        ]
      : []),
  ];

  const table = useReactTable({
    data: members,
    columns,
    state: { sorting, columnFilters, columnOrder, columnVisibility, pagination: { pageIndex, pageSize } },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onPaginationChange: (updater) => {
      const next = typeof updater === "function" ? updater({ pageIndex, pageSize }) : updater;
      setPageIndex(next.pageIndex);
      if (next.pageSize !== pageSize) setPageSize(next.pageSize);
    },
    onColumnOrderChange: () => {},
    onColumnVisibilityChange: () => {},
    enableMultiSort: true,
    enableSortingRemoval: false,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  });

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <h1 className="text-2xl font-bold mb-6">
        {capitalize(pluralize(memberLabel))} Directory
      </h1>

      {/* Toolbar: column customiser (list only) + counts + view toggle */}
      <div className="mb-4 flex items-center justify-between gap-4">
        <div>
          {view === "list" && (
            <ColumnCustomiserTrigger onClick={() => setShowCustomiser(true)} />
          )}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground whitespace-nowrap">
            <span className="font-medium text-foreground">
              {table.getFilteredRowModel().rows.length}
            </span>{" "}
            shown · out of{" "}
            <span className="font-medium text-foreground">{members.length}</span>
          </span>
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
        </div>
      </div>

      {/* Card view */}
      {view === "card" && (
        <div className="mb-4">
          {table.getRowModel().rows.length ? (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {table.getRowModel().rows.map((row) => {
                const m = row.original;
                const initials = [m.first_name, m.last_name]
                  .map((n) => n?.charAt(0).toUpperCase())
                  .join("");
                return (
                  <div
                    key={m.member_id}
                    className={cn(
                      "flex flex-col items-center gap-3 rounded-lg border bg-card p-6 text-center",
                      canEdit && "cursor-pointer hover:bg-muted/50"
                    )}
                    onClick={() => canEdit && setEditingMember(m)}
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
      )}

      {/* List view */}
      {view === "list" && <div className="rounded-md border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id}>
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                          header.column.columnDef.header,
                          header.getContext()
                        )}
                  </TableHead>
                ))}
              </TableRow>
            ))}
            <TableRow className="bg-muted/50 hover:bg-muted/50">
              {table.getHeaderGroups()[0]?.headers.map((header) => {
                const columnId = header.column.id;
                if (columnId === "actions") {
                  return <TableHead key={`filter-${header.id}`} />;
                }
                if (columnId === "avatar") {
                  return <TableHead key={`filter-${header.id}`} className="w-16 shrink-0" />;
                }
                if (columnId === "payroll_number") {
                  return (
                    <TableHead key={`filter-${header.id}`} className="py-2">
                      <Input
                        placeholder="Filter..."
                        className="h-8 text-sm"
                        value={(header.column.getFilterValue() as string) ?? ""}
                        onChange={(e) =>
                          header.column.setFilterValue(e.target.value || undefined)
                        }
                      />
                    </TableHead>
                  );
                }
                if (columnId === "role") {
                  return (
                    <TableHead key={`filter-${header.id}`} className="py-2">
                      <select
                        className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
                        value={(header.column.getFilterValue() as string) ?? ""}
                        onChange={(e) =>
                          header.column.setFilterValue(e.target.value || undefined)
                        }
                      >
                        <option value="">All</option>
                        <option value="Owner">Owner</option>
                        <option value="Admin">Admin</option>
                        <option value={capitalize(memberLabel)}>{capitalize(memberLabel)}</option>
                      </select>
                    </TableHead>
                  );
                }
                if (columnId === "profile") {
                  const allProfiles = [...adminProfiles, ...employeeProfiles]
                    .map((p) => p.name)
                    .filter((name, i, arr) => arr.indexOf(name) === i)
                    .sort();
                  return (
                    <TableHead key={`filter-${header.id}`} className="py-2">
                      <select
                        className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
                        value={(header.column.getFilterValue() as string) ?? ""}
                        onChange={(e) =>
                          header.column.setFilterValue(e.target.value || undefined)
                        }
                      >
                        <option value="">All</option>
                        {allProfiles.map((name) => (
                          <option key={name} value={name}>{name}</option>
                        ))}
                      </select>
                    </TableHead>
                  );
                }
                if (columnId === "team") {
                  return (
                    <TableHead key={`filter-${header.id}`} className="py-2">
                      <select
                        className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
                        value={(header.column.getFilterValue() as string) ?? ""}
                        onChange={(e) =>
                          header.column.setFilterValue(e.target.value || undefined)
                        }
                      >
                        <option value="">All</option>
                        {teams.map((team) => (
                          <option key={team.id} value={team.name}>
                            {team.name}
                          </option>
                        ))}
                      </select>
                    </TableHead>
                  );
                }
                if (columnId === "status") {
                  return (
                    <TableHead key={`filter-${header.id}`} className="py-2">
                      <select
                        className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
                        value={(header.column.getFilterValue() as string) ?? ""}
                        onChange={(e) =>
                          header.column.setFilterValue(e.target.value || undefined)
                        }
                      >
                        <option value="">All</option>
                        <option value="Active">Active</option>
                        <option value="Invited">Invited</option>
                        <option value="Not invited">Not invited</option>
                      </select>
                    </TableHead>
                  );
                }
                const cfDef = customFieldDefs.find((d) => `cf_${d.field_key}` === columnId);
                if (columnId === "last_log_in" || (cfDef && cfDef.field_type === "date")) {
                  const df = (header.column.getFilterValue() as { preset?: string; from?: string; to?: string }) ?? {};
                  return (
                    <TableHead key={`filter-${header.id}`} className="py-2">
                      <div className="flex flex-col gap-1">
                        <select
                          className="h-7 w-full rounded-md border border-input bg-background px-2 text-xs"
                          value={df.preset ?? ""}
                          onChange={(e) => {
                            const preset = e.target.value;
                            header.column.setFilterValue(preset ? { preset } : undefined);
                          }}
                        >
                          <option value="">Any time</option>
                          <option value="last_week">Last Week</option>
                          <option value="this_week">This Week</option>
                          <option value="next_week">Next Week</option>
                          <option value="last_month">Last Month</option>
                          <option value="this_month">This Month</option>
                          <option value="next_month">Next Month</option>
                          <option value="last_year">Last Year</option>
                          <option value="this_year">This Year</option>
                          <option value="next_year">Next Year</option>
                          <option value="custom">Custom range...</option>
                        </select>
                        {df.preset === "custom" && (
                          <>
                            <input
                              type="date"
                              className="h-7 w-full rounded-md border border-input bg-background px-2 text-xs"
                              placeholder="From"
                              value={df.from ?? ""}
                              onChange={(e) =>
                                header.column.setFilterValue({ ...df, from: e.target.value || undefined })
                              }
                            />
                            <input
                              type="date"
                              className="h-7 w-full rounded-md border border-input bg-background px-2 text-xs"
                              placeholder="To"
                              value={df.to ?? ""}
                              onChange={(e) =>
                                header.column.setFilterValue({ ...df, to: e.target.value || undefined })
                              }
                            />
                          </>
                        )}
                      </div>
                    </TableHead>
                  );
                }
                if (cfDef && (cfDef.field_type === "number" || cfDef.field_type === "currency")) {
                  const nf = (header.column.getFilterValue() as { op?: string; val?: string; val2?: string }) ?? {};
                  return (
                    <TableHead key={`filter-${header.id}`} className="py-2">
                      <div className="flex flex-col gap-1">
                        <select
                          className="h-7 w-full rounded-md border border-input bg-background px-2 text-xs"
                          value={nf.op ?? ""}
                          onChange={(e) => {
                            const op = e.target.value;
                            header.column.setFilterValue(op ? { ...nf, op } : undefined);
                          }}
                        >
                          <option value="">Any</option>
                          <option value="gt">&gt; Greater than</option>
                          <option value="lt">&lt; Less than</option>
                          <option value="between">Between</option>
                        </select>
                        {nf.op && (
                          <input
                            type="number"
                            className="h-7 w-full rounded-md border border-input bg-background px-2 text-xs"
                            placeholder={nf.op === "between" ? "From" : "Value"}
                            value={nf.val ?? ""}
                            onChange={(e) =>
                              header.column.setFilterValue({ ...nf, val: e.target.value || undefined })
                            }
                          />
                        )}
                        {nf.op === "between" && (
                          <input
                            type="number"
                            className="h-7 w-full rounded-md border border-input bg-background px-2 text-xs"
                            placeholder="To"
                            value={nf.val2 ?? ""}
                            onChange={(e) =>
                              header.column.setFilterValue({ ...nf, val2: e.target.value || undefined })
                            }
                          />
                        )}
                      </div>
                    </TableHead>
                  );
                }
                return (
                  <TableHead key={`filter-${header.id}`} className="py-2">
                    <Input
                      placeholder="Filter..."
                      className="h-8 text-sm"
                      value={(header.column.getFilterValue() as string) ?? ""}
                      onChange={(e) =>
                        header.column.setFilterValue(e.target.value || undefined)
                      }
                    />
                  </TableHead>
                );
              })}
            </TableRow>
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  className={canEdit ? "cursor-pointer" : ""}
                  onClick={() => canEdit && setEditingMember(row.original)}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext()
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="h-24 text-center"
                >
                  No {pluralize(memberLabel)} found.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>}

      {/* Pagination */}
      <div className="mt-4 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span>Rows per page</span>
          <select
            className="h-8 rounded-md border border-input bg-background px-2 text-sm"
            value={pageSize}
            onChange={(e) => {
              const n = parseInt(e.target.value, 10);
              setPageSize(n);
              setPageIndex(0);
            }}
          >
            {[10, 25, 50, 100, 250].map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">
            Page {pageIndex + 1} of {Math.max(1, table.getPageCount())}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPageIndex((p) => p - 1)}
            disabled={!table.getCanPreviousPage()}
          >
            ← Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPageIndex((p) => p + 1)}
            disabled={!table.getCanNextPage()}
          >
            Next →
          </Button>
        </div>
      </div>

      {/* Action buttons */}
      <div className="mt-4 flex justify-center gap-2">
        {columnFilters.length > 0 && (
          <Button
            variant="outline"
            onClick={() => setColumnFilters([])}
          >
            Clear Filters
          </Button>
        )}
        <Button
          variant="outline"
          onClick={() => setShowPdfDialog(true)}
          disabled={pdfLoading}
        >
          <FileDown className="h-4 w-4 mr-2" />
          {pdfLoading ? "Generating..." : "Download PDF"}
        </Button>
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

      {/* Column customiser dialog */}
      <ColumnCustomiserDialog
        open={showCustomiser}
        onOpenChange={setShowCustomiser}
        prefs={prefs}
        colLabels={allColLabels}
        defaultCols={allDefaultCols}
        onChange={(newPrefs) => {
          updatePrefs(newPrefs);
        }}
      />

      {/* Dialogs */}
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

      {/* Capacity reached dialog */}
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

      {/* PDF orientation dialog */}
      <Dialog open={showPdfDialog} onOpenChange={setShowPdfDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Download PDF</DialogTitle>
            <DialogDescription>
              Choose the page orientation for your report.
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-3 justify-center py-4">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => handleDownloadPdf("portrait")}
            >
              Portrait
            </Button>
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => handleDownloadPdf("landscape")}
            >
              Landscape
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog
        open={!!deletingMember}
        onOpenChange={(open) => !open && setDeletingMember(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {capitalize(memberLabel)}
            </AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete{" "}
              <strong>
                {deletingMember?.first_name} {deletingMember?.last_name}
              </strong>
              ? This will permanently remove them from the organisation
              {deletingMember?.user_id
                ? " and delete their user account"
                : ""}
              . This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteLoading}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={deleteLoading}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={async (e) => {
                e.preventDefault();
                if (!deletingMember) return;
                setDeleteLoading(true);
                const result = await deleteEmployee(
                  deletingMember.member_id
                );
                setDeleteLoading(false);
                if (result.success) {
                  setMembers((prev) =>
                    prev.filter(
                      (m) => m.member_id !== deletingMember.member_id
                    )
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
