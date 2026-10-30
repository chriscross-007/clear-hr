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

import { PdfViewer } from "@/components/documents/pdf-viewer";
import { SignatureSection } from "@/components/documents/signature-section";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Archive, ArchiveRestore, Camera, CheckSquare, Download, FileUp, Layers, Loader2, Pencil, SendHorizontal, Smartphone, Upload as UploadIcon } from "lucide-react";
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
  markMemberDocumentReviewed,
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
import { replaceOrgDocument, updateOrgDocumentMetadata, markOrgDocumentReviewed } from "@/app/(dashboard)/documents/organisation/org-document-actions";
import { canBeVerified, reviewIntervalLabel } from "@/app/(dashboard)/settings/documents/subtype-types";
import {
  archiveDocument,
  publishNewDocumentVersion,
  restoreArchivedDocument,
} from "@/app/(dashboard)/documents/document-lifecycle-actions";
import { canArchiveType, canVersionType } from "@/lib/document-archive";
import { createClient as createSupabaseBrowserClient } from "@/lib/supabase/client";
import { useMemberLabel } from "@/contexts/member-label-context";
import { capitalize, pluralize } from "@/lib/label-utils";
import { dispatchMemberDocsChanged } from "@/lib/member-docs-events";
import { OrgDocAudienceSection } from "@/components/documents/org-doc-audience-section";
import {
  acknowledgeDocument,
  getDocumentAcknowledgementStatus,
} from "@/app/(dashboard)/documents/acknowledgement-actions";
import type { DocumentAcknowledgementStatus } from "@/app/(dashboard)/documents/acknowledgement-actions-impl";

const TYPE_LABEL: Record<string, string> = {
  contract: "Employment",
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
  /** The caller is looking at their own documents as a member (the My
   *  Documents surfaces). Only then does the Acknowledgement section
   *  offer "I have read and understood" or show "You acknowledged…".
   *  Everywhere else (admin pages: Org Documents, a member's Documents,
   *  Compliance) the section only states whether acknowledgement is
   *  required and the coverage — an admin never acknowledges as a
   *  member from an admin page. */
  memberView?: boolean;
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
  "document.archived": "Archived",
  "document.unarchived": "Restored from archive",
  "document.version_published": "New version published",
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
  memberView = false,
}: Props) {
  const { memberLabel } = useMemberLabel();
  // A read-only opening (from the Trash list) forces every pencil off
  // and the composer off, regardless of whether the caller would
  // ordinarily have update rights.
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
  // CLE-233 — an archived document is read-only too.
  const isArchived = !!detail?.archivedAt;
  const effectiveCanUpdate = canUpdate && !readOnly && !isArchived;
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
  // CLE-236 — "sign" when this document is signed rather than acknowledged.
  const [signOff, setSignOff] = useState<"none" | "acknowledge" | "sign" | null>(null);
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
              {(detail.row.statuses.length > 0 || readOnly || isArchived) && (
                <div className="flex flex-wrap justify-center gap-1">
                  {readOnly && (
                    <span className="inline-block rounded-full bg-neutral-200 px-2 py-0.5 text-xs font-medium text-neutral-800 dark:bg-neutral-800 dark:text-neutral-200">
                      In Trash
                    </span>
                  )}
                  {isArchived && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-800 dark:bg-slate-700 dark:text-slate-100">
                      <Archive className="h-3 w-3" /> Archived
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

              {/* CLE-233 — version chain. */}
              {(detail.versionNumber > 1 || detail.previousVersion || detail.nextVersion) && (
                <p className="flex flex-wrap items-center justify-center gap-x-1 text-xs text-muted-foreground">
                  <Layers className="h-3.5 w-3.5" />
                  <span>Version {detail.versionNumber}</span>
                  {detail.previousVersion && (
                    <>
                      <span>· replaces</span>
                      <button
                        type="button"
                        className="underline hover:text-foreground"
                        onClick={() => setCurrentDocumentId(detail.previousVersion!.id)}
                      >
                        Version {detail.previousVersion.versionNumber}
                      </button>
                      {detail.previousVersion.archivedAt && (
                        <span>(archived {fmtDate(detail.previousVersion.archivedAt.slice(0, 10))})</span>
                      )}
                    </>
                  )}
                  {detail.nextVersion && (
                    <>
                      <span>· replaced by</span>
                      <button
                        type="button"
                        className="underline hover:text-foreground"
                        onClick={() => setCurrentDocumentId(detail.nextVersion!.id)}
                      >
                        Version {detail.nextVersion.versionNumber}
                      </button>
                    </>
                  )}
                </p>
              )}
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
                  // ClearHR's own viewer — viewing controls only, same in
                  // every browser (no browser PDF toolbar / edit tools).
                  <PdfViewer
                    url={previewUrl}
                    fileName={detail.row.fileName}
                    onDownload={() => {
                      setReadyToAck(true);
                      void downloadDocument(currentDocumentId, detail.row.fileName, reloadActivity);
                    }}
                  />
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
                {previewUrl && detail.row.contentType !== "application/pdf" && (
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
              {/* CLE-230 — the right pane scrolls as a whole. Sections
                  above Activity (Visible to, Expiry, Verify, Replace,
                  Acknowledgement) can now be taller than the pane, so
                  clipping them is no longer an option. Activity keeps a
                  minimum height and its own inner scroll so it stays
                  usable either way. */}
              <div className="flex min-h-0 flex-col overflow-y-auto">
                {/* CLE-220 — `hideHrMetadata` collapses the three HR-only
                    sections (Expiry, Verify, Replace) so the employee-
                    facing surfaces (My Documents + Org Documents tabs
                    on /my-documents) present a clean read-and-
                    acknowledge dialog. The Acknowledgement section
                    (below) stays visible so an employee can still
                    click "I have read and understood".
                    CLE-234 — Verify (member-supplied kinds only) and
                    Review are separate sections again. */}
                {/* A member replacing their own upload before it is verified
                    (wrong file picked). Upload only — remote photo capture is
                    an HR flow. Gate: DocumentDetailContext.memberCanReplace
                    (memberCanReplaceOwnDocument; re-checked server-side). */}
                {employeeStripped && !readOnly && detail.memberCanReplace && (
                  <div className="border-b p-4">
                    <ReplaceSection
                      documentId={currentDocumentId}
                      targetMemberId={detail.targetMemberId}
                      targetMemberName={detail.targetMemberName}
                      subtypeId={detail.row.subtypeId}
                      subtypeName={detail.row.subtypeName}
                      isOrgDocument={false}
                      selfService
                      onReplaced={pivotToReplacement}
                    />
                  </div>
                )}
                {!hideHrMetadata && (
                  <>
                    {/* CLE-230 — Visible to (org docs, managers only).
                        `effectiveCanUpdate` on an org doc means the caller
                        has can_manage_organisation_documents. */}
                    {detail.row.type === "organisation_document" && effectiveCanUpdate && !employeeStripped && (
                      <div className="border-b p-4">
                        <OrgDocAudienceSection documentId={currentDocumentId} onSaved={notifySaved} />
                      </div>
                    )}

                    {/* Expiry */}
                    <div className="border-b p-4">
                      <ExpirySection
                        detail={detail}
                        canUpdate={effectiveCanUpdate && !employeeStripped}
                        onSaved={refreshDetailAndHistory}
                      />
                    </div>

                    {/* CLE-234 — Verify (member-supplied kinds only) and
                        Review are independent sections. */}
                    {canBeVerified(detail.row.type) && (
                      <div className="border-b p-4">
                        <VerifySection
                          detail={detail}
                          canUpdate={effectiveCanUpdate && !employeeStripped}
                          onSaved={refreshDetailAndHistory}
                        />
                      </div>
                    )}
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
                        {detail.row.verifiedOn === null && !detail.hasAcknowledgements ? (
                          <ReplaceSection
                            documentId={currentDocumentId}
                            targetMemberId={detail.targetMemberId}
                            targetMemberName={detail.targetMemberName}
                            subtypeId={detail.row.subtypeId}
                            subtypeName={detail.row.subtypeName}
                            isOrgDocument={detail.row.type === "organisation_document"}
                            onReplaced={pivotToReplacement}
                          />
                        ) : (
                          <div>
                            <p className="mb-1 flex items-center gap-2 text-base font-semibold">
                              Replace file
                            </p>
                            <p className="text-sm text-muted-foreground">
                              {detail.hasAcknowledgements
                                ? canVersionType(detail.row.type)
                                  ? "This document has been acknowledged, so its file can't be replaced. Publish a new version instead (below)."
                                  : "This document has been acknowledged, so its file can't be replaced. Add the new file as a new document instead."
                                : canVersionType(detail.row.type)
                                  ? "This document has been verified and cannot be reloaded. If it has been renewed, upload the new version below; if the wrong document is showing, Delete and Reload."
                                  : "This document has been verified and cannot be reloaded. If the wrong document is showing, please Delete and Reload."}
                            </p>
                          </div>
                        )}
                      </div>
                    )}

                    {/* CLE-233 — new version / archive / restore. */}
                    {!readOnly && !employeeStripped && detail.canManageLifecycle && canArchiveType(detail.row.type) && (
                      <div className="border-b p-4">
                        <LifecycleSection
                          detail={detail}
                          documentId={currentDocumentId}
                          onChanged={refreshDetailAndHistory}
                          onPublished={pivotToReplacement}
                        />
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
                {/* CLE-236 — Signature section (loads its own state). A
                    document is acknowledged or signed, never both, so the
                    acknowledgement section is hidden for signing documents. */}
                {currentDocumentId && (
                  <div className={signOff === "sign" || signOff === null ? "border-b p-4 empty:hidden" : "hidden"}>
                    <SignatureSection
                      key={currentDocumentId}
                      documentId={currentDocumentId}
                      memberView={memberView}
                      readOnly={readOnly}
                      targetMemberName={detail.row.type === "organisation_document" ? null : detail.targetMemberName}
                      onSignOff={setSignOff}
                      onChanged={refreshDetailAndHistory}
                    />
                  </div>
                )}

                {!readOnly && ackStatus && signOff !== "sign" && (ackStatus.requiresAcknowledgement || hideActivity || !memberView) && (
                  <div className="border-b p-4">
                    {!memberView ? (
                      <AdminAcknowledgementSection
                        status={ackStatus}
                        archived={!!detail.archivedAt}
                        subject={
                          detail.row.type === "organisation_document"
                            ? { plural: true, label: capitalize(pluralize(memberLabel)) }
                            : { plural: false, label: detail.targetMemberName || capitalize(memberLabel) }
                        }
                      />
                    ) : (
                    <AcknowledgementSection
                      status={ackStatus}
                      readyToAck={readyToAck}
                      pending={ackPending}
                      error={ackError}
                      onAcknowledge={handleAcknowledge}
                    />
                    )}
                  </div>
                )}

                {/* Activity — merged audit + comments feed. The list is
                    the only scrolling region; the composer stays pinned
                    below it. `hideActivity` (CLE-216 follow-up) drops
                    the entire section for the self-scope "My
                    Documents" surface — employees don't see the
                    internal audit chatter or the comment feed. */}
                {!hideActivity && (
                <div className="flex-1 shrink-0 overflow-hidden p-4 flex flex-col min-h-64">
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
                                // CLE-226 — For delete events, append the
                                // reason inline to the action label so the
                                // feed reads as e.g. "Moved to Trash — Old
                                // passport superseded". `metadata.reason` is
                                // the current key; `metadata.force_delete_reason`
                                // is the legacy key on pre-CLE-226 rows.
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
                  {!employeeStripped && !readOnly && !isArchived && (
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

/** Org documents and member documents have separate metadata actions
 *  (each refuses the other's scope with "Document not found"). Pick by
 *  the document's type. */
function updateDocumentMetadata(
  detail: DocumentDetailContext,
  patch: { subtypeId?: string | null; expiresOn?: string | null; nextReviewOn?: string | null },
) {
  return detail.row.type === "organisation_document"
    ? updateOrgDocumentMetadata(detail.row.id, patch)
    : updateMemberDocumentMetadata(detail.row.id, patch);
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
      const res = await updateDocumentMetadata(detail, {
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
      const res = await updateDocumentMetadata(detail, {
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
          <p className="text-[10px] text-muted-foreground">
            Leave blank if the document has no expiry. If the file has no real expiry date, set a Next review date instead.
          </p>
        </div>
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="outline" onClick={() => setOpen(false)} disabled={pending}>Cancel</Button>
          <Button size="sm" onClick={save} disabled={pending || (expiresOn || null) === (detail.row.expiresOn ?? null)}>Save</Button>
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

// CLE-234 — Verify and Review are independent.
//
// Verify = "HR confirms this copy is genuine". Shown only for kinds a
// member supplies (certificate / RTW evidence / attachment), one-off per
// file: once verified there is no button (a new file is a new document).
// Review = "check whether this still needs updating", for every kind:
// Next review date (editable), the subtype's interval, the last review,
// and Mark as reviewed (today + interval, or clear when the interval is
// None; repeat clicks the same day change nothing).
function VerifySection({
  detail,
  canUpdate,
  onSaved,
}: {
  detail: DocumentDetailContext;
  canUpdate: boolean;
  onSaved: () => Promise<void>;
}) {
  if (!detail.row.requiresVerification) {
    return (
      <div>
        <p className="text-base font-semibold">Verify</p>
        <p className="mt-1 text-sm text-muted-foreground">Verification not required</p>
      </div>
    );
  }

  const verifiedOn = detail.row.verifiedOn;
  return (
    <div>
      <p className="text-base font-semibold">Verify</p>
      <p className="mt-1 text-sm">
        {verifiedOn ? (
          <>
            Verified <strong>{fmtDate(verifiedOn)}</strong>
            {detail.verifiedByName && (
              <span className="text-muted-foreground"> by {detail.verifiedByName}</span>
            )}
          </>
        ) : (
          <span className="text-muted-foreground">Not yet verified</span>
        )}
      </p>
      {canUpdate && !verifiedOn && (
        <div className="mt-3">
          <VerifyButton detail={detail} onSaved={onSaved} />
        </div>
      )}
    </div>
  );
}

function VerifyButton({
  detail,
  onSaved,
}: {
  detail: DocumentDetailContext;
  onSaved: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save() {
    setError(null);
    startTransition(async () => {
      const today = new Date().toISOString().slice(0, 10);
      const res = await verifyMemberDocument(detail.row.id, {
        verifiedOn: today,
        verificationNotes: null,
      });
      if (!res.success) { setError(res.error ?? "Verify failed"); return; }
      setOpen(false);
      await onSaved();
    });
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="sm" variant="outline">Verify</Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 space-y-2">
        <p className="text-sm font-medium">Mark as verified today?</p>
        <p className="text-xs text-muted-foreground">
          This records that you&apos;ve checked this file is a true copy of the original.
        </p>
        {error && <div className="rounded-md bg-destructive/10 p-2 text-xs text-destructive">{error}</div>}
        <div className="flex justify-end gap-2 pt-1">
          <Button size="sm" variant="outline" onClick={() => setOpen(false)} disabled={pending}>Cancel</Button>
          <Button size="sm" onClick={save} disabled={pending}>Confirm</Button>
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
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const nextReviewOn = detail.row.nextReviewOn;
  const interval = detail.reviewPeriodMonths;

  function markReviewed() {
    setError(null);
    setNote(null);
    startTransition(async () => {
      const res = detail.row.type === "organisation_document"
        ? await markOrgDocumentReviewed(detail.row.id)
        : await markMemberDocumentReviewed(detail.row.id);
      if (!res.success) { setError(res.error ?? "Couldn't mark as reviewed"); return; }
      if (!res.changed) { setNote("Already reviewed today — nothing to change."); return; }
      await onSaved();
    });
  }

  const lastReviewed = detail.lastReviewedAt
    ? new Date(detail.lastReviewedAt).toLocaleDateString("en-GB", {
        day: "2-digit", month: "short", year: "numeric",
      })
    : null;

  return (
    <div>
      <p className="text-base font-semibold">Review</p>
      <div className="mt-1 space-y-1 text-sm">
        <div className="flex items-center gap-2">
          <span>
            Next review{" "}
            {nextReviewOn ? <strong>{fmtDate(nextReviewOn)}</strong> : <span className="text-muted-foreground">not set</span>}
          </span>
          {canUpdate && <NextReviewPencil detail={detail} onSaved={onSaved} />}
        </div>
        <p className="text-xs text-muted-foreground">
          {interval !== null && detail.row.requiresVerification && !detail.row.verifiedOn && !nextReviewOn
            ? `Reviewed every ${reviewIntervalLabel(interval).replace(/ \(.*\)$/, "")}, starting when the document is verified.`
            : interval === null
            ? "Ad hoc — set a review date when one is needed."
            : `Reviewed every ${reviewIntervalLabel(interval).replace(/ \(.*\)$/, "")}.`}
        </p>
        {lastReviewed && (
          <p className="text-xs text-muted-foreground">
            Last reviewed {lastReviewed}
            {detail.lastReviewedByName && <> by {detail.lastReviewedByName}</>}
          </p>
        )}
      </div>
      {error && <div className="mt-2 rounded-md bg-destructive/10 p-2 text-xs text-destructive">{error}</div>}
      {note && <p className="mt-2 text-xs text-muted-foreground">{note}</p>}
      {canUpdate && nextReviewOn && (
        <div className="mt-3 flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={markReviewed} disabled={pending}>
            {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Mark as reviewed
          </Button>
          <span className="text-xs text-muted-foreground">
            {interval === null ? "Clears the next review date." : `Sets the next review to today + ${reviewIntervalLabel(interval).replace(/ \(.*\)$/, "")}.`}
          </span>
        </div>
      )}
    </div>
  );
}

function NextReviewPencil({
  detail,
  onSaved,
}: {
  detail: DocumentDetailContext;
  onSaved: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState<string>(detail.row.nextReviewOn ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save() {
    setError(null);
    startTransition(async () => {
      const res = await updateDocumentMetadata(detail, { nextReviewOn: value || null });
      if (!res.success) { setError(res.error ?? "Save failed"); return; }
      setOpen(false);
      await onSaved();
    });
  }

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (o) setValue(detail.row.nextReviewOn ?? ""); }}>
      <PopoverTrigger asChild>
        <span>
          <PencilButton onClick={() => setOpen(true)} label="Edit next review date" />
        </span>
      </PopoverTrigger>
      <PopoverContent className="w-80 space-y-2">
        <p className="text-sm font-medium">Next review date</p>
        {error && <div className="rounded-md bg-destructive/10 p-2 text-xs text-destructive">{error}</div>}
        <div className="space-y-1">
          <Label className="text-xs">Review by</Label>
          <Input type="date" value={value} onChange={(e) => setValue(e.target.value)} />
          <p className="text-[10px] text-muted-foreground">Leave blank for no review date.</p>
        </div>
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="outline" onClick={() => setOpen(false)} disabled={pending}>Cancel</Button>
          <Button size="sm" onClick={save} disabled={pending || (value || null) === (detail.row.nextReviewOn ?? null)}>Save</Button>
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
          Acknowledgement
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
          Acknowledgement
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
          Acknowledgement
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
          Acknowledgement
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
          See the Compliance dashboard&apos;s Acknowledgements tab for the full list.
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
        Acknowledgement
      </p>
      <p className="text-sm text-muted-foreground">
        This document requires acknowledgement from its target Member(s).
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CLE-233 — LifecycleSection: publish a new version / archive / restore.
// Admin-only (detail.canManageLifecycle). New version + Archive for
// organisation, Employment, Certificate and RTW evidence documents.
// ---------------------------------------------------------------------------

function LifecycleSection({
  detail,
  documentId,
  onChanged,
  onPublished,
}: {
  detail: DocumentDetailContext;
  documentId: string;
  onChanged: () => Promise<void>;
  onPublished: (newDocumentId: string) => void | Promise<void>;
}) {
  const { memberLabel } = useMemberLabel();
  const [error, setError] = useState<string | null>(null);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [pending, startTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [staged, setStaged] = useState<File | null>(null);
  const [stagedExpiry, setStagedExpiry] = useState("");
  const isOrg = detail.row.type === "organisation_document";
  const audience = isOrg ? pluralize(memberLabel).toLowerCase() : `this ${memberLabel.toLowerCase()}`;

  if (detail.archivedAt) {
    return (
      <div className="space-y-2">
        <p className="flex items-center gap-2 text-base font-semibold">
          <Archive className="h-4 w-4" /> Archived
        </p>
        <p className="text-sm text-muted-foreground">
          Archived {fmtDateTime(detail.archivedAt)}
          {detail.archivedByName ? ` by ${detail.archivedByName}` : ""}. It is read-only, hidden from {audience}, and
          no longer counted or chased. Its file, details, activity and acknowledgements are kept.
        </p>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() => {
            setError(null);
            startTransition(async () => {
              const res = await restoreArchivedDocument(documentId);
              if (!res.success) { setError(res.error ?? "Restore failed"); return; }
              await onChanged();
            });
          }}
        >
          <ArchiveRestore className="mr-1.5 h-4 w-4" />
          Restore from archive
        </Button>
      </div>
    );
  }

  const versionable = canVersionType(detail.row.type);
  // Certificates / RTW evidence the member supplies: a renewal (e.g. a new
  // driving licence) with its own expiry date.
  const isRenewal = detail.row.type === "certificate" || detail.row.type === "evidence";
  const takesExpiry = !isOrg;
  const expiryNeeded = takesExpiry && detail.expiryRequired;
  const nextVersion = detail.versionNumber + 1;

  function handleFileChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const chosen = e.target.files?.[0] ?? null;
    e.target.value = "";
    if (!chosen) return;
    setError(null);
    setStaged(chosen);
    setStagedExpiry("");
  }

  function publishStaged() {
    if (!staged) return;
    setError(null);
    const fd = new FormData();
    fd.set("file", staged);
    if (takesExpiry && stagedExpiry) fd.set("expiresOn", stagedExpiry);
    startTransition(async () => {
      const res = await publishNewDocumentVersion(documentId, fd);
      if (!res.success || !res.documentId) { setError(res.error ?? "Publishing failed"); return; }
      setStaged(null);
      await onPublished(res.documentId);
    });
  }

  return (
    <div className="space-y-3">
      <p className="flex items-center gap-2 text-base font-semibold">
        <Layers className="h-4 w-4" /> {versionable ? "Versions & archive" : "Archive"}
      </p>

      {versionable && (
        <div className="space-y-1.5">
          <p className="text-sm text-muted-foreground">
            {isRenewal ? (
              <>
                Renewed or replaced? Upload the new one as version {nextVersion}. It keeps this document&apos;s type
                and subtype{detail.row.requiresVerification ? " and needs verifying" : ""}. This version is archived and
                kept read-only, so it stops counting as expiring.
              </>
            ) : (
              <>
                Publish a new file as version {nextVersion}. It keeps this document&apos;s type
                {isOrg ? ", subtype and audience" : " and subtype"}; acknowledgements start again. This version is
                archived and kept read-only.
              </>
            )}
          </p>
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx,.txt"
            onChange={handleFileChosen}
          />
          {!staged ? (
            <Button size="sm" disabled={pending} onClick={() => fileInputRef.current?.click()}>
              <FileUp className="mr-1.5 h-4 w-4" />
              {isRenewal ? "Upload new version" : "Publish new version"}
            </Button>
          ) : (
            <div className="space-y-2 rounded-md border p-3 text-sm">
              <p>
                Version {nextVersion}: <span className="font-medium">{staged.name}</span>
              </p>
              {takesExpiry && (
                <label className="flex flex-wrap items-center gap-2">
                  <span>Expires{expiryNeeded ? "" : " (optional)"}</span>
                  <input
                    type="date"
                    value={stagedExpiry}
                    onChange={(e) => setStagedExpiry(e.target.value)}
                    className="rounded-md border bg-background px-2 py-1 text-sm"
                  />
                </label>
              )}
              <div className="flex gap-2">
                <Button size="sm" disabled={pending || (expiryNeeded && !stagedExpiry)} onClick={publishStaged}>
                  {pending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <FileUp className="mr-1.5 h-4 w-4" />}
                  Publish version {nextVersion}
                </Button>
                <Button size="sm" variant="ghost" disabled={pending} onClick={() => { setStaged(null); setError(null); }}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="space-y-1.5">
        {!confirmArchive ? (
          <>
            <p className="text-sm text-muted-foreground">
              {versionable
                ? "Withdrawing it without a replacement? Archive it instead."
                : "Superseded or no longer needed? Archive it to keep the record without it being counted."}
            </p>
            <Button size="sm" variant="outline" disabled={pending} onClick={() => setConfirmArchive(true)}>
              <Archive className="mr-1.5 h-4 w-4" />
              Archive
            </Button>
          </>
        ) : (
          <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-800 dark:bg-amber-950/40">
            <p className="mb-2">
              Archive this document? It will be hidden from {audience}, won&apos;t be counted on the dashboard or
              chased for acknowledgement, and becomes read-only. You can restore it later.
            </p>
            <div className="flex gap-2">
              <Button
                size="sm"
                disabled={pending}
                onClick={() => {
                  setError(null);
                  startTransition(async () => {
                    const res = await archiveDocument(documentId);
                    if (!res.success) { setError(res.error ?? "Archive failed"); return; }
                    setConfirmArchive(false);
                    await onChanged();
                  });
                }}
              >
                {pending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                Archive
              </Button>
              <Button size="sm" variant="ghost" disabled={pending} onClick={() => setConfirmArchive(false)}>
                Cancel
              </Button>
            </div>
          </div>
        )}
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// AdminAcknowledgementSection — admin pages only (memberView = false).
//
// States whether acknowledgement is required and, where available, the
// coverage. Never offers the acknowledge button and never shows the
// caller's own ack: on an admin page the caller is acting as an admin,
// and acknowledging as a member belongs on their own My Documents page.
// ---------------------------------------------------------------------------

function AdminAcknowledgementSection({
  status,
  subject,
  archived = false,
}: {
  status: DocumentAcknowledgementStatus;
  /** Archived docs ask nobody — show coverage as history, no "outstanding". */
  archived?: boolean;
  /** Who acknowledges: the member label in the plural for org docs,
   *  the member's name for a member's document. */
  subject: { plural: boolean; label: string };
}) {
  const { requiresAcknowledgement, coverageSummary, ownerAcknowledgement } = status;
  const verb = subject.plural ? "are" : "is";
  // A member's own document they have acknowledged: say when.
  const ownerAckedAt = !subject.plural && requiresAcknowledgement && ownerAcknowledgement
    ? new Date(ownerAcknowledgement.acknowledgedAt).toLocaleDateString("en-GB", {
        day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
      })
    : null;
  return (
    <div>
      <p className="mb-1 flex items-center gap-2 text-base font-semibold">
        Acknowledgement
      </p>
      <p className="text-sm text-muted-foreground">
        {ownerAckedAt
          ? <>{subject.label} acknowledged reading this document on {ownerAckedAt}.</>
          : archived
            ? "Archived — nobody is asked to acknowledge it any more."
            : <>{subject.label} {verb} {requiresAcknowledgement ? "" : "not "}required to acknowledge reading this document.</>}
      </p>
      {requiresAcknowledgement && coverageSummary && (
        <p className="mt-1 text-sm text-muted-foreground">
          <span className="font-medium text-foreground">
            {coverageSummary.totalAcknowledged} of {coverageSummary.totalExpected}
          </span>{" "}
          acknowledged{archived && " before it was archived"}
          {!archived && coverageSummary.outstanding > 0 && (
            <> · <span className="font-medium text-amber-700 dark:text-amber-400">{coverageSummary.outstanding} outstanding</span></>
          )}
        </p>
      )}
    </div>
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
  isOrgDocument,
  selfService = false,
  onReplaced,
}: {
  documentId: string;
  targetMemberId: string;
  targetMemberName: string;
  subtypeId: string | null;
  subtypeName: string | null;
  /** Org documents replace via `replaceOrgDocument` and have no photo
   *  capture (that flow belongs to a member). */
  isOrgDocument: boolean;
  /** The member replacing their own upload: upload only, member wording. */
  selfService?: boolean;
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
      const res = isOrgDocument
        ? await replaceOrgDocument(documentId, fd)
        : await replaceMemberDocument(documentId, fd);
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
        Replace file
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        {selfService
          ? "Uploaded the wrong file? You can replace it until it has been verified."
          : "Files that have not been Verified or Acknowledged can be replaced."}
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
          {!isOrgDocument && !selfService && (
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
          )}
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
