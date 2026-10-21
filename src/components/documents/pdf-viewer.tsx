"use client";

// ClearHR's own PDF viewer. Renders each page to a <canvas> with pdf.js
// so every browser shows the same read-only viewer with only viewing
// controls (page, zoom, print, download). Replaces the browser's
// built-in PDF viewer (iframe), whose toolbar varied by browser and in
// Edge offered drawing / highlight / add-text / add-image tools.
//
// - pdf.js worker is served from /pdf.worker.min.mjs (copied from
//   node_modules by scripts/copy-pdf-worker.mjs on postinstall).
// - pdf.js v6 no longer evaluates code from a PDF (eval support removed).
// - No text layer and no annotation editing: pages are pictures.
// - Signed URLs are fetched directly by pdf.js (Supabase storage serves
//   CORS headers). The URL is never exposed in the UI.

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Download, Loader2, Maximize2, Minus, Plus, Printer } from "lucide-react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { cn } from "@/lib/utils";

const ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];

type PdfJs = typeof import("pdfjs-dist");
let pdfjsPromise: Promise<PdfJs> | null = null;
function loadPdfJs(): Promise<PdfJs> {
  if (!pdfjsPromise) {
    pdfjsPromise = import("pdfjs-dist").then((m) => {
      m.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
      return m;
    });
  }
  return pdfjsPromise;
}

/** Print a PDF without showing the browser's PDF viewer UI: fetch the
 *  bytes, load them into a hidden iframe, and open the print dialog. */
export async function printPdfFromUrl(url: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new Error("Could not load the document for printing");
  printPdfBytes(await res.arrayBuffer());
}

function printPdfBytes(bytes: ArrayBuffer | Uint8Array): void {
  const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
  const objectUrl = URL.createObjectURL(blob);
  const iframe = document.createElement("iframe");
  iframe.style.position = "fixed";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "0";
  iframe.style.opacity = "0";
  iframe.src = objectUrl;
  iframe.onload = () => {
    try {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
    } finally {
      // Leave time for the print dialog to take its copy.
      setTimeout(() => {
        iframe.remove();
        URL.revokeObjectURL(objectUrl);
      }, 60_000);
    }
  };
  document.body.appendChild(iframe);
}

export function PdfViewer({
  url,
  fileName,
  onDownload,
  showPrint = true,
  className,
}: {
  /** Short-lived signed URL of the PDF. */
  url: string;
  fileName: string;
  /** When given, a Download button appears in the toolbar. */
  onDownload?: () => void;
  showPrint?: boolean;
  className?: string;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const pageRefs = useRef<(HTMLCanvasElement | null)[]>([]);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  /** null = fit to width; otherwise a fixed zoom factor. */
  const [zoom, setZoom] = useState<number | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [fitScale, setFitScale] = useState(1);
  const [printing, setPrinting] = useState(false);

  // Load the document.
  useEffect(() => {
    let cancelled = false;
    let task: { destroy: () => Promise<void> } | null = null;
    setDoc(null);
    setError(null);
    setNumPages(0);
    setCurrentPage(1);
    (async () => {
      try {
        const pdfjs = await loadPdfJs();
        const loadingTask = pdfjs.getDocument({ url });
        task = loadingTask;
        const loaded = await loadingTask.promise;
        if (cancelled) return;
        setDoc(loaded);
        setNumPages(loaded.numPages);
      } catch {
        if (!cancelled) setError("This PDF couldn't be displayed. Use Download to open it instead.");
      }
    })();
    return () => {
      cancelled = true;
      if (task) void task.destroy();
    };
  }, [url]);

  // Track the available width for fit-to-width.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setContainerWidth(el.clientWidth));
    ro.observe(el);
    setContainerWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  // Render every page whenever the document, width or zoom changes.
  useEffect(() => {
    if (!doc || containerWidth === 0) return;
    let cancelled = false;
    const tasks: { cancel: () => void }[] = [];
    (async () => {
      const first = await doc.getPage(1);
      const base = first.getViewport({ scale: 1 });
      const fit = Math.max(0.1, (containerWidth - 32) / base.width);
      if (cancelled) return;
      setFitScale(fit);
      const scale = zoom ?? fit;
      const dpr = window.devicePixelRatio || 1;
      for (let i = 1; i <= doc.numPages; i++) {
        if (cancelled) return;
        const page = i === 1 ? first : await doc.getPage(i);
        const canvas = pageRefs.current[i - 1];
        if (!canvas) continue;
        const viewport = page.getViewport({ scale: scale * dpr });
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        canvas.style.width = `${Math.floor(viewport.width / dpr)}px`;
        canvas.style.height = `${Math.floor(viewport.height / dpr)}px`;
        const task = page.render({ canvas, viewport });
        tasks.push(task);
        try {
          await task.promise;
        } catch {
          // Cancelled by a newer render — ignore.
        }
      }
    })();
    return () => {
      cancelled = true;
      tasks.forEach((t) => t.cancel());
    };
  }, [doc, containerWidth, zoom]);

  // Current page = the page nearest the top of the scroll area.
  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const top = el.scrollTop + 8;
    let page = 1;
    pageRefs.current.forEach((c, i) => {
      if (c && c.offsetTop <= top + c.clientHeight / 2) page = i + 1;
    });
    setCurrentPage(page);
  }, []);

  function goToPage(p: number) {
    const target = Math.min(Math.max(1, p), numPages);
    const canvas = pageRefs.current[target - 1];
    const el = scrollRef.current;
    if (canvas && el) el.scrollTo({ top: canvas.offsetTop - 8, behavior: "smooth" });
  }

  const effective = zoom ?? fitScale;
  function zoomBy(direction: 1 | -1) {
    const next = direction === 1
      ? ZOOM_STEPS.find((z) => z > effective + 0.001)
      : [...ZOOM_STEPS].reverse().find((z) => z < effective - 0.001);
    if (next !== undefined) setZoom(next);
  }

  async function handlePrint() {
    if (!doc) return;
    setPrinting(true);
    try {
      printPdfBytes(await doc.getData());
    } finally {
      setPrinting(false);
    }
  }

  const btn =
    "inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40";

  return (
    <div className={cn("flex h-full w-full min-w-0 flex-col", className)}>
      {/* Viewing controls only — no editing tools. */}
      <div className="flex shrink-0 flex-wrap items-center gap-1 border-b bg-background/95 px-2 py-1 text-xs">
        <button type="button" className={btn} onClick={() => goToPage(currentPage - 1)} disabled={!doc || currentPage <= 1} aria-label="Previous page" title="Previous page">
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="min-w-[4.5rem] text-center tabular-nums text-muted-foreground">
          {numPages > 0 ? `${currentPage} / ${numPages}` : "–"}
        </span>
        <button type="button" className={btn} onClick={() => goToPage(currentPage + 1)} disabled={!doc || currentPage >= numPages} aria-label="Next page" title="Next page">
          <ChevronRight className="h-4 w-4" />
        </button>
        <span className="mx-1 h-4 w-px bg-border" aria-hidden />
        <button type="button" className={btn} onClick={() => zoomBy(-1)} disabled={!doc} aria-label="Zoom out" title="Zoom out">
          <Minus className="h-4 w-4" />
        </button>
        <span className="min-w-[3rem] text-center tabular-nums text-muted-foreground">{Math.round(effective * 100)}%</span>
        <button type="button" className={btn} onClick={() => zoomBy(1)} disabled={!doc} aria-label="Zoom in" title="Zoom in">
          <Plus className="h-4 w-4" />
        </button>
        <button type="button" className={btn} onClick={() => setZoom(null)} disabled={!doc || zoom === null} aria-label="Fit to width" title="Fit to width">
          <Maximize2 className="h-4 w-4" />
        </button>
        <span className="ml-auto" />
        {showPrint && (
          <button type="button" className={btn} onClick={() => void handlePrint()} disabled={!doc || printing} aria-label="Print" title="Print">
            {printing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />}
          </button>
        )}
        {onDownload && (
          <button type="button" className={btn} onClick={onDownload} aria-label="Download" title="Download">
            <Download className="h-4 w-4" />
          </button>
        )}
      </div>

      <div
        ref={scrollRef}
        onScroll={onScroll}
        onContextMenu={(e) => e.preventDefault()}
        className="min-h-0 flex-1 overflow-auto bg-muted/40"
        aria-label={fileName}
      >
        {error ? (
          <p className="p-6 text-center text-sm text-muted-foreground">{error}</p>
        ) : !doc ? (
          <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading document…
          </div>
        ) : (
          <div className="flex w-max min-w-full flex-col items-center gap-3 p-4">
            {Array.from({ length: numPages }, (_, i) => (
              <canvas
                key={i}
                ref={(el) => { pageRefs.current[i] = el; }}
                className="bg-white shadow-sm"
                aria-label={`Page ${i + 1}`}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
