"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, X, Loader2 } from "lucide-react";
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

interface ApprovalsClientProps {
  pendingRows: ApprovalRow[];
  allRows: ApprovalRow[];
}

function fmtDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00Z");
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
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

export function ApprovalsClient({ pendingRows, allRows }: ApprovalsClientProps) {
  const router = useRouter();
  const [approvingRow, setApprovingRow] = useState<ApprovalRow | null>(null);
  const [approveNote, setApproveNote] = useState("");
  const [approveLoading, setApproveLoading] = useState(false);
  const [rejectingRow, setRejectingRow] = useState<ApprovalRow | null>(null);
  const [rejectNote, setRejectNote] = useState("");
  const [rejectLoading, setRejectLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState("all");

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
// Shared table component
// ---------------------------------------------------------------------------

function ApprovalsTable({
  rows,
  showActions,
  onApprove,
  onReject,
  emptyMessage,
}: {
  rows: ApprovalRow[];
  showActions: boolean;
  onApprove: (row: ApprovalRow) => void;
  onReject: (row: ApprovalRow) => void;
  emptyMessage: string;
}) {
  return (
    <div className="flex justify-center w-full">
      <div className="w-auto max-w-[90%] min-w-0">
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Employee</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Dates</TableHead>
                <TableHead>Days/Hours</TableHead>
                <TableHead>Notes</TableHead>
                <TableHead>Submitted</TableHead>
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
                    <TableRow key={row.id}>
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
                      <TableCell>{fmtDate(row.created_at.slice(0, 10))}</TableCell>
                      <TableCell>
                        <Badge variant={badge.variant}>{badge.label}</Badge>
                      </TableCell>
                      {showActions && (
                        <TableCell>
                          {row.status === "pending" && (
                            <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
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
