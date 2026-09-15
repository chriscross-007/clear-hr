"use client";

// CLE-213 — Required Documents card on the Employment tab.
//
// One always-visible table listing every subtype expected of this
// member (union of org-wide `expected_for_every_member` and per-member
// `member_expected_document`). Each row shows status pills + expiry +
// review date; row-click opens the Document Details dialog for the
// newest active doc, when one exists.
//
// Inline editing (no Edit button, no explicit Save):
//   * Per-row "−" button → immediately removes the per-member
//     assignment. Only shown for rows that HR explicitly added
//     (i.e. `assignedPerMember` is true). Org-wide-only rows can't
//     be removed here — they're managed on the subtype itself.
//   * Discreet "+" at the bottom-left → opens a popover picker of
//     trackable subtypes not already assigned. Selecting one persists
//     immediately. Hidden when no subtypes are addable.
//
// Every mutation calls setMemberExpectedDocuments with the new full
// set, so the server-side diff audit still fires with add/remove
// entries as before.

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { Loader2, Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { STATUS_LABEL, STATUS_TONE, type DocumentStatus } from "@/lib/document-status";
import { DocumentDetailsDialog } from "@/components/documents/document-details-dialog";
import { NewMemberDocumentDialog } from "@/components/documents/new-document-dialog";
import { useMemberLabel } from "@/contexts/member-label-context";
import { capitalize } from "@/lib/label-utils";
import {
  listTrackablePerMemberSubtypes,
  getMemberRequiredDocumentRows,
  setMemberExpectedDocuments,
  softDeleteMemberDocument,
  type TrackableSubtype,
  type RequiredDocumentRow,
} from "@/app/(dashboard)/members/[memberId]/docs/document-actions";
import { dispatchMemberDocsChanged } from "@/lib/member-docs-events";

const TYPE_LABEL: Record<string, string> = {
  contract: "Contract",
  certificate: "Certificate",
  evidence: "RTW Evidence",
  attachment: "Attachment",
};

const NOT_UPLOADED_TONE =
  "bg-neutral-200 text-neutral-800 dark:bg-neutral-800 dark:text-neutral-200";

function subtypeLabel(type: string, name: string): string {
  const t = TYPE_LABEL[type] ?? type;
  return `${t} / ${name}`;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso + "T00:00:00Z").toLocaleDateString("en-GB", {
    day: "2-digit", month: "short", year: "numeric", timeZone: "UTC",
  });
}

export function RequiredDocumentsCard({
  memberId,
  memberName,
  canEdit,
}: {
  memberId: string;
  memberName: string;
  /** Requires the documents.update tab flag on the target. When
   *  false the +/− controls are hidden and the table is view-only. */
  canEdit: boolean;
}) {
  const { memberLabel } = useMemberLabel();
  const [rows, setRows] = useState<RequiredDocumentRow[] | null>(null);
  const [available, setAvailable] = useState<TrackableSubtype[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [detailsDocId, setDetailsDocId] = useState<string | null>(null);
  // Preset subtype for a new-doc dialog. Set when the user clicks a
  // not_uploaded row — the dialog opens with the subtype pre-locked.
  const [newDocSubtypeId, setNewDocSubtypeId] = useState<string | null>(null);
  // CLE-215 — RTW aggregate row's "+ Add" opens the new-doc dialog
  // in rtwOnly mode. Separate state because there's no preset
  // subtype; the user picks one from the restricted list.
  const [rtwAdding, setRtwAdding] = useState(false);
  // CLE-215 follow-up — deleting an RTW doc requires a reason
  // (retention_class = right_to_work is protected while the employee
  // is still active). Holds the row being confirmed.
  const [rtwDeleting, setRtwDeleting] = useState<RequiredDocumentRow | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const [rowsRes, avRes] = await Promise.all([
      getMemberRequiredDocumentRows(memberId),
      listTrackablePerMemberSubtypes(),
    ]);
    if (!rowsRes.success) { setError(rowsRes.error); return; }
    if (!avRes.success) { setError(avRes.error); return; }
    setRows(rowsRes.rows);
    setAvailable(avRes.subtypes);
  }, [memberId]);

  useEffect(() => { void load(); }, [load]);

  // CLE-216 — When the page is opened with #required-documents (from
  // the sidebar avatar badge or the Directory Docs icon), the browser
  // can only push the card to the top of the viewport if there's
  // enough scrollable content below it. On short Employment pages the
  // card would land near the bottom instead. To guarantee it hits the
  // top: inject a tall spacer at the end of the scrollable page just
  // before scrolling, then scroll the card into view. The spacer
  // stays for the life of the visit so the card remains at top even
  // if the user scrolls back — small UX cost, big clarity win when
  // arriving from the traffic-light click.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.location.hash !== "#required-documents") return;
    const raf = requestAnimationFrame(() => {
      const card = document.getElementById("required-documents");
      if (!card) return;
      // Inject spacer once (idempotent) so scroll-to-top has room.
      if (!document.getElementById("required-documents-spacer")) {
        const spacer = document.createElement("div");
        spacer.id = "required-documents-spacer";
        spacer.setAttribute("aria-hidden", "true");
        spacer.style.height = "70vh";
        // Append to the card's own scrolling ancestor's flow — the
        // page wrapper (max-w-4xl space-y-6) works because it's the
        // outermost content box on Employment.
        card.parentElement?.appendChild(spacer);
      }
      card.scrollIntoView({ block: "start", behavior: "auto" });
    });
    return () => cancelAnimationFrame(raf);
  }, []);

  // CLE-215 — react to the RTW opt-out toggle on the sibling card.
  // The RTW aggregate row appears/disappears based on
  // `members.rtw_not_required`, so re-fetching here makes the card
  // pick up the change without a page reload.
  useEffect(() => {
    function onRtwChanged(e: Event) {
      const detail = (e as CustomEvent<{ memberId?: string }>).detail;
      if (!detail || detail.memberId !== memberId) return;
      void load();
    }
    window.addEventListener("clearhr:rtw-changed", onRtwChanged);
    return () => window.removeEventListener("clearhr:rtw-changed", onRtwChanged);
  }, [memberId, load]);

  // Subtypes with the trackable flag on that aren't already assigned
  // per-member. Drives the "+" picker.
  const pickable = useMemo(() => {
    if (!rows) return [] as TrackableSubtype[];
    const assigned = new Set(rows.filter((r) => r.assignedPerMember).map((r) => r.subtypeId));
    return available.filter((s) => !assigned.has(s.id));
  }, [rows, available]);

  /** Persist a new full set of per-member expected subtype IDs.
   *  Server handles diffing + auditing. Refetches on success. */
  function persist(nextIds: string[]) {
    setError(null);
    startTransition(async () => {
      const res = await setMemberExpectedDocuments(memberId, nextIds);
      if (!res.success) { setError(res.error ?? "Save failed"); return; }
      // CLE-216 — Sidebar avatar traffic light listens for this.
      dispatchMemberDocsChanged(memberId);
      await load();
    });
  }

  function addSubtype(id: string) {
    if (!rows) return;
    const current = rows.filter((r) => r.assignedPerMember).map((r) => r.subtypeId);
    persist([...current, id]);
    setPickerOpen(false);
  }

  function removeSubtype(id: string) {
    if (!rows) return;
    const current = rows.filter((r) => r.assignedPerMember).map((r) => r.subtypeId);
    persist(current.filter((existing) => existing !== id));
  }

  return (
    // CLE-216 — Scroll anchor for the traffic-light click target on
    // the sidebar avatar (and Directory Docs column). `scroll-mt-24`
    // keeps the card clear of the sticky page header when scrolled to.
    <Card id="required-documents" className="scroll-mt-24">
      <CardHeader>
        <CardTitle className="text-base">Required documents</CardTitle>
        <CardDescription>
          Documents this {capitalize(memberLabel)} is expected to provide.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {error && (
          <div className="rounded-md bg-destructive/10 p-2 text-sm text-destructive">{error}</div>
        )}
        {rows === null ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : (
          <>
            {rows.length === 0 ? (
              <p className="text-sm text-muted-foreground">No required documents.</p>
            ) : (
              <div className="overflow-hidden rounded-md border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                      <th className="px-3 py-2 font-medium">Subtype</th>
                      <th className="px-3 py-2 font-medium">Status</th>
                      <th className="px-3 py-2 font-medium hidden md:table-cell">Verified</th>
                      <th className="px-3 py-2 font-medium hidden md:table-cell">Expires</th>
                      <th className="px-3 py-2 font-medium hidden md:table-cell">To be reviewed by</th>
                      {canEdit && <th className="w-8 px-2 py-2" aria-label="Actions" />}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => {
                      // CLE-215 — RTW aggregate row uses its own
                      // rendering path: a single row whose Subtype
                      // cell lists every non-expired qualifying doc
                      // as a clickable chip.
                      if (r.isRtwAggregate) {
                        const canAddRtw = canEdit;
                        // Earliest expiry across the qualifying docs
                        // — the one that'll next trigger an alarm.
                        // Skip docs with no expiry set. Undefined
                        // when nothing qualifies.
                        const earliestExpiry = (() => {
                          const withDates = (r.rtwDocs ?? [])
                            .map((d) => d.expiresOn)
                            .filter((v): v is string => typeof v === "string" && v.length > 0);
                          if (withDates.length === 0) return null;
                          withDates.sort();
                          return withDates[0];
                        })();
                        return (
                          <tr key="rtw-aggregate" className="border-b last:border-b-0">
                            <td className="px-3 py-2">
                              <p className="font-medium">Right to Work evidence</p>
                              {r.rtwDocs && r.rtwDocs.length > 0 ? (
                                <div className="mt-1 flex flex-wrap gap-1">
                                  {r.rtwDocs.map((d) => (
                                    <button
                                      key={d.documentId}
                                      type="button"
                                      onClick={() => setDetailsDocId(d.documentId)}
                                      className="inline-flex items-center gap-1 rounded-full border bg-muted/40 px-2 py-0.5 text-xs hover:bg-muted"
                                      title={d.fileName}
                                    >
                                      {subtypeLabel(d.subtypeType, d.subtypeName)}
                                    </button>
                                  ))}
                                </div>
                              ) : (
                                <p className="mt-0.5 text-xs text-muted-foreground italic">
                                  No qualifying doc uploaded.
                                </p>
                              )}
                            </td>
                            <td className="px-3 py-2">
                              <div className="flex flex-wrap gap-1">
                                {r.statuses.map((s) => (
                                  <span
                                    key={s}
                                    className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                                      s === "not_uploaded"
                                        ? NOT_UPLOADED_TONE
                                        : STATUS_TONE[s as DocumentStatus].className
                                    }`}
                                  >
                                    {s === "not_uploaded" ? "Not uploaded" : STATUS_LABEL[s as DocumentStatus]}
                                  </span>
                                ))}
                              </div>
                            </td>
                            <td className="px-3 py-2 hidden md:table-cell text-muted-foreground">—</td>
                            <td className="px-3 py-2 hidden md:table-cell text-muted-foreground">
                              {fmtDate(earliestExpiry)}
                            </td>
                            <td className="px-3 py-2 hidden md:table-cell text-muted-foreground">—</td>
                            {canEdit && (
                              <td className="px-2 py-2 text-right">
                                {canAddRtw && (
                                  <button
                                    type="button"
                                    onClick={() => setRtwAdding(true)}
                                    disabled={pending}
                                    className="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
                                    aria-label="Add RTW evidence"
                                    title="Add RTW evidence"
                                  >
                                    <Plus className="h-3.5 w-3.5" />
                                  </button>
                                )}
                              </td>
                            )}
                          </tr>
                        );
                      }

                      const hasDoc = r.documentId !== null;
                      // Not-uploaded rows are also clickable — they
                      // open the New Document dialog with the row's
                      // subtype pre-locked. Only offer that path to
                      // callers who can edit; otherwise the row is
                      // static. RTW-evidence rows always have a doc
                      // (they're built from real uploads).
                      const canOpenNew = !hasDoc && canEdit && !r.isRtwEvidence;
                      const clickable = hasDoc || canOpenNew;
                      return (
                        <tr
                          key={r.documentId ?? r.subtypeId}
                          className={
                            "border-b last:border-b-0 " +
                            (clickable ? "cursor-pointer hover:bg-muted/30" : "")
                          }
                          onClick={() => {
                            if (hasDoc && r.documentId) setDetailsDocId(r.documentId);
                            else if (canOpenNew) setNewDocSubtypeId(r.subtypeId);
                          }}
                          title={
                            hasDoc
                              ? "Open document details"
                              : canOpenNew
                                ? "Upload the required document"
                                : "No document uploaded yet"
                          }
                        >
                          <td className="px-3 py-2">
                            <p className="font-medium">{subtypeLabel(r.subtypeType, r.subtypeName)}</p>
                            {r.fileName && (
                              <p className="text-xs text-muted-foreground truncate">{r.fileName}</p>
                            )}
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex flex-wrap gap-1">
                              {r.statuses.map((s) => (
                                <span
                                  key={s}
                                  className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                                    s === "not_uploaded"
                                      ? NOT_UPLOADED_TONE
                                      : STATUS_TONE[s as DocumentStatus].className
                                  }`}
                                >
                                  {s === "not_uploaded" ? "Not uploaded" : STATUS_LABEL[s as DocumentStatus]}
                                </span>
                              ))}
                            </div>
                          </td>
                          <td className="px-3 py-2 hidden md:table-cell text-muted-foreground">
                            {fmtDate(r.verifiedOn)}
                          </td>
                          <td className="px-3 py-2 hidden md:table-cell text-muted-foreground">
                            {fmtDate(r.expiresOn)}
                          </td>
                          <td className="px-3 py-2 hidden md:table-cell text-muted-foreground">
                            {fmtDate(r.nextReviewOn)}
                          </td>
                          {canEdit && (
                            <td className="px-2 py-2 text-right">
                              {r.assignedPerMember && (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    removeSubtype(r.subtypeId);
                                  }}
                                  disabled={pending}
                                  className="inline-flex h-6 w-6 items-center justify-center rounded text-destructive hover:bg-destructive/10 hover:text-destructive disabled:opacity-40"
                                  aria-label={`Remove ${subtypeLabel(r.subtypeType, r.subtypeName)}`}
                                  title="Remove from this member's required docs"
                                >
                                  <Minus className="h-3.5 w-3.5" />
                                </button>
                              )}
                              {r.isRtwEvidence && r.documentId && (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setRtwDeleting(r);
                                  }}
                                  disabled={pending}
                                  className="inline-flex h-6 w-6 items-center justify-center rounded text-destructive hover:bg-destructive/10 hover:text-destructive disabled:opacity-40"
                                  aria-label={`Delete ${subtypeLabel(r.subtypeType, r.subtypeName)}`}
                                  title="Delete this document (moves it to Trash)"
                                >
                                  <Minus className="h-3.5 w-3.5" />
                                </button>
                              )}
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {canEdit && (pickable.length > 0 || rows.some((r) => r.isRtwEvidence)) && (
              <div className="flex flex-wrap items-center gap-2">
                {pickable.length > 0 && (
                  <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        disabled={pending}
                        className="inline-flex items-center gap-1 rounded-full border border-dashed px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
                        aria-label="Add required document"
                        title="Add required document"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        Add subtype
                      </button>
                    </PopoverTrigger>
                    <PopoverContent className="w-80 p-0" align="start">
                      <div className="max-h-72 overflow-y-auto py-1">
                        {pickable.map((s) => (
                          <button
                            key={s.id}
                            type="button"
                            onClick={() => addSubtype(s.id)}
                            className="block w-full px-3 py-1.5 text-left text-sm hover:bg-muted/50"
                          >
                            {subtypeLabel(s.type, s.name)}
                          </button>
                        ))}
                      </div>
                    </PopoverContent>
                  </Popover>
                )}
                {/* CLE-215 follow-up — when at least one RTW-evidence
                    row is already present, offer a second button for
                    adding another RTW doc (a different subtype or a
                    replacement). The empty-state placeholder already
                    has its own "+" so we only surface this here when
                    docs exist. */}
                {rows.some((r) => r.isRtwEvidence) && (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => setRtwAdding(true)}
                    className="inline-flex items-center gap-1 rounded-full border border-dashed px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
                    aria-label="Add another Right to Work doc"
                    title="Add another Right to Work doc"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Add RTW evidence
                  </button>
                )}
                {pending && (
                  <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" /> Saving…
                  </span>
                )}
              </div>
            )}
          </>
        )}
      </CardContent>

      {detailsDocId && (
        <DocumentDetailsDialog
          documentId={detailsDocId}
          canUpdate={canEdit}
          onClose={() => setDetailsDocId(null)}
          onSaved={load}
        />
      )}

      {newDocSubtypeId && (
        <NewMemberDocumentDialog
          memberId={memberId}
          memberName={memberName}
          presetSubtypeId={newDocSubtypeId}
          onClose={() => setNewDocSubtypeId(null)}
          onCreated={async (newDocId) => {
            // Hand over to the full details dialog on the same tick
            // so the transition looks like the same surface just
            // gained a file.
            setNewDocSubtypeId(null);
            setDetailsDocId(newDocId);
            await load();
          }}
        />
      )}

      {rtwAdding && (
        <NewMemberDocumentDialog
          memberId={memberId}
          memberName={memberName}
          rtwOnly
          onClose={() => setRtwAdding(false)}
          onCreated={async (newDocId) => {
            setRtwAdding(false);
            setDetailsDocId(newDocId);
            await load();
          }}
        />
      )}

      {rtwDeleting && (
        <RtwDeleteDialog
          row={rtwDeleting}
          onClose={() => setRtwDeleting(null)}
          onDeleted={async () => {
            setRtwDeleting(null);
            // CLE-216 — Sidebar avatar traffic light listens for this.
            dispatchMemberDocsChanged(memberId);
            await load();
          }}
        />
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// RTW delete confirmation — RTW-class docs are retention-protected
// while the employee is active, so soft-delete requires a reason.
// The reason is captured here and passed straight through to the
// existing `softDeleteMemberDocument` action.
// ---------------------------------------------------------------------------

function RtwDeleteDialog({
  row,
  onClose,
  onDeleted,
}: {
  row: RequiredDocumentRow;
  onClose: () => void;
  onDeleted: () => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleDelete() {
    if (!row.documentId) return;
    if (!reason.trim()) {
      setError("Please give a reason.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await softDeleteMemberDocument(row.documentId as string, {
        forceDeleteReason: reason.trim(),
      });
      if (!res.success) { setError(res.error ?? "Failed to delete"); return; }
      await onDeleted();
    });
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !pending) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Delete Right to Work evidence</DialogTitle>
          <DialogDescription>
            <span className="font-medium">{subtypeLabel(row.subtypeType, row.subtypeName)}</span> will move to Trash
            for 30 days, then be permanently deleted. Right-to-Work evidence
            is retention-protected while the employee is active, so please
            record why you're removing it.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label>Reason <span className="text-destructive">*</span></Label>
          <Textarea
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Superseded by renewed passport uploaded today."
            disabled={pending}
          />
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>Cancel</Button>
          <Button
            variant="destructive"
            onClick={handleDelete}
            disabled={pending || !reason.trim()}
          >
            {pending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
