"use client";

// CLE-216 follow-up — Self-scope "My Documents" card.
//
// Stripped-down clone of the admin Employment tab's
// `<RequiredDocumentsCard>`. Rather than growing that component with a
// mountain of admin/employee toggles, this component mirrors just the
// display path and omits every admin-only affordance:
//
//   * No per-row "−" (employees can't unrequire docs).
//   * No "+ Add subtype" popover (subtype assignment is HR's call).
//   * No RTW delete dialog (RTW is retention-protected).
//   * The RTW aggregate row is read-only (no "+ Add").
//
// The one write affordance retained is "+ Add" on a **not-uploaded**
// row whose subtype has `employee_can_upload = true`. That opens
// `NewMemberDocumentDialog` preset to the row's subtype, matching the
// admin card's row-click path. Not-uploaded rows for subtypes with
// `employee_can_upload = false` render as static text with a small
// "HR will upload this for you" hint.
//
// Uploaded rows are clickable — they open the shared Document Details
// dialog with `readOnly` + `hideActivity` on, so the employee sees the
// preview + download + read-only metadata but no pencils, no Activity
// feed, no Replace section.
//
// The card listens for `clearhr:member-docs-changed` and reloads its
// rows on every fire; the dialog's own `notifySaved()` dispatches that
// event on upload so the card refreshes without a page reload.

import { useCallback, useEffect, useState } from "react";
import { Loader2, Plus } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { STATUS_LABEL, STATUS_TONE, type DocumentStatus } from "@/lib/document-status";
import { fmtBytes } from "@/lib/format-bytes";
import { DocumentDetailsDialog } from "@/components/documents/document-details-dialog";
import { NewMemberDocumentDialog } from "@/components/documents/new-document-dialog";
import {
  getMemberRequiredDocumentRows,
  type RequiredDocumentRow,
} from "@/app/(dashboard)/members/[memberId]/docs/document-actions";
import { onMemberDocsChanged } from "@/lib/member-docs-events";

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

export function MyDocumentsCard({
  memberId,
  memberName,
}: {
  /** The caller's own member id — resolved by the parent server
   *  component. The card only ever runs against the caller, so no
   *  admin affordances are exposed. */
  memberId: string;
  /** Used as the target-member name on the New Document dialog. */
  memberName: string;
}) {
  const [rows, setRows] = useState<RequiredDocumentRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [detailsDocId, setDetailsDocId] = useState<string | null>(null);
  // Preset subtype for the New Document dialog. Set when the user
  // clicks "+ Add" on a not-uploaded row whose subtype allows
  // employee upload.
  const [newDocSubtypeId, setNewDocSubtypeId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const res = await getMemberRequiredDocumentRows(memberId);
    if (!res.success) { setError(res.error); return; }
    setRows(res.rows);
  }, [memberId]);

  useEffect(() => { void load(); }, [load]);

  // Refresh when any surface fires the docs-changed event for this
  // member — same pattern the sidebar avatar traffic light uses.
  useEffect(() => {
    return onMemberDocsChanged(memberId, () => { void load(); });
  }, [memberId, load]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">My required documents</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {error && (
          <div className="rounded-md bg-destructive/10 p-2 text-sm text-destructive">{error}</div>
        )}
        {rows === null ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : rows.length === 0 ? (
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
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  // RTW aggregate row — a read-only placeholder for
                  // employees. Admins get a "+ Add" here; we
                  // deliberately don't (RTW evidence goes through HR).
                  if (r.isRtwAggregate) {
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
                              HR will upload this for you.
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
                      </tr>
                    );
                  }

                  const hasDoc = r.documentId !== null;
                  // Not-uploaded rows split by the subtype's
                  // `employee_can_upload` flag:
                  //   * true  → clickable "+ Add" affordance that
                  //             opens NewMemberDocumentDialog preset
                  //             to this subtype.
                  //   * false → static hint saying HR will upload.
                  //             RTW-evidence rows also fall in this
                  //             branch (employeeCanUpload is set to
                  //             the subtype's own flag, which for RTW
                  //             is typically false anyway).
                  const canOpenNew = !hasDoc && r.employeeCanUpload && !r.isRtwEvidence;
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
                            ? "Upload this document"
                            : "HR will upload this for you"
                      }
                    >
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-medium">{subtypeLabel(r.subtypeType, r.subtypeName)}</p>
                          {/* CLE-220 — "Please Ack" pill. Renders when the
                              subtype requires acknowledgement AND this
                              row has an uploaded doc the caller hasn't
                              acked yet. Not-uploaded rows never carry a
                              pill (there's no doc to ack). */}
                          {r.requiresAcknowledgement && r.documentId && !r.isAcknowledged && (
                            <span className="inline-block rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
                              Please Ack
                            </span>
                          )}
                        </div>
                        {r.fileName && (
                          <p className="text-xs text-muted-foreground truncate">
                            {r.fileName}
                            {r.fileSize !== null && (
                              <span className="ml-1 text-muted-foreground/70">({fmtBytes(r.fileSize)})</span>
                            )}
                          </p>
                        )}
                        {!hasDoc && !canOpenNew && (
                          <p className="mt-0.5 text-xs text-muted-foreground italic">
                            HR will upload this for you.
                          </p>
                        )}
                        {canOpenNew && (
                          <span className="mt-0.5 inline-flex items-center gap-1 text-xs text-muted-foreground">
                            <Plus className="h-3 w-3" /> Add
                          </span>
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
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>

      {detailsDocId && (
        // Employee-view mode: `canUpdate=false` strips the pencils
        // (via `effectiveCanUpdate = canUpdate && !readOnly` inside
        // the dialog), `hideActivity` drops the Activity feed. We
        // deliberately do NOT pass `readOnly` any more — that flag is
        // reserved for the Trash-list view, and setting it here would
        // (a) fire the misleading "In Trash" pill and (b) suppress the
        // Acknowledgement section, blocking the employee's only way to
        // click "I have read and understood this document" (CLE-219).
        // CLE-220 — `hideHrMetadata` drops Expiry / Verify / Review /
        // Replace so the employee gets a clean read-and-acknowledge
        // surface. Download + preview + Acknowledge stay visible.
        <DocumentDetailsDialog
          documentId={detailsDocId}
          canUpdate={false}
          hideActivity
          hideHrMetadata
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
            // Swap to the Details dialog on the same tick so the
            // employee sees the freshly-uploaded file. The dialog is
            // opened in the same read-only + hideActivity mode as any
            // other row click.
            setNewDocSubtypeId(null);
            setDetailsDocId(newDocId);
            await load();
          }}
        />
      )}
    </Card>
  );
}
