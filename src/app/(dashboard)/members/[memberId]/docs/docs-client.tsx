"use client";

// CLE-206 — Per-Member Documents client. Wraps the CRUD actions from
// document-actions.ts. Signed-URL viewer preserved from the legacy
// docs-client, but the underlying storage bucket + row now live on
// the new `document` table.

import { capitalize } from "@/lib/label-utils";
import { sortDocs } from "@/lib/document-sort";
import { PdfViewer } from "@/components/documents/pdf-viewer";
import { useCallback, useEffect, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Calendar,
  EyeOff,
  FileText,
  Loader2,
  Plus,
  Trash2,
  Undo2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { StickyPageHeader } from "@/components/ui/sticky-page-header";
import { Tabs, TabsContent, TabsList } from "@/components/ui/tabs";
import {
  DOC_TAB_LIST_CLASS,
  DocTabTrigger,
  docTabCard,
  docTabTooltip,
  type DocTabKey,
} from "@/components/documents/doc-tab-theme";
// CLE-224 — Admin variant of the org-docs list, per-target ack state.
import { MemberOrgDocumentsList } from "@/components/documents/member-org-documents-list";
import { useMemberLabel } from "@/contexts/member-label-context";
import {
  listMemberDocuments,
  listTrashedMemberDocuments,
  getMemberDocumentSignedUrl,
  updateMemberDocumentMetadata,
  softDeleteMemberDocument,
  restoreMemberDocument,
  verifyMemberDocument,
  backdateDisposalQueue,
  getMemberRequiredDocumentRows,
} from "./document-actions";
import type { MemberDocumentRow, TrashedMemberDocumentRow } from "./document-types";
import { STATUS_LABEL, STATUS_TONE } from "@/lib/document-status";
import { DocumentDetailsDialog } from "@/components/documents/document-details-dialog";
import { NewMemberDocumentDialog } from "@/components/documents/new-document-dialog";
import { dispatchMemberDocsChanged } from "@/lib/member-docs-events";
// CLE-222 — Required Documents card mirrors the employee's own
// /my-documents view. Lives here (not on the Employment tab)
// so the admin surface stacks the two docs cards on one page.
import { RequiredDocumentsCard } from "@/app/(dashboard)/members/[memberId]/employment/required-documents-card";
import { SignatureBadgeFor } from "@/components/documents/signature-badge";

const DOCS_TABS = ["certifications", "employment", "other", "org", "archived", "trash"] as const;
type DocsTab = (typeof DOCS_TABS)[number];
function isDocsTab(v: string | null): v is DocsTab {
  return v !== null && (DOCS_TABS as readonly string[]).includes(v);
}
const TYPE_LABEL: Record<string, string> = {
  contract: "Employment",
  certificate: "Certificate",
  evidence: "RTW Evidence",
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

function fmtUploaded(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function fmtViewed(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
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
  const { memberLabel } = useMemberLabel();
  const [rows, setRows] = useState<MemberDocumentRow[]>([]);
  // CLE-228 — IDs of docs currently represented on the Required
  // Documents card. "Other documents" filters these out so a doc
  // never shows in both cards at once.
  const [requiredDocIds, setRequiredDocIds] = useState<Set<string>>(new Set());
  const [trashRows, setTrashRows] = useState<TrashedMemberDocumentRow[]>([]);
  // CLE-233 — archived documents (admins only).
  const [archivedRows, setArchivedRows] = useState<MemberDocumentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // CLE-231 — Five tabs: Certifications (what the member supplies:
  // RTW + required certificates), Employment (what the org issues to
  // the member), Other (everything else), Org, Trash. `?tab=<key>`
  // opens a specific tab (the admin dashboard ack chip uses ?tab=org);
  // the default lands on Certifications so the #required-documents
  // traffic-light deep link still resolves inside that card.
  const searchParams = useSearchParams();
  const tipOpts = { self: false, memberLabel };
  const initialTab = searchParams.get("tab");
  const [activeTab, setActiveTab] = useState<DocsTab>(
    isDocsTab(initialTab) && ((initialTab !== "trash" && initialTab !== "archived") || canManageDeleted) ? initialTab : "certifications",
  );

  const [viewerDoc, setViewerDoc] = useState<{
    url: string;
    fileName: string;
    contentType: string;
  } | null>(null);

  // CLE-231 — which tab's "Add Document" opened the dialog; narrows
  // the subtype picker to that tab's kinds.
  const [uploadBucket, setUploadBucket] = useState<"employment" | "other" | null>(null);
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
    const [listRes, trashRes, requiredRes, archivedRes] = await Promise.all([
      listMemberDocuments(memberId),
      canManageDeleted ? listTrashedMemberDocuments(memberId) : Promise.resolve({ success: true, rows: [] as TrashedMemberDocumentRow[] }),
      getMemberRequiredDocumentRows(memberId),
      canManageDeleted ? listMemberDocuments(memberId, { archived: true }) : Promise.resolve({ success: true, rows: [] as MemberDocumentRow[] }),
    ]);
    if (archivedRes.success) setArchivedRows(archivedRes.rows);
    setLoading(false);
    if (!listRes.success) setError(listRes.error ?? "Could not load documents");
    setRows(listRes.rows);
    if ("rows" in trashRes) setTrashRows(trashRes.rows);
    // CLE-228 — Collect doc IDs represented on Required so "Other
    // documents" below can exclude them. Required rows carry
    // `documentId` directly; RTW aggregate rows additionally carry
    // `rtwDocs[].documentId`. Not-uploaded rows have no doc id.
    if (requiredRes.success) {
      const ids = new Set<string>();
      for (const r of requiredRes.rows) {
        if (r.documentId) ids.add(r.documentId);
      }
      setRequiredDocIds(ids);
    }
  }, [memberId, canManageDeleted]);

  useEffect(() => {
    void load();
  }, [load]);

  // CLE-228 — RequiredDocumentsCard dispatches
  // `clearhr:member-docs-changed` on verify / renew / add / remove.
  // Re-fetch here so the "Other documents" filter against the
  // Required doc-id set stays in step with Required's state.
  useEffect(() => {
    const onChanged = () => { void load(); };
    window.addEventListener("clearhr:member-docs-changed", onChanged);
    return () => window.removeEventListener("clearhr:member-docs-changed", onChanged);
  }, [load]);

  const handleView = useCallback(async (doc: MemberDocumentRow) => {
    const res = await getMemberDocumentSignedUrl(doc.id, "inline");
    if (!res.success || !res.url) {
      setError(res.error ?? "Failed to open document");
      return;
    }
    setViewerDoc({ url: res.url, fileName: res.fileName ?? doc.fileName, contentType: doc.contentType });
  }, []);

  // CLE-225 follow-up — `handleDownload` was the row-level download
  // shortcut on the Live + Trash lists. Removed because the Details
  // dialog (opened on row-click) carries its own download control, so
  // a per-row icon was redundant. `getMemberDocumentSignedUrl` still
  // fires from inside the Details dialog.

  return (
    <div className="w-full px-4 py-8 sm:px-6 lg:px-8">
      {/* Transient "Received…" toast for photo uploads landing from
          mobile. Sits above everything for ~3 seconds. */}
      {toastMessage && (
        <div className="fixed left-1/2 top-6 z-50 -translate-x-1/2 rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white shadow-lg">
          {toastMessage}
        </div>
      )}
      {/* CLE-231 — Five-tab shell. Follows CLAUDE.md's "Tabs in the
          sticky header" convention: <Tabs> spans both the sticky
          header and the tab content, TabsList lives inside the sticky
          band so triggers stay pinned. */}
      <Tabs
        value={activeTab}
        onValueChange={(v) => { if (isDocsTab(v)) setActiveTab(v); }}
        className="w-full"
      >
        <StickyPageHeader>
          <div className="flex items-center justify-between gap-3 mb-3">
            <h1 className="text-2xl font-bold">Documents</h1>
          </div>
          {/* Colour-keyed tab buttons (doc-tab-theme): the active
              tab's card header uses the same pastel. */}
          <TabsList className={DOC_TAB_LIST_CLASS}>
            <DocTabTrigger tab="certifications" tooltip={docTabTooltip("certifications", tipOpts)} />
            <DocTabTrigger tab="employment" tooltip={docTabTooltip("employment", tipOpts)} />
            <DocTabTrigger tab="other" tooltip={docTabTooltip("other", tipOpts)} />
            <DocTabTrigger tab="org" tooltip={docTabTooltip("org", tipOpts)} />
            {canManageDeleted && (
              <DocTabTrigger tab="archived" tooltip={docTabTooltip("archived", tipOpts)}>
                Archived ({archivedRows.length})
              </DocTabTrigger>
            )}
            {canManageDeleted && (
              <DocTabTrigger tab="trash" tooltip={docTabTooltip("trash", tipOpts)}>
                Trash ({trashRows.length})
              </DocTabTrigger>
            )}
          </TabsList>
        </StickyPageHeader>

        {error && <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive mt-4">{error}</div>}

        {/* Certifications — documents the member supplies: Right to
            Work evidence + the certificates required of them (picked
            on the Employment page). */}
        <TabsContent value="certifications" className="mt-4">
          <RequiredDocumentsCard
            memberId={memberId}
            memberName={memberName}
            canEdit={canUpdate}
            tone="certifications"
          />
        </TabsContent>

        {/* Employment — documents the organisation issues to the
            member (contract, reviews, disciplinary). */}
        <TabsContent value="employment" className="mt-4">
          <DocListCard
            tone="employment"
            title="Employment documents"
            description={`Documents the organisation has issued to this ${memberLabel}. Kinds marked HR only are hidden from the ${memberLabel}.`}
            loading={loading}
            canUpdate={canUpdate}
            onAdd={() => setUploadBucket("employment")}
          >
            <DocList
              rows={rows.filter((r) => r.type === "contract")}
              canUpdate={canUpdate}
              variant="employment"
              showHrOnly
              onOpen={(r) => { setDetailsReadOnly(false); setDetailsDocId(r.id); }}
              onDelete={(r) => setDeleting(r)}
            />
          </DocListCard>
        </TabsContent>

        {/* Other — absence evidence, unrequired certificates,
            superseded RTW evidence, etc. */}
        <TabsContent value="other" className="mt-4">
          <DocListCard
            tone="other"
            title="Other documents"
            description="Everything not held under Certifications or Employment."
            loading={loading}
            canUpdate={canUpdate}
            onAdd={() => setUploadBucket("other")}
          >
            <DocList
              rows={rows.filter((r) => r.type !== "contract" && !requiredDocIds.has(r.id))}
              canUpdate={canUpdate}
              variant="other"
              onOpen={(r) => { setDetailsReadOnly(false); setDetailsDocId(r.id); }}
              onDelete={(r) => setDeleting(r)}
            />
          </DocListCard>
        </TabsContent>

        {/* CLE-224 — Org Documents tab. Component owns its own Card
            wrapper (same convention as <MyOrgDocumentsList>). */}
        <TabsContent value="org" className="mt-4">
          <MemberOrgDocumentsList memberId={memberId} memberName={memberName} tone="org" />
        </TabsContent>

        {/* CLE-233 — Archived: replaced / withdrawn Employment docs and
            archived Certificates / RTW evidence. Read-only; open a row to
            restore it. */}
        {canManageDeleted && (
          <TabsContent value="archived" className="mt-4">
            <DocListCard
              tone="archived"
              title="Archived"
              description={`Replaced or withdrawn documents, kept read-only with their history and acknowledgements. Hidden from ${memberName}. Open one to restore it.`}
              loading={loading}
              canUpdate={false}
            >
              <ArchivedList rows={archivedRows} onOpen={(r) => { setDetailsReadOnly(false); setDetailsDocId(r.id); }} />
            </DocListCard>
          </TabsContent>
        )}

        {canManageDeleted && (
          <TabsContent value="trash" className="mt-4">
            <DocListCard
              tone="trash"
              title="Trash"
              description="Deleted documents are kept for 30 days, then permanently removed."
              loading={loading}
              canUpdate={false}
            >
              <TrashList
                rows={trashRows}
                onRestore={async (id) => {
                  const res = await restoreMemberDocument(id);
                  if (!res.success) { setError(res.error ?? "Failed to restore"); return; }
                  // CLE-216 — Sidebar avatar traffic light listens for this.
                  dispatchMemberDocsChanged(memberId);
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
                  // dialog offers except the pencils and composer.
                  setDetailsReadOnly(true);
                  setDetailsDocId(d.id);
                }}
              />
            </DocListCard>
          </TabsContent>
        )}
      </Tabs>

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

      {uploadBucket && (
        <NewMemberDocumentDialog
          memberId={memberId}
          memberName={memberName}
          bucket={uploadBucket}
          onClose={() => setUploadBucket(null)}
          onCreated={async (newDocId) => {
            // Swap the "new doc" dialog for the full details dialog
            // in the same tick — from the user's perspective the
            // same surface just gained a file.
            setUploadBucket(null);
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
            // CLE-216 — Sidebar avatar traffic light listens for this.
            dispatchMemberDocsChanged(memberId);
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

function DocListCard({
  tone,
  title,
  description,
  loading,
  canUpdate,
  onAdd,
  children,
}: {
  tone: DocTabKey;
  title: string;
  description: string;
  loading: boolean;
  canUpdate: boolean;
  onAdd?: () => void;
  children: React.ReactNode;
}) {
  const toneCls = docTabCard(tone);
  return (
    <Card className={toneCls.card}>
      <CardHeader className={toneCls.header}>
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle className="text-base">{title}</CardTitle>
            <CardDescription>{description}</CardDescription>
          </div>
          {canUpdate && onAdd && (
            <Button type="button" size="sm" onClick={onAdd}>
              <Plus className="mr-1.5 h-4 w-4" />
              Add Document
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          children
        )}
      </CardContent>
    </Card>
  );
}

function DocList({
  rows,
  canUpdate,
  variant,
  showHrOnly = false,
  onOpen,
  onDelete,
}: {
  rows: MemberDocumentRow[];
  canUpdate: boolean;
  /** Employment shows an Acknowledged column; Other shows Verified. */
  variant: "employment" | "other";
  /** CLE-231 — mark rows whose subtype is hidden from the member. */
  showHrOnly?: boolean;

  /** Row click → open the Document Details dialog (§7b.13). */
  onOpen: (r: MemberDocumentRow) => void;
  onDelete: (r: MemberDocumentRow) => void;
}) {
  const { memberLabel } = useMemberLabel();
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground py-8 text-center">No documents yet.</p>;
  }
  return (
    <div className="mt-4 rounded-md border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/50 text-left text-xs uppercase text-muted-foreground">
            <th className="px-4 py-2 font-medium">Document</th>
            <th className="px-4 py-2 font-medium">Status</th>
            <th className="px-4 py-2 font-medium hidden lg:table-cell">Uploaded</th>
            <th className="px-4 py-2 font-medium hidden lg:table-cell">{capitalize(memberLabel)} viewed</th>
            <th className="px-4 py-2 font-medium hidden lg:table-cell">
              {variant === "employment" ? "Acknowledged" : "Verified"}
            </th>
            <th className="px-4 py-2 font-medium hidden lg:table-cell">Expires</th>
            <th className="px-4 py-2 font-medium hidden lg:table-cell">Next review</th>
            <th className="px-4 py-2 font-medium text-right" />
          </tr>
        </thead>
        <tbody>
          {sortDocs(rows, (r) => ({ type: r.type, subtypeName: r.subtypeName, fileName: r.fileName })).map((r) => (
            <tr
              key={r.id}
              className="cursor-pointer border-b last:border-b-0 hover:bg-muted/30"
              onClick={() => onOpen(r)}
            >
              <td className="px-4 py-2">
                <div className="min-w-0">
                  <p className="font-medium">
                    {TYPE_LABEL[r.type] ?? r.type}
                    {r.subtypeName ? <span className="text-muted-foreground"> / {r.subtypeName}</span> : null}
                    {/* CLE-231 follow-up — same pill the Org tab uses:
                        the member owes an acknowledgement on this doc. */}
                    {r.awaitingAckByOwner && (
                      <span className="ml-2 inline-block rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
                        Awaiting Ack
                      </span>
                    )}
                    {variant === "employment" && <span className="ml-2"><SignatureBadgeFor documentId={r.id} /></span>}
                    {showHrOnly && !r.visibleToMember && (
                      <span
                        className="ml-2 inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-normal text-slate-700 dark:bg-slate-800 dark:text-slate-300"
                        title="Hidden from the member this document belongs to"
                      >
                        <EyeOff className="h-3 w-3" /> HR only
                      </span>
                    )}
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
                {fmtUploaded(r.uploadedAt)}
              </td>
              <td className="px-4 py-2 text-muted-foreground hidden lg:table-cell">
                {fmtViewed(r.memberViewedAt)}
              </td>
              <td className="px-4 py-2 text-muted-foreground hidden lg:table-cell">
                {variant === "employment"
                  ? r.ownerAcknowledgedAt
                    ? fmtUploaded(r.ownerAcknowledgedAt)
                    : "—"
                  : fmtDate(r.verifiedOn)}
              </td>
              <td className="px-4 py-2 text-muted-foreground hidden lg:table-cell">
                {fmtDate(r.expiresOn)}
              </td>
              <td className="px-4 py-2 text-muted-foreground hidden lg:table-cell">
                {fmtDate(r.nextReviewOn)}
              </td>
              <td className="px-4 py-2 text-right">
                <div className="flex items-center justify-end gap-0.5">
                  {/* CLE-225 follow-up — Download icon removed from the
                      row; the Details dialog opened on row-click carries
                      its own download control, so a row-level shortcut
                      is redundant. Delete stays here because it's a
                      destructive row-level action, not a dialog affordance. */}
                  {canUpdate && (
                    <Button variant="ghost" size="icon" aria-label="Move to Trash" title="Move to Trash" onClick={(e) => { e.stopPropagation(); onDelete(r); }}>
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

function ArchivedList({
  rows,
  onOpen,
}: {
  rows: MemberDocumentRow[];
  onOpen: (r: MemberDocumentRow) => void;
}) {
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground py-8 text-center">No archived documents.</p>;
  }
  return (
    <div className="mt-4 rounded-md border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/50 text-left text-xs uppercase text-muted-foreground">
            <th className="px-4 py-2 font-medium">Document</th>
            <th className="px-4 py-2 font-medium">Version</th>
            <th className="px-4 py-2 font-medium hidden lg:table-cell">Uploaded</th>
            <th className="px-4 py-2 font-medium">Archived</th>
          </tr>
        </thead>
        <tbody>
          {sortDocs(rows, (r) => ({ type: r.type, subtypeName: r.subtypeName, fileName: r.fileName })).map((r) => (
            <tr
              key={r.id}
              className="cursor-pointer border-b last:border-b-0 hover:bg-muted/30"
              onClick={() => onOpen(r)}
            >
              <td className="px-4 py-2">
                <p className="font-medium">
                  {TYPE_LABEL[r.type] ?? r.type}
                  {r.subtypeName ? <span className="text-muted-foreground"> / {r.subtypeName}</span> : null}
                </p>
                <p className="text-xs text-muted-foreground truncate" title={r.fileName}>
                  {r.fileName} · {fmtFileSize(r.fileSize)}
                </p>
              </td>
              <td className="px-4 py-2 text-muted-foreground">{r.versionNumber ?? 1}</td>
              <td className="px-4 py-2 text-muted-foreground hidden lg:table-cell">{fmtDateTime(r.uploadedAt)}</td>
              <td className="px-4 py-2 text-muted-foreground">{r.archivedAt ? fmtDateTime(r.archivedAt) : "—"}</td>
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
            <th className="px-4 py-2 font-medium">Document</th>
            <th className="px-4 py-2 font-medium">Queued for Deletion</th>
            {/* CLE-226 — Column renamed from "Force-delete reason" to
                "Reason" now that a reason is captured on every soft-delete. */}
            <th className="px-4 py-2 font-medium hidden lg:table-cell">Reason</th>
            <th className="px-4 py-2 font-medium text-right" />
          </tr>
        </thead>
        <tbody>
          {sortDocs(rows, (r) => ({ type: r.type, subtypeName: r.subtypeName, fileName: r.fileName })).map((r) => (
            <tr
              key={r.id}
              className="cursor-pointer border-b last:border-b-0 hover:bg-muted/30"
              onClick={() => onView(r)}
            >
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
              {/* CLE-226 — Now populated for every user-initiated delete;
                  em-dash only appears on legacy rows or auto-Replace queue
                  entries. `title` gives a hover-preview of the full text. */}
              <td
                className="px-4 py-2 text-muted-foreground hidden lg:table-cell max-w-xs truncate"
                title={r.forceDeleteReason ?? undefined}
              >
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
            <div className="h-[70vh] w-full">
              <PdfViewer url={viewer.url} fileName={viewer.fileName} />
            </div>
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
  // CLE-226 — Reason is now mandatory on every soft-delete, not just
  // retention-protected ones. Switched from AlertDialog to Dialog to
  // pick up the standard scrollable-body layout for forms.
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
    const trimmed = reason.trim();
    if (trimmed.length < 3) {
      setError("Please give a reason (at least 3 characters).");
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await softDeleteMemberDocument(row.id, { reason: trimmed });
      if (!res.success) { setError(res.error ?? "Failed to delete"); return; }
      await onDeleted();
    });
  }

  const canSave = !pending && reason.trim().length >= 3 && (!requiresForce || canForceDelete);

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !pending) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Move to Trash?</DialogTitle>
          <DialogDescription>
            <span className="font-medium">{row.fileName}</span> will move to Trash for 30 days,
            then be permanently deleted. Enter a reason for the audit trail.
          </DialogDescription>
        </DialogHeader>

        {/* CLE-226 follow-up — small vertical padding so the focus ring
            on the Textarea isn't clipped by the scroll container. */}
        <div className="overflow-y-auto max-h-[60vh] p-1 space-y-3">
          {requiresForce && (
            <div className="space-y-1 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-800 dark:bg-amber-900/20">
              <div className="flex items-center gap-2 font-medium text-amber-800 dark:text-amber-300">
                <Calendar className="h-4 w-4" />
                Force-delete required
              </div>
              <p className="text-xs text-amber-800 dark:text-amber-300">
                This subtype is retention-protected while the member is active. Deleting
                it requires the <em>Force-delete documents</em> right on your profile.
              </p>
            </div>
          )}

          <div className="space-y-2">
            <Label>Reason <span className="text-destructive">*</span></Label>
            <Textarea
              placeholder="Recorded in the audit trail"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              maxLength={500}
              disabled={pending}
            />
          </div>

          {error && <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>Cancel</Button>
          <Button
            variant="destructive"
            onClick={handleDelete}
            disabled={!canSave}
          >
            {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Move to Trash
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
