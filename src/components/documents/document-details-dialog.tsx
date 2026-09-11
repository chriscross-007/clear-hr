"use client";

// CLE-211 follow-up / spec §7b.13 — Document Details dialog.
//
// Single source of truth for one document, wide-layout redesign.
// Header spans full width (4 rows); body splits 50/50 into a Preview
// pane on the left and a stacked Expiry → Verify → Review → Activity
// column on the right. The only vertically scrolling region is
// Activity.
//
// Every editable value is behind a small pencil icon that opens a
// popover with the single field-specific control (Subtype / Expiry /
// Verify / Review). CLE-212: the shared Note field has been removed
// from all four popovers. Free-text lives in the Activity thread
// instead — a proper conversation with author + timestamp per message,
// using the same conversations / conversation_messages tables as
// Absence Bookings. Activity merges those comments with the audit log.
//
// Preview signed URL loads eagerly on mount — trade the click-to-view
// step for a small upfront fetch.

import { useEffect, useMemo, useState, useTransition } from "react";
import { Camera, Download, Pencil, SendHorizontal, Upload as UploadIcon } from "lucide-react";
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
  getDocumentActivity,
  postDocumentComment,
  updateMemberDocumentMetadata,
  verifyMemberDocument,
  renewMemberDocument,
  getMemberDocumentSignedUrl,
  getSubtypesForUpload,
  type DocumentDetailContext,
  type DocumentActivityItem,
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
  /** When true, the dialog is fully read-only: pencils are hidden on
   *  every section, the Activity composer is hidden, and a "In Trash"
   *  pill sits at the top of the header. Used from the per-member
   *  Trash list so admins can still review a trashed doc without being
   *  able to change or comment on it. */
  readOnly?: boolean;
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
  "document.deleted": "Moved to Trash",
  "document.force_deleted": "Moved to Trash (retention override)",
  "document.restored": "Restored from Trash",
  "document.purged": "Permanently deleted",
};

function actionLabel(action: string): string {
  if (ACTION_LABEL_OVERRIDES[action]) return ACTION_LABEL_OVERRIDES[action];
  return action.replace(/^document\./, "").replace(/_/g, " ");
}

// Friendly labels for the fields that show up in audit `changes` diffs.
const CHANGE_FIELD_LABEL: Record<string, string> = {
  subtype_id: "Subtype",
  expires_on: "Expiry Date",
  next_review_on: "Next Review Date",
  verified_on: "Verified On",
  verified_by: "Verified By",
  note: "Note",
  file_name: "Filename",
};

// Fields whose values are ISO dates (YYYY-MM-DD) and should render as
// the UK short date. Datetime fields (verified_at etc.) are handled
// separately by fmtChangeValue's ISO-datetime detection.
const CHANGE_DATE_FIELDS = new Set([
  "expires_on",
  "next_review_on",
  "verified_on",
]);

function fmtChangeField(field: string): string {
  if (CHANGE_FIELD_LABEL[field]) return CHANGE_FIELD_LABEL[field];
  // Fallback: title-case the snake_case field name.
  return field
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// Fetches a fresh signed URL in `download` mode (which sets
// Content-Disposition: attachment on the response), triggers the
// browser's native download flow, then asks the caller to refresh the
// Activity feed so the just-written `document.downloaded` audit row
// shows up when the "Show views/downloads" toggle is on.
//
// Delivery mechanism is a hidden `<iframe>` pointed at the signed URL.
// The response carries Content-Disposition: attachment, so the browser
// starts a download and the iframe's page load "fails" harmlessly.
// This is more robust than the `<a download>` pattern inside a Radix
// Dialog — the dialog's focus trap + Next.js's link interception can
// interfere with a programmatically-clicked anchor.
async function downloadDocument(
  documentId: string,
  _fileName: string,
  onDone?: () => Promise<void>,
): Promise<void> {
  try {
    const res = await getMemberDocumentSignedUrl(documentId, "download");
    if (!res.success || !res.url) return;

    const iframe = document.createElement("iframe");
    iframe.style.display = "none";
    iframe.src = res.url;
    document.body.appendChild(iframe);
    // Remove the iframe after a short delay so we don't leak DOM nodes.
    // The browser has already started the download by then.
    window.setTimeout(() => {
      if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
    }, 4000);
  } catch {
    // Network hiccups on the signed-URL server action are non-fatal —
    // the user can just click again.
    return;
  }
  // Refresh Activity so the freshly-written document.downloaded row
  // appears when the "Show views/downloads" toggle is on. Failure here
  // must not surface an error overlay (dev-server flake shouldn't
  // look like a download failure).
  try {
    if (onDone) await onDone();
  } catch { /* ignore */ }
}

function fmtChangeValue(field: string, val: unknown): string {
  if (val === null || val === undefined || val === "") return "—";
  const s = String(val);
  if (CHANGE_DATE_FIELDS.has(field) && /^\d{4}-\d{2}-\d{2}$/.test(s)) {
    return fmtDate(s);
  }
  // Full ISO datetime (e.g. verified_at).
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) {
    return fmtDateTime(s);
  }
  return s;
}

export function DocumentDetailsDialog({
  documentId,
  canUpdate,
  onClose,
  onSaved,
  readOnly = false,
}: Props) {
  // A read-only opening (from the Trash list) forces every pencil off
  // and the composer off, regardless of whether the caller would
  // ordinarily have update rights.
  const effectiveCanUpdate = canUpdate && !readOnly;
  const [detail, setDetail] = useState<DocumentDetailContext | null>(null);
  const [activity, setActivity] = useState<DocumentActivityItem[] | null>(null);
  const [subtypes, setSubtypes] = useState<Array<{ id: string; name: string; type: string }>>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const [showChatty, setShowChatty] = useState(false);

  // Load detail, subtypes, activity, preview URL on mount / when
  // documentId changes.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const dRes = await getDocumentDetail(documentId);
      if (cancelled) return;
      if (!dRes.success) { setLoadError(dRes.error); return; }
      setDetail(dRes.detail);

      const [stRes, aRes, urlRes] = await Promise.all([
        getSubtypesForUpload(dRes.detail.targetMemberId),
        getDocumentActivity(documentId),
        getMemberDocumentSignedUrl(documentId, "inline"),
      ]);
      if (cancelled) return;
      if (stRes.success) {
        setSubtypes(stRes.subtypes.filter((s) => s.type === dRes.detail.row.type));
      }
      if (aRes.success) setActivity(aRes.items);
      if (urlRes.success) setPreviewUrl(urlRes.url as string);
      else setPreviewError(urlRes.error ?? "Could not load preview");

      // The signed-URL call above writes a `document.viewed` audit row
      // as a side effect. That write races the parallel
      // getDocumentActivity fetch, so the "current viewing" wouldn't
      // otherwise appear in the feed. Refetch once the URL call has
      // definitely landed so the just-written view row shows up when
      // the user toggles "Show views/downloads" on.
      if (urlRes.success) {
        const a2 = await getDocumentActivity(documentId);
        if (cancelled) return;
        if (a2.success) setActivity(a2.items);
      }
    })();
    return () => { cancelled = true; };
  }, [documentId]);

  const employeeStripped = detail?.isSelf && !canUpdate;

  const visibleActivity = useMemo(() => {
    if (!activity) return [];
    const filterChatty = (a: DocumentActivityItem) =>
      a.kind !== "audit" || !CHATTY_ACTIONS.has(a.entry.action);
    if (employeeStripped) return activity.filter(filterChatty);
    if (showChatty) return activity;
    return activity.filter(filterChatty);
  }, [activity, showChatty, employeeStripped]);

  async function refreshDetailAndHistory() {
    const [d, a] = await Promise.all([
      getDocumentDetail(documentId),
      getDocumentActivity(documentId),
    ]);
    if (d.success) setDetail(d.detail);
    if (a.success) setActivity(a.items);
    if (onSaved) await onSaved();
  }

  async function reloadActivity() {
    const a = await getDocumentActivity(documentId);
    if (a.success) setActivity(a.items);
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
                {effectiveCanUpdate && !employeeStripped && (
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

              {/* Row 3: status pills (+ "In Trash" pill in read-only mode). */}
              {(detail.row.statuses.length > 0 || readOnly) && (
                <div className="flex flex-wrap justify-center gap-1">
                  {readOnly && (
                    <span className="inline-block rounded-full bg-neutral-200 px-2 py-0.5 text-xs font-medium text-neutral-800 dark:bg-neutral-800 dark:text-neutral-200">
                      In Trash
                    </span>
                  )}
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

              {/* Row 4: origin */}
              <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-sm">
                <span className="inline-flex items-center gap-1">
                  Original Document{" "}
                  {detail.row.captureSource === "photo"
                    ? <Camera className="inline h-3.5 w-3.5" />
                    : <UploadIcon className="inline h-3.5 w-3.5" />}
                  {" "}by <strong>{detail.uploadedByName ?? "Unknown"}</strong>{" "}
                  <span className="text-muted-foreground">{fmtDateTime(detail.row.uploadedAt)}</span>
                </span>
              </div>
            </DialogHeader>

            <div className="grid grid-cols-2 gap-0" style={{ height: "min(70vh, 620px)" }}>
              {/* Left pane — Preview */}
              <div className="relative flex items-center justify-center overflow-hidden border-r bg-muted/20 pb-4">
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
                    <button
                      type="button"
                      onClick={() => void downloadDocument(documentId, detail.row.fileName, reloadActivity)}
                      className="underline hover:text-foreground"
                    >
                      Download
                    </button>{" "}
                    instead.
                  </div>
                )}
                {/* Floating Download button — always available when there's a
                    preview URL, positioned top-right of the pane. Fires a
                    distinct `document.downloaded` audit event so it shows up
                    in Activity separately from views. */}
                {previewUrl && (
                  <button
                    type="button"
                    onClick={() => void downloadDocument(documentId, detail.row.fileName, reloadActivity)}
                    className="absolute right-2 top-2 inline-flex h-8 w-8 items-center justify-center rounded-md border bg-background/90 text-muted-foreground shadow-sm backdrop-blur transition-colors hover:bg-background hover:text-foreground"
                    aria-label="Download"
                    title="Download"
                  >
                    <Download className="h-4 w-4" />
                  </button>
                )}
              </div>

              {/* Right pane — Expiry / Verify / Review / History */}
              <div className="flex flex-col overflow-hidden">
                {/* Expiry */}
                <div className="border-b p-4">
                  <ExpirySection
                    detail={detail}
                    canUpdate={effectiveCanUpdate && !employeeStripped}
                    onSaved={refreshDetailAndHistory}
                  />
                </div>

                {/* Verify */}
                <div className="border-b p-4">
                  <VerifySection
                    detail={detail}
                    canUpdate={effectiveCanUpdate && !employeeStripped}
                    onSaved={refreshDetailAndHistory}
                  />
                </div>

                {/* Review */}
                <div className="border-b p-4">
                  <ReviewSection
                    detail={detail}
                    canUpdate={effectiveCanUpdate && !employeeStripped}
                    onSaved={refreshDetailAndHistory}
                  />
                </div>

                {/* Activity — merged audit + comments feed. The list is
                    the only scrolling region; the composer stays pinned
                    below it. */}
                <div className="flex-1 overflow-hidden p-4 flex flex-col min-h-0">
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-base font-semibold">Activity</p>
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
                    {activity === null ? (
                      <p className="text-xs text-muted-foreground">Loading…</p>
                    ) : visibleActivity.length === 0 ? (
                      <p className="text-xs text-muted-foreground">Nothing recorded yet.</p>
                    ) : (
                      <ul className="space-y-2">
                        {visibleActivity.map((item) =>
                          item.kind === "audit" ? (
                            <li key={`a-${item.entry.id}`} className="text-xs text-muted-foreground">
                              <span className="font-medium text-foreground">{item.entry.actorName}</span>
                              {" · "}
                              <span className="text-foreground">{actionLabel(item.entry.action)}</span>
                              {" · "}
                              <span>{fmtDateTime(item.entry.createdAt)}</span>
                              {item.entry.changes && Object.keys(item.entry.changes).length > 0 && (
                                <div className="mt-0.5 pl-3">
                                  {Object.entries(item.entry.changes).map(([field, val]) => {
                                    const v = val as { old?: unknown; new?: unknown };
                                    return (
                                      <div key={field}>
                                        <span className="font-medium">{fmtChangeField(field)}:</span>{" "}
                                        <span>{fmtChangeValue(field, v.old)} → {fmtChangeValue(field, v.new)}</span>
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                              {(() => {
                                // Surface a small set of "context" keys from
                                // audit metadata — the ones that read as
                                // human-visible detail rather than routing
                                // plumbing. Currently just the force-delete
                                // reason, which used to be invisible in the
                                // Activity feed even though the audit row
                                // captured it.
                                const md = item.entry.metadata as Record<string, unknown> | null;
                                if (!md) return null;
                                const reason = md.force_delete_reason;
                                if (typeof reason !== "string" || reason.trim() === "") return null;
                                return (
                                  <div className="mt-0.5 pl-3">
                                    <span className="font-medium">Reason:</span> <span>{reason}</span>
                                  </div>
                                );
                              })()}
                            </li>
                          ) : (
                            <li key={`c-${item.comment.id}`} className="rounded-md border bg-muted/30 p-2">
                              <div className="flex items-baseline justify-between gap-2 text-xs text-muted-foreground">
                                <span className="font-medium text-foreground">{item.comment.authorName}</span>
                                <span>{fmtDateTime(item.comment.createdAt)}</span>
                              </div>
                              <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">{item.comment.body}</p>
                            </li>
                          ),
                        )}
                      </ul>
                    )}
                  </div>
                  {/* Composer — pinned below the scrolling list. Hidden
                      for employees viewing their own record without
                      update rights, and for the read-only mode used
                      when reviewing a trashed doc. */}
                  {!employeeStripped && !readOnly && (
                    <div className="mt-2 shrink-0">
                      <ActivityComposer documentId={documentId} onPosted={reloadActivity} />
                    </div>
                  )}
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
// Activity composer — small textarea + send button. Empties on submit.
// ---------------------------------------------------------------------------

function ActivityComposer({
  documentId,
  onPosted,
}: {
  documentId: string;
  onPosted: () => Promise<void>;
}) {
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function send() {
    const trimmed = body.trim();
    if (!trimmed || pending) return;
    setError(null);
    startTransition(async () => {
      const res = await postDocumentComment(documentId, trimmed);
      if (!res.success) { setError(res.error ?? "Could not post comment"); return; }
      setBody("");
      await onPosted();
    });
  }

  const canSend = body.trim().length > 0 && !pending;

  return (
    <div className="space-y-1">
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex items-end gap-2">
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value.slice(0, 2000))}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              send();
            }
          }}
          rows={2}
          placeholder="Add a comment…"
          className="min-h-9 resize-none py-2 text-sm"
        />
        <Button
          type="button"
          size="icon"
          className="h-9 w-9 shrink-0"
          onClick={send}
          disabled={!canSend}
          aria-label="Post comment"
          title="Post comment (⌘/Ctrl + Enter)"
        >
          <SendHorizontal className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pencil popovers — each edits its one field. CLE-212: no shared Note.
// Free-text belongs in the Activity thread.
// ---------------------------------------------------------------------------

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
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save() {
    setError(null);
    startTransition(async () => {
      const res = await updateMemberDocumentMetadata(detail.row.id, {
        subtypeId: subtypeId || null,
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
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save() {
    setError(null);
    startTransition(async () => {
      const res = await updateMemberDocumentMetadata(detail.row.id, {
        expiresOn: expiresOn || null,
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
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="outline" onClick={() => setOpen(false)} disabled={pending}>Cancel</Button>
          <Button size="sm" onClick={save} disabled={pending}>Save</Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function ExpirySection({
  detail,
  canUpdate,
  onSaved,
}: {
  detail: DocumentDetailContext;
  canUpdate: boolean;
  onSaved: () => Promise<void>;
}) {
  return (
    <div>
      <p className="text-base font-semibold">Expiry</p>
      <div className="mt-1 flex items-center gap-2 text-sm">
        <span>
          Expires <strong>{fmtDateOrNever(detail.row.expiresOn)}</strong>
        </span>
        {canUpdate && (
          <ExpiryPencil detail={detail} onSaved={onSaved} />
        )}
      </div>
    </div>
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
        <p className="text-base font-semibold">Verify</p>
        <p className="mt-1 text-sm text-muted-foreground">Verification not required</p>
      </div>
    );
  }

  return (
    <div>
      <p className="text-base font-semibold">Verify</p>
      <div className="mt-1 flex items-center gap-2 text-sm">
        {verifiedOn ? (
          <span>
            Last Verified: <strong>{fmtDate(verifiedOn)}</strong>
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
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const isRenew = detail.row.verifiedOn !== null;

  function save() {
    setError(null);
    startTransition(async () => {
      const fn = isRenew ? renewMemberDocument : verifyMemberDocument;
      // Deliberately not sending nextReviewOn — verify/renew is the
      // cycle reset, and the server recomputes next_review_on from
      // the subtype's review_period_months (or leaves it alone for
      // subtypes without a period). Sending the current value here
      // used to suppress the recompute and leave a stale review-by
      // date on the doc.
      const verifyRes = await fn(detail.row.id, {
        verifiedOn,
        verificationNotes: null,
      });
      if (!verifyRes.success) { setError(verifyRes.error ?? "Verify failed"); return; }
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
        <p className="text-base font-semibold">Review</p>
        <p className="mt-1 text-sm text-muted-foreground">Review not required</p>
      </div>
    );
  }

  return (
    <div>
      <p className="text-base font-semibold">Review</p>
      <div className="mt-1 flex items-center gap-2 text-sm">
        {nextReviewOn ? (
          <span>To be reviewed by <strong>{fmtDate(nextReviewOn)}</strong></span>
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
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // Match the server-side check in verifyOrRenew — a review date in
  // the past doesn't make sense (a review is a future commitment).
  // `min` on the date input is only advisory (some browsers ignore it
  // for typed input), so we also validate live in `onChange` + block
  // Save on the invalid state.
  const todayIso = new Date().toISOString().slice(0, 10);
  const inPast = nextReviewOn.length > 0 && nextReviewOn < todayIso;

  function save() {
    if (inPast) {
      setError("The review date can't be in the past.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await updateMemberDocumentMetadata(detail.row.id, {
        nextReviewOn: nextReviewOn || null,
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
          <Label className="text-xs">To be reviewed by</Label>
          <Input
            type="date"
            min={todayIso}
            value={nextReviewOn}
            onChange={(e) => {
              const v = e.target.value;
              setNextReviewOn(v);
              // Live feedback the moment the user picks or types
              // something before today. `min` isn't enough on its own
              // — some browsers only enforce it on form submission.
              if (v && v < todayIso) {
                setError("The review date can't be in the past.");
              } else {
                setError(null);
              }
            }}
            aria-invalid={inPast || undefined}
            className={inPast ? "border-destructive" : undefined}
          />
          <p className="text-[10px] text-muted-foreground">Leave blank to remove the scheduled review.</p>
        </div>
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="outline" onClick={() => setOpen(false)} disabled={pending}>Cancel</Button>
          <Button size="sm" onClick={save} disabled={pending || inPast}>Save</Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
