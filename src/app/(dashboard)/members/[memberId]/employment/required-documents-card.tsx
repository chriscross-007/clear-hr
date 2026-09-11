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
import { STATUS_LABEL, STATUS_TONE, type DocumentStatus } from "@/lib/document-status";
import { DocumentDetailsDialog } from "@/components/documents/document-details-dialog";
import { NewMemberDocumentDialog } from "@/components/documents/new-document-dialog";
import {
  listTrackablePerMemberSubtypes,
  getMemberRequiredDocumentRows,
  setMemberExpectedDocuments,
  type TrackableSubtype,
  type RequiredDocumentRow,
} from "@/app/(dashboard)/members/[memberId]/docs/document-actions";

const TYPE_LABEL: Record<string, string> = {
  contract: "Contract",
  certificate: "Certificate",
  evidence: "Evidence",
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
  const [rows, setRows] = useState<RequiredDocumentRow[] | null>(null);
  const [available, setAvailable] = useState<TrackableSubtype[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [detailsDocId, setDetailsDocId] = useState<string | null>(null);
  // Preset subtype for a new-doc dialog. Set when the user clicks a
  // not_uploaded row — the dialog opens with the subtype pre-locked.
  const [newDocSubtypeId, setNewDocSubtypeId] = useState<string | null>(null);

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
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Required documents</CardTitle>
        <CardDescription>
          Document subtypes this member is expected to supply. Add to the
          documents already required of everyone in the organisation.
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
                      <th className="px-3 py-2 font-medium hidden md:table-cell">Expires</th>
                      <th className="px-3 py-2 font-medium hidden md:table-cell">To be reviewed by</th>
                      {canEdit && <th className="w-8 px-2 py-2" aria-label="Actions" />}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => {
                      const hasDoc = r.documentId !== null;
                      // Not-uploaded rows are also clickable — they
                      // open the New Document dialog with the row's
                      // subtype pre-locked. Only offer that path to
                      // callers who can edit; otherwise the row is
                      // static.
                      const canOpenNew = !hasDoc && canEdit;
                      const clickable = hasDoc || canOpenNew;
                      return (
                        <tr
                          key={r.subtypeId}
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
                            {fmtDate(r.expiresOn)}
                          </td>
                          <td className="px-3 py-2 hidden md:table-cell text-muted-foreground">
                            {fmtDate(r.nextReviewOn)}
                          </td>
                          {canEdit && (
                            <td className="px-2 py-2 text-right">
                              {r.assignedPerMember ? (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    removeSubtype(r.subtypeId);
                                  }}
                                  disabled={pending}
                                  className="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
                                  aria-label={`Remove ${subtypeLabel(r.subtypeType, r.subtypeName)}`}
                                  title="Remove from this member's required docs"
                                >
                                  <Minus className="h-3.5 w-3.5" />
                                </button>
                              ) : (
                                // Org-wide-only row: no minus. Small hint on hover.
                                <span
                                  className="text-[10px] text-muted-foreground"
                                  title="Required of every member in the organisation. Manage on the subtype itself."
                                >
                                  Org-wide
                                </span>
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

            {canEdit && pickable.length > 0 && (
              <div className="flex items-center gap-2">
                <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      disabled={pending}
                      className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-dashed text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
                      aria-label="Add required document"
                      title="Add required document"
                    >
                      <Plus className="h-4 w-4" />
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
    </Card>
  );
}
