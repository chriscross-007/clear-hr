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

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Camera, CheckSquare, Download, FileUp, Loader2, Pencil, RefreshCw, SendHorizontal, Smartphone, Upload as UploadIcon } from "lucide-react";
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
  replaceMemberDocument,
  finalizeDocumentReplace,
  type DocumentDetailContext,
  type DocumentActivityItem,
} from "@/app/(dashboard)/members/[memberId]/docs/document-actions";
import {
  queueCaptureTask,
  cancelCaptureTask,
} from "@/app/(dashboard)/members/[memberId]/docs/capture-actions";
import { createClient as createSupabaseBrowserClient } from "@/lib/supabase/client";
import { dispatchMemberDocsChanged } from "@/lib/member-docs-events";
import {
  acknowledgeDocument,
  getDocumentAcknowledgementStatus,
  type DocumentAcknowledgementStatus,
} from "@/app/(dashboard)/documents/acknowledgement-actions";

const TYPE_LABEL: Record<string, string> = {
  contract: "Contract",
  certificate: "Certificate",
  evidence: "RTW Evidence",
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
  /** CLE-216 follow-up — when true, the entire Activity section is
   *  hidden (header, feed, composer). Distinct axis from `readOnly`,
   *  which keeps the feed visible (Trash consumers want the audit
   *  trail). The self-scope "My Documents" surface passes both:
   *  employees see their doc + download but not the internal audit
   *  chatter or comment history. */
  hideActivity?: boolean;
  /** CLE-220 — when true, hide the four HR-facing metadata surfaces:
   *  Expiry, Verify, Review, and Replace. The Acknowledgement section
   *  (self-only, driven by subtype flag) stays visible so an employee
   *  can still click "I have read and understood".
   *
   *  `hideHrMetadata` also implies "no Replace", but Replace is
   *  already gated on `effectiveCanUpdate = canUpdate && !readOnly` so
   *  a self-scope caller who passes `canUpdate={false}` never gets
   *  Replace anyway — this prop is the explicit lever for the intent,
   *  redundant-but-safe for the Replace surface. */
  hideHrMetadata?: boolean;
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
  "document.replaced": "File replaced",
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
  hideActivity = false,
  hideHrMetadata = false,
}: Props) {
  // A read-only opening (from the Trash list) forces every pencil off
  // and the composer off, regardless of whether the caller would
  // ordinarily have update rights.
  const effectiveCanUpdate = canUpdate && !readOnly;
  // CLE-217 — the currently-displayed document id is lifted from the
  // prop into local state so the Replace flow can pivot the whole
  // dialog to the freshly-created replacement id without the parent
  // having to close + reopen. Seeded from the `documentId` prop; kept
  // in sync if the prop itself changes (belt + braces for callers
  // that mount a new dialog with a new prop rather than closing
  // first).
  const [currentDocumentId, setCurrentDocumentId] = useState(documentId);
  useEffect(() => { setCurrentDocumentId(documentId); }, [documentId]);
  const [detail, setDetail] = useState<DocumentDetailContext | null>(null);
  const [activity, setActivity] = useState<DocumentActivityItem[] | null>(null);
  const [subtypes, setSubtypes] = useState<Array<{ id: string; name: string; type: string }>>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const [showChatty, setShowChatty] = useState(false);

  // CLE-219 — Acknowledgement state.
  //   ackStatus  — server-fetched summary (whether ack is required,
  //                whether caller has ack'd, coverage summary for admin
  //                viewing org docs).
  //   readyToAck — the read-first gate. Enabled when the preview has
  //                loaded OR the download button has been clicked.
  //   ackPending — the ack button transition.
  const [ackStatus, setAckStatus] = useState<DocumentAcknowledgementStatus | null>(null);
  const [readyToAck, setReadyToAck] = useState(false);
  const [ackError, setAckError] = useState<string | null>(null);
  const [ackPending, startAckTransition] = useTransition();

  // Load detail, subtypes, activity, preview URL on mount / when the
  // active document id changes (either the prop or a post-Replace
  // pivot to a new id).
  useEffect(() => {
    let cancelled = false;
    // Reset per-doc UI state so the previous doc's preview / error
    // never bleed through the pivot.
    setDetail(null);
    setActivity(null);
    setPreviewUrl(null);
    setPreviewError(null);
    setLoadError(null);
    setAckStatus(null);
    setReadyToAck(false);
    setAckError(null);
    (async () => {
      const dRes = await getDocumentDetail(currentDocumentId);
      if (cancelled) return;
      if (!dRes.success) { setLoadError(dRes.error); return; }
      setDetail(dRes.detail);

      const [stRes, aRes, urlRes, ackRes] = await Promise.all([
        getSubtypesForUpload(dRes.detail.targetMemberId),
        getDocumentActivity(currentDocumentId),
        getMemberDocumentSignedUrl(currentDocumentId, "inline"),
        getDocumentAcknowledgementStatus(currentDocumentId),
      ]);
      if (cancelled) return;
      if (stRes.success) {
        setSubtypes(stRes.subtypes.filter((s) => s.type === dRes.detail.row.type));
      }
      if (aRes.success) setActivity(aRes.items);
      if (urlRes.success) {
        setPreviewUrl(urlRes.url as string);
        // CLE-219 — Preview loaded successfully → read-first gate
        // unlocks. Users on a working-preview path can Acknowledge
        // straight from the dialog. If preview fails, the gate can
        // still unlock via a Download click (handled below).
        setReadyToAck(true);
      } else {
        setPreviewError(urlRes.error ?? "Could not load preview");
      }
      if (ackRes.success) setAckStatus(ackRes.status);

      // The signed-URL call above writes a `document.viewed` audit row
      // as a side effect. That write races the parallel
      // getDocumentActivity fetch, so the "current viewing" wouldn't
      // otherwise appear in the feed. Refetch once the URL call has
      // definitely landed so the just-written view row shows up when
      // the user toggles "Show views/downloads" on.
      if (urlRes.success) {
        const a2 = await getDocumentActivity(currentDocumentId);
        if (cancelled) return;
        if (a2.success) setActivity(a2.items);
      }
    })();
    return () => { cancelled = true; };
  }, [currentDocumentId]);

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
      getDocumentDetail(currentDocumentId),
      getDocumentActivity(currentDocumentId),
    ]);
    if (d.success) setDetail(d.detail);
    if (a.success) setActivity(a.items);
    await notifySaved();
  }

  /** CLE-216 — Called after any successful save inside the dialog.
   *  Dispatches the member-docs-changed event so the sidebar avatar
   *  traffic light (and any other listener) reloads, then calls the
   *  caller's `onSaved`. Every existing `await onSaved()` site was
   *  migrated to this helper. */
  async function notifySaved() {
    if (detail) dispatchMemberDocsChanged(detail.targetMemberId);
    if (onSaved) await onSaved();
  }

  /** CLE-219 — Fire the ack click. Guarded by `readyToAck` at the
   *  UI level (button is disabled otherwise); this function is
   *  defensive-only — it will still call the server if invoked. On
   *  success, refresh the local ackStatus so the panel flips to the
   *  "You acknowledged this on …" stamp, and dispatch member-docs-
   *  changed so the dashboard chip decrements. */
  function handleAcknowledge() {
    setAckError(null);
    startAckTransition(async () => {
      const res = await acknowledgeDocument(currentDocumentId);
      if (!res.success) {
        setAckError(res.error);
        return;
      }
      // Refetch status so we get the timestamp + IP freshly from the
      // server (we don't have to construct it locally).
      const statusRes = await getDocumentAcknowledgementStatus(currentDocumentId);
      if (statusRes.success) setAckStatus(statusRes.status);
      if (detail) dispatchMemberDocsChanged(detail.targetMemberId);
    });
  }

  async function reloadActivity() {
    const a = await getDocumentActivity(currentDocumentId);
    if (a.success) setActivity(a.items);
  }

  /** CLE-217 — pivot the whole dialog to a freshly-created
   *  replacement document. Called from both Replace paths (file
   *  upload + photo capture). Fires the traffic-light event so the
   *  sidebar avatar + Required Documents card catch up. */
  async function pivotToReplacement(newId: string) {
    setCurrentDocumentId(newId);
    await notifySaved();
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent
        // Override shadcn's default `sm:max-w-lg` at every breakpoint —
        // width is driven entirely by the inline style below. Shrinks
        // to a compact loading box while `detail` is still fetching so
        // the user doesn't see a full-width empty dialog for 1–2s.
        //
        // Default close X is hidden — we render a named "Close" button
        // top-right instead once the doc has loaded, matching the
        // NewMemberDocumentDialog pattern. Consistent affordance across
        // both add and view surfaces, and stays out of the composer's
        // send arrow at the bottom.
        className="max-w-none sm:max-w-none p-0 gap-0"
        style={{ width: detail ? "min(1200px, 95vw)" : "auto" }}
        showCloseButton={false}
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
        {/* Named Close button (top-right). Shown once the doc has
            loaded — hidden during the compact "Loading…" flash so it
            doesn't crowd the placeholder. ESC still dismisses either
            way. Mirrors the NewMemberDocumentDialog's button. */}
        {(detail || loadError) && (
          <Button
            onClick={onClose}
            size="sm"
            className="absolute right-3 top-3 z-10"
          >
            Close
          </Button>
        )}

        {loadError && (
          <div className="p-6 text-sm text-destructive">{loadError}</div>
        )}

        {!detail && !loadError && (
          <div className="flex items-center gap-2 px-6 py-4 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading document…
          </div>
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
                      onClick={() => {
                        setReadyToAck(true);
                        void downloadDocument(currentDocumentId, detail.row.fileName, reloadActivity);
                      }}
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
                    in Activity separately from views. CLE-219 — clicking
                    Download also unlocks the acknowledge button's read-first
                    gate, so a caller who prefers reading the downloaded copy
                    can Acknowledge without needing the in-dialog preview. */}
                {previewUrl && (
                  <button
                    type="button"
                    onClick={() => {
                      setReadyToAck(true);
                      void downloadDocument(currentDocumentId, detail.row.fileName, reloadActivity);
                    }}
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
                {/* CLE-220 — `hideHrMetadata` collapses the four HR-only
                    sections (Expiry, Verify, Review, Replace) so the
                    employee-facing surfaces (My Documents + Org
                    Documents tabs on /my-documents) present a clean
                    read-and-acknowledge dialog. The Acknowledgement
                    section (below) stays visible so an employee can
                    still click "I have read and understood". */}
                {!hideHrMetadata && (
                  <>
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

                    {/* Replace (CLE-217) — rendered whenever the caller has
                        update rights, but the *content* switches on
                        verification state:
                        • Unverified → the active ReplaceSection with the two
                          upload/photo entry points.
                        • Verified → a short explanatory panel telling the
                          admin why Replace is locked and what to do instead.
                        Keeping the surface visible (rather than collapsing
                        the whole section) means admins who go looking for
                        Replace on a verified doc find the reason rather than
                        an empty gap — the panel is the answer to "where did
                        the Replace button go?".
                        CLE-220 — `hideHrMetadata` also implies "no Replace",
                        but Replace is already gated on
                        `effectiveCanUpdate && !employeeStripped` so a self-
                        scope caller (canUpdate=false) never sees it anyway;
                        wrapping in the outer `!hideHrMetadata` block just
                        makes the intent explicit. */}
                    {effectiveCanUpdate && !employeeStripped && (
                      <div className="border-b p-4">
                        {detail.row.verifiedOn === null ? (
                          <ReplaceSection
                            documentId={currentDocumentId}
                            targetMemberId={detail.targetMemberId}
                            targetMemberName={detail.targetMemberName}
                            subtypeId={detail.row.subtypeId}
                            subtypeName={detail.row.subtypeName}
                            onReplaced={pivotToReplacement}
                          />
                        ) : (
                          <div>
                            <p className="mb-1 flex items-center gap-2 text-base font-semibold">
                              <RefreshCw className="h-4 w-4" /> Replace file
                            </p>
                            <p className="text-sm text-muted-foreground">
                              This document has been verified and cannot be reloaded. If the wrong document is showing, please Delete and Reload.
                            </p>
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )}

                {/* CLE-219 — Acknowledgement section. Content switches
                    on caller identity + ack state — see spec §12 for
                    the full grid.
                    Trash-view (`readOnly`) suppresses it entirely — a
                    trashed doc's ack state is moot, and the audit
                    story stays clean by not offering a click on a
                    soon-to-be-deleted row.
                    CLE-220 follow-up: for the employee-view dialog
                    (`hideActivity`, which is the marker for the
                    self-scope My Documents / Org Documents surface)
                    we render the section even when the doc DOESN'T
                    require acknowledgement — so the employee gets
                    "No acknowledgement needed" instead of an empty
                    right half. Admins keep the old "only show when
                    required" behaviour to avoid clutter. */}
                {!readOnly && ackStatus && (ackStatus.requiresAcknowledgement || hideActivity) && (
                  <div className="border-b p-4">
                    <AcknowledgementSection
                      status={ackStatus}
                      readyToAck={readyToAck}
                      pending={ackPending}
                      error={ackError}
                      onAcknowledge={handleAcknowledge}
                    />
                  </div>
                )}

                {/* Activity — merged audit + comments feed. The list is
                    the only scrolling region; the composer stays pinned
                    below it. `hideActivity` (CLE-216 follow-up) drops
                    the entire section for the self-scope "My
                    Documents" surface — employees don't see the
                    internal audit chatter or the comment feed. */}
                {!hideActivity && (
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
                              {(() => {
                                // CLE-225 — For delete events, append the
                                // reason inline to the action label so the
                                // feed reads as e.g. "Moved to Trash — Old
                                // passport superseded". `metadata.reason` is
                                // the current key; `metadata.force_delete_reason`
                                // is the legacy key on pre-CLE-225 rows.
                                const md = item.entry.metadata as Record<string, unknown> | null;
                                const rawReason = md
                                  ? (md.reason ?? md.force_delete_reason)
                                  : null;
                                const reason = typeof rawReason === "string" && rawReason.trim() !== ""
                                  ? rawReason.trim()
                                  : null;
                                const isDelete = item.entry.action === "document.deleted"
                                  || item.entry.action === "document.force_deleted";
                                const label = actionLabel(item.entry.action);
                                return (
                                  <>
                                    <span className="font-medium text-foreground">{item.entry.actorName}</span>
                                    {" · "}
                                    <span className="text-foreground">
                                      {label}
                                      {isDelete && reason ? ` — ${reason}` : null}
                                    </span>
                                    {" · "}
                                    <span>{fmtDateTime(item.entry.createdAt)}</span>
                                  </>
                                );
                              })()}
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
                      <ActivityComposer documentId={currentDocumentId} onPosted={reloadActivity} />
                    </div>
                  )}
                </div>
                )}
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
      // Prop-supplied callback — parent (DocumentDetailsDialog) wires
      // this to `refreshDetailAndHistory`, which itself dispatches the
      // member-docs-changed event before calling `onSaved`. Sub-
      // components don't have `notifySaved` in scope.
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
      // Prop-supplied callback — parent (DocumentDetailsDialog) wires
      // this to `refreshDetailAndHistory`, which itself dispatches the
      // member-docs-changed event before calling `onSaved`. Sub-
      // components don't have `notifySaved` in scope.
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

// ---------------------------------------------------------------------------
// AcknowledgementSection — CLE-219
// ---------------------------------------------------------------------------
//
// Renders the Acknowledgement panel below Replace. Content branches on
// caller identity + ack state (see spec §12):
//   - Expected + not yet acknowledged → button, disabled until
//     `readyToAck` (preview loaded OR download clicked).
//   - Expected + already acknowledged → read-only stamp.
//   - Not expected (admin viewing) + coverage available → org-doc
//     coverage summary.
//   - Not expected + no coverage → simple info line so the admin knows
//     the subtype flags require ack but they aren't in scope.

function AcknowledgementSection({
  status,
  readyToAck,
  pending,
  error,
  onAcknowledge,
}: {
  status: DocumentAcknowledgementStatus;
  readyToAck: boolean;
  pending: boolean;
  error: string | null;
  onAcknowledge: () => void;
}) {
  const { requiresAcknowledgement, isCallerExpectedToAcknowledge, callerAcknowledgement, coverageSummary } = status;

  // Branch 0 (CLE-220 follow-up) — Doc doesn't require acknowledgement
  // at all. Only reached in the employee-view dialog (`hideActivity`
  // in the parent), where we render the section anyway so the panel
  // isn't half-empty. Plain info line — no action, no state.
  if (!requiresAcknowledgement) {
    return (
      <div>
        <p className="mb-1 flex items-center gap-2 text-base font-semibold">
          <CheckSquare className="h-4 w-4 text-muted-foreground" /> Acknowledgement
        </p>
        <p className="text-sm text-muted-foreground">
          No acknowledgement is required for this document.
        </p>
      </div>
    );
  }

  // Branch 1 — Caller has ack'd. Show the read-only stamp.
  if (callerAcknowledgement) {
    const stamp = new Date(callerAcknowledgement.acknowledgedAt).toLocaleDateString("en-GB", {
      day: "2-digit", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit", hour12: false,
    });
    return (
      <div>
        <p className="mb-1 flex items-center gap-2 text-base font-semibold">
          <CheckSquare className="h-4 w-4 text-green-600" /> Acknowledgement
        </p>
        <p className="text-sm text-muted-foreground">
          You acknowledged this document on <span className="font-medium text-foreground">{stamp}</span>.
        </p>
      </div>
    );
  }

  // Branch 2 — Caller is the target Member, not yet ack'd. Actionable
  // button + read-first gate + audit-note.
  if (isCallerExpectedToAcknowledge) {
    return (
      <div>
        <p className="mb-1 flex items-center gap-2 text-base font-semibold">
          <CheckSquare className="h-4 w-4" /> Acknowledgement
        </p>
        <p className="text-sm text-muted-foreground">
          Confirm you have read and understood this document. Your acknowledgement will be recorded with your name, the date and time, and your IP address.
        </p>
        {error && (
          <p className="mt-2 rounded-md bg-destructive/10 p-2 text-sm text-destructive">{error}</p>
        )}
        <div className="mt-3 flex items-center gap-2">
          <Button
            type="button"
            onClick={onAcknowledge}
            disabled={pending || !readyToAck}
          >
            {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            <CheckSquare className="mr-2 h-4 w-4" />
            I have read and understood this document
          </Button>
          {!readyToAck && (
            <p className="text-xs text-muted-foreground">Open or download the file first.</p>
          )}
        </div>
      </div>
    );
  }

  // Branch 3 — Admin viewing an org doc (or a member doc they don't
  // own). Coverage summary if available.
  if (coverageSummary) {
    return (
      <div>
        <p className="mb-1 flex items-center gap-2 text-base font-semibold">
          <CheckSquare className="h-4 w-4" /> Acknowledgement
        </p>
        <p className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground">
            {coverageSummary.totalAcknowledged} of {coverageSummary.totalExpected}
          </span>{" "}
          acknowledged
          {coverageSummary.outstanding > 0 && (
            <> · <span className="font-medium text-amber-700 dark:text-amber-400">{coverageSummary.outstanding} outstanding</span></>
          )}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          See the Compliance dashboard's Acknowledgements tab for the full list.
        </p>
      </div>
    );
  }

  // Branch 4 — Fallback. Subtype requires ack but the caller isn't in
  // scope AND has no coverage view. Rare: e.g. an admin without
  // `can_view_organisation_documents` looking at an org doc via a
  // deep link. Just show a static info line.
  return (
    <div>
      <p className="mb-1 flex items-center gap-2 text-base font-semibold">
        <CheckSquare className="h-4 w-4" /> Acknowledgement
      </p>
      <p className="text-sm text-muted-foreground">
        This document requires acknowledgement from its target Member(s).
      </p>
    </div>
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
      // Prop-supplied callback — parent (DocumentDetailsDialog) wires
      // this to `refreshDetailAndHistory`, which itself dispatches the
      // member-docs-changed event before calling `onSaved`. Sub-
      // components don't have `notifySaved` in scope.
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

// ---------------------------------------------------------------------------
// Replace file (CLE-217).
//
// Two entry points that mirror NewMemberDocumentDialog: a file upload
// (calls the one-shot server action `replaceMemberDocument`) and a
// photo capture (queues a capture_task, subscribes to it via Realtime,
// then calls `finalizeDocumentReplace` once the mobile side lands
// the new doc). Both paths end the same way — the parent's
// `onReplaced(newId)` fires, which pivots the whole dialog to the
// new document's id.
//
// The wrinkle is that this component only renders while the doc is
// unverified (the parent gates it), but the useEffect chain that
// watches the capture_task might outlive that render if the user
// hits Cancel mid-flight. The cleanup effect below cancels the task
// server-side when we unmount so the mobile app doesn't keep a stale
// task at the top of its list.
// ---------------------------------------------------------------------------

function ReplaceSection({
  documentId,
  targetMemberId,
  targetMemberName,
  subtypeId,
  subtypeName,
  onReplaced,
}: {
  documentId: string;
  targetMemberId: string;
  targetMemberName: string;
  subtypeId: string | null;
  subtypeName: string | null;
  onReplaced: (newDocumentId: string) => void | Promise<void>;
}) {
  const [mode, setMode] = useState<"idle" | "waiting">("idle");
  const [captureTaskId, setCaptureTaskId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Keep a ref to onReplaced so the Realtime subscription doesn't
  // need to be torn down + resubscribed every render.
  const onReplacedRef = useRef(onReplaced);
  onReplacedRef.current = onReplaced;

  function handleUploadClick() {
    setError(null);
    fileInputRef.current?.click();
  }

  function handleFileChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const chosen = e.target.files?.[0] ?? null;
    e.target.value = "";
    if (!chosen) return;
    setError(null);
    const fd = new FormData();
    fd.set("file", chosen);
    startTransition(async () => {
      const res = await replaceMemberDocument(documentId, fd);
      if (!res.success || !res.documentId) {
        setError(res.error ?? "Replace failed");
        return;
      }
      await onReplacedRef.current(res.documentId);
    });
  }

  function handlePhotoClick() {
    if (!subtypeId) {
      setError("This document has no subtype — set one before replacing via photo.");
      return;
    }
    setError(null);
    startTransition(async () => {
      // Note the null expiresOn — the queue action auto-derives from
      // the subtype's default when required. The replacement inherits
      // the old row's expiry via finalizeDocumentReplace instead, but
      // the capture_task's own expires_on is only used to seed a
      // brand-new upload; here it's harmless.
      const res = await queueCaptureTask(targetMemberId, subtypeId, null, null);
      if (!res.success) { setError(res.error); return; }
      setCaptureTaskId(res.taskId);
      setMode("waiting");
    });
  }

  // Realtime subscription — mirrors the NewMemberDocumentDialog flow.
  // Fires finalizeDocumentReplace when the mobile side lands the new
  // doc, then hands over to the parent to pivot the dialog.
  useEffect(() => {
    if (mode !== "waiting" || !captureTaskId) return;
    const supabase = createSupabaseBrowserClient();
    let cancelled = false;

    async function fetchAndProgress() {
      const { data } = await supabase
        .from("capture_task")
        .select("status, uploaded_document_id")
        .eq("id", captureTaskId)
        .single();
      if (cancelled || !data) return;
      handleStatus(
        data.status as string,
        (data as { uploaded_document_id?: string | null }).uploaded_document_id ?? null,
      );
    }

    async function handleStatus(status: string, uploadedDocumentId: string | null) {
      if (cancelled) return;
      if (status === "uploaded" && uploadedDocumentId) {
        // Trash the old row + audit, then hand over.
        const res = await finalizeDocumentReplace(documentId, uploadedDocumentId);
        if (!res.success) {
          setError(res.error ?? "Replace finalize failed");
          setMode("idle");
          setCaptureTaskId(null);
          return;
        }
        await onReplacedRef.current(uploadedDocumentId);
      } else if (status === "cancelled") {
        setMode("idle");
        setCaptureTaskId(null);
      } else if (status === "timeout") {
        setMode("idle");
        setCaptureTaskId(null);
        setError("This request timed out. Try again when you're ready to take the photo.");
      }
    }

    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.access_token) supabase.realtime.setAuth(session.access_token);
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
          const row = payload.new as {
            status?: string;
            uploaded_document_id?: string | null;
          } | null;
          if (row?.status) void handleStatus(row.status, row.uploaded_document_id ?? null);
        },
      )
      .subscribe();

    const pollInterval = setInterval(() => {
      if (!cancelled) void fetchAndProgress();
    }, 3000);

    return () => {
      cancelled = true;
      clearInterval(pollInterval);
      void supabase.removeChannel(channel);
    };
  }, [mode, captureTaskId, documentId]);

  // If the section unmounts (e.g. the doc gets verified from another
  // pencil while we're waiting, or the dialog closes) cancel the
  // capture task server-side so it doesn't sit on the mobile app's
  // list.
  useEffect(() => {
    return () => {
      if (captureTaskId && mode === "waiting") {
        void cancelCaptureTask(captureTaskId);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleWaitingCancel() {
    if (captureTaskId) await cancelCaptureTask(captureTaskId);
    setMode("idle");
    setCaptureTaskId(null);
  }

  return (
    <div>
      <p className="text-base font-semibold flex items-center gap-2">
        <RefreshCw className="h-4 w-4" /> Replace file
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        Only unverified files can be replaced. Once verified, delete and add a new upload instead.
      </p>
      {error && (
        <div className="mt-2 rounded-md bg-destructive/10 p-2 text-xs text-destructive">{error}</div>
      )}
      {mode === "waiting" ? (
        <div className="mt-2 flex flex-col items-center gap-2 rounded-md border bg-background p-3 text-center">
          <Smartphone className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm">
            Take a photo of <strong>{targetMemberName}</strong>&apos;s{" "}
            <strong>{subtypeName ?? "document"}</strong>
          </p>
          <p className="text-xs text-muted-foreground">
            Open ClearHR on your phone — the capture task is at the top of the app.
          </p>
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          <Button variant="outline" size="sm" onClick={handleWaitingCancel}>
            Cancel
          </Button>
        </div>
      ) : (
        <div className="mt-2 flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={handleUploadClick}
            disabled={pending}
            className="gap-1"
          >
            <FileUp className="h-4 w-4" /> Upload replacement
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={handlePhotoClick}
            disabled={pending}
            className="gap-1"
          >
            <Camera className="h-4 w-4" /> Take photo
          </Button>
          {pending && (
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" /> Working…
            </span>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/plain"
            className="hidden"
            onChange={handleFileChosen}
          />
        </div>
      )}
    </div>
  );
}
