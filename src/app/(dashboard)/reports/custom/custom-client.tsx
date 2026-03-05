"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Share2, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ALL_STANDARD_REPORTS } from "../definitions";
import { createCustomReport, deleteCustomReport } from "../actions";

type CustomReport = {
  id: string;
  name: string;
  based_on: string;
  shared: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
};

interface CustomReportsClientProps {
  reports: CustomReport[];
  callerMemberId: string;
  callerRole: string;
}

export function CustomReportsClient({
  reports: initialReports,
  callerMemberId,
}: CustomReportsClientProps) {
  const router = useRouter();
  const [reports, setReports] = useState(initialReports);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createBasedOn, setCreateBasedOn] = useState(ALL_STANDARD_REPORTS[0]?.id ?? "");
  const [createShared, setCreateShared] = useState<"private" | "shared">("private");
  const [createLoading, setCreateLoading] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [deletingReport, setDeletingReport] = useState<CustomReport | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  async function handleCreate() {
    if (!createName.trim()) return;
    setCreateLoading(true);
    setCreateError(null);
    const result = await createCustomReport({
      name: createName.trim(),
      based_on: createBasedOn,
      shared: createShared === "shared",
    });
    setCreateLoading(false);
    if (!result.success) {
      setCreateError(result.error ?? "Failed to create report");
    } else if (result.report) {
      setShowCreateDialog(false);
      setCreateName("");
      router.push(`/reports/custom/${result.report.id}`);
    }
  }

  async function handleDelete() {
    if (!deletingReport) return;
    setDeleteLoading(true);
    const result = await deleteCustomReport(deletingReport.id);
    setDeleteLoading(false);
    if (result.success) {
      setReports((prev) => prev.filter((r) => r.id !== deletingReport.id));
      setDeletingReport(null);
    }
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Custom Reports</h1>
        <Button onClick={() => setShowCreateDialog(true)}>
          <Plus className="h-4 w-4 mr-2" />
          New Report
        </Button>
      </div>

      {reports.length === 0 ? (
        <p className="text-muted-foreground">No custom reports yet. Create one from a standard report.</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {reports.map((report) => {
            const baseReport = ALL_STANDARD_REPORTS.find((r) => r.id === report.based_on);
            const isOwner = report.created_by === callerMemberId;
            return (
              <div
                key={report.id}
                className="relative flex flex-col gap-2 rounded-lg border bg-card p-4"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <Link
                      href={`/reports/custom/${report.id}`}
                      className="font-semibold hover:underline truncate block"
                    >
                      {report.name}
                    </Link>
                    <p className="text-sm text-muted-foreground">
                      Based on: {baseReport?.name ?? report.based_on}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {report.shared ? (
                      <span title="Shared with admins"><Share2 className="h-4 w-4 text-muted-foreground" /></span>
                    ) : (
                      <span title="Private"><Lock className="h-4 w-4 text-muted-foreground" /></span>
                    )}
                    {isOwner && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => setDeletingReport(report)}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    )}
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Updated {new Date(report.updated_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                </p>
              </div>
            );
          })}
        </div>
      )}

      {/* Create dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Custom Report</DialogTitle>
            <DialogDescription>
              Choose a standard report to base this on, then customise columns and filters.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {createError && <p className="text-sm text-destructive">{createError}</p>}
            <div className="space-y-2">
              <Label htmlFor="create-name">Report name</Label>
              <Input
                id="create-name"
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                placeholder="Enter a name..."
              />
            </div>
            <div className="space-y-2">
              <Label>Based on</Label>
              <Select value={createBasedOn} onValueChange={setCreateBasedOn}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ALL_STANDARD_REPORTS.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.groupLabel} — {r.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Visibility</Label>
              <Select
                value={createShared}
                onValueChange={(v) => setCreateShared(v as "private" | "shared")}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="private">Private (only me)</SelectItem>
                  <SelectItem value="shared">Shared (all admins)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateDialog(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={createLoading || !createName.trim()}>
              {createLoading ? "Creating..." : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog open={!!deletingReport} onOpenChange={(open) => !open && setDeletingReport(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Custom Report</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete &ldquo;{deletingReport?.name}&rdquo;? This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteLoading}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleteLoading}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(e) => { e.preventDefault(); handleDelete(); }}
            >
              {deleteLoading ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
