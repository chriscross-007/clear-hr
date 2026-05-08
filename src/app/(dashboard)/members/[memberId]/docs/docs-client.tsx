"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { FileText, Loader2, ExternalLink, CalendarDays } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  getEmployeeDocuments,
  getDocumentDownloadUrl,
  type EmployeeDocument,
} from "@/app/(dashboard)/conversation-actions";
import { StickyPageHeader } from "@/components/ui/sticky-page-header";

// ---------------------------------------------------------------------------
// Human-readable labels
// ---------------------------------------------------------------------------

const CATEGORY_LABELS: Record<string, string> = {
  absence_document: "Absence Document",
};

const LABEL_LABELS: Record<string, string> = {
  self_certification: "Self-Certification",
  medical_certificate: "Medical Certificate",
  fit_note: "Fit Note",
  prescription: "Prescription",
  other: "Other",
};

function fmtCategory(cat: string | null): string {
  if (!cat) return "—";
  return CATEGORY_LABELS[cat] ?? cat.replace(/_/g, " ");
}

function fmtLabel(label: string | null): string {
  if (!label) return "—";
  return LABEL_LABELS[label] ?? label.replace(/_/g, " ");
}

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function fmtFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function DocsClient({ memberId }: { memberId: string }) {
  const router = useRouter();
  const [documents, setDocuments] = useState<EmployeeDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Document viewer
  const [viewerDoc, setViewerDoc] = useState<{
    url: string;
    downloadUrl: string;
    fileName: string;
    contentType: string;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await getEmployeeDocuments(memberId);
      if (cancelled) return;
      if (!res.success) {
        setError(res.error ?? "Could not load documents");
      } else {
        setDocuments(res.documents);
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [memberId]);

  const handleRowClick = useCallback(async (doc: EmployeeDocument) => {
    const res = await getDocumentDownloadUrl(doc.id);
    if (res.success && res.url) {
      setViewerDoc({
        url: res.url,
        downloadUrl: res.downloadUrl ?? res.url,
        fileName: res.fileName ?? doc.fileName,
        contentType: doc.contentType,
      });
    }
  }, []);

  const handleDownload = useCallback(() => {
    if (!viewerDoc) return;
    const a = document.createElement("a");
    a.href = viewerDoc.downloadUrl;
    a.download = viewerDoc.fileName;
    a.rel = "noopener noreferrer";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }, [viewerDoc]);

  return (
    <div className="w-full px-4 py-8 sm:px-6 lg:px-8">
      <StickyPageHeader>
        <h1 className="text-2xl font-bold">Documents</h1>
      </StickyPageHeader>

      {loading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      {!loading && !error && documents.length === 0 && (
        <p className="text-sm text-muted-foreground py-8 text-center">
          No documents yet.
        </p>
      )}

      {!loading && !error && documents.length > 0 && (
        <div className="rounded-md border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50 text-left">
                <th className="px-4 py-2.5 font-medium">File</th>
                <th className="px-4 py-2.5 font-medium hidden sm:table-cell">Category</th>
                <th className="px-4 py-2.5 font-medium hidden md:table-cell">Type</th>
                <th className="px-4 py-2.5 font-medium hidden lg:table-cell">Source</th>
                <th className="px-4 py-2.5 font-medium">Date</th>
                <th className="px-4 py-2.5 font-medium hidden sm:table-cell w-10"></th>
              </tr>
            </thead>
            <tbody>
              {documents.map((doc) => (
                <tr
                  key={doc.id}
                  onClick={() => handleRowClick(doc)}
                  className="border-b last:border-b-0 cursor-pointer hover:bg-muted/50 transition-colors"
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2 min-w-0">
                      <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0">
                        <p className="font-medium truncate">{doc.fileName}</p>
                        <p className="text-xs text-muted-foreground sm:hidden">
                          {fmtCategory(doc.documentCategory)}
                          {doc.documentLabel && ` · ${fmtLabel(doc.documentLabel)}`}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground hidden sm:table-cell">
                    {fmtCategory(doc.documentCategory)}
                  </td>
                  <td className="px-4 py-3 hidden md:table-cell">
                    {doc.documentLabel ? (
                      <span className="inline-block rounded bg-muted px-2 py-0.5 text-xs">
                        {fmtLabel(doc.documentLabel)}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground hidden lg:table-cell">
                    {doc.uploadedBy}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                    {fmtDateTime(doc.createdAt)}
                  </td>
                  <td className="px-4 py-3 hidden sm:table-cell">
                    {doc.entityType === "absence_booking" && doc.entityId && (
                      <button
                        type="button"
                        title="View absence booking"
                        onClick={(e) => {
                          e.stopPropagation();
                          router.push(
                            `/members/${memberId}/calendar?bookingId=${doc.entityId}`
                          );
                        }}
                        className="inline-flex items-center justify-center rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                      >
                        <CalendarDays className="h-4 w-4" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Document viewer dialog */}
      <Dialog open={viewerDoc !== null} onOpenChange={(o) => { if (!o) setViewerDoc(null); }}>
        <DialogContent className="flex max-h-[90vh] max-w-3xl flex-col">
          <DialogHeader className="flex-row items-center justify-between gap-4 space-y-0">
            <DialogTitle className="truncate text-sm font-medium">
              {viewerDoc?.fileName}
            </DialogTitle>
            <div className="flex shrink-0 gap-2">
              <Button variant="outline" size="sm" onClick={handleDownload}>
                <ExternalLink className="mr-1.5 h-4 w-4" />
                Download
              </Button>
            </div>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-auto rounded-md border bg-muted/30">
            {viewerDoc && viewerDoc.contentType.startsWith("image/") && (
              <img
                src={viewerDoc.url}
                alt={viewerDoc.fileName}
                className="mx-auto max-h-[70vh] object-contain"
              />
            )}
            {viewerDoc && !viewerDoc.contentType.startsWith("image/") && (
              <iframe
                src={viewerDoc.url}
                title={viewerDoc.fileName}
                className="h-[70vh] w-full"
              />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
