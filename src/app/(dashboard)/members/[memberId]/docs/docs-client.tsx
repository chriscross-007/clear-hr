"use client";

// CLE-206 — Per-Member Documents client. Wraps the CRUD actions from
// document-actions.ts. Signed-URL viewer preserved from the legacy
// docs-client, but the underlying storage bucket + row now live on
// the new `document` table.

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Calendar,
  Camera,
  ExternalLink,
  FileText,
  Loader2,
  Pencil,
  Plus,
  RotateCcw,
  Smartphone,
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
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
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
  verifyMemberDocument,
  renewMemberDocument,
  backdateDisposalQueue,
} from "./document-actions";
import type { MemberDocumentRow, TrashedMemberDocumentRow } from "./document-types";
import { STATUS_LABEL, STATUS_TONE } from "@/lib/document-status";
import { ShieldCheck } from "lucide-react";
import { VerifyDialog } from "@/components/documents/verify-dialog";
import { createClient as createSupabaseBrowserClient } from "@/lib/supabase/client";
import { queueCaptureTask, cancelCaptureTask } from "./capture-actions";

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
  const [editing, setEditing] = useState<MemberDocumentRow | null>(null);
  const [deleting, setDeleting] = useState<MemberDocumentRow | null>(null);
  const [verifying, setVerifying] = useState<{ mode: "verify" | "renew"; row: MemberDocumentRow } | null>(null);

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
          onVerify={(r) => setVerifying({ mode: r.verifiedOn ? "renew" : "verify", row: r })}
        />
      )}

      {viewerDoc && (
        <ViewerDialog viewer={viewerDoc} onClose={() => setViewerDoc(null)} />
      )}

      {uploadOpen && (
        <UploadDialog
          memberId={memberId}
          memberName={memberName}
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

      {verifying && (
        <VerifyDialog
          mode={verifying.mode}
          documentId={verifying.row.id}
          initialNextReviewOn={verifying.row.nextReviewOn}
          headerLabel={verifying.row.fileName}
          onClose={() => setVerifying(null)}
          onSaved={async () => {
            setVerifying(null);
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
  onVerify,
}: {
  rows: MemberDocumentRow[];
  canUpdate: boolean;
  onView: (r: MemberDocumentRow) => void;
  onDownload: (r: MemberDocumentRow) => void;
  onEdit: (r: MemberDocumentRow) => void;
  onDelete: (r: MemberDocumentRow) => void;
  onVerify: (r: MemberDocumentRow) => void;
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
              <td className="px-4 py-2">
                {r.status !== "not_applicable" && (
                  <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_TONE[r.status].className}`}>
                    {STATUS_LABEL[r.status]}
                  </span>
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
                  {canUpdate && r.requiresVerification && (
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={r.verifiedOn ? "Renew" : "Verify"}
                      title={r.verifiedOn ? "Renew" : "Verify"}
                      onClick={(e) => { e.stopPropagation(); onVerify(r); }}
                    >
                      <ShieldCheck className={`h-4 w-4 ${r.status === "verified" ? "text-green-600" : "text-amber-600"}`} />
                    </Button>
                  )}
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
                <div className="flex items-center justify-end gap-1">
                  <Button variant="ghost" size="sm" title="Backdate the queued date (testing helper for the nightly purge sweep)" onClick={() => setBackdating(r)}>
                    Backdate
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => onRestore(r.id)}>
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

// -------- Upload dialog --------------------------------------------------

function UploadDialog({
  memberId,
  memberName,
  onClose,
  onUploaded,
}: {
  memberId: string;
  memberName: string;
  onClose: () => void;
  onUploaded: () => Promise<void>;
}) {
  const [subtypes, setSubtypes] = useState<UploadSubtype[]>([]);
  const [subtypeId, setSubtypeId] = useState<string>("");
  const [expiresOn, setExpiresOn] = useState<string>("");
  const [note, setNote] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // Hidden file input triggered by the Upload button — file picker
  // only opens once the caller has committed to the Upload path, so
  // it doesn't clutter the initial form.
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  // CLE-211 — two-mode dialog. `form` is the metadata form + three
  // footer buttons (Cancel / Upload / Photo). `waiting` is the state
  // after Photo has queued a capture_task; a Realtime subscription
  // on the task row drives the transition to closed (uploaded /
  // cancelled / timeout).
  const [mode, setMode] = useState<"form" | "waiting">("form");
  const [captureTaskId, setCaptureTaskId] = useState<string | null>(null);
  const [waitingMessage, setWaitingMessage] = useState<string>("");

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

  // Realtime subscription on the queued capture task. Fires when the
  // mobile app uploads, cancels, or the timeout sweep flips it.
  //
  // Realtime respects RLS, so the browser socket needs the caller's
  // JWT to evaluate `queued_by_user_id = auth.uid()`. `setAuth` pins
  // the token on the realtime client explicitly — newer supabase-js
  // pulls it from the auth session, but doing it up-front avoids a
  // race where the subscription opens before the auth exchange
  // completes. Also polls the task status every 3 s as a belt-and-
  // braces fallback for the Realtime event landing.
  useEffect(() => {
    if (mode !== "waiting" || !captureTaskId) return;
    const supabase = createSupabaseBrowserClient();

    let cancelled = false;

    function handleStatus(status: string) {
      if (cancelled) return;
      if (status === "uploaded") {
        void onUploaded();
      } else if (status === "cancelled") {
        onClose();
      } else if (status === "timeout") {
        setWaitingMessage("This request timed out. Try again when you're ready to take the photo.");
        setMode("form");
        setCaptureTaskId(null);
      }
    }

    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.access_token) {
        supabase.realtime.setAuth(session.access_token);
      }
    })();

    const channel = supabase
      .channel(`capture_task:${captureTaskId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "capture_task",
          filter: `id=eq.${captureTaskId}`,
        },
        (payload) => {
          const row = payload.new as { status?: string } | null;
          if (row?.status) handleStatus(row.status);
        },
      )
      .subscribe();

    // Fallback poll every 3 s in case Realtime doesn't deliver the
    // event (some Realtime + RLS + REPLICA IDENTITY edge cases). Cheap
    // — one indexed row lookup per tick, only while the dialog is
    // in `waiting` mode.
    const pollInterval = setInterval(async () => {
      if (cancelled) return;
      const { data } = await supabase
        .from("capture_task")
        .select("status")
        .eq("id", captureTaskId)
        .single();
      if (data?.status && data.status !== "pending") {
        handleStatus(data.status as string);
      }
    }, 3000);

    return () => {
      cancelled = true;
      clearInterval(pollInterval);
      void supabase.removeChannel(channel);
    };
  }, [mode, captureTaskId, onUploaded, onClose]);

  // Cleanup: if the user closes the dialog while a task is pending,
  // cancel it server-side so it doesn't hang around.
  useEffect(() => {
    return () => {
      if (captureTaskId && mode === "waiting") {
        void cancelCaptureTask(captureTaskId);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Upload path: click Upload → open OS file picker via hidden input →
  // as soon as the user selects a file, submit immediately. Metadata
  // is already committed in state at this point.
  function handleUploadClick() {
    if (!subtypeId) { setError("Choose a subtype"); return; }
    if (expiryRequired && !expiresOn) { setError("Expiry date is required for this subtype"); return; }
    setError(null);
    fileInputRef.current?.click();
  }

  function handleFileChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const chosen = e.target.files?.[0] ?? null;
    // Reset the input so re-selecting the same file re-triggers change.
    e.target.value = "";
    if (!chosen) return;
    setError(null);
    const fd = new FormData();
    fd.set("file", chosen);
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

  function handlePhoto() {
    if (!subtypeId) { setError("Choose a subtype"); return; }
    if (expiryRequired && !expiresOn) { setError("Expiry date is required for this subtype"); return; }
    setError(null);
    setWaitingMessage("");
    startTransition(async () => {
      const res = await queueCaptureTask(
        memberId,
        subtypeId,
        expiresOn || null,
        note.trim() || null,
      );
      if (!res.success) {
        setError(res.error);
        return;
      }
      setCaptureTaskId(res.taskId);
      setMode("waiting");
    });
  }

  async function handleWaitingCancel() {
    if (captureTaskId) {
      await cancelCaptureTask(captureTaskId);
    }
    onClose();
  }

  // Group subtypes by type for the picker.
  const grouped = subtypes.reduce<Record<string, UploadSubtype[]>>((acc, s) => {
    (acc[s.type] ??= []).push(s);
    return acc;
  }, {});

  // Metadata complete? Enables both Upload and Photo. Uploader still
  // has to pick a file in the OS dialog after clicking Upload.
  const metadataReady = subtypeId && (!expiryRequired || !!expiresOn);

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{mode === "waiting" ? "Waiting for photo…" : "Add document"}</DialogTitle>
          <DialogDescription>
            {mode === "waiting"
              ? "Open ClearHR on your phone and take the photo. This dialog closes when the photo arrives."
              : "Choose a subtype, then either Upload a file from this computer or take a Photo on your phone."}
          </DialogDescription>
        </DialogHeader>

        {mode === "waiting" ? (
          <div className="space-y-4">
            <div className="flex flex-col items-center gap-3 rounded-md border bg-muted/30 p-6">
              <Smartphone className="h-10 w-10 text-muted-foreground" />
              <div className="text-center">
                <p className="text-sm">
                  Take a photo of{" "}
                  <strong>{memberName}</strong>&apos;s{" "}
                  <strong>{currentSubtype?.name ?? "document"}</strong>
                </p>
                <p className="mt-2 text-sm text-muted-foreground">
                  Open ClearHR on your phone — the capture task is at the top of the app.
                </p>
              </div>
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={handleWaitingCancel}>Cancel</Button>
            </DialogFooter>
          </div>
        ) : (
          <>
            <div className="space-y-4">
              {error && (
                <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div>
              )}
              {waitingMessage && !error && (
                <div className="rounded-md bg-amber-100 p-3 text-sm text-amber-800 dark:bg-amber-900/30 dark:text-amber-200">
                  {waitingMessage}
                </div>
              )}

              <div className="space-y-2">
                <Label>Subtype</Label>
                {/* Radix Select needs SelectItem children to be inside
                    SelectGroup (or direct SelectContent children) —
                    wrapping in a <div> silently drops items after the
                    first group, which was truncating the list. */}
                <Select value={subtypeId} onValueChange={setSubtypeId}>
                  <SelectTrigger><SelectValue placeholder="Choose a subtype…" /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(grouped).map(([type, list]) => (
                      <SelectGroup key={type}>
                        <SelectLabel className="text-[10px] font-semibold uppercase text-muted-foreground">
                          {TYPE_LABEL[type] ?? type}
                        </SelectLabel>
                        {list.map((s) => (
                          <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                        ))}
                      </SelectGroup>
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

              {/* Hidden file input — opened by the Upload button
                  after metadata is complete. Nothing visible until the
                  caller commits to the Upload path. */}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/plain"
                className="hidden"
                onChange={handleFileChosen}
              />

              {/* Optional note — only meaningful for the Photo path. */}
              {subtypeId && (
                <div className="space-y-2">
                  <Label>Note for the photo (optional)</Label>
                  <Textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value.slice(0, 240))}
                    placeholder="e.g. both pages of the passport"
                    rows={2}
                  />
                  <p className="text-xs text-muted-foreground">
                    Only shown in the mobile app when you use Photo — ignored for Upload.
                  </p>
                </div>
              )}
            </div>

            <DialogFooter className="flex-wrap gap-2 sm:flex-nowrap">
              <Button variant="outline" onClick={onClose} disabled={pending}>Cancel</Button>
              <Button
                onClick={handlePhoto}
                disabled={pending || !metadataReady}
                title="Take the photo on your paired mobile app"
              >
                {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                <Camera className="mr-1.5 h-4 w-4" />
                Photo
              </Button>
              <Button
                onClick={handleUploadClick}
                disabled={pending || !metadataReady}
                title="Pick a file from this computer"
              >
                {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                <UploadIcon className="mr-1.5 h-4 w-4" />
                Upload
              </Button>
            </DialogFooter>
          </>
        )}
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
