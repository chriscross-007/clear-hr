"use client";

// CLE-211 follow-up / spec §7b.13 — Document Details dialog.
//
// Single source of truth for one document. Opened from:
//   - Per-member docs grid row click
//   - Compliance dashboard row click (real doc rows only)
//
// Four sections stacked in one wide dialog:
//   1. At a glance — read-only header + View button
//   2. Editable metadata (Subtype, Expires, Note)
//   3. Verify / Renew (inline)
//   4. History (audit timeline)
//
// The View button doesn't open a modal-over-modal — it temporarily
// swaps the dialog's content for the file viewer. Close/Back returns
// to the details view without re-fetching audit history.
//
// Employee stripped variant: when `isSelf` and the caller can't
// update, sections 2 + 3 hide entirely and the History omits
// document.viewed / document.downloaded rows with no toggle.

import { useEffect, useMemo, useState, useTransition } from "react";
import {
  ArrowLeft,
  ExternalLink,
  Eye,
  Loader2,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { STATUS_LABEL, STATUS_TONE } from "@/lib/document-status";
import {
  getDocumentDetail,
  getDocumentAuditHistory,
  updateMemberDocumentMetadata,
  verifyMemberDocument,
  renewMemberDocument,
  getMemberDocumentSignedUrl,
  getSubtypesForUpload,
  type DocumentDetailContext,
  type DocumentAuditEntry,
} from "@/app/(dashboard)/members/[memberId]/docs/document-actions";

const TYPE_LABEL: Record<string, string> = {
  contract: "Contract",
  certificate: "Certificate",
  evidence: "Evidence",
  attachment: "Attachment",
  organisation_document: "Organisation Document",
};

const CHATTY_ACTIONS = new Set(["document.viewed", "document.downloaded"]);

interface Props {
  documentId: string;
  /** Caller has `documents.update` on the target member's scope. */
  canUpdate: boolean;
  onClose: () => void;
  /** Called when metadata / verify / renew commits so parents can
   *  refresh their list. */
  onSaved?: () => void | Promise<void>;
}

type Stage = "details" | "viewer";

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso + "T00:00:00Z").toLocaleDateString("en-GB", {
    day: "2-digit", month: "short", year: "numeric", timeZone: "UTC",
  });
}
function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
}
function fmtFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
function actionLabel(action: string): string {
  return action.replace(/^document\./, "").replace(/_/g, " ");
}

export function DocumentDetailsDialog({
  documentId,
  canUpdate,
  onClose,
  onSaved,
}: Props) {
  const [detail, setDetail] = useState<DocumentDetailContext | null>(null);
  const [history, setHistory] = useState<DocumentAuditEntry[] | null>(null);
  const [subtypes, setSubtypes] = useState<Array<{ id: string; name: string; type: string }>>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [stage, setStage] = useState<Stage>("details");
  const [viewer, setViewer] = useState<{ url: string; fileName: string; contentType: string } | null>(null);
  const [viewerError, setViewerError] = useState<string | null>(null);

  // Edit state
  const [subtypeId, setSubtypeId] = useState<string>("");
  const [expiresOn, setExpiresOn] = useState<string>("");
  const [note, setNote] = useState<string>("");
  const [metaError, setMetaError] = useState<string | null>(null);
  const [metaPending, startMetaTransition] = useTransition();

  // Verify state
  const [verifiedOn, setVerifiedOn] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [nextReviewOn, setNextReviewOn] = useState<string>("");
  const [verifyNotes, setVerifyNotes] = useState<string>("");
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [verifyPending, startVerifyTransition] = useTransition();

  // History toggle
  const [showChatty, setShowChatty] = useState(false);

  // Load detail + history on mount / when documentId changes.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const dRes = await getDocumentDetail(documentId);
      if (cancelled) return;
      if (!dRes.success) { setLoadError(dRes.error); return; }
      setDetail(dRes.detail);
      setSubtypeId(dRes.detail.row.subtypeId ?? "");
      setExpiresOn(dRes.detail.row.expiresOn ?? "");
      setNote(dRes.detail.row.note ?? "");
      setNextReviewOn(dRes.detail.row.nextReviewOn ?? "");
      setVerifyNotes(dRes.detail.verificationNotes ?? "");

      // Now that we know the target member, load subtypes + history in
      // parallel. Filter subtypes to the doc's `type` bucket so the
      // dropdown only shows same-family options.
      const [stRes, hRes] = await Promise.all([
        getSubtypesForUpload(dRes.detail.targetMemberId),
        getDocumentAuditHistory(documentId),
      ]);
      if (cancelled) return;
      if (stRes.success) {
        setSubtypes(stRes.subtypes.filter((s) => s.type === dRes.detail.row.type));
      }
      if (hRes.success) setHistory(hRes.entries);
    })();
    return () => { cancelled = true; };
  }, [documentId]);

  const employeeStripped = detail?.isSelf && !canUpdate;

  const visibleHistory = useMemo(() => {
    if (!history) return [];
    if (employeeStripped) return history.filter((e) => !CHATTY_ACTIONS.has(e.action));
    if (showChatty) return history;
    return history.filter((e) => !CHATTY_ACTIONS.has(e.action));
  }, [history, showChatty, employeeStripped]);

  async function refreshDetail() {
    const dRes = await getDocumentDetail(documentId);
    if (dRes.success) setDetail(dRes.detail);
    const hRes = await getDocumentAuditHistory(documentId);
    if (hRes.success) setHistory(hRes.entries);
  }

  function handleSaveMetadata() {
    if (!detail) return;
    setMetaError(null);
    startMetaTransition(async () => {
      const res = await updateMemberDocumentMetadata(detail.row.id, {
        subtypeId: subtypeId || null,
        expiresOn: expiresOn || null,
        note: note.trim() ? note.trim() : null,
      });
      if (!res.success) { setMetaError(res.error ?? "Save failed"); return; }
      await refreshDetail();
      if (onSaved) await onSaved();
    });
  }

  function handleVerify() {
    if (!detail) return;
    setVerifyError(null);
    startVerifyTransition(async () => {
      const fn = detail.row.verifiedOn ? renewMemberDocument : verifyMemberDocument;
      const res = await fn(detail.row.id, {
        verifiedOn,
        nextReviewOn: nextReviewOn || null,
        verificationNotes: verifyNotes || null,
      });
      if (!res.success) { setVerifyError(res.error ?? "Save failed"); return; }
      await refreshDetail();
      if (onSaved) await onSaved();
    });
  }

  async function handleView() {
    if (!detail) return;
    setViewerError(null);
    const res = await getMemberDocumentSignedUrl(detail.row.id, "inline");
    if (!res.success) { setViewerError(res.error ?? "Could not load document"); return; }
    setViewer({
      url: res.url as string,
      fileName: (res.fileName as string | undefined) ?? detail.row.fileName,
      contentType: detail.row.contentType,
    });
    setStage("viewer");
  }

  function backFromViewer() {
    setStage("details");
    setViewer(null);
  }

  const showVerifySection = detail && detail.row.requiresVerification && canUpdate;
  const showEditSection = canUpdate && !employeeStripped;

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {stage === "viewer" && (
              <Button variant="ghost" size="sm" onClick={backFromViewer} className="-ml-2">
                <ArrowLeft className="mr-1 h-4 w-4" />
                Back
              </Button>
            )}
            {stage === "viewer" ? (viewer?.fileName ?? "Document") : "Document details"}
          </DialogTitle>
        </DialogHeader>

        {loadError && (
          <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{loadError}</div>
        )}

        {!detail && !loadError && (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {detail && stage === "viewer" && (
          <div className="max-h-[70vh] overflow-auto">
            {viewerError && (
              <div className="mb-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive">{viewerError}</div>
            )}
            {viewer && viewer.contentType.startsWith("image/") && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={viewer.url} alt={viewer.fileName} className="mx-auto max-h-[70vh] object-contain" />
            )}
            {viewer && !viewer.contentType.startsWith("image/") && (
              <iframe src={viewer.url} title={viewer.fileName} className="h-[70vh] w-full" />
            )}
          </div>
        )}

        {detail && stage === "details" && (
          <div className="max-h-[75vh] space-y-4 overflow-y-auto pr-1">
            {/* Section 1 — At a glance */}
            <section className="rounded-md border bg-muted/30 p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-xs uppercase text-muted-foreground">Document</p>
                  <p className="font-medium">
                    {TYPE_LABEL[detail.row.type] ?? detail.row.type}
                    {detail.row.subtypeName && <span className="text-muted-foreground"> / {detail.row.subtypeName}</span>}
                  </p>
                  <p className="text-xs text-muted-foreground truncate" title={detail.row.fileName}>
                    {detail.row.fileName} · {fmtFileSize(detail.row.fileSize)}
                  </p>
                </div>
                <Button size="sm" variant="outline" onClick={handleView}>
                  <Eye className="mr-1.5 h-4 w-4" />
                  View
                </Button>
              </div>

              {detail.row.statuses.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {detail.row.statuses.map((s) => (
                    <span
                      key={s}
                      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_TONE[s].className}`}
                    >
                      {STATUS_LABEL[s]}
                    </span>
                  ))}
                </div>
              )}

              <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <FactRow label="Member" value={detail.targetMemberName} />
                <FactRow label="Uploaded" value={
                  `${detail.uploadedByName ?? "Unknown"} · ${fmtDateTime(detail.row.uploadedAt)}`
                } />
                <FactRow label="Source" value={detail.row.captureSource === "photo" ? "Photo (mobile)" : "Upload"} />
                <FactRow label="Expires" value={fmtDate(detail.row.expiresOn)} />
                {(detail.verifiedByName || detail.row.verifiedOn) && (
                  <FactRow label="Verified" value={
                    `${detail.verifiedByName ?? "—"} · ${fmtDate(detail.row.verifiedOn)}`
                  } />
                )}
                <FactRow label="Next review" value={fmtDate(detail.row.nextReviewOn)} />
                {detail.row.note && <FactRow label="Note" value={detail.row.note} span={2} />}
              </div>
            </section>

            {/* Section 2 — Editable metadata */}
            {showEditSection && (
              <section className="rounded-md border p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium">Metadata</p>
                </div>
                {metaError && (
                  <div className="rounded-md bg-destructive/10 p-2 text-xs text-destructive">{metaError}</div>
                )}
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label className="text-xs">Subtype</Label>
                    <Select value={subtypeId} onValueChange={setSubtypeId}>
                      <SelectTrigger><SelectValue placeholder="Choose a subtype…" /></SelectTrigger>
                      <SelectContent>
                        {subtypes.map((s) => (
                          <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Expires on</Label>
                    <Input type="date" value={expiresOn} onChange={(e) => setExpiresOn(e.target.value)} />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Note</Label>
                  <Textarea
                    rows={2}
                    value={note}
                    onChange={(e) => setNote(e.target.value.slice(0, 240))}
                    placeholder="Optional — free text, up to 240 characters"
                  />
                </div>
                <div className="flex justify-end">
                  <Button size="sm" onClick={handleSaveMetadata} disabled={metaPending}>
                    {metaPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Save
                  </Button>
                </div>
              </section>
            )}

            {/* Section 3 — Verify / Renew */}
            {showVerifySection && (
              <section className="rounded-md border p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium">
                    {detail.row.verifiedOn ? "Renew verification" : "Verify document"}
                  </p>
                </div>
                {verifyError && (
                  <div className="rounded-md bg-destructive/10 p-2 text-xs text-destructive">{verifyError}</div>
                )}
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label className="text-xs">Verified on</Label>
                    <Input type="date" value={verifiedOn} onChange={(e) => setVerifiedOn(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Next review on</Label>
                    <Input type="date" value={nextReviewOn} onChange={(e) => setNextReviewOn(e.target.value)} />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Verification notes</Label>
                  <Textarea
                    rows={2}
                    maxLength={1000}
                    value={verifyNotes}
                    onChange={(e) => setVerifyNotes(e.target.value)}
                    placeholder="Anything else HR should know about this check…"
                  />
                </div>
                <div className="flex justify-end">
                  <Button size="sm" onClick={handleVerify} disabled={verifyPending || !verifiedOn}>
                    {verifyPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    <ShieldCheck className="mr-1.5 h-3.5 w-3.5" />
                    {detail.row.verifiedOn ? "Renew" : "Verify"}
                  </Button>
                </div>
              </section>
            )}

            {/* Section 4 — History */}
            <section className="rounded-md border p-4 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">History</p>
                {!employeeStripped && (
                  <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={showChatty}
                      onChange={(e) => setShowChatty(e.target.checked)}
                    />
                    Show views/downloads
                  </label>
                )}
              </div>
              {history === null ? (
                <div className="flex items-center justify-center py-6">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                </div>
              ) : visibleHistory.length === 0 ? (
                <p className="text-xs text-muted-foreground">Nothing recorded yet.</p>
              ) : (
                <ul className="space-y-2">
                  {visibleHistory.map((e) => (
                    <li key={e.id} className="text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">{e.actorName}</span>
                      {" · "}
                      <span className="text-foreground">{actionLabel(e.action)}</span>
                      {" · "}
                      <span>{fmtDateTime(e.createdAt)}</span>
                      {e.changes && Object.keys(e.changes).length > 0 && (
                        <div className="mt-0.5 pl-3">
                          {Object.entries(e.changes).map(([field, val]) => {
                            const v = val as { old?: unknown; new?: unknown };
                            return (
                              <div key={field}>
                                <span className="font-medium">{field}:</span>{" "}
                                <span>{String(v.old ?? "—")} → {String(v.new ?? "—")}</span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}

        <div className="mt-2 flex justify-end">
          <Button variant="outline" onClick={onClose}>
            <ExternalLink className="mr-1 h-4 w-4 rotate-180" />
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function FactRow({ label, value, span }: { label: string; value: string; span?: 1 | 2 }) {
  return (
    <div className={span === 2 ? "col-span-2" : undefined}>
      <p className="text-[10px] uppercase text-muted-foreground">{label}</p>
      <p className="text-sm whitespace-pre-wrap">{value}</p>
    </div>
  );
}
