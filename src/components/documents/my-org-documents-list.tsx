"use client";

// CLE-220 — Employee-facing organisation-documents list. Renders inside
// the "Org Documents" tab on /my-documents. Same underlying data as the
// admin `<OrganisationDocsClient>` but the affordances differ:
//   * No Upload / Delete controls (employees don't manage org docs).
//   * Row-click opens `<DocumentDetailsDialog>` with the same
//     employee-view props the /my-documents "My Documents" tab uses:
//     `canUpdate=false`, `hideActivity`, `hideHrMetadata`.
//   * Per-row "Please Ack" pill when the doc requires acknowledgement
//     and the caller has not yet acked it (see CLE-220 spec §Employee
//     surfaces + the shared `getMyOutstandingAcknowledgements` action).
//
// Reads via the existing `listOrgDocuments()` action; that action also
// returns `requiresAcknowledgement` + `isAcknowledged` per row now
// (CLE-220), so no second round-trip is needed for the pill.

import { useCallback, useEffect, useState } from "react";
import { FileText } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DocumentDetailsDialog } from "@/components/documents/document-details-dialog";
import {
  listOrgDocuments,
  type OrgDocumentRow,
} from "@/app/(dashboard)/documents/organisation/org-document-actions";
import { onMemberDocsChanged } from "@/lib/member-docs-events";
import { fmtBytes } from "@/lib/format-bytes";

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso + "T00:00:00Z").toLocaleDateString("en-GB", {
    day: "2-digit", month: "short", year: "numeric", timeZone: "UTC",
  });
}
function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
  });
}

export function MyOrgDocumentsList({
  memberId,
  initialRows,
}: {
  /** The caller's own member id — used to hook into the shared
   *  `clearhr:member-docs-changed` bus so the list refreshes after
   *  the caller acknowledges a doc from the details dialog. */
  memberId: string;
  /** SSR-fetched org docs. The list re-fetches client-side on
   *  ack + on the `member-docs-changed` event, but the initial paint
   *  comes from the server. */
  initialRows: OrgDocumentRow[];
}) {
  const [rows, setRows] = useState<OrgDocumentRow[]>(initialRows);
  const [error, setError] = useState<string | null>(null);
  const [detailsDocId, setDetailsDocId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const res = await listOrgDocuments();
    if (!res.success) { setError(res.error ?? "Failed to load"); return; }
    setRows(res.rows);
  }, []);

  // Refresh when the ack surface fires the shared event — the details
  // dialog dispatches `member-docs-changed` on the caller's memberId
  // after a successful acknowledgement, and this list watches that
  // bus so the Please Ack pill vanishes without a page reload.
  useEffect(() => onMemberDocsChanged(memberId, () => { void load(); }), [memberId, load]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Organisation documents</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {error && (
          <div className="rounded-md bg-destructive/10 p-2 text-sm text-destructive">{error}</div>
        )}
        {rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No organisation documents yet.
          </p>
        ) : (
          <div className="overflow-hidden rounded-md border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                  {/* CLE-221 follow-up — Col 1 now folds Subtype (bold) +
                      file name + size into one cell so this list reads
                      the same way as the two My Documents cards on the
                      other tab. Separate Subtype column dropped. */}
                  <th className="px-3 py-2 font-medium">Document</th>
                  <th className="px-3 py-2 font-medium hidden lg:table-cell">Expires</th>
                  <th className="px-3 py-2 font-medium hidden lg:table-cell">Uploaded</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.id}
                    className="cursor-pointer border-b last:border-b-0 hover:bg-muted/30"
                    onClick={() => setDetailsDocId(r.id)}
                    title="Open document details"
                  >
                    <td className="px-3 py-2">
                      <div className="flex items-start gap-2 min-w-0">
                        <FileText className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="font-medium">
                              {r.subtypeName ?? <span className="text-muted-foreground">—</span>}
                            </p>
                            {/* CLE-220 — "Please Ack" pill on any org
                                doc whose subtype requires ack AND the
                                caller has not yet acknowledged it. */}
                            {r.requiresAcknowledgement && !r.isAcknowledged && (
                              <span className="inline-block rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
                                Please Ack
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground truncate">
                            {r.fileName}
                            <span className="ml-1 text-muted-foreground/70">({fmtBytes(r.fileSize)})</span>
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground hidden lg:table-cell">{fmtDate(r.expiresOn)}</td>
                    <td className="px-3 py-2 text-muted-foreground hidden lg:table-cell">{fmtDateTime(r.uploadedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>

      {detailsDocId && (
        // Employee-view — same props as MyDocumentsCard uses on the
        // My Documents tab. `canUpdate=false` + `hideActivity` +
        // `hideHrMetadata` collapses the four HR-only sections (Expiry
        // / Verify / Review / Replace) so the dialog is a clean
        // read-and-acknowledge surface.
        <DocumentDetailsDialog
          documentId={detailsDocId}
          canUpdate={false}
          hideActivity
          hideHrMetadata
          onClose={() => setDetailsDocId(null)}
          onSaved={load}
        />
      )}

    </Card>
  );
}
