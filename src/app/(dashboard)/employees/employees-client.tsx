"use client";

import { useState } from "react";
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import Link from "next/link";
import { Pencil, Plus, ArrowUpDown, Trash2 } from "lucide-react";
import { useMemberLabel } from "@/contexts/member-label-context";
import { capitalize, pluralize } from "@/lib/label-utils";
import { deleteEmployee } from "./actions";
import { Button } from "@/components/ui/button";
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

interface EmployeesClientProps {
  initialMembers: Member[];
  canManage: boolean;
  maxEmployees: number;
  isOwner: boolean;
  teams: Team[];
}

export function EmployeesClient({
  initialMembers,
  canManage,
  maxEmployees,
  isOwner,
  teams,
}: EmployeesClientProps) {
  const { memberLabel } = useMemberLabel();
  const teamMap = Object.fromEntries(teams.map((t) => [t.id, t.name]));
  const [members, setMembers] = useState(initialMembers);
  const [sorting, setSorting] = useState<SortingState>([]);
  const [editingMember, setEditingMember] = useState<Member | null>(null);
  const [deletingMember, setDeletingMember] = useState<Member | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showCapacityDialog, setShowCapacityDialog] = useState(false);
  const atCapacity = members.length >= maxEmployees;

  const columns: ColumnDef<Member>[] = [
    {
      accessorKey: "first_name",
      header: ({ column }) => (
        <Button
          variant="ghost"
          className="-ml-4"
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
        >
          First Name
          <ArrowUpDown className="ml-2 h-4 w-4" />
        </Button>
      ),
    },
    {
      accessorKey: "last_name",
      header: ({ column }) => (
        <Button
          variant="ghost"
          className="-ml-4"
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
        >
          Last Name
          <ArrowUpDown className="ml-2 h-4 w-4" />
        </Button>
      ),
    },
    {
      id: "role",
      accessorFn: (row) =>
        row.role === "admin" ? "Admin" : row.role === "owner" ? "Owner" : capitalize(memberLabel),
      header: ({ column }) => (
        <Button
          variant="ghost"
          className="-ml-4"
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
        >
          Role
          <ArrowUpDown className="ml-2 h-4 w-4" />
        </Button>
      ),
      cell: ({ row }) => <RoleBadge role={row.original.role} memberLabel={memberLabel} />,
    },
    {
      id: "team",
      accessorFn: (row) => (row.team_id ? teamMap[row.team_id] ?? "—" : "—"),
      header: ({ column }) => (
        <Button
          variant="ghost"
          className="-ml-4"
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
        >
          Team
          <ArrowUpDown className="ml-2 h-4 w-4" />
        </Button>
      ),
    },
    {
      accessorKey: "email",
      header: ({ column }) => (
        <Button
          variant="ghost"
          className="-ml-4"
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
        >
          Email Address
          <ArrowUpDown className="ml-2 h-4 w-4" />
        </Button>
      ),
    },
    {
      id: "status",
      header: "Status",
      cell: ({ row }) => <InviteStatus member={row.original} />,
    },
    ...(canManage
      ? [
          {
            id: "actions",
            cell: ({ row }: { row: { original: Member } }) => (
              <div className="flex justify-end gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setEditingMember(row.original)}
                >
                  <Pencil className="h-4 w-4" />
                </Button>
                {row.original.role !== "owner" && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setDeletingMember(row.original)}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                )}
              </div>
            ),
          } satisfies ColumnDef<Member>,
        ]
      : []),
  ];

  const table = useReactTable({
    data: members,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <h1 className="text-2xl font-bold mb-6">
        {capitalize(pluralize(memberLabel))} Directory
      </h1>

      {/* Table */}
      <div className="rounded-md border">
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
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id}>
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
      </div>

      {/* Add button */}
      {canManage && (
        <div className="mt-4 flex justify-center">
          <Button
            variant="outline"
            onClick={() => atCapacity ? setShowCapacityDialog(true) : setShowAddDialog(true)}
          >
            <Plus className="h-4 w-4 mr-2" />
            Add {capitalize(memberLabel)}
          </Button>
        </div>
      )}

      {/* Dialogs */}
      <EditEmployeeDialog
        member={editingMember}
        open={!!editingMember}
        onOpenChange={(open) => !open && setEditingMember(null)}
        teams={teams}
        onSaved={(updated) => {
          setMembers((prev) =>
            prev.map((m) =>
              m.member_id === updated.member_id
                ? { ...m, first_name: updated.first_name, last_name: updated.last_name, role: updated.role, team_id: updated.team_id }
                : m
            )
          );
          setEditingMember(null);
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
        onAdded={(newMember) => {
          setMembers((prev) => [...prev, newMember]);
          setShowAddDialog(false);
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
