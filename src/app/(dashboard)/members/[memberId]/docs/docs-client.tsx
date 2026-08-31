"use client";

// CLE-206 — Per-Member Documents client. Wraps the CRUD actions from
// document-actions.ts. Signed-URL viewer preserved from the legacy
// docs-client, but the underlying storage bucket + row now live on
// the new `document` table.

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Calendar,
  ExternalLink,
  FileText,
  Loader2,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
  Undo2,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StickyPageHeader } from "@/components/ui/sticky-page-header";
import {
  listMemberDocuments,
  listTrashedMemberDocuments,
  getMemberDocumentSignedUrl,
  uploadMemberDocument,
  updateMemberDocumentMetadata,
  softDeleteMemberDocument,
  restoreMemberDocument,
  getSubtypesForUpload,
} from "./document-actions";
import type { MemberDocumentRow, TrashedMemberDocumentRow } from "./document-types";

type UploadSubtype = {
  id: string;
  type: string;
  name: string;
  retentionClass: string;
  expiryRequired: boolean;
  defaultExpiryMonths: number | null;
  employeeCanUpload: boolean;
};

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

function fmtFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface DocsClientProps {
  memberId: string;
  canUpdate: boolean;
  canManageDeleted: boolean;
  canForceDelete: boolean;
}

export function DocsClient({
  memberId,
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
  const [editing, setEditing] = useState<MemberDocumentRow | null>(null);
  const [deleting, setDeleting] = useState<MemberDocumentRow | null>(null);

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
                Upload
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
          onView={(d) => handleView({ ...d } as MemberDocumentRow)}
        />
      ) : (
        <DocList
          rows={rows}
          canUpdate={canUpdate}
          onView={handleView}
          onDownload={handleDownload}
          onEdit={(r) => setEditing(r)}
          onDelete={(r) => setDeleting(r)}
        />
      )}

      {viewerDoc && (
        <ViewerDialog viewer={viewerDoc} onClose={() => setViewerDoc(null)} />
      )}

      {uploadOpen && (
        <UploadDialog
          memberId={memberId}
          onClose={() => setUploadOpen(false)}
          onUploaded={async () => {
            setUploadOpen(false);
            await load();
            router.refresh();
          }}
        />
      )}

      {editing && (
        <EditMetadataDialog
          memberId={memberId}
          row={editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
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
  onView,
  onDownload,
  onEdit,
  onDelete,
}: {
  rows: MemberDocumentRow[];
  canUpdate: boolean;
  onView: (r: MemberDocumentRow) => void;
  onDownload: (r: MemberDocumentRow) => void;
  onEdit: (r: MemberDocumentRow) => void;
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
            <th className="px-4 py-2 font-medium">File</th>
            <th className="px-4 py-2 font-medium hidden sm:table-cell">Type</th>
            <th className="px-4 py-2 font-medium hidden md:table-cell">Subtype</th>
            <th className="px-4 py-2 font-medium hidden lg:table-cell">Expires</th>
            <th className="px-4 py-2 font-medium hidden lg:table-cell">Uploaded</th>
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
              <td className="px-4 py-2">
                <div className="flex items-center gap-2 min-w-0">
                  <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0">
                    <p className="font-medium truncate">{r.fileName}</p>
                    <p className="text-xs text-muted-foreground">{fmtFileSize(r.fileSize)}</p>
                  </div>
                </div>
              </td>
              <td className="px-4 py-2 text-muted-foreground hidden sm:table-cell">
                {TYPE_LABEL[r.type] ?? r.type}
              </td>
              <td className="px-4 py-2 hidden md:table-cell">
                {r.subtypeName ? (
                  <span className="inline-block rounded bg-muted px-2 py-0.5 text-xs">{r.subtypeName}</span>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </td>
              <td className="px-4 py-2 text-muted-foreground hidden lg:table-cell">
                {fmtDate(r.expiresOn)}
              </td>
              <td className="px-4 py-2 text-muted-foreground hidden lg:table-cell">
                {fmtDateTime(r.uploadedAt)}
              </td>
              <td className="px-4 py-2 text-right">
                <div className="flex items-center justify-end gap-0.5">
                  <Button variant="ghost" size="icon" aria-label="Download" onClick={(e) => { e.stopPropagation(); onDownload(r); }}>
                    <ExternalLink className="h-4 w-4" />
                  </Button>
                  {canUpdate && (
                    <>
                      <Button variant="ghost" size="icon" aria-label="Edit" onClick={(e) => { e.stopPropagation(); onEdit(r); }}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" aria-label="Delete" onClick={(e) => { e.stopPropagation(); onDelete(r); }}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </>
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
  onView,
}: {
  rows: TrashedMemberDocumentRow[];
  onRestore: (id: string) => Promise<void>;
  onView: (r: TrashedMemberDocumentRow) => void;
}) {
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground py-8 text-center">Trash is empty.</p>;
  }
  return (
    <div className="mt-4 rounded-md border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/50 text-left text-xs uppercase text-muted-foreground">
            <th className="px-4 py-2 font-medium">File</th>
            <th className="px-4 py-2 font-medium hidden md:table-cell">Subtype</th>
            <th className="px-4 py-2 font-medium">Queued</th>
            <th className="px-4 py-2 font-medium hidden lg:table-cell">Force-delete reason</th>
            <th className="px-4 py-2 font-medium text-right" />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b last:border-b-0">
              <td className="px-4 py-2">
                <button type="button" className="flex items-center gap-2 min-w-0 text-left" onClick={() => onView(r)}>
                  <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 truncate font-medium">{r.fileName}</span>
                </button>
              </td>
              <td className="px-4 py-2 hidden md:table-cell">
                {r.subtypeName ?? <span className="text-muted-foreground">—</span>}
              </td>
              <td className="px-4 py-2 text-muted-foreground">{fmtDateTime(r.queuedAt)}</td>
              <td className="px-4 py-2 text-muted-foreground hidden lg:table-cell max-w-xs truncate">
                {r.forceDeleteReason ?? "—"}
              </td>
              <td className="px-4 py-2 text-right">
                <Button variant="outline" size="sm" onClick={() => onRestore(r.id)}>
                  <Undo2 className="mr-1.5 h-3.5 w-3.5" />
                  Restore
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
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

// -------- Upload dialog --------------------------------------------------

function UploadDialog({
  memberId,
  onClose,
  onUploaded,
}: {
  memberId: string;
  onClose: () => void;
  onUploaded: () => Promise<void>;
}) {
  const [subtypes, setSubtypes] = useState<UploadSubtype[]>([]);
  const [subtypeId, setSubtypeId] = useState<string>("");
  const [file, setFile] = useState<File | null>(null);
  const [expiresOn, setExpiresOn] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    (async () => {
      const res = await getSubtypesForUpload(memberId);
      if (res.success) {
        setSubtypes(res.subtypes);
      } else {
        setError(res.error ?? "Failed to load subtypes");
      }
    })();
  }, [memberId]);

  const currentSubtype = useMemo(
    () => subtypes.find((s) => s.id === subtypeId) ?? null,
    [subtypeId, subtypes],
  );
  const expiryRequired = currentSubtype?.expiryRequired ?? false;

  // Pre-fill expiry from subtype default when the user picks one.
  useEffect(() => {
    if (currentSubtype?.defaultExpiryMonths && !expiresOn) {
      const d = new Date();
      d.setUTCMonth(d.getUTCMonth() + currentSubtype.defaultExpiryMonths);
      setExpiresOn(d.toISOString().slice(0, 10));
    }
  }, [currentSubtype?.defaultExpiryMonths]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleUpload() {
    if (!file) { setError("Choose a file first"); return; }
    if (!subtypeId) { setError("Choose a subtype"); return; }
    setError(null);
    const fd = new FormData();
    fd.set("file", file);
    fd.set("subtypeId", subtypeId);
    if (expiresOn) fd.set("expiresOn", expiresOn);
    startTransition(async () => {
      const res = await uploadMemberDocument(memberId, fd);
      if (!res.success) {
        setError(res.error ?? "Upload failed");
        return;
      }
      await onUploaded();
    });
  }

  // Group subtypes by type for the picker.
  const grouped = subtypes.reduce<Record<string, UploadSubtype[]>>((acc, s) => {
    (acc[s.type] ??= []).push(s);
    return acc;
  }, {});

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Upload document</DialogTitle>
          <DialogDescription>
            Choose the subtype the document belongs to. Fields marked required are driven
            by the tenant&apos;s subtype configuration.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {error && (
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div>
          )}

          <div className="space-y-2">
            <Label>Subtype</Label>
            <Select value={subtypeId} onValueChange={setSubtypeId}>
              <SelectTrigger><SelectValue placeholder="Choose a subtype…" /></SelectTrigger>
              <SelectContent>
                {Object.entries(grouped).map(([type, list]) => (
                  <div key={type}>
                    <div className="px-2 py-1 text-[10px] font-semibold uppercase text-muted-foreground">
                      {TYPE_LABEL[type] ?? type}
                    </div>
                    {list.map((s) => (
                      <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                    ))}
                  </div>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>
              Expires on
              {expiryRequired && <span className="ml-1 text-destructive">*</span>}
            </Label>
            <Input
              type="date"
              value={expiresOn}
              onChange={(e) => setExpiresOn(e.target.value)}
            />
            {!expiryRequired && (
              <p className="text-xs text-muted-foreground">Optional for this subtype.</p>
            )}
          </div>

          <div className="space-y-2">
            <Label>File</Label>
            <Input
              type="file"
              accept="image/*,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/plain"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            {file && (
              <p className="text-xs text-muted-foreground">
                {file.name} · {fmtFileSize(file.size)}
              </p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>Cancel</Button>
          <Button onClick={handleUpload} disabled={pending || !file || !subtypeId}>
            {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Upload
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// -------- Edit metadata dialog --------------------------------------------------

function EditMetadataDialog({
  memberId,
  row,
  onClose,
  onSaved,
}: {
  memberId: string;
  row: MemberDocumentRow;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [subtypes, setSubtypes] = useState<UploadSubtype[]>([]);
  const [subtypeId, setSubtypeId] = useState<string>(row.subtypeId ?? "");
  const [expiresOn, setExpiresOn] = useState<string>(row.expiresOn ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    (async () => {
      const res = await getSubtypesForUpload(memberId);
      if (res.success) {
        setSubtypes(res.subtypes.filter((s) => s.type === row.type));
      }
    })();
  }, [memberId, row.type]);

  function handleSave() {
    startTransition(async () => {
      const res = await updateMemberDocumentMetadata(row.id, {
        subtypeId: subtypeId || null,
        expiresOn: expiresOn || null,
      });
      if (!res.success) { setError(res.error ?? "Failed to save"); return; }
      await onSaved();
    });
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Edit metadata</DialogTitle>
          <DialogDescription>
            Update the subtype and expiry. The document&apos;s type is fixed and can
            only be changed by re-uploading.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {error && <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}

          <div className="space-y-2">
            <Label>Subtype</Label>
            <Select value={subtypeId} onValueChange={setSubtypeId}>
              <SelectTrigger><SelectValue placeholder="Choose a subtype…" /></SelectTrigger>
              <SelectContent>
                {subtypes.map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Expires on</Label>
            <Input type="date" value={expiresOn} onChange={(e) => setExpiresOn(e.target.value)} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>Cancel</Button>
          <Button onClick={handleSave} disabled={pending}>
            {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save
          </Button>
        </DialogFooter>
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
