"use client";

// CLE-221 — Sibling of `<MyDocumentsCard>`. Renders every member-scope
// document the caller owns that is NOT already surfaced by the
// required-docs card (see server action `getMyOtherMemberDocuments`
// for the exact inclusion rule).
//
// Strictly informational — no "+ Add" affordance, no RTW aggregate,
// no not-uploaded placeholder rows. A row click opens the shared
// Document Details dialog in the same read-only mode the required
// card uses (`canUpdate={false} hideActivity hideHrMetadata`), which
// still leaves the Acknowledge button visible for ack-required docs
// the caller hasn't yet acked.
//
// Refresh path: listens on the shared member-docs event bus keyed on
// the caller's memberId — the same signal the sidebar avatar traffic
// light and the required-docs card use, so an upload / replace / ack
// anywhere on the page reloads this list without a router hop.

import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { STATUS_LABEL, STATUS_TONE, type DocumentStatus } from "@/lib/document-status";
import { fmtBytes } from "@/lib/format-bytes";
import { DocumentDetailsDialog } from "@/components/documents/document-details-dialog";
import {
  getMyOtherMemberDocuments,
  type OtherMemberDocumentRow,
} from "@/app/(dashboard)/my-documents/actions";
import { onMemberDocsChanged } from "@/lib/member-docs-events";

// Mirrors the required card's TYPE_LABEL map so the two lists read
// with the same vocabulary. RTW evidence is excluded upstream so
// there's no "evidence" branch here.
const TYPE_LABEL: Record<string, string> = {
  contract: "Contract",
  certificate: "Certificate",
  attachment: "Attachment",
};

function subtypeLabel(type: string, name: string): string {
  const t = TYPE_LABEL[type] ?? type;
  return `${t} / ${name}`;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  // Date-only column — force UTC so a UK caller doesn't see the
  // rendered date jitter by a day around midnight.
  return new Date(iso + "T00:00:00Z").toLocaleDateString("en-GB", {
    day: "2-digit", month: "short", year: "numeric", timeZone: "UTC",
  });
}


export function MyOtherDocumentsCard({
  memberId,
}: {
  /** The caller's own member id — resolved by the parent server
   *  component. Used only as the key for the docs-changed event bus;
   *  the server action itself resolves the caller. */
  memberId: string;
}) {
  const [rows, setRows] = useState<OtherMemberDocumentRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [detailsDocId, setDetailsDocId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const res = await getMyOtherMemberDocuments();
    if (!res.success) { setError(res.error); return; }
    setRows(res.rows);
  }, []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    return onMemberDocsChanged(memberId, () => { void load(); });
  }, [memberId, load]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">My other documents</CardTitle>
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
          <p className="text-sm text-muted-foreground">No other documents uploaded for you.</p>
        ) : (
          <div className="overflow-hidden rounded-md border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                  <th className="px-3 py-2 font-medium">Document</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium hidden md:table-cell">Verified</th>
                  <th className="px-3 py-2 font-medium hidden md:table-cell">Expires</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.documentId}
                    className="border-b last:border-b-0 cursor-pointer hover:bg-muted/30"
                    onClick={() => setDetailsDocId(r.documentId)}
                    title="Open document details"
                  >
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-medium">{subtypeLabel(r.subtypeType, r.subtypeName)}</p>
                        {/* CLE-221 — "Please Ack" pill. Mirrors the
                            visual on the required-docs card. Renders
                            only when the subtype requires ack AND the
                            caller hasn't yet acked this doc. */}
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
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1">
                        {r.statuses.map((s) => (
                          <span
                            key={s}
                            className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_TONE[s as DocumentStatus].className}`}
                          >
                            {STATUS_LABEL[s as DocumentStatus]}
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
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>

      {detailsDocId && (
        // Same employee-view invocation the required card uses:
        // `canUpdate=false` strips the pencils, `hideActivity` drops
        // the Activity feed, `hideHrMetadata` hides Expiry / Verify /
        // Review / Replace. Download + preview + Acknowledge stay
        // visible so the caller can still tick off any outstanding ack.
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
