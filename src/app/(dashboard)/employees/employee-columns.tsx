"use client";

import type { ColumnDef, Column, RowData } from "@tanstack/react-table";
import type { ReactNode } from "react";
import { ArrowUp, ArrowDown, ArrowUpDown, Trash2, MoreHorizontal, Clock, CalendarDays, LayoutDashboard, Settings } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { capitalize } from "@/lib/label-utils";
import type { Profile } from "./profile-actions";
import type { FieldDef } from "./custom-field-actions";

// ---------------------------------------------------------------------------
// TanStack Table module augmentation — adds filterElement + class helpers to
// every ColumnDef's meta object
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-unused-vars
declare module "@tanstack/react-table" {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData extends RowData, TValue> {
    /** Per-column filter UI rendered in the filter row */
    filterElement?: (column: Column<TData, unknown>) => ReactNode;
    /** Extra classes for the <TableHead> cell */
    headerClassName?: string;
    /** Extra classes for the <TableCell> cell */
    cellClassName?: string;
    /** Returns the raw numeric value for aggregation, or null if not applicable */
    getAggregateValue?: (row: TData) => number | null;
    aggregateFormat?: "currency" | "number";
    aggregateCurrencySymbol?: string;
    aggregateDecimals?: number | null;
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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
  updated_at: string | null;
};

// ---------------------------------------------------------------------------
// Badge components
// ---------------------------------------------------------------------------

export function RoleBadge({ role, memberLabel }: { role: string; memberLabel: string }) {
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

export function InviteStatus({ member }: { member: Member }) {
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

// ---------------------------------------------------------------------------
// Date utilities
// ---------------------------------------------------------------------------

export function getDateRange(preset: string): { from: string; to: string } | null {
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

export const DATE_PRESET_LABELS: Record<string, string> = {
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

// ---------------------------------------------------------------------------
// Column ID constants
// ---------------------------------------------------------------------------

export const ALL_EMPLOYEE_COLS = [
  "avatar", "first_name", "last_name", "payroll_number", "email", "role", "profile",
  "team", "status", "last_log_in",
];

export const DEFAULT_EMPLOYEE_COLS = [
  "avatar", "first_name", "last_name", "payroll_number", "email", "role", "profile",
  "team", "status",
];

export const EMPLOYEE_COL_LABELS: Record<string, string> = {
  avatar: "Avatar",
  first_name: "First Name",
  last_name: "Last Name",
  payroll_number: "Payroll #",
  email: "Email",
  role: "Role",
  profile: "Profile",
  team: "Team",
  status: "Status",
  last_log_in: "Last Log-in",
};

// ---------------------------------------------------------------------------
// Shared sort header button
// ---------------------------------------------------------------------------

function SortHeader({ column, label }: { column: Column<Member, unknown>; label: string }) {
  return (
    <Button
      variant="ghost"
      className="-ml-4"
      onMouseDown={(e) => e.preventDefault()}
      onClick={(e) => column.getToggleSortingHandler()?.(e)}
    >
      {label}
      {column.getIsSorted() === "asc" ? (
        <ArrowUp className="ml-2 h-4 w-4" />
      ) : column.getIsSorted() === "desc" ? (
        <ArrowDown className="ml-2 h-4 w-4" />
      ) : (
        <ArrowUpDown className="ml-2 h-4 w-4 opacity-40" />
      )}
    </Button>
  );
}

// Date preset filter UI — reused for last_log_in and date-type custom fields
function DatePresetFilter({ column }: { column: Column<Member, unknown> }) {
  const df = (column.getFilterValue() as { preset?: string; from?: string; to?: string }) ?? {};
  return (
    <div className="flex flex-col gap-1">
      <select
        className="h-7 w-full rounded-md border border-input bg-background px-2 text-xs"
        value={df.preset ?? ""}
        onChange={(e) => {
          const preset = e.target.value;
          column.setFilterValue(preset ? { preset } : undefined);
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
            value={df.from ?? ""}
            onChange={(e) =>
              column.setFilterValue({ ...df, from: e.target.value || undefined })
            }
          />
          <input
            type="date"
            className="h-7 w-full rounded-md border border-input bg-background px-2 text-xs"
            value={df.to ?? ""}
            onChange={(e) =>
              column.setFilterValue({ ...df, to: e.target.value || undefined })
            }
          />
        </>
      )}
    </div>
  );
}

// Number/currency filter UI
function NumberFilter({ column }: { column: Column<Member, unknown> }) {
  const nf = (column.getFilterValue() as { op?: string; val?: string; val2?: string }) ?? {};
  return (
    <div className="flex flex-col gap-1">
      <select
        className="h-7 w-full rounded-md border border-input bg-background px-2 text-xs"
        value={nf.op ?? ""}
        onChange={(e) => {
          const op = e.target.value;
          column.setFilterValue(op ? { ...nf, op } : undefined);
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
            column.setFilterValue({ ...nf, val: e.target.value || undefined })
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
            column.setFilterValue({ ...nf, val2: e.target.value || undefined })
          }
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Column builder
// ---------------------------------------------------------------------------

export function buildEmployeeColumns(opts: {
  teams: Team[];
  adminProfiles: Profile[];
  employeeProfiles: Profile[];
  memberLabel: string;
  canAdd: boolean;
  currencySymbol: string;
  customFieldDefs: FieldDef[];
  onDelete?: (member: Member) => void;
}): ColumnDef<Member>[] {
  const { teams, adminProfiles, employeeProfiles, memberLabel, canAdd, currencySymbol, customFieldDefs, onDelete } = opts;
  const teamMap = Object.fromEntries(teams.map((t) => [t.id, t.name]));

  return [
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
      meta: {
        headerClassName: "w-20 shrink-0",
        cellClassName: "w-20 shrink-0 py-2",
      },
    },
    {
      accessorKey: "first_name",
      sortingFn: (rowA, rowB) =>
        rowA.original.first_name.localeCompare(rowB.original.first_name, undefined, { sensitivity: "base" }),
      header: ({ column }) => <SortHeader column={column as Column<Member, unknown>} label="First Name" />,
    },
    {
      accessorKey: "last_name",
      sortingFn: (rowA, rowB) =>
        rowA.original.last_name.localeCompare(rowB.original.last_name, undefined, { sensitivity: "base" }),
      header: ({ column }) => <SortHeader column={column as Column<Member, unknown>} label="Last Name" />,
    },
    {
      accessorKey: "payroll_number",
      sortingFn: (rowA, rowB) =>
        (rowA.original.payroll_number ?? "").localeCompare(rowB.original.payroll_number ?? "", undefined, { sensitivity: "base" }),
      header: ({ column }) => <SortHeader column={column as Column<Member, unknown>} label="Payroll #" />,
      cell: ({ row }) => row.original.payroll_number ?? "—",
    },
    {
      id: "role",
      accessorFn: (row) =>
        row.role === "admin" ? "Admin" : row.role === "owner" ? "Owner" : capitalize(memberLabel),
      header: ({ column }) => <SortHeader column={column as Column<Member, unknown>} label="Role" />,
      cell: ({ row }) => <RoleBadge role={row.original.role} memberLabel={memberLabel} />,
      meta: {
        filterElement: (column) => (
          <select
            className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
            value={(column.getFilterValue() as string) ?? ""}
            onChange={(e) => column.setFilterValue(e.target.value || undefined)}
          >
            <option value="">All</option>
            <option value="Owner">Owner</option>
            <option value="Admin">Admin</option>
            <option value={capitalize(memberLabel)}>{capitalize(memberLabel)}</option>
          </select>
        ),
      },
    },
    {
      id: "profile",
      accessorFn: (row) => row.profile_name ?? "—",
      sortingFn: (rowA, rowB) => {
        const a = rowA.original.profile_name ?? "";
        const b = rowB.original.profile_name ?? "";
        return a.localeCompare(b, undefined, { sensitivity: "base" });
      },
      header: ({ column }) => <SortHeader column={column as Column<Member, unknown>} label="Profile" />,
      cell: ({ row }) => row.original.profile_name ?? "—",
      meta: {
        filterElement: (column) => {
          const allProfiles = [...adminProfiles, ...employeeProfiles]
            .map((p) => p.name)
            .filter((name, i, arr) => arr.indexOf(name) === i)
            .sort();
          return (
            <select
              className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
              value={(column.getFilterValue() as string) ?? ""}
              onChange={(e) => column.setFilterValue(e.target.value || undefined)}
            >
              <option value="">All</option>
              {allProfiles.map((name) => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
          );
        },
      },
    },
    {
      id: "team",
      accessorFn: (row) => (row.team_id ? teamMap[row.team_id] ?? "—" : "—"),
      sortingFn: (rowA, rowB) => {
        const a = rowA.getValue<string>("team");
        const b = rowB.getValue<string>("team");
        return a.localeCompare(b, undefined, { sensitivity: "base" });
      },
      header: ({ column }) => <SortHeader column={column as Column<Member, unknown>} label="Team" />,
      meta: {
        filterElement: (column) => (
          <select
            className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
            value={(column.getFilterValue() as string) ?? ""}
            onChange={(e) => column.setFilterValue(e.target.value || undefined)}
          >
            <option value="">All</option>
            {teams.map((team) => (
              <option key={team.id} value={team.name}>{team.name}</option>
            ))}
          </select>
        ),
      },
    },
    {
      accessorKey: "email",
      sortingFn: (rowA, rowB) =>
        rowA.original.email.localeCompare(rowB.original.email, undefined, { sensitivity: "base" }),
      header: ({ column }) => <SortHeader column={column as Column<Member, unknown>} label="Email Address" />,
    },
    {
      id: "status",
      accessorFn: (row) =>
        row.accepted_at ? "Active" : row.invited_at ? "Invited" : "Not invited",
      header: "Status",
      cell: ({ row }) => <InviteStatus member={row.original} />,
      meta: {
        filterElement: (column) => (
          <select
            className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
            value={(column.getFilterValue() as string) ?? ""}
            onChange={(e) => column.setFilterValue(e.target.value || undefined)}
          >
            <option value="">All</option>
            <option value="Active">Active</option>
            <option value="Invited">Invited</option>
            <option value="Not invited">Not invited</option>
          </select>
        ),
      },
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
      header: ({ column }) => <SortHeader column={column as Column<Member, unknown>} label="Last Log-in" />,
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
      meta: {
        filterElement: (column) => <DatePresetFilter column={column} />,
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
      header: ({ column }) => <SortHeader column={column as Column<Member, unknown>} label={def.label} />,
      ...(def.field_type === "number" || def.field_type === "currency"
        ? {
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
            meta: {
              filterElement: (column: Column<Member, unknown>) => <NumberFilter column={column} />,
              getAggregateValue: (row: Member) => {
                const val = row.custom_fields?.[def.field_key];
                if (val === null || val === undefined || val === "") return null;
                const num = Number(val);
                return isNaN(num) ? null : num;
              },
              aggregateFormat: def.field_type as "currency" | "number",
              aggregateCurrencySymbol: def.field_type === "currency" ? currencySymbol : undefined,
              aggregateDecimals: def.field_type === "number" ? def.max_decimal_places : 2,
            },
          }
        : def.field_type === "date"
        ? {
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
            meta: { filterElement: (column: Column<Member, unknown>) => <DatePresetFilter column={column} /> },
          }
        : {}),
    })),
    {
      id: "actions",
      enableSorting: false,
      enableColumnFilter: false,
      header: () => null,
      cell: ({ row }: { row: { original: Member } }) => {
        const memberId = row.original.member_id;
        const isOwner = row.original.role === "owner";
        return (
          <div className="flex justify-end" onClick={(e) => e.stopPropagation()}>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon">
                  <MoreHorizontal className="h-4 w-4" />
                  <span className="sr-only">Open menu</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem asChild>
                  <Link href={`/timesheets/${memberId}`}>
                    <Clock className="mr-2 h-4 w-4" />
                    Timesheet
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href={`/employees/${memberId}/dashboard`}>
                    <LayoutDashboard className="mr-2 h-4 w-4" />
                    Dashboard
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href={`/employees/${memberId}/calendar`}>
                    <CalendarDays className="mr-2 h-4 w-4" />
                    Calendar
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href={`/employees/${memberId}/settings`}>
                    <Settings className="mr-2 h-4 w-4" />
                    Settings
                  </Link>
                </DropdownMenuItem>
                {canAdd && !isOwner && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="text-destructive focus:text-destructive"
                      onClick={() => onDelete?.(row.original)}
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      Delete
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        );
      },
    } satisfies ColumnDef<Member>,
  ];
}
