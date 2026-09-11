"use client";

// CLE-206 — Per-Member Documents client. Wraps the CRUD actions from
// document-actions.ts. Signed-URL viewer preserved from the legacy
// docs-client, but the underlying storage bucket + row now live on
// the new `document` table.

import { useCallback, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Calendar,
  Camera,
  ExternalLink,
  FileText,
  Loader2,
  Plus,
  RotateCcw,
  Trash2,
  Undo2,
  Upload as UploadIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
import { StickyPageHeader } from "@/components/ui/sticky-page-header";
import {
  listMemberDocuments,
  listTrashedMemberDocuments,
  getMemberDocumentSignedUrl,
  updateMemberDocumentMetadata,
  softDeleteMemberDocument,
  restoreMemberDocument,
  verifyMemberDocument,
  renewMemberDocument,
  backdateDisposalQueue,
} from "./document-actions";
import type { MemberDocumentRow, TrashedMemberDocumentRow } from "./document-types";
import { STATUS_LABEL, STATUS_TONE } from "@/lib/document-status";
import { DocumentDetailsDialog } from "@/components/documents/document-details-dialog";
import { NewMemberDocumentDialog } from "@/components/documents/new-document-dialog";
const TYPE_LABEL: Record<string, string> = {
  contract: "Contract",
  certificate: "Certificate",
  evidence: "Evidence",
  policy: "Policy",
  handbook: "Handbook",
  attachment: "Attachment",
  other: "Other",
};

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso + "T00:00:00Z").toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

// Return an ISO string N days after the given ISO. Used by the
// Trash grid to show the projected purge date (queued_at + 30 days
// grace, per the retention sweep).
function addDaysIso(iso: string, days: number): string {
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}

function fmtFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface DocsClientProps {
  memberId: string;
  memberName: string;
  canUpdate: boolean;
  canManageDeleted: boolean;
  canForceDelete: boolean;
}

export function DocsClient({
  memberId,
  memberName,
  canUpdate,
  canManageDeleted,
  canForceDelete,
}: DocsClientProps) {
  const router = useRouter();
  const [rows, setRows] = useState<MemberDocumentRow[]>([]);
  const [trashRows, setTrashRows] = useState<TrashedMemberDocumentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showTrash, setShowTrash] = useState(false);

  const [viewerDoc, setViewerDoc] = useState<{
    url: string;
    fileName: string;
    contentType: string;
  } | null>(null);

  const [uploadOpen, setUploadOpen] = useState(false);
  const [detailsDocId, setDetailsDocId] = useState<string | null>(null);
  // When the details dialog was opened from the Trash list it renders
  // in read-only mode (all pencils + composer hidden, "In Trash" pill
  // in the header).
  const [detailsReadOnly, setDetailsReadOnly] = useState(false);
  const [deleting, setDeleting] = useState<MemberDocumentRow | null>(null);
  // Transient success toast shown after a photo upload lands from
  // the mobile app. Dialog closes → this appears for ~3s.
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [listRes, trashRes] = await Promise.all([
      listMemberDocuments(memberId),
      canManageDeleted ? listTrashedMemberDocuments(memberId) : Promise.resolve({ success: true, rows: [] as TrashedMemberDocumentRow[] }),
    ]);
    setLoading(false);
    if (!listRes.success) setError(listRes.error ?? "Could not load documents");
    setRows(listRes.rows);
    if ("rows" in trashRes) setTrashRows(trashRes.rows);
  }, [memberId, canManageDeleted]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleView = useCallback(async (doc: MemberDocumentRow) => {
    const res = await getMemberDocumentSignedUrl(doc.id, "inline");
    if (!res.success || !res.url) {
      setError(res.error ?? "Failed to open document");
      return;
    }
    setViewerDoc({ url: res.url, fileName: res.fileName ?? doc.fileName, contentType: doc.contentType });
  }, []);

  const handleDownload = useCallback(async (doc: MemberDocumentRow) => {
    const res = await getMemberDocumentSignedUrl(doc.id, "download");
    if (!res.success || !res.url) return;
    const a = document.createElement("a");
    a.href = res.url;
    a.download = res.fileName ?? doc.fileName;
    a.rel = "noopener noreferrer";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }, []);

  return (
    <div className="w-full px-4 py-8 sm:px-6 lg:px-8">
      {/* Transient "Received…" toast for photo uploads landing from
          mobile. Sits above everything for ~3 seconds. */}
      {toastMessage && (
        <div className="fixed left-1/2 top-6 z-50 -translate-x-1/2 rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white shadow-lg">
          {toastMessage}
        </div>
      )}
      <StickyPageHeader>
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-2xl font-bold">
            Documents <span className="text-muted-foreground font-normal">— {showTrash ? "Trash" : "Live"}</span>
          </h1>
          <div className="flex items-center gap-2">
            {canManageDeleted && (
              <Button
                type="button"
                variant={showTrash ? "default" : "outline"}
                size="sm"
                onClick={() => setShowTrash((v) => !v)}
              >
                <RotateCcw className="mr-1.5 h-4 w-4" />
                Trash ({trashRows.length})
              </Button>
            )}
            {canUpdate && (
              <Button type="button" size="sm" onClick={() => setUploadOpen(true)}>
                <Plus className="mr-1.5 h-4 w-4" />
                Add Document
              </Button>
            )}
          </div>
        </div>
      </StickyPageHeader>

      {error && <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive mt-4">{error}</div>}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : showTrash ? (
        <TrashList
          rows={trashRows}
          onRestore={async (id) => {
            const res = await restoreMemberDocument(id);
            if (!res.success) { setError(res.error ?? "Failed to restore"); return; }
            await load();
            router.refresh();
          }}
          onBackdate={async (id, newQueuedAt) => {
            const res = await backdateDisposalQueue(id, newQueuedAt);
            if (!res.success) { setError(res.error ?? "Failed to backdate"); return; }
            await load();
            router.refresh();
          }}
          onView={(d) => {
            // Read-only Document Details dialog — everything the live
            // dialog offers (Preview / Expiry / Verify / Review /
            // Activity / Download) except the pencils and composer.
            setDetailsReadOnly(true);
            setDetailsDocId(d.id);
          }}
        />
      ) : (
        <DocList
          rows={rows}
          canUpdate={canUpdate}
          onOpen={(r) => {
            setDetailsReadOnly(false);
            setDetailsDocId(r.id);
          }}
          onDownload={handleDownload}
          onDelete={(r) => setDeleting(r)}
        />
      )}

      {detailsDocId && (
        <DocumentDetailsDialog
          documentId={detailsDocId}
          canUpdate={canUpdate}
          readOnly={detailsReadOnly}
          onClose={() => {
            setDetailsDocId(null);
            setDetailsReadOnly(false);
          }}
          onSaved={async () => {
            await load();
            router.refresh();
          }}
        />
      )}

      {viewerDoc && (
        <ViewerDialog viewer={viewerDoc} onClose={() => setViewerDoc(null)} />
      )}

      {uploadOpen && (
        <NewMemberDocumentDialog
          memberId={memberId}
          memberName={memberName}
          onClose={() => setUploadOpen(false)}
          onCreated={async (newDocId) => {
            // Swap the "new doc" dialog for the full details dialog
            // in the same tick — from the user's perspective the
            // same surface just gained a file.
            setUploadOpen(false);
            setDetailsReadOnly(false);
            setDetailsDocId(newDocId);
            await load();
            router.refresh();
          }}
        />
      )}

      {deleting && (
        <DeleteDialog
          row={deleting}
          canForceDelete={canForceDelete}
          onClose={() => setDeleting(null)}
          onDeleted={async () => {
            setDeleting(null);
            await load();
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function DocList({
  rows,
  canUpdate,
  onOpen,
  onDownload,
  onDelete,
}: {
  rows: MemberDocumentRow[];
  canUpdate: boolean;
  /** Row click → open the Document Details dialog (§7b.13). */
  onOpen: (r: MemberDocumentRow) => void;
  onDownload: (r: MemberDocumentRow) => void;
  onDelete: (r: MemberDocumentRow) => void;
}) {
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground py-8 text-center">No documents yet.</p>;
  }
  return (
    <div className="mt-4 rounded-md border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/50 text-left text-xs uppercase text-muted-foreground">
            <th className="w-8 px-4 py-2 font-medium" title="Source" />
            <th className="px-4 py-2 font-medium">Document</th>
            <th className="px-4 py-2 font-medium">Status</th>
            <th className="px-4 py-2 font-medium hidden lg:table-cell">Expires</th>
            <th className="px-4 py-2 font-medium hidden lg:table-cell">Next review</th>
            <th className="px-4 py-2 font-medium hidden xl:table-cell">Uploaded</th>
            <th className="px-4 py-2 font-medium text-right" />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.id}
              className="cursor-pointer border-b last:border-b-0 hover:bg-muted/30"
              onClick={() => onOpen(r)}
            >
              <td className="px-4 py-2 text-muted-foreground" title={r.captureSource === "photo" ? "Captured on mobile" : "Uploaded from computer"}>
                {r.captureSource === "photo"
                  ? <Camera className="h-4 w-4" />
                  : <UploadIcon className="h-4 w-4" />}
              </td>
              <td className="px-4 py-2">
                <div className="min-w-0">
                  <p className="font-medium">
                    {TYPE_LABEL[r.type] ?? r.type}
                    {r.subtypeName ? <span className="text-muted-foreground"> / {r.subtypeName}</span> : null}
                  </p>
                  <p className="text-xs text-muted-foreground truncate" title={r.fileName}>
                    {r.fileName} · {fmtFileSize(r.fileSize)}
                  </p>
                </div>
              </td>
              <td className="px-4 py-2">
                {r.statuses.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {r.statuses.map((s) => (
                      <span
                        key={s}
                        className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_TONE[s].className}`}
                      >
                        {STATUS_LABEL[s]}
                      </span>
                    ))}
                  </div>
                )}
              </td>
              <td className="px-4 py-2 text-muted-foreground hidden lg:table-cell">
                {fmtDate(r.expiresOn)}
              </td>
              <td className="px-4 py-2 text-muted-foreground hidden lg:table-cell">
                {fmtDate(r.nextReviewOn)}
              </td>
              <td className="px-4 py-2 text-muted-foreground hidden xl:table-cell">
                {fmtDateTime(r.uploadedAt)}
              </td>
              <td className="px-4 py-2 text-right">
                <div className="flex items-center justify-end gap-0.5">
                  <Button variant="ghost" size="icon" aria-label="Download" onClick={(e) => { e.stopPropagation(); onDownload(r); }}>
                    <ExternalLink className="h-4 w-4" />
                  </Button>
                  {canUpdate && (
                    <Button variant="ghost" size="icon" aria-label="Delete" onClick={(e) => { e.stopPropagation(); onDelete(r); }}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TrashList({
  rows,
  onRestore,
  onBackdate,
  onView,
}: {
  rows: TrashedMemberDocumentRow[];
  onRestore: (id: string) => Promise<void>;
  onBackdate: (id: string, newQueuedAt: string) => Promise<void>;
  onView: (r: TrashedMemberDocumentRow) => void;
}) {
  const [backdating, setBackdating] = useState<TrashedMemberDocumentRow | null>(null);
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground py-8 text-center">Trash is empty.</p>;
  }
  return (
    <div className="mt-4 rounded-md border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/50 text-left text-xs uppercase text-muted-foreground">
            <th className="w-8 px-4 py-2 font-medium" title="Source" />
            <th className="px-4 py-2 font-medium">Document</th>
            <th className="px-4 py-2 font-medium">Queued for Deletion</th>
            <th className="px-4 py-2 font-medium hidden lg:table-cell">Force-delete reason</th>
            <th className="px-4 py-2 font-medium text-right" />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.id}
              className="cursor-pointer border-b last:border-b-0 hover:bg-muted/30"
              onClick={() => onView(r)}
            >
              <td className="px-4 py-2 text-muted-foreground" title={r.captureSource === "photo" ? "Captured on mobile" : "Uploaded from computer"}>
                {r.captureSource === "photo"
                  ? <Camera className="h-4 w-4" />
                  : <UploadIcon className="h-4 w-4" />}
              </td>
              <td className="px-4 py-2">
                <div className="min-w-0">
                  <p className="font-medium">
                    {TYPE_LABEL[r.type] ?? r.type}
                    {r.subtypeName ? <span className="text-muted-foreground"> / {r.subtypeName}</span> : null}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">
                    {r.fileName} · {fmtFileSize(r.fileSize)}
                  </p>
                </div>
              </td>
              <td className="px-4 py-2 text-muted-foreground" title={`Queued at ${fmtDateTime(r.queuedAt)}`}>
                {fmtDateTime(addDaysIso(r.queuedAt, 30))}
              </td>
              <td className="px-4 py-2 text-muted-foreground hidden lg:table-cell max-w-xs truncate">
                {r.forceDeleteReason ?? "—"}
              </td>
              <td className="px-4 py-2 text-right">
                <div className="flex items-center justify-end gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    title="Backdate the queued date (testing helper for the nightly purge sweep)"
                    onClick={(e) => { e.stopPropagation(); setBackdating(r); }}
                  >
                    Backdate
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={(e) => { e.stopPropagation(); void onRestore(r.id); }}
                  >
                    <Undo2 className="mr-1.5 h-3.5 w-3.5" />
                    Restore
                  </Button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {backdating && (
        <BackdateDialog
          row={backdating}
          onClose={() => setBackdating(null)}
          onSaved={async (newQueuedAt) => {
            const id = backdating.id;
            setBackdating(null);
            await onBackdate(id, newQueuedAt);
          }}
        />
      )}
    </div>
  );
}

function BackdateDialog({
  row,
  onClose,
  onSaved,
}: {
  row: TrashedMemberDocumentRow;
  onClose: () => void;
  onSaved: (newQueuedAt: string) => Promise<void>;
}) {
  const [when, setWhen] = useState<string>(() => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - 31);
    return d.toISOString().slice(0, 10);
  });
  const [pending, startTransition] = useTransition();

  function handleSave() {
    startTransition(async () => {
      await onSaved(when);
    });
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Backdate queue entry</DialogTitle>
          <DialogDescription>
            Testing helper. Move the queued date on <span className="font-medium">{row.fileName}</span> so
            the nightly purge sweep can pick it up without waiting 30 days.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label>New queued date</Label>
          <Input type="date" value={when} onChange={(e) => setWhen(e.target.value)} />
          <p className="text-xs text-muted-foreground">Pre-filled to 31 days ago so the sweep will purge on next run.</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>Cancel</Button>
          <Button onClick={handleSave} disabled={pending || !when}>
            {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Apply
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ViewerDialog({
  viewer,
  onClose,
}: {
  viewer: { url: string; fileName: string; contentType: string };
  onClose: () => void;
}) {
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="flex max-h-[90vh] max-w-3xl flex-col">
        <DialogHeader className="flex-row items-center justify-between gap-4 space-y-0">
          <DialogTitle className="truncate text-sm font-medium">{viewer.fileName}</DialogTitle>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-auto rounded-md border bg-muted/30">
          {viewer.contentType.startsWith("image/") ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={viewer.url} alt={viewer.fileName} className="mx-auto max-h-[70vh] object-contain" />
          ) : (
            <iframe src={viewer.url} title={viewer.fileName} className="h-[70vh] w-full" />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// -------- Delete dialog --------------------------------------------------

function DeleteDialog({
  row,
  canForceDelete,
  onClose,
  onDeleted,
}: {
  row: MemberDocumentRow;
  canForceDelete: boolean;
  onClose: () => void;
  onDeleted: () => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const requiresForce =
    ["right_to_work", "contract", "payroll"].includes(row.retentionClass)
    && row.disposalDate === null;

  function handleDelete() {
    if (requiresForce && !canForceDelete) {
      setError(`${row.retentionClass} evidence can't be deleted while the employee is still active.`);
      return;
    }
    startTransition(async () => {
      const res = await softDeleteMemberDocument(row.id, { forceDeleteReason: reason || null });
      if (!res.success) { setError(res.error ?? "Failed to delete"); return; }
      await onDeleted();
    });
  }

  return (
    <AlertDialog open onOpenChange={(o) => { if (!o && !pending) onClose(); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete document</AlertDialogTitle>
          <AlertDialogDescription>
            <span className="font-medium">{row.fileName}</span> will move to Trash for 30 days,
            then be permanently deleted from storage.
          </AlertDialogDescription>
        </AlertDialogHeader>

        {requiresForce && (
          <div className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-800 dark:bg-amber-900/20">
            <div className="flex items-center gap-2 font-medium text-amber-800 dark:text-amber-300">
              <Calendar className="h-4 w-4" />
              Force-delete required
            </div>
            <p className="text-xs text-amber-800 dark:text-amber-300">
              This subtype is retention-protected while the member is active. Force-delete requires
              a reason and the <em>Force-delete documents</em> right on your profile.
            </p>
            <Textarea
              placeholder="Reason (recorded in the audit trail)"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              maxLength={500}
            />
          </div>
        )}

        {error && <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            disabled={pending || (requiresForce && !reason.trim())}
            onClick={(e) => { e.preventDefault(); handleDelete(); }}
          >
            {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
