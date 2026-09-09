"use client";

// CLE-211 follow-up / spec §7b.13 — Document Details dialog.
//
// Single source of truth for one document, wide-layout redesign.
// Header spans full width (4 rows); body splits 50/50 into a Preview
// pane on the left and a stacked Verify → Review → History column on
// the right. The only vertically scrolling region is History.
//
// Every editable value is behind a small pencil icon that opens a
// popover with the field-specific control + the shared Note field.
// All four popovers (Subtype, Expiry, Verify, Review) write to
// `document.note` for the shared note; History picks up the note diff
// via the existing `document.metadata_updated` audit shape.
//
// Preview signed URL loads eagerly on mount — trade the click-to-view
// step for a small upfront fetch.

import { useEffect, useMemo, useState, useTransition } from "react";
import { Camera, Pencil, Upload as UploadIcon } from "lucide-react";
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
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
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
  canUpdate: boolean;
  onClose: () => void;
  onSaved?: () => void | Promise<void>;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso + "T00:00:00Z").toLocaleDateString("en-GB", {
    day: "2-digit", month: "short", year: "numeric", timeZone: "UTC",
  });
}
function fmtDateOrNever(iso: string | null): string {
  return iso ? fmtDate(iso) : "never";
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
const ACTION_LABEL_OVERRIDES: Record<string, string> = {
  "document.metadata_updated": "Details updated",
};

function actionLabel(action: string): string {
  if (ACTION_LABEL_OVERRIDES[action]) return ACTION_LABEL_OVERRIDES[action];
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

  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const [showChatty, setShowChatty] = useState(false);

  // Load detail, subtypes, history, preview URL on mount / when
  // documentId changes.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const dRes = await getDocumentDetail(documentId);
      if (cancelled) return;
      if (!dRes.success) { setLoadError(dRes.error); return; }
      setDetail(dRes.detail);

      const [stRes, hRes, urlRes] = await Promise.all([
        getSubtypesForUpload(dRes.detail.targetMemberId),
        getDocumentAuditHistory(documentId),
        getMemberDocumentSignedUrl(documentId, "inline"),
      ]);
      if (cancelled) return;
      if (stRes.success) {
        setSubtypes(stRes.subtypes.filter((s) => s.type === dRes.detail.row.type));
      }
      if (hRes.success) setHistory(hRes.entries);
      if (urlRes.success) setPreviewUrl(urlRes.url as string);
      else setPreviewError(urlRes.error ?? "Could not load preview");
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

  async function refreshDetailAndHistory() {
    const [d, h] = await Promise.all([
      getDocumentDetail(documentId),
      getDocumentAuditHistory(documentId),
    ]);
    if (d.success) setDetail(d.detail);
    if (h.success) setHistory(h.entries);
    if (onSaved) await onSaved();
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent
        // Override shadcn's default `sm:max-w-lg` at every breakpoint —
        // width is driven entirely by the inline style below.
        className="max-w-none sm:max-w-none p-0 gap-0"
        style={{ width: "min(1200px, 95vw)" }}
      >
        {/* Radix requires DialogTitle to be present in every
            DialogContent for a11y. Render a hidden fallback for the
            loading + error paths so the "Document details" mount
            isn't a11y-broken while the row is still being fetched. */}
        {!detail && (
          <DialogHeader className="sr-only">
            <DialogTitle>Document details</DialogTitle>
          </DialogHeader>
        )}

        {loadError && (
          <div className="p-6 text-sm text-destructive">{loadError}</div>
        )}

        {!detail && !loadError && (
          <div className="p-10 text-center text-sm text-muted-foreground">Loading…</div>
        )}

        {detail && (
          <>
            <DialogHeader className="border-b p-5 space-y-2 text-center sm:text-center">
              {/* Row 1: title + subtype pencil */}
              <DialogTitle className="text-xl flex items-center justify-center gap-2">
                <span>{detail.targetMemberName}</span>
                <span className="text-muted-foreground">·</span>
                <span>
                  {TYPE_LABEL[detail.row.type] ?? detail.row.type}
                  {detail.row.subtypeName && (
                    <span className="text-muted-foreground"> / {detail.row.subtypeName}</span>
                  )}
                </span>
                {canUpdate && !employeeStripped && (
                  <SubtypePencil
                    detail={detail}
                    subtypes={subtypes}
                    onSaved={refreshDetailAndHistory}
                  />
                )}
              </DialogTitle>

              {/* Row 2: filename + size */}
              <p className="text-xs text-muted-foreground truncate text-center" title={detail.row.fileName}>
                Filename: {detail.row.fileName} · {fmtFileSize(detail.row.fileSize)}
              </p>

              {/* Row 3: status pills */}
              {detail.row.statuses.length > 0 && (
                <div className="flex flex-wrap justify-center gap-1">
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

              {/* Row 4: origin + expiry */}
              <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-sm">
                <span className="inline-flex items-center gap-1">
                  Original Document{" "}
                  {detail.row.captureSource === "photo"
                    ? <Camera className="inline h-3.5 w-3.5" />
                    : <UploadIcon className="inline h-3.5 w-3.5" />}
                  {" "}by <strong>{detail.uploadedByName ?? "Unknown"}</strong>{" "}
                  <span className="text-muted-foreground">{fmtDateTime(detail.row.uploadedAt)}</span>
                </span>
                <span className="text-muted-foreground">·</span>
                <span className="inline-flex items-center gap-1">
                  Expires <strong>{fmtDateOrNever(detail.row.expiresOn)}</strong>
                  {canUpdate && !employeeStripped && (
                    <ExpiryPencil detail={detail} onSaved={refreshDetailAndHistory} />
                  )}
                </span>
              </div>
            </DialogHeader>

            <div className="grid grid-cols-2 gap-0" style={{ height: "min(70vh, 620px)" }}>
              {/* Left pane — Preview */}
              <div className="flex items-center justify-center overflow-hidden border-r bg-muted/20">
                {previewError ? (
                  <p className="text-sm text-destructive">{previewError}</p>
                ) : !previewUrl ? (
                  <p className="text-sm text-muted-foreground">Loading preview…</p>
                ) : detail.row.contentType.startsWith("image/") ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={previewUrl}
                    alt={detail.row.fileName}
                    className="max-h-full max-w-full object-contain"
                  />
                ) : detail.row.contentType === "application/pdf" ? (
                  <iframe src={previewUrl} title={detail.row.fileName} className="h-full w-full" />
                ) : (
                  <div className="p-6 text-center text-sm text-muted-foreground">
                    Preview not available for this file type.{" "}
                    <a href={previewUrl} download={detail.row.fileName} className="underline">
                      Download
                    </a>{" "}
                    instead.
                  </div>
                )}
              </div>

              {/* Right pane — Verify / Review / History */}
              <div className="flex flex-col overflow-hidden">
                {/* Verify */}
                <div className="border-b p-4">
                  <VerifySection
                    detail={detail}
                    canUpdate={canUpdate && !employeeStripped}
                    onSaved={refreshDetailAndHistory}
                  />
                </div>

                {/* Review */}
                <div className="border-b p-4">
                  <ReviewSection
                    detail={detail}
                    canUpdate={canUpdate && !employeeStripped}
                    onSaved={refreshDetailAndHistory}
                  />
                </div>

                {/* History — the only scrolling region */}
                <div className="flex-1 overflow-hidden p-4 flex flex-col">
                  <div className="mb-2 flex items-center justify-between">
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
                  <div className="flex-1 overflow-y-auto">
                    {history === null ? (
                      <p className="text-xs text-muted-foreground">Loading…</p>
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
                  </div>
                </div>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Pencil popovers — each edits its own field plus the shared Note.
// ---------------------------------------------------------------------------

function SharedNoteHint() {
  return (
    <p className="text-[10px] text-muted-foreground">
      Note is shared across Subtype, Expiry, Verify and Review.
    </p>
  );
}

function PencilButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center rounded p-1 text-muted-foreground hover:bg-muted"
      aria-label={label}
      title={label}
    >
      <Pencil className="h-3 w-3" />
    </button>
  );
}

function SubtypePencil({
  detail,
  subtypes,
  onSaved,
}: {
  detail: DocumentDetailContext;
  subtypes: Array<{ id: string; name: string; type: string }>;
  onSaved: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [subtypeId, setSubtypeId] = useState<string>(detail.row.subtypeId ?? "");
  const [note, setNote] = useState<string>(detail.row.note ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save() {
    setError(null);
    startTransition(async () => {
      const res = await updateMemberDocumentMetadata(detail.row.id, {
        subtypeId: subtypeId || null,
        note: note.trim() ? note.trim() : null,
      });
      if (!res.success) { setError(res.error ?? "Save failed"); return; }
      setOpen(false);
      await onSaved();
    });
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <span>
          <PencilButton onClick={() => setOpen(true)} label="Edit subtype" />
        </span>
      </PopoverTrigger>
      <PopoverContent className="w-80 space-y-2">
        <p className="text-sm font-medium">Re-classify document</p>
        {error && <div className="rounded-md bg-destructive/10 p-2 text-xs text-destructive">{error}</div>}
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
          <Label className="text-xs">Note</Label>
          <Textarea
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value.slice(0, 240))}
            placeholder="Optional, up to 240 characters"
          />
          <SharedNoteHint />
        </div>
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="outline" onClick={() => setOpen(false)} disabled={pending}>Cancel</Button>
          <Button size="sm" onClick={save} disabled={pending}>Save</Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function ExpiryPencil({
  detail,
  onSaved,
}: {
  detail: DocumentDetailContext;
  onSaved: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [expiresOn, setExpiresOn] = useState<string>(detail.row.expiresOn ?? "");
  const [note, setNote] = useState<string>(detail.row.note ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save() {
    setError(null);
    startTransition(async () => {
      const res = await updateMemberDocumentMetadata(detail.row.id, {
        expiresOn: expiresOn || null,
        note: note.trim() ? note.trim() : null,
      });
      if (!res.success) { setError(res.error ?? "Save failed"); return; }
      setOpen(false);
      await onSaved();
    });
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <span>
          <PencilButton onClick={() => setOpen(true)} label="Edit expiry" />
        </span>
      </PopoverTrigger>
      <PopoverContent className="w-80 space-y-2">
        <p className="text-sm font-medium">Edit expiry</p>
        {error && <div className="rounded-md bg-destructive/10 p-2 text-xs text-destructive">{error}</div>}
        <div className="space-y-1">
          <Label className="text-xs">Expires on</Label>
          <Input type="date" value={expiresOn} onChange={(e) => setExpiresOn(e.target.value)} />
          <p className="text-[10px] text-muted-foreground">Leave blank if the document has no expiry.</p>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Note</Label>
          <Textarea
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value.slice(0, 240))}
          />
          <SharedNoteHint />
        </div>
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="outline" onClick={() => setOpen(false)} disabled={pending}>Cancel</Button>
          <Button size="sm" onClick={save} disabled={pending}>Save</Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function VerifySection({
  detail,
  canUpdate,
  onSaved,
}: {
  detail: DocumentDetailContext;
  canUpdate: boolean;
  onSaved: () => Promise<void>;
}) {
  const requires = detail.row.requiresVerification;
  const verifiedOn = detail.row.verifiedOn;

  if (!requires) {
    return (
      <div>
        <p className="text-sm font-medium">Verify</p>
        <p className="mt-1 text-sm text-muted-foreground">Verification not required</p>
      </div>
    );
  }

  return (
    <div>
      <p className="text-sm font-medium">Verify</p>
      <div className="mt-1 flex items-center gap-2 text-sm">
        {verifiedOn ? (
          <span>
            Verified on <strong>{fmtDate(verifiedOn)}</strong>
            {detail.verifiedByName && (
              <span className="text-muted-foreground"> by {detail.verifiedByName}</span>
            )}
          </span>
        ) : (
          <span className="text-muted-foreground">Not yet verified</span>
        )}
        {canUpdate && (
          <VerifyPencil detail={detail} onSaved={onSaved} />
        )}
      </div>
    </div>
  );
}

function VerifyPencil({
  detail,
  onSaved,
}: {
  detail: DocumentDetailContext;
  onSaved: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [verifiedOn, setVerifiedOn] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState<string>(detail.row.note ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const isRenew = detail.row.verifiedOn !== null;

  function save() {
    setError(null);
    startTransition(async () => {
      // Fire the formal verify/renew audit event with the date. We
      // deliberately pass `verificationNotes = null` — the shared note
      // is written separately via updateMemberDocumentMetadata below
      // so it lives on the single `note` column.
      const fn = isRenew ? renewMemberDocument : verifyMemberDocument;
      const verifyRes = await fn(detail.row.id, {
        verifiedOn,
        verificationNotes: null,
        nextReviewOn: detail.row.nextReviewOn,
      });
      if (!verifyRes.success) { setError(verifyRes.error ?? "Verify failed"); return; }

      // If the note changed, persist that as a separate metadata edit
      // so History captures the diff via document.metadata_updated.
      const noteChanged = (note.trim() || null) !== (detail.row.note ?? null);
      if (noteChanged) {
        const metaRes = await updateMemberDocumentMetadata(detail.row.id, {
          note: note.trim() ? note.trim() : null,
        });
        if (!metaRes.success) {
          setError(metaRes.error ?? "Note save failed");
          return;
        }
      }

      setOpen(false);
      await onSaved();
    });
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <span>
          <PencilButton
            onClick={() => setOpen(true)}
            label={isRenew ? "Renew verification" : "Verify document"}
          />
        </span>
      </PopoverTrigger>
      <PopoverContent className="w-80 space-y-2">
        <p className="text-sm font-medium">{isRenew ? "Renew verification" : "Verify document"}</p>
        {error && <div className="rounded-md bg-destructive/10 p-2 text-xs text-destructive">{error}</div>}
        <div className="space-y-1">
          <Label className="text-xs">Verified on</Label>
          <Input type="date" value={verifiedOn} onChange={(e) => setVerifiedOn(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Note</Label>
          <Textarea
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value.slice(0, 240))}
          />
          <SharedNoteHint />
        </div>
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="outline" onClick={() => setOpen(false)} disabled={pending}>Cancel</Button>
          <Button size="sm" onClick={save} disabled={pending || !verifiedOn}>
            {isRenew ? "Renew" : "Verify"}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function ReviewSection({
  detail,
  canUpdate,
  onSaved,
}: {
  detail: DocumentDetailContext;
  canUpdate: boolean;
  onSaved: () => Promise<void>;
}) {
  // Review only makes sense when the subtype has a review cadence OR
  // the doc already has a next_review_on set. If neither, show "not
  // required" — matches the Verify section's shape.
  const nextReviewOn = detail.row.nextReviewOn;
  const requires = detail.row.requiresVerification; // reuse the same gate; review is meaningless when no verification workflow

  if (!requires) {
    return (
      <div>
        <p className="text-sm font-medium">Review</p>
        <p className="mt-1 text-sm text-muted-foreground">Review not required</p>
      </div>
    );
  }

  return (
    <div>
      <p className="text-sm font-medium">Review</p>
      <div className="mt-1 flex items-center gap-2 text-sm">
        {nextReviewOn ? (
          <span>Review on <strong>{fmtDate(nextReviewOn)}</strong></span>
        ) : (
          <span className="text-muted-foreground">No review scheduled</span>
        )}
        {canUpdate && (
          <ReviewPencil detail={detail} onSaved={onSaved} />
        )}
      </div>
    </div>
  );
}

function ReviewPencil({
  detail,
  onSaved,
}: {
  detail: DocumentDetailContext;
  onSaved: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [nextReviewOn, setNextReviewOn] = useState<string>(detail.row.nextReviewOn ?? "");
  const [note, setNote] = useState<string>(detail.row.note ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save() {
    setError(null);
    startTransition(async () => {
      const res = await updateMemberDocumentMetadata(detail.row.id, {
        nextReviewOn: nextReviewOn || null,
        note: note.trim() ? note.trim() : null,
      });
      if (!res.success) { setError(res.error ?? "Save failed"); return; }
      setOpen(false);
      await onSaved();
    });
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <span>
          <PencilButton onClick={() => setOpen(true)} label="Edit review date" />
        </span>
      </PopoverTrigger>
      <PopoverContent className="w-80 space-y-2">
        <p className="text-sm font-medium">Schedule review</p>
        {error && <div className="rounded-md bg-destructive/10 p-2 text-xs text-destructive">{error}</div>}
        <div className="space-y-1">
          <Label className="text-xs">Review on</Label>
          <Input type="date" value={nextReviewOn} onChange={(e) => setNextReviewOn(e.target.value)} />
          <p className="text-[10px] text-muted-foreground">Leave blank to remove the scheduled review.</p>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Note</Label>
          <Textarea
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value.slice(0, 240))}
          />
          <SharedNoteHint />
        </div>
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="outline" onClick={() => setOpen(false)} disabled={pending}>Cancel</Button>
          <Button size="sm" onClick={save} disabled={pending}>Save</Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
