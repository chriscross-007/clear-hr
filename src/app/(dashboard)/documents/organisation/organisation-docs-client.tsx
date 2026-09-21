"use client";

// CLE-208 — Admin CRUD for organisation-scoped documents. Employee
// read view lives at /documents/organisation and reuses the read +
// download actions without the mutation surface.

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, FileText, Loader2, Plus, Trash2 } from "lucide-react";
import { DocumentDetailsDialog } from "@/components/documents/document-details-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  getOrgDocumentSignedUrl,
  getOrgUploadSubtypes,
  softDeleteOrgDocument,
  uploadOrgDocument,
  type OrgDocumentRow,
} from "@/app/(dashboard)/documents/organisation/org-document-actions";

const TYPE_LABEL: Record<string, string> = {
  organisation_document: "Organisation document",
};

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso + "T00:00:00Z").toLocaleDateString("en-GB", {
    day: "2-digit", month: "short", year: "numeric", timeZone: "UTC",
  });
}
function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
  });
}
function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function OrganisationDocsClient({
  initialRows,
  canEdit,
}: {
  initialRows: OrgDocumentRow[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [rows, setRows] = useState<OrgDocumentRow[]>(initialRows);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [detailsDocId, setDetailsDocId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<OrgDocumentRow | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    router.refresh();
  }
  // Keep local rows in sync when props change (after router.refresh).
  useEffect(() => { setRows(initialRows); }, [initialRows]);

  async function handleDownload(r: OrgDocumentRow) {
    const res = await getOrgDocumentSignedUrl(r.id, "download");
    if (!res.success || !res.url) return;
    const a = document.createElement("a");
    a.href = res.url;
    a.download = res.fileName ?? r.fileName;
    a.rel = "noopener noreferrer";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  return (
    <div className="space-y-4">
      {error && <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}

      {canEdit && (
        <div className="flex justify-end">
          <Button size="sm" onClick={() => setUploadOpen(true)}>
            <Plus className="mr-1.5 h-4 w-4" /> Upload
          </Button>
        </div>
      )}

      {rows.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          No organisation documents yet.
        </p>
      ) : (
        <div className="rounded-md border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                {/* CLE-221 follow-up — Col 1 folds Subtype (bold) + file
                    name + size into one cell so this list reads the
                    same way as the two My Documents cards.
                    Type column dropped: every row today is "Organisation
                    Document", so the column carried no information —
                    trivial to reinstate if we ever add a second org-
                    scope doc type. */}
                <th className="px-4 py-2 font-medium">Subtype</th>
                <th className="px-4 py-2 font-medium hidden lg:table-cell">Expires</th>
                <th className="px-4 py-2 font-medium hidden lg:table-cell">Uploaded</th>
                <th className="px-4 py-2 text-right" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.id}
                  className="cursor-pointer border-b last:border-b-0 hover:bg-muted/30"
                  onClick={() => setDetailsDocId(r.id)}
                  title="Open document details"
                >
                  <td className="px-4 py-2">
                    <div className="flex items-start gap-2 min-w-0">
                      <FileText className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0">
                        {/* Subtype line on top so this cell reads the same
                            way as the My Documents cards. Falls back to
                            an em-dash for the rare row with no subtype. */}
                        <p className="font-medium">
                          {r.subtypeName ?? <span className="text-muted-foreground">—</span>}
                        </p>
                        <p className="text-xs text-muted-foreground truncate">
                          {r.fileName}
                          <span className="ml-1 text-muted-foreground/70">({fmtSize(r.fileSize)})</span>
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-2 text-muted-foreground hidden lg:table-cell">{fmtDate(r.expiresOn)}</td>
                  <td className="px-4 py-2 text-muted-foreground hidden lg:table-cell">{fmtDateTime(r.uploadedAt)}</td>
                  <td className="px-4 py-2 text-right">
                    <div className="flex items-center justify-end gap-0.5">
                      <Button variant="ghost" size="icon" aria-label="Download" onClick={(e) => { e.stopPropagation(); void handleDownload(r); }}>
                        <ExternalLink className="h-4 w-4" />
                      </Button>
                      {canEdit && (
                        <Button variant="ghost" size="icon" aria-label="Delete" onClick={(e) => { e.stopPropagation(); setDeleting(r); }}>
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
      )}

      {detailsDocId && (
        // Row-click opens the shared Document Details dialog. `canUpdate`
        // is bound to the caller's org-docs write flag — admins with
        // `can_manage_organisation_documents` get the pencils inside;
        // read-only viewers get preview + download only.
        <DocumentDetailsDialog
          documentId={detailsDocId}
          canUpdate={canEdit}
          onClose={() => setDetailsDocId(null)}
          onSaved={async () => { await reload(); }}
        />
      )}

      {uploadOpen && (
        <UploadDialog onClose={() => setUploadOpen(false)} onUploaded={async () => { setUploadOpen(false); await reload(); }} />
      )}

      {deleting && (
        <AlertDialog open onOpenChange={(o) => { if (!o) setDeleting(null); }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete document</AlertDialogTitle>
              <AlertDialogDescription>
                <span className="font-medium">{deleting.fileName}</span> will move to Trash for 30 days,
                then be permanently deleted.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={async (e) => {
                  e.preventDefault();
                  const res = await softDeleteOrgDocument(deleting.id);
                  if (!res.success) { setError(res.error ?? "Failed to delete"); return; }
                  setDeleting(null);
                  await reload();
                }}
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  );
}

function UploadDialog({ onClose, onUploaded }: { onClose: () => void; onUploaded: () => Promise<void> }) {
  const [subtypes, setSubtypes] = useState<Awaited<ReturnType<typeof getOrgUploadSubtypes>>["subtypes"]>([]);
  const [subtypeId, setSubtypeId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [expiresOn, setExpiresOn] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    (async () => {
      const res = await getOrgUploadSubtypes();
      if (res.success) setSubtypes(res.subtypes);
    })();
  }, []);

  const current = useMemo(() => subtypes.find((s) => s.id === subtypeId) ?? null, [subtypes, subtypeId]);
  const expiryRequired = current?.expiryRequired ?? false;

  const grouped = subtypes.reduce<Record<string, typeof subtypes>>((acc, s) => {
    (acc[s.type] ??= []).push(s);
    return acc;
  }, {});

  function handleUpload() {
    if (!file) { setError("Choose a file first"); return; }
    if (!subtypeId) { setError("Choose a subtype"); return; }
    setError(null);
    const fd = new FormData();
    fd.set("file", file);
    fd.set("subtypeId", subtypeId);
    if (expiresOn) fd.set("expiresOn", expiresOn);
    startTransition(async () => {
      const res = await uploadOrgDocument(fd);
      if (!res.success) { setError(res.error ?? "Upload failed"); return; }
      await onUploaded();
    });
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Upload organisation document</DialogTitle>
          <DialogDescription>
            Choose the subtype. Organisation-scope subtypes (Employee Handbook and
            any you&apos;ve added in Settings) are the only options here.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {error && <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}
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
            <Label>Expires on {expiryRequired && <span className="text-destructive">*</span>}</Label>
            <Input type="date" value={expiresOn} onChange={(e) => setExpiresOn(e.target.value)} />
            {!expiryRequired && <p className="text-xs text-muted-foreground">Optional for this subtype.</p>}
          </div>
          <div className="space-y-2">
            <Label>File</Label>
            <Input type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            {file && <p className="text-xs text-muted-foreground">{file.name} · {fmtSize(file.size)}</p>}
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

