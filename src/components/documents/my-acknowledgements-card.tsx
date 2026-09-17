"use client";

// CLE-219 — Outstanding-acknowledgement card for the /my-documents
// page. Lists every doc the caller must click "I have read and
// understood" on. Rows open the Document Details dialog in employee-
// view mode (readOnly false so the ack button renders, hideActivity
// true so the internal audit chatter stays hidden from the employee).
//
// Refreshes on `clearhr:member-docs-changed` events so the list
// decrements immediately after the caller acks a doc — the details
// dialog fires that event via `notifySaved` / the ack handler's
// dispatchMemberDocsChanged call.

import { useCallback, useEffect, useState } from "react";
import { CheckSquare, FileText, Loader2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  getMyOutstandingAcknowledgements,
  type OutstandingAcknowledgement,
} from "@/app/(dashboard)/documents/acknowledgement-actions";
import { DocumentDetailsDialog } from "@/components/documents/document-details-dialog";
import { onMemberDocsChanged } from "@/lib/member-docs-events";

const TYPE_LABEL: Record<string, string> = {
  contract: "Contract",
  certificate: "Certificate",
  evidence: "RTW Evidence",
  attachment: "Attachment",
  organisation_document: "Organisation Document",
};

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "2-digit", month: "short", year: "numeric", timeZone: "UTC",
  });
}

export function MyAcknowledgementsCard({
  memberId,
}: {
  memberId: string;
}) {
  const [rows, setRows] = useState<OutstandingAcknowledgement[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openDocId, setOpenDocId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const res = await getMyOutstandingAcknowledgements();
    if (!res.success) { setError(res.error); return; }
    setRows(res.rows);
  }, []);

  useEffect(() => { void load(); }, [load]);

  // Refresh when the caller acks a doc (or any doc-mutating action on
  // their record fires the same event). Listener is per-member; the
  // dialog dispatches with the target member id, which for a self-
  // scope acknowledgement matches `memberId` here.
  useEffect(() => onMemberDocsChanged(memberId, () => { void load(); }), [memberId, load]);

  if (rows === null && !error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Documents to acknowledge</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" /> Loading…
          </p>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Documents to acknowledge</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-destructive">{error}</p>
        </CardContent>
      </Card>
    );
  }

  // Zero outstanding — show a compact "all clear" panel. The
  // /my-documents page can also hide this card entirely; for now
  // renders it so the count is honest either way.
  if (!rows || rows.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <CheckSquare className="h-4 w-4 text-green-600" /> Documents to acknowledge
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Nothing to acknowledge right now.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <CheckSquare className="h-4 w-4 text-amber-600" />
            Documents to acknowledge
            <span className="ml-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
              {rows.length}
            </span>
          </CardTitle>
          <CardDescription>
            Click a row to open the document and confirm you have read it.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {rows.map((r) => (
            <button
              key={r.documentId}
              type="button"
              onClick={() => setOpenDocId(r.documentId)}
              className="flex w-full items-center gap-3 rounded-md border px-3 py-2 text-left transition-colors hover:bg-muted/60"
            >
              <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{r.fileName}</p>
                <p className="text-xs text-muted-foreground">
                  {TYPE_LABEL[r.subtypeType] ?? r.subtypeType} / {r.subtypeName} · added {fmtDate(r.createdAt)}
                </p>
              </div>
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
                Awaiting
              </span>
            </button>
          ))}
        </CardContent>
      </Card>
      {openDocId && (
        <DocumentDetailsDialog
          documentId={openDocId}
          canUpdate={false}
          hideActivity
          onClose={() => setOpenDocId(null)}
          onSaved={async () => { await load(); }}
        />
      )}
    </>
  );
}
