"use client";

// CLE-237 — Settings → Documents → Templates. Word (.docx) templates
// with {{merge fields}} that produce member documents as PDFs.
// Spec: Spec Vault → specs/Documents/09 Document Templates.md

import { useCallback, useEffect, useState } from "react";
import { Archive, ArchiveRestore, Download, FileText, Loader2, Plus, Eye, AlertTriangle, ChevronDown, ChevronRight, Puzzle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { PdfViewer } from "@/components/documents/pdf-viewer";
import { useMemberLabel } from "@/contexts/member-label-context";
import { cn } from "@/lib/utils";
import {
  createDocumentTemplate,
  getTemplateVersionDownloadUrl,
  inspectTemplateFile,
  listDocumentTemplates,
  listTemplatePreviewMembers,
  listTemplateSubtypes,
  previewDocumentTemplate,
  setDocumentTemplateArchived,
  updateDocumentTemplate,
  uploadTemplateVersion,
} from "@/app/(dashboard)/documents/template-actions";
import type {
  DocumentTemplateRow,
  TemplateField,
  TemplateSubtypeOption,
} from "@/app/(dashboard)/documents/template-types";

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
}

export function DocumentTemplatesClient() {
  const [templates, setTemplates] = useState<DocumentTemplateRow[] | null>(null);
  const [catalogue, setCatalogue] = useState<{ tag: string; label: string }[]>([]);
  const [subtypes, setSubtypes] = useState<TemplateSubtypeOption[]>([]);
  const [rendererReady, setRendererReady] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<{ mode: "create" } | { mode: "edit"; row: DocumentTemplateRow } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  // CLE-238 — "Get the Word panel" instructions.
  const [showWordPanel, setShowWordPanel] = useState(false);

  const load = useCallback(async () => {
    const [t, s] = await Promise.all([listDocumentTemplates(), listTemplateSubtypes()]);
    if (!t.success) {
      setError(t.error);
      setTemplates([]);
      return;
    }
    setError(null);
    setTemplates(t.templates);
    setCatalogue(t.catalogue);
    setRendererReady(t.rendererReady);
    if (s.success) setSubtypes(s.subtypes);
  }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.all([listDocumentTemplates(), listTemplateSubtypes()]).then(([t, s]) => {
      if (cancelled) return;
      if (!t.success) {
        setError(t.error);
        setTemplates([]);
        return;
      }
      setTemplates(t.templates);
      setCatalogue(t.catalogue);
      setRendererReady(t.rendererReady);
      if (s.success) setSubtypes(s.subtypes);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const visible = (templates ?? []).filter((t) => (showArchived ? t.archivedAt : !t.archivedAt));
  const archivedCount = (templates ?? []).filter((t) => t.archivedAt).length;

  async function toggleArchive(row: DocumentTemplateRow) {
    setBusyId(row.id);
    const res = await setDocumentTemplateArchived(row.id, !row.archivedAt);
    setBusyId(null);
    if (!res.success) {
      setError(res.error);
      return;
    }
    await load();
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground">
            Word (.docx) files with merge fields like <code className="text-xs">{"{{member.first_name}}"}</code>. ClearHR fills them in and files a PDF.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Button size="sm" variant="ghost" onClick={() => setShowWordPanel(true)}>
            <Puzzle className="mr-1.5 h-4 w-4" />
            Get the Word panel
          </Button>
          <Button size="sm" variant="outline" onClick={() => setEditing({ mode: "create" })} disabled={subtypes.length === 0}>
            <Plus className="mr-1.5 h-4 w-4" />
            Add template
          </Button>
        </div>
      </div>

      {!rendererReady && (
        <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>PDF conversion isn&apos;t set up yet. Templates can be uploaded, but previews and documents can&apos;t be produced until it is.</span>
        </div>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}

      {templates === null ? (
        <div className="flex justify-center py-6">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : error && templates.length === 0 ? null : visible.length === 0 ? (
        <p className="text-sm text-muted-foreground">{showArchived ? "No archived templates." : "No templates yet."}</p>
      ) : (
        <div className="overflow-hidden rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr className="text-left text-xs uppercase text-muted-foreground">
                <th className="px-3 py-2 font-medium">Name</th>
                <th className="px-3 py-2 font-medium">Produces</th>
                <th className="px-3 py-2 font-medium">Version</th>
                <th className="px-3 py-2 font-medium">Fields</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {visible.map((t) => (
                <tr key={t.id} className="cursor-pointer border-t hover:bg-muted/30" onClick={() => setEditing({ mode: "edit", row: t })}>
                  <td className="px-3 py-2 font-medium">
                    <span className="inline-flex items-center gap-1.5">
                      <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                      {t.name}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{t.subtypeName}</td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {t.current ? `v${t.current.versionNumber} · ${fmtDate(t.current.uploadedAt)}` : "—"}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{t.current?.fields.length ?? 0}</td>
                  <td className="px-3 py-2 text-right">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          aria-label={t.archivedAt ? "Restore template" : "Archive template"}
                          disabled={busyId === t.id}
                          onClick={(e) => {
                            e.stopPropagation();
                            void toggleArchive(t);
                          }}
                        >
                          {busyId === t.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : t.archivedAt ? (
                            <ArchiveRestore className="h-3.5 w-3.5" />
                          ) : (
                            <Archive className="h-3.5 w-3.5" />
                          )}
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>{t.archivedAt ? "Restore" : "Archive"}</TooltipContent>
                    </Tooltip>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {(archivedCount > 0 || showArchived) && (
        <button type="button" className="text-xs text-muted-foreground underline-offset-2 hover:underline" onClick={() => setShowArchived((v) => !v)}>
          {showArchived ? "Show current templates" : `Show archived (${archivedCount})`}
        </button>
      )}

      {showWordPanel && <WordPanelDialog onClose={() => setShowWordPanel(false)} />}

      {editing && (
        <TemplateEditorDialog
          key={editing.mode === "edit" ? editing.row.id : "new"}
          row={editing.mode === "edit" ? editing.row : null}
          subtypes={subtypes}
          catalogue={catalogue}
          rendererReady={rendererReady}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await load();
          }}
        />
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------

const KIND_STYLE: Record<TemplateField["kind"], string> = {
  member: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  organisation: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  today: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  custom: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  ask: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  unknown: "bg-red-100 text-red-800 ring-1 ring-red-400 dark:bg-red-900/30 dark:text-red-300",
};

function FieldGroup({ title, list }: { title: string; list: TemplateField[] }) {
  return (
    list.length === 0 ? null : (
      <div className="space-y-1">
        <p className="text-xs font-medium text-muted-foreground">{title}</p>
        <div className="flex flex-wrap gap-1.5">
          {list.map((f) => (
            <span key={f.tag} className={cn("rounded px-1.5 py-0.5 font-mono text-[11px]", KIND_STYLE[f.kind])} title={f.label}>
              {`{{${f.tag}}}`}
              {f.kind !== "unknown" && <span className="ml-1 font-sans opacity-70">{f.label}</span>}
              {f.sensitive && <span className="ml-1 font-sans">(sensitive)</span>}
            </span>
          ))}
        </div>
      </div>
    )
  );
}

function FieldList({ fields }: { fields: TemplateField[] }) {
  if (fields.length === 0) {
    return <p className="text-xs text-muted-foreground">No merge fields found. The file will be produced exactly as it is.</p>;
  }
  const unknown = fields.filter((f) => f.kind === "unknown");
  const ask = fields.filter((f) => f.kind === "ask");
  const known = fields.filter((f) => f.kind !== "unknown" && f.kind !== "ask");
  return (
    <div className="space-y-2">
      <FieldGroup title="Not recognised — fix these in Word" list={unknown} />
      <FieldGroup title="Filled from records" list={known} />
      <FieldGroup title="Asked when the document is created" list={ask} />
    </div>
  );
}

function TemplateEditorDialog({
  row,
  subtypes,
  catalogue,
  rendererReady,
  onClose,
  onSaved,
}: {
  row: DocumentTemplateRow | null;
  subtypes: TemplateSubtypeOption[];
  catalogue: { tag: string; label: string }[];
  rendererReady: boolean;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const { memberLabel } = useMemberLabel();
  const isEdit = row !== null;
  const [name, setName] = useState(row?.name ?? "");
  const [subtypeId, setSubtypeId] = useState(row?.subtypeId ?? (subtypes.find((s) => s.type === "contract") ?? subtypes[0])?.id ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [fileFields, setFileFields] = useState<TemplateField[] | null>(null);
  const [inspecting, setInspecting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCatalogue, setShowCatalogue] = useState(false);

  // Preview
  const [members, setMembers] = useState<{ id: string; name: string }[]>([]);
  const [previewMemberId, setPreviewMemberId] = useState("");
  const [previewing, setPreviewing] = useState(false);
  const [preview, setPreview] = useState<{ url: string; fileName: string } | null>(null);

  useEffect(() => {
    if (!isEdit) return;
    let cancelled = false;
    listTemplatePreviewMembers().then((r) => {
      if (!cancelled && r.success) setMembers(r.members);
    });
    return () => {
      cancelled = true;
    };
  }, [isEdit]);

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview.url); }, [preview]);

  const archived = Boolean(row?.archivedAt);
  const unknownCount = (fileFields ?? []).filter((f) => f.kind === "unknown").length;
  const dirty = !isEdit || name.trim() !== row!.name || subtypeId !== row!.subtypeId || file !== null;
  const canSave =
    !saving && !inspecting && dirty && name.trim() !== "" && subtypeId !== "" && (isEdit || file !== null) && unknownCount === 0 && !(file && !fileFields);

  async function chooseFile(f: File | null) {
    setFile(f);
    setFileFields(null);
    setError(null);
    if (!f) return;
    setInspecting(true);
    const fd = new FormData();
    fd.append("file", f);
    const res = await inspectTemplateFile(fd);
    setInspecting(false);
    if (!res.success) {
      setError(res.error);
      setFile(null);
      return;
    }
    setFileFields(res.fields);
    if (!name.trim()) setName(f.name.replace(/\.docx$/i, ""));
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      if (!isEdit) {
        const fd = new FormData();
        fd.append("name", name.trim());
        fd.append("subtypeId", subtypeId);
        fd.append("file", file!);
        const res = await createDocumentTemplate(fd);
        if (!res.success) return setError(res.error);
      } else {
        if (name.trim() !== row!.name || subtypeId !== row!.subtypeId) {
          const res = await updateDocumentTemplate(row!.id, { name: name.trim(), subtypeId });
          if (!res.success) return setError(res.error);
        }
        if (file) {
          const fd = new FormData();
          fd.append("file", file);
          const res = await uploadTemplateVersion(row!.id, fd);
          if (!res.success) return setError(res.error);
        }
      }
      await onSaved();
    } finally {
      setSaving(false);
    }
  }

  async function runPreview() {
    if (!row || !previewMemberId) return;
    setPreviewing(true);
    setError(null);
    const res = await previewDocumentTemplate(row.id, previewMemberId);
    setPreviewing(false);
    if (!res.success) return setError(res.error);
    const bin = atob(res.pdfBase64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
    setPreview({ url, fileName: res.fileName });
  }

  async function download(versionId: string) {
    const res = await getTemplateVersionDownloadUrl(versionId);
    if (!res.success) return setError(res.error);
    window.location.href = res.url;
  }

  const employment = subtypes.filter((s) => s.type === "contract");
  const other = subtypes.filter((s) => s.type === "attachment");
  const selectedSubtype = subtypes.find((s) => s.id === subtypeId);

  return (
    <>
      <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{isEdit ? row!.name : "New template"}</DialogTitle>
            <DialogDescription>
              Upload a Word (.docx) file. Merge fields use double braces, e.g. <code className="text-xs">{"{{member.full_name}}"}</code>; anything ClearHR
              should ask for when the document is made uses <code className="text-xs">{"{{ask.salary}}"}</code>.
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-[60vh] space-y-5 overflow-y-auto px-1">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="tpl-name">Name</Label>
                <Input id="tpl-name" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} placeholder="e.g. Permanent contract — full time" />
              </div>
              <div className="space-y-1.5">
                <Label>Produces</Label>
                <Select value={subtypeId} onValueChange={setSubtypeId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Choose a document kind" />
                  </SelectTrigger>
                  <SelectContent>
                    {employment.length > 0 && (
                      <SelectGroup>
                        <SelectLabel>Employment</SelectLabel>
                        {employment.map((s) => (
                          <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                        ))}
                      </SelectGroup>
                    )}
                    {other.length > 0 && (
                      <SelectGroup>
                        <SelectLabel>Other</SelectLabel>
                        {other.map((s) => (
                          <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                        ))}
                      </SelectGroup>
                    )}
                  </SelectContent>
                </Select>
                {selectedSubtype && selectedSubtype.signOff !== "none" && (
                  <p className="text-xs text-muted-foreground">
                    {selectedSubtype.signOff === "sign"
                      ? "Documents of this kind are signed — after creating one you can send it straight for signature."
                      : `The ${memberLabel} will be asked to acknowledge documents of this kind.`}
                  </p>
                )}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="tpl-file">{isEdit ? "Replace file (saved as a new version)" : "Word file"}</Label>
              <Input
                id="tpl-file"
                type="file"
                accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                disabled={archived}
                onChange={(e) => void chooseFile(e.target.files?.[0] ?? null)}
              />
              {inspecting && (
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" /> Reading merge fields…
                </p>
              )}
            </div>

            {(fileFields || row?.current) && (
              <div className="space-y-1.5 rounded-md border p-3">
                <p className="text-sm font-medium">
                  {fileFields ? "Merge fields in the new file" : `Merge fields (v${row!.current!.versionNumber})`}
                </p>
                <FieldList fields={fileFields ?? row!.current!.fields} />
              </div>
            )}

            <div>
              <button type="button" className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground" onClick={() => setShowCatalogue((v) => !v)}>
                {showCatalogue ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                Available merge fields
              </button>
              {showCatalogue && (
                <div className="mt-2 grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2">
                  {catalogue.map((c) => (
                    <div key={c.tag} className="flex justify-between gap-2">
                      <code className="select-all">{`{{${c.tag}}}`}</code>
                      <span className="truncate text-muted-foreground">{c.label}</span>
                    </div>
                  ))}
                  <div className="flex justify-between gap-2">
                    <code>{"{{ask.your_question}}"}</code>
                    <span className="text-muted-foreground">Asked each time</span>
                  </div>
                </div>
              )}
            </div>

            {isEdit && !archived && row!.current && (
              <div className="space-y-2 rounded-md border p-3">
                <p className="text-sm font-medium">Preview</p>
                <p className="text-xs text-muted-foreground">
                  Produces a sample PDF with a {memberLabel}&apos;s details. Nothing is filed. Questions show as [Label].
                </p>
                <div className="flex gap-2">
                  <Select value={previewMemberId} onValueChange={setPreviewMemberId}>
                    <SelectTrigger className="flex-1">
                      <SelectValue placeholder={`Choose a ${memberLabel}`} />
                    </SelectTrigger>
                    <SelectContent>
                      {members.map((m) => (
                        <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button type="button" variant="outline" disabled={!previewMemberId || previewing || !rendererReady} onClick={() => void runPreview()}>
                    {previewing ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Eye className="mr-1.5 h-4 w-4" />}
                    Preview
                  </Button>
                </div>
              </div>
            )}

            {isEdit && row!.versions.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-sm font-medium">Versions</p>
                <ul className="divide-y rounded-md border text-xs">
                  {row!.versions.map((v) => (
                    <li key={v.id} className="flex items-center justify-between gap-2 px-3 py-1.5">
                      <span>
                        <span className="font-medium">v{v.versionNumber}</span> · {v.fileName} · {fmtDate(v.uploadedAt)}
                        {v.uploadedByName ? ` · ${v.uploadedByName}` : ""}
                      </span>
                      <Button type="button" size="icon" variant="ghost" className="h-6 w-6" aria-label="Download" onClick={() => void download(v.id)}>
                        <Download className="h-3.5 w-3.5" />
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="button" disabled={!canSave} onClick={() => void save()}>
              {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              {isEdit ? "Save" : "Add template"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {preview && (
        <Dialog open onOpenChange={(o) => { if (!o) setPreview(null); }}>
          <DialogContent className="flex max-h-[90vh] flex-col sm:max-w-3xl">
            <DialogHeader>
              <DialogTitle className="truncate text-sm font-medium">{preview.fileName}</DialogTitle>
              <DialogDescription>Preview — not filed against any {memberLabel}.</DialogDescription>
            </DialogHeader>
            <div className="h-[70vh] w-full overflow-auto rounded-md border bg-muted/30">
              <PdfViewer url={preview.url} fileName={preview.fileName} />
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// CLE-238 — how to add the ClearHR panel to Word.

function WordPanelDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>ClearHR panel for Word</DialogTitle>
          <DialogDescription>
            A panel inside Microsoft Word that lists your merge fields, inserts them where the cursor is, checks the document and sends it
            straight here as a template. Works in Word for Windows, Mac and the web.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] space-y-4 overflow-y-auto px-1 text-sm">
          <Button asChild size="sm">
            <a href="/word-addin/manifest.xml" download>
              <Download className="mr-1.5 h-4 w-4" />
              Download the panel file (manifest)
            </a>
          </Button>
          <div className="space-y-1">
            <p className="font-medium">Just for you</p>
            <ul className="list-disc space-y-1.5 pl-5 text-muted-foreground">
              <li>
                <strong>Word for Windows:</strong> put the downloaded file in a folder and share it (right-click → Properties → Sharing),
                then copy its network path, e.g. <code className="text-xs">{"\\\\YOUR-PC\\ClearHR"}</code>. In Word: <strong>File → Options → Trust
                Center → Trust Center Settings → Trusted Add-in Catalogs</strong>, paste the path, <strong>Add catalog</strong>, tick{" "}
                <strong>Show in Menu</strong>, OK, and restart Word. Then <strong>Home → Add-ins → More Add-ins → Shared Folder</strong> →
                ClearHR → Add.
              </li>
              <li>
                <strong>Word for Mac:</strong> copy the file into the folder{" "}
                <code className="text-xs">~/Library/Containers/com.microsoft.Word/Data/Documents/wef</code> (create <code className="text-xs">wef</code> if
                it isn&apos;t there) and restart Word.
              </li>
              <li>
                <strong>Word on the web:</strong> <strong>Home → Add-ins → More Add-ins → My Add-ins → Upload My Add-in</strong> and choose the file.
              </li>
              <li>
                Then click <strong>ClearHR fields</strong> on the Home tab and sign in with your ClearHR email and password.
              </li>
            </ul>
          </div>
          <div className="space-y-1">
            <p className="font-medium">For everyone in your organisation</p>
            <p className="text-muted-foreground">
              Your Microsoft 365 administrator can add the same file once in <strong>Microsoft 365 admin centre → Settings → Integrated apps →
              Upload custom apps</strong> and choose who gets it. It then appears in Word automatically.
            </p>
          </div>
          <p className="text-xs text-muted-foreground">
            The panel only shows field names — never anyone&apos;s details — and only to people who can set up templates.
          </p>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
