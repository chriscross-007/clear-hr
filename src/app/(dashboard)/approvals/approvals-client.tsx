"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, X, Loader2, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  approveBooking,
  rejectBooking,
  type ApprovalRow,
} from "../approvals-actions";
import { TeamCalendar, type TeamMember, type TeamBooking, type TeamBankHoliday } from "@/components/team-calendar";

interface ApprovalsClientProps {
  pendingRows: ApprovalRow[];
  allRows: ApprovalRow[];
  calendarMembers: (TeamMember & { teamId: string | null })[];
  calendarBookings: TeamBooking[];
  calendarBankHolidays: TeamBankHoliday[];
}

function fmtDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00Z");
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  const date = d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });
  return `${date} ${time}`;
}

function fmtDateRange(start: string, end: string, startHalf: string | null, endHalf: string | null): string {
  const sameDay = start === end;
  let label = sameDay ? fmtDate(start) : `${fmtDate(start)} – ${fmtDate(end)}`;
  if (startHalf) label += ` (${startHalf.toUpperCase()})`;
  if (!sameDay && endHalf) label += ` to (${endHalf.toUpperCase()})`;
  return label;
}

const STATUS_BADGE: Record<string, { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
  pending: { label: "Pending", variant: "outline" },
  approved: { label: "Approved", variant: "default" },
  rejected: { label: "Rejected", variant: "destructive" },
  cancelled: { label: "Cancelled", variant: "secondary" },
};

export function ApprovalsClient({ pendingRows, allRows, calendarMembers, calendarBookings, calendarBankHolidays }: ApprovalsClientProps) {
  const router = useRouter();
  const [approvingRow, setApprovingRow] = useState<ApprovalRow | null>(null);
  const [approveNote, setApproveNote] = useState("");
  const [approveLoading, setApproveLoading] = useState(false);
  const [rejectingRow, setRejectingRow] = useState<ApprovalRow | null>(null);
  const [rejectNote, setRejectNote] = useState("");
  const [rejectLoading, setRejectLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState("all");
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);

  async function handleApprove() {
    if (!approvingRow) return;
    setApproveLoading(true);
    const result = await approveBooking(approvingRow.id, approveNote);
    setApproveLoading(false);
    if (result.success) {
      setApprovingRow(null);
      setApproveNote("");
      router.refresh();
    }
  }

  async function handleReject() {
    if (!rejectingRow) return;
    setRejectLoading(true);
    const result = await rejectBooking(rejectingRow.id, rejectNote);
    setRejectLoading(false);
    if (result.success) {
      setRejectingRow(null);
      setRejectNote("");
      router.refresh();
    }
  }

  const filteredAllRows = statusFilter === "all"
    ? allRows
    : allRows.filter((r) => r.status === statusFilter);

  const pendingCount = pendingRows.length;

  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Holiday Approvals</h1>
      </div>

      <Tabs defaultValue="pending" className="w-full">
        <TabsList>
          <TabsTrigger value="pending">
            Pending{pendingCount > 0 && ` (${pendingCount})`}
          </TabsTrigger>
          <TabsTrigger value="all">All Requests</TabsTrigger>
        </TabsList>

        <TabsContent value="pending" className="mt-4">
          <ApprovalsTable
            rows={pendingRows}
            showActions
            onApprove={(row) => { setApproveNote(""); setApprovingRow(row); }}
            onReject={(row) => { setRejectNote(""); setRejectingRow(row); }}
            emptyMessage="No pending requests."
            expandedRowId={expandedRowId}
            onToggleCalendar={(rowId) => setExpandedRowId((prev) => prev === rowId ? null : rowId)}
            calendarMembers={calendarMembers}
            calendarBookings={calendarBookings}
            calendarBankHolidays={calendarBankHolidays}
          />
        </TabsContent>

        <TabsContent value="all" className="mt-4 space-y-4">
          <div className="flex items-center gap-2">
            <Label className="text-sm text-muted-foreground">Status:</Label>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="approved">Approved</SelectItem>
                <SelectItem value="rejected">Rejected</SelectItem>
                <SelectItem value="cancelled">Cancelled</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <ApprovalsTable
            rows={filteredAllRows}
            showActions={false}
            onApprove={() => {}}
            onReject={() => {}}
            emptyMessage="No requests found."
          />
        </TabsContent>
      </Tabs>

      {/* Approve dialog */}
      <Dialog open={!!approvingRow} onOpenChange={(open) => { if (!open) setApprovingRow(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Approve Holiday Request</DialogTitle>
            <DialogDescription>
              {approvingRow && (
                <>
                  <strong>{approvingRow.member_name}</strong> —{" "}
                  {fmtDateRange(approvingRow.start_date, approvingRow.end_date, approvingRow.start_half, approvingRow.end_half)}{" "}
                  ({approvingRow.reason_name})
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="approve-note">Add a note for the employee (optional)</Label>
            <Textarea
              id="approve-note"
              value={approveNote}
              onChange={(e) => setApproveNote(e.target.value)}
              rows={3}
              placeholder="Optional"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setApprovingRow(null)} disabled={approveLoading}>
              Cancel
            </Button>
            <Button
              className="bg-green-600 text-white hover:bg-green-700"
              onClick={handleApprove}
              disabled={approveLoading}
            >
              {approveLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Approve
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reject dialog */}
      <Dialog open={!!rejectingRow} onOpenChange={(open) => { if (!open) setRejectingRow(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject Holiday Request</DialogTitle>
            <DialogDescription>
              {rejectingRow && (
                <>
                  <strong>{rejectingRow.member_name}</strong> —{" "}
                  {fmtDateRange(rejectingRow.start_date, rejectingRow.end_date, rejectingRow.start_half, rejectingRow.end_half)}{" "}
                  ({rejectingRow.reason_name})
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="reject-note">Reason for rejection (shown to employee)</Label>
            <Textarea
              id="reject-note"
              value={rejectNote}
              onChange={(e) => setRejectNote(e.target.value)}
              rows={3}
              placeholder="Optional"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectingRow(null)} disabled={rejectLoading}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleReject}
              disabled={rejectLoading}
            >
              {rejectLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Reject Request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ---------------------------------------------------------------------------
// Overlap-sorted members for inline calendar
// ---------------------------------------------------------------------------

function getOverlapDays(aStart: string, aEnd: string, bStart: string, bEnd: string): number {
  const s = aStart > bStart ? aStart : bStart;
  const e = aEnd < bEnd ? aEnd : bEnd;
  if (s > e) return 0;
  const ms = Date.parse(e + "T00:00:00Z") - Date.parse(s + "T00:00:00Z");
  return Math.floor(ms / 86_400_000) + 1;
}

function sortMembersForApproval(
  row: ApprovalRow,
  members: (TeamMember & { teamId: string | null })[],
  bookings: TeamBooking[],
): (TeamMember & { teamId: string | null })[] {
  const requestor = members.find((m) => m.id === row.member_id);
  const teamId = requestor?.teamId ?? null;

  // Filter to same team (if requestor has a team), otherwise show all
  const teamMembers = teamId
    ? members.filter((m) => m.teamId === teamId)
    : members;

  // For each member, compute: approved overlap days, pending overlap days,
  // and earliest overlapping pending booking created_at
  const approvedOverlap = new Map<string, number>();
  const pendingOverlap = new Map<string, number>();
  const earliestPendingCreatedAt = new Map<string, string>();

  for (const m of teamMembers) {
    let approvedDays = 0;
    let pendingDays = 0;
    let earliestCa: string | null = null;

    for (const b of bookings) {
      if (b.member_id !== m.id) continue;
      const overlap = getOverlapDays(row.start_date, row.end_date, b.start_date, b.end_date);
      if (overlap === 0) continue;

      if (b.status === "approved") {
        approvedDays += overlap;
      } else if (b.status === "pending") {
        pendingDays += overlap;
        if (b.created_at && (!earliestCa || b.created_at < earliestCa)) {
          earliestCa = b.created_at;
        }
      }
    }

    approvedOverlap.set(m.id, approvedDays);
    pendingOverlap.set(m.id, pendingDays);
    if (earliestCa) earliestPendingCreatedAt.set(m.id, earliestCa);
  }

  // Assign each member to a group:
  // 1 = approved overlap, 2 = pending overlap (no approved), 3 = no overlap
  function getGroup(id: string): number {
    if ((approvedOverlap.get(id) ?? 0) > 0) return 1;
    if ((pendingOverlap.get(id) ?? 0) > 0) return 2;
    return 3;
  }

  return [...teamMembers].sort((a, b) => {
    const gA = getGroup(a.id);
    const gB = getGroup(b.id);
    if (gA !== gB) return gA - gB;

    if (gA === 1) {
      // Group 1: descending by approved overlap days
      return (approvedOverlap.get(b.id) ?? 0) - (approvedOverlap.get(a.id) ?? 0);
    }
    if (gA === 2) {
      // Group 2: ascending by earliest pending created_at
      const caA = earliestPendingCreatedAt.get(a.id) ?? "";
      const caB = earliestPendingCreatedAt.get(b.id) ?? "";
      return caA < caB ? -1 : caA > caB ? 1 : 0;
    }
    // Group 3: alphabetical by name
    return a.name.localeCompare(b.name);
  });
}

// ---------------------------------------------------------------------------
// Shared table component
// ---------------------------------------------------------------------------

function ApprovalsTable({
  rows,
  showActions,
  onApprove,
  onReject,
  emptyMessage,
  expandedRowId,
  onToggleCalendar,
  calendarMembers,
  calendarBookings,
  calendarBankHolidays,
}: {
  rows: ApprovalRow[];
  showActions: boolean;
  onApprove: (row: ApprovalRow) => void;
  onReject: (row: ApprovalRow) => void;
  emptyMessage: string;
  expandedRowId?: string | null;
  onToggleCalendar?: (rowId: string) => void;
  calendarMembers?: (TeamMember & { teamId: string | null })[];
  calendarBookings?: TeamBooking[];
  calendarBankHolidays?: TeamBankHoliday[];
}) {
  return (
    <div className="flex justify-center w-full">
      <div className="w-auto max-w-[90%] min-w-0">
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Requested</TableHead>
                <TableHead>Employee</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Dates</TableHead>
                <TableHead>Days/Hours</TableHead>
                <TableHead>Notes</TableHead>
                <TableHead>Status</TableHead>
                {showActions && <TableHead className="w-32">Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={showActions ? 8 : 7} className="h-24 text-center text-muted-foreground">
                    {emptyMessage}
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row) => {
                  const unit = row.measurement_mode === "hours" ? "hours" : "days";
                  const val = row.measurement_mode === "hours" ? row.hours_deducted : row.days_deducted;
                  const badge = STATUS_BADGE[row.status] ?? STATUS_BADGE.pending;
                  return (
                    <React.Fragment key={row.id}>
                    <TableRow>
                      <TableCell className="whitespace-nowrap text-muted-foreground">{fmtDateTime(row.created_at)}</TableCell>
                      <TableCell className="font-medium">{row.member_name}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span
                            className="inline-block h-2.5 w-2.5 rounded-full shrink-0"
                            style={{ backgroundColor: row.reason_colour }}
                          />
                          {row.reason_name}
                        </div>
                      </TableCell>
                      <TableCell>
                        {fmtDateRange(row.start_date, row.end_date, row.start_half, row.end_half)}
                      </TableCell>
                      <TableCell>{val ?? "—"} {val !== null ? unit : ""}</TableCell>
                      <TableCell className="max-w-60 text-muted-foreground">
                        <div className="space-y-0.5">
                          {row.employee_note && <p className="truncate italic">{row.member_name}: {row.employee_note}</p>}
                          {row.approver_note && <p className="truncate">{row.approver_name ?? "Approver"}: {row.approver_note}</p>}
                          {!row.employee_note && !row.approver_note && ""}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={badge.variant}>{badge.label}</Badge>
                      </TableCell>
                      {showActions && (
                        <TableCell>
                          {row.status === "pending" && (
                            <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                              <Button
                                size="sm"
                                variant={expandedRowId === row.id ? "secondary" : "ghost"}
                                title="View team availability"
                                onClick={() => onToggleCalendar?.(row.id)}
                              >
                                <Info className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="text-green-600 border-green-200 hover:bg-green-50 dark:hover:bg-green-950/30"
                                onClick={() => onApprove(row)}
                              >
                                <Check className="h-3.5 w-3.5 mr-1" />
                                Approve
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="text-red-600 border-red-200 hover:bg-red-50 dark:hover:bg-red-950/30"
                                onClick={() => onReject(row)}
                              >
                                <X className="h-3.5 w-3.5 mr-1" />
                                Reject
                              </Button>
                            </div>
                          )}
                        </TableCell>
                      )}
                    </TableRow>
                    {expandedRowId === row.id && calendarMembers && calendarBookings && calendarBankHolidays && (() => {
                      const sorted = sortMembersForApproval(row, calendarMembers, calendarBookings);
                      return (
                        <TableRow>
                          <TableCell colSpan={showActions ? 8 : 7} className="p-4 bg-muted/30">
                            <div className="flex justify-center">
                              <div className="w-fit overflow-x-auto">
                                <TeamCalendar
                                  members={sorted}
                                  bookings={calendarBookings}
                                  bankHolidays={calendarBankHolidays}
                                  highlightMemberId={row.member_id}
                                  focusRange={{ startDate: row.start_date, endDate: row.end_date }}
                                />
                              </div>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })()}
                  </React.Fragment>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}
