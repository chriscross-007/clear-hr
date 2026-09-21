"use client";

// CLE-223 — Admin view of the org-documents list scoped to a specific
// target member. Renders inside the "Org Documents" tab on
// /members/[memberId]/docs.
//
// Visual parity with <MyOrgDocumentsList>, differences:
//   * Data comes from `getOrgDocumentsForMember(memberId)` — the ack
//     state is computed for the *target*, not the caller.
//   * Amber "Awaiting Ack" pill when the target has not yet
//     acknowledged an ack-required doc.
//   * Details dialog opens with `canUpdate={false}` — the admin is
//     checking on the employee's status, not editing the org doc
//     from here. Full HR panels stay visible for coverage / expiry /
//     verify.
//   * No SSR pre-load; fetch on mount (same pattern as
//     <MyDocumentsCard>).

import { useCallback, useEffect, useState } from "react";
import { FileText, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { DocumentDetailsDialog } from "@/components/documents/document-details-dialog";
import {
  getOrgDocumentsForMember,
  setMemberOrgDocumentVisibility,
  type OrgDocumentRowForMember,
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

export function MemberOrgDocumentsList({
  memberId,
  // memberName retained for the future empty-state prompt / audit
  // context; not surfaced anywhere on-screen today, but keeps the
  // component's props aligned with the sibling MyOrgDocumentsList.
  memberName: _memberName,
}: {
  /** The target member id — used for the fetch and the event-bus key. */
  memberId: string;
  /** Target member's display name — currently unused, reserved for
   *  future empty-state / audit copy. */
  memberName: string;
}) {
  const [rows, setRows] = useState<OrgDocumentRowForMember[]>([]);
  // CLE-224 follow-up — initial vs. background refresh. The spinner
  // shows only for the very first mount; subsequent refreshes (event
  // bus fires, optimistic-toggle post-hoc syncs) happen silently so
  // the grid never disappears mid-interaction.
  const [initialLoaded, setInitialLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detailsDocId, setDetailsDocId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const res = await getOrgDocumentsForMember(memberId);
    if (!res.success) { setError(res.error ?? "Failed to load"); setInitialLoaded(true); return; }
    setRows(res.rows);
    setInitialLoaded(true);
  }, [memberId]);

  useEffect(() => { void load(); }, [load]);

  // Refresh on the shared bus keyed on the target's memberId so future
  // HR-ack-on-behalf flows or other sibling surfaces can trigger a
  // silent refetch. Runs without setting loading=true, so the grid
  // stays visible throughout.
  useEffect(() => onMemberDocsChanged(memberId, () => { void load(); }), [memberId, load]);

  // CLE-224 — optimistic toggle for the Viewable column. Flips local
  // state first, fires the server action, reverts on failure. We
  // deliberately do NOT dispatch `member-docs-changed` from this
  // handler — the local state already reflects the change, and firing
  // the bus would trigger our own listener above (silent now, but
  // still an unnecessary round-trip). Sibling surfaces that need to
  // react to visibility changes should subscribe to a distinct event
  // if that becomes a real need.
  const toggleViewable = useCallback(
    async (documentId: string, next: boolean) => {
      setRows((prev) => prev.map((r) => (r.id === documentId ? { ...r, viewable: next } : r)));
      setError(null);
      const res = await setMemberOrgDocumentVisibility(memberId, documentId, next);
      if (!res.success) {
        setError(res.error ?? "Failed to update visibility");
        setRows((prev) => prev.map((r) => (r.id === documentId ? { ...r, viewable: !next } : r)));
      }
    },
    [memberId],
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Organisation documents</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {error && (
          <div className="rounded-md bg-destructive/10 p-2 text-sm text-destructive">{error}</div>
        )}
        {!initialLoaded ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No organisation documents yet.
          </p>
        ) : (
          <div className="overflow-hidden rounded-md border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                  {/* CLE-224 — Viewable toggle. Real interactive
                      Checkbox (not a display icon), so the
                      Boolean-values-in-tables convention doesn't
                      apply here. Unchecked hides the doc from the
                      target's `/my-documents` view and drops the
                      pair out of ack coverage denominators. */}
                  <th className="px-3 py-2 font-medium w-24">Viewable</th>
                  <th className="px-3 py-2 font-medium">Document</th>
                  <th className="px-3 py-2 font-medium hidden lg:table-cell">Expires</th>
                  <th className="px-3 py-2 font-medium hidden lg:table-cell">Uploaded</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.id}
                    className={`cursor-pointer border-b last:border-b-0 hover:bg-muted/30 ${
                      r.viewable ? "" : "opacity-60"
                    }`}
                    onClick={() => setDetailsDocId(r.id)}
                    title="Open document details"
                  >
                    <td
                      className="px-3 py-2"
                      // CLE-224 — swallow the row-level click so
                      // toggling the checkbox doesn't also open the
                      // details dialog.
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Checkbox
                        checked={r.viewable}
                        aria-label={
                          r.viewable
                            ? "Hide this document from the employee"
                            : "Make this document visible to the employee"
                        }
                        onCheckedChange={(next) => {
                          void toggleViewable(r.id, next === true);
                        }}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-start gap-2 min-w-0">
                        <FileText className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="font-medium">
                              {r.subtypeName ?? <span className="text-muted-foreground">—</span>}
                            </p>
                            {/* CLE-223 — "Awaiting Ack" pill: the
                                doc requires acknowledgement AND the
                                target member has not yet acked it.
                                Distinct copy from the employee's
                                "Please Ack" since the admin isn't
                                the one who owes the ack.
                                CLE-224 — Suppress the pill when the
                                doc is hidden from this employee: an
                                ack that isn't expected shouldn't
                                read as "awaited". */}
                            {r.viewable && r.requiresAcknowledgement && !r.isAcknowledgedByTarget && (
                              <span className="inline-block rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
                                Awaiting Ack
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
        // CLE-223 — Admin viewing employee's org-doc coverage. Full
        // HR panels (Expiry / Verify / Review / Activity) stay
        // visible so the admin can drill down, but `canUpdate=false`
        // stops accidental edits from a per-member surface. Org-doc
        // edits belong on /documents/organisation.
        <DocumentDetailsDialog
          documentId={detailsDocId}
          canUpdate={false}
          onClose={() => setDetailsDocId(null)}
          onSaved={load}
        />
      )}
    </Card>
  );
}
