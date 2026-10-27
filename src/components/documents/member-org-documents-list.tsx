"use client";

// CLE-224 — Admin view of the org-documents list scoped to a specific
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

import { useMemberLabel } from "@/contexts/member-label-context";
import { capitalize } from "@/lib/label-utils";
import { sortDocs } from "@/lib/document-sort";
import { docTabCard, type DocTabKey } from "@/components/documents/doc-tab-theme";
import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DocumentDetailsDialog } from "@/components/documents/document-details-dialog";
import {
  getOrgDocumentsForMember,
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
  tone,
  memberId,
  // memberName retained for the future empty-state prompt / audit
  // context; not surfaced anywhere on-screen today, but keeps the
  // component's props aligned with the sibling MyOrgDocumentsList.
  memberName: _memberName,
}: {
  /** Colour-keys the card header to its Documents tab (doc-tab-theme). */
  tone?: DocTabKey;
  /** The target member id — used for the fetch and the event-bus key. */
  memberId: string;
  /** Target member's display name — currently unused, reserved for
   *  future empty-state / audit copy. */
  memberName: string;
}) {
  const toneCls = docTabCard(tone);
  const { memberLabel } = useMemberLabel();
  const [rows, setRows] = useState<OrgDocumentRowForMember[]>([]);
  // CLE-225 follow-up — initial vs. background refresh. The spinner
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
    // CLE-230 — per-document audience replaces the per-member Viewable
    // checkbox. This tab shows exactly the org docs the member can see.
    setRows(res.rows.filter((r) => r.viewable));
    setInitialLoaded(true);
  }, [memberId]);

  useEffect(() => { void load(); }, [load]);

  // Refresh on the shared bus keyed on the target's memberId so future
  // HR-ack-on-behalf flows or other sibling surfaces can trigger a
  // silent refetch. Runs without setting loading=true, so the grid
  // stays visible throughout.
  useEffect(() => onMemberDocsChanged(memberId, () => { void load(); }), [memberId, load]);

  return (
    <Card className={toneCls.card}>
      <CardHeader className={toneCls.header}>
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
                  <th className="px-3 py-2 font-medium">Document</th>
                  <th className="px-3 py-2 font-medium hidden lg:table-cell">Expires</th>
                  <th className="px-3 py-2 font-medium hidden lg:table-cell">Uploaded</th>
                  <th className="px-3 py-2 font-medium hidden lg:table-cell">{capitalize(memberLabel)} viewed</th>
                </tr>
              </thead>
              <tbody>
                {sortDocs(rows, (r) => ({ type: r.type, subtypeName: r.subtypeName, fileName: r.fileName })).map((r) => (
                  <tr
                    key={r.id}
                    className="cursor-pointer border-b last:border-b-0 hover:bg-muted/30"
                    onClick={() => setDetailsDocId(r.id)}
                  >
                    <td className="px-3 py-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-medium">
                            {r.subtypeName ?? <span className="text-muted-foreground">—</span>}
                          </p>
                          {/* CLE-224 — "Awaiting Ack" pill: the
                              doc requires acknowledgement AND the
                              target member has not yet acked it.
                              Distinct copy from the employee's
                              "Please Ack" since the admin isn't
                              the one who owes the ack.
                              CLE-225 — Suppress the pill when the
                              doc is hidden from this employee: an
                              ack that isn't expected shouldn't
                              read as "awaited". */}
                          {r.requiresAcknowledgement && r.expectedByTarget && !r.isAcknowledgedByTarget && (
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
                    </td>
                    <td className="px-3 py-2 text-muted-foreground hidden lg:table-cell">{fmtDate(r.expiresOn)}</td>
                    <td className="px-3 py-2 text-muted-foreground hidden lg:table-cell">{fmtDateTime(r.uploadedAt)}</td>
                    <td className="px-3 py-2 text-muted-foreground hidden lg:table-cell">
                      {r.memberViewedAt ? fmtDateTime(r.memberViewedAt) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>

      {detailsDocId && (
        // CLE-224 — Admin viewing employee's org-doc coverage. Full
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
