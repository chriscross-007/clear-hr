"use client";

// CLE-214 — "New document" surface. Renders the same wide-layout
// shell as DocumentDetailsDialog (1200px, header, 2-pane body) but
// with new-doc content: a subtype picker in the header + Upload/
// Photo CTAs in the middle of the preview pane. On successful upload
// (either path) the dialog closes and the caller hands over to
// DocumentDetailsDialog at the new documentId, so from the user's
// perspective the dialog "gets a file" without a visible jump.

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Camera, FileUp, Loader2, Pencil, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { createClient as createSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  getSubtypesForUpload,
  uploadMemberDocument,
} from "@/app/(dashboard)/members/[memberId]/docs/document-actions";
import {
  queueCaptureTask,
  cancelCaptureTask,
} from "@/app/(dashboard)/members/[memberId]/docs/capture-actions";

const TYPE_LABEL: Record<string, string> = {
  contract: "Contract",
  certificate: "Certificate",
  evidence: "Evidence",
  attachment: "Attachment",
};

interface UploadSubtype {
  id: string;
  type: string;
  name: string;
  retentionClass: string;
  expiryRequired: boolean;
  defaultExpiryMonths: number | null;
  employeeCanUpload: boolean;
}

interface Props {
  memberId: string;
  memberName: string;
  /** When set, the header locks the subtype picker to this subtype.
   *  Used by the Required Documents card so clicking a not_uploaded
   *  row skips the subtype-picking step. */
  presetSubtypeId?: string | null;
  onClose: () => void;
  /** Fires with the new document's id once upload/photo lands. The
   *  caller closes this dialog and typically opens
   *  DocumentDetailsDialog(newId) in the same tick so the transition
   *  looks like the same dialog gaining a file. */
  onCreated: (documentId: string) => void | Promise<void>;
}

export function NewMemberDocumentDialog({
  memberId,
  memberName,
  presetSubtypeId = null,
  onClose,
  onCreated,
}: Props) {
  const [subtypes, setSubtypes] = useState<UploadSubtype[]>([]);
  const [subtypeId, setSubtypeId] = useState<string>(presetSubtypeId ?? "");
  const [subtypeError, setSubtypeError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [mode, setMode] = useState<"form" | "waiting">("form");
  const [captureTaskId, setCaptureTaskId] = useState<string | null>(null);
  const [subtypePickerOpen, setSubtypePickerOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Load subtypes on mount.
  useEffect(() => {
    (async () => {
      const res = await getSubtypesForUpload(memberId);
      if (res.success) setSubtypes(res.subtypes);
      else setSubtypeError(res.error ?? "Failed to load subtypes");
    })();
  }, [memberId]);

  const currentSubtype = useMemo(
    () => subtypes.find((s) => s.id === subtypeId) ?? null,
    [subtypeId, subtypes],
  );

  const grouped = useMemo(() => {
    return subtypes.reduce<Record<string, UploadSubtype[]>>((acc, s) => {
      (acc[s.type] ??= []).push(s);
      return acc;
    }, {});
  }, [subtypes]);

  // Realtime subscription on the queued capture task. Fires when the
  // mobile app uploads (status='uploaded' + uploaded_document_id set),
  // cancels, or the timeout sweep flips it. Poll every 3s as a
  // belt-and-braces fallback for edge cases where Realtime + RLS
  // don't deliver.
  const onCreatedRef = useRef(onCreated);
  onCreatedRef.current = onCreated;

  useEffect(() => {
    if (mode !== "waiting" || !captureTaskId) return;
    const supabase = createSupabaseBrowserClient();
    let cancelled = false;

    async function fetchTaskAndProgress() {
      const { data } = await supabase
        .from("capture_task")
        .select("status, uploaded_document_id")
        .eq("id", captureTaskId)
        .single();
      if (cancelled || !data) return;
      handleStatus(
        data.status as string,
        (data as { uploaded_document_id?: string | null }).uploaded_document_id ?? null,
      );
    }

    function handleStatus(status: string, uploadedDocumentId: string | null) {
      if (cancelled) return;
      if (status === "uploaded" && uploadedDocumentId) {
        // Hand over to the caller — they'll close us and open the
        // full details dialog at the new id.
        void onCreatedRef.current(uploadedDocumentId);
      } else if (status === "cancelled") {
        onClose();
      } else if (status === "timeout") {
        setMode("form");
        setCaptureTaskId(null);
        setError("This request timed out. Try again when you're ready to take the photo.");
      }
    }

    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.access_token) supabase.realtime.setAuth(session.access_token);
    })();

    const channel = supabase
      .channel(`capture_task:${captureTaskId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "capture_task",
          filter: `id=eq.${captureTaskId}`,
        },
        (payload) => {
          const row = payload.new as {
            status?: string;
            uploaded_document_id?: string | null;
          } | null;
          if (row?.status) handleStatus(row.status, row.uploaded_document_id ?? null);
        },
      )
      .subscribe();

    const pollInterval = setInterval(() => {
      if (!cancelled) void fetchTaskAndProgress();
    }, 3000);

    return () => {
      cancelled = true;
      clearInterval(pollInterval);
      void supabase.removeChannel(channel);
    };
  }, [mode, captureTaskId, onClose]);

  // If the user closes the dialog while a task is pending, cancel it
  // server-side so it doesn't hang around on the mobile pending list.
  useEffect(() => {
    return () => {
      if (captureTaskId && mode === "waiting") {
        void cancelCaptureTask(captureTaskId);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleUploadClick() {
    if (!subtypeId) { setError("Choose a subtype first."); return; }
    setError(null);
    fileInputRef.current?.click();
  }

  function handleFileChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const chosen = e.target.files?.[0] ?? null;
    e.target.value = "";
    if (!chosen) return;
    setError(null);
    const fd = new FormData();
    fd.set("file", chosen);
    fd.set("subtypeId", subtypeId);
    startTransition(async () => {
      const res = await uploadMemberDocument(memberId, fd);
      if (!res.success || !res.documentId) {
        setError(res.error ?? "Upload failed");
        return;
      }
      await onCreated(res.documentId);
    });
  }

  function handlePhoto() {
    if (!subtypeId) { setError("Choose a subtype first."); return; }
    setError(null);
    startTransition(async () => {
      const res = await queueCaptureTask(memberId, subtypeId, null, null);
      if (!res.success) { setError(res.error); return; }
      setCaptureTaskId(res.taskId);
      setMode("waiting");
    });
  }

  async function handleWaitingCancel() {
    if (captureTaskId) await cancelCaptureTask(captureTaskId);
    onClose();
  }

  const subtypeLocked = presetSubtypeId !== null && presetSubtypeId !== undefined;

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent
        className="max-w-none sm:max-w-none p-0 gap-0"
        style={{ width: "min(1200px, 95vw)" }}
      >
        <DialogHeader className="border-b p-5 space-y-2 text-center sm:text-center">
          {/* Row 1: Member + subtype (locked or picker) */}
          <DialogTitle className="text-xl flex items-center justify-center gap-2">
            <span>{memberName}</span>
            <span className="text-muted-foreground">·</span>
            {currentSubtype ? (
              <span>
                {TYPE_LABEL[currentSubtype.type] ?? currentSubtype.type}
                <span className="text-muted-foreground"> / {currentSubtype.name}</span>
              </span>
            ) : (
              <span className="text-muted-foreground italic">Choose a subtype</span>
            )}
            {!subtypeLocked && (
              <Popover open={subtypePickerOpen} onOpenChange={setSubtypePickerOpen}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    aria-label="Choose subtype"
                    title="Choose subtype"
                    className="inline-flex items-center rounded p-1 text-muted-foreground hover:bg-muted"
                  >
                    <Pencil className="h-3 w-3" />
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-80 space-y-2">
                  <p className="text-sm font-medium">Choose a subtype</p>
                  {subtypeError && (
                    <div className="rounded-md bg-destructive/10 p-2 text-xs text-destructive">{subtypeError}</div>
                  )}
                  <div className="space-y-1">
                    <Label className="text-xs">Subtype</Label>
                    <Select
                      value={subtypeId}
                      onValueChange={(v) => { setSubtypeId(v); setSubtypePickerOpen(false); }}
                    >
                      <SelectTrigger><SelectValue placeholder="Choose a subtype…" /></SelectTrigger>
                      <SelectContent>
                        {Object.entries(grouped).map(([type, list]) => (
                          <SelectGroup key={type}>
                            <SelectLabel className="text-[10px] font-semibold uppercase text-muted-foreground">
                              {TYPE_LABEL[type] ?? type}
                            </SelectLabel>
                            {list.map((s) => (
                              <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                            ))}
                          </SelectGroup>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </PopoverContent>
              </Popover>
            )}
          </DialogTitle>

          {/* Row 2: Filename placeholder */}
          <p className="text-xs text-muted-foreground truncate text-center">
            Not yet uploaded
          </p>

          {/* Row 3: single "New" pill so the row is visually consistent
              with the existing-doc layout */}
          <div className="flex flex-wrap justify-center gap-1">
            <span className="inline-block rounded-full bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-800 dark:bg-sky-900/30 dark:text-sky-300">
              New
            </span>
          </div>
        </DialogHeader>

        {/* Body — 50/50 like the existing dialog */}
        <div className="grid grid-cols-2 gap-0" style={{ height: "min(70vh, 620px)" }}>
          {/* Left pane — Upload / Photo CTAs or waiting spinner */}
          <div className="flex flex-col items-center justify-center gap-4 overflow-hidden border-r bg-muted/20 p-6 pb-4">
            {error && (
              <div className="w-full rounded-md bg-destructive/10 p-2 text-sm text-destructive">{error}</div>
            )}
            {mode === "waiting" ? (
              <div className="flex flex-col items-center gap-3 rounded-md border bg-background p-6 text-center">
                <Smartphone className="h-10 w-10 text-muted-foreground" />
                <p className="text-sm">
                  Take a photo of <strong>{memberName}</strong>&apos;s{" "}
                  <strong>{currentSubtype?.name ?? "document"}</strong>
                </p>
                <p className="text-xs text-muted-foreground">
                  Open ClearHR on your phone — the capture task is at the top of the app.
                </p>
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                <Button variant="outline" size="sm" onClick={handleWaitingCancel}>
                  Cancel
                </Button>
              </div>
            ) : (
              <>
                <p className="text-sm text-muted-foreground text-center max-w-xs">
                  {subtypeId
                    ? "Upload a file from this computer, or take a photo on your phone."
                    : "Choose a subtype above, then upload or take a photo."}
                </p>
                <div className="flex items-center gap-3">
                  <Button
                    type="button"
                    size="lg"
                    variant="outline"
                    onClick={handleUploadClick}
                    disabled={!subtypeId || pending}
                    className="flex-col h-24 w-32 gap-1"
                  >
                    <FileUp className="h-6 w-6" />
                    <span>Upload</span>
                  </Button>
                  <Button
                    type="button"
                    size="lg"
                    variant="outline"
                    onClick={handlePhoto}
                    disabled={!subtypeId || pending}
                    className="flex-col h-24 w-32 gap-1"
                  >
                    <Camera className="h-6 w-6" />
                    <span>Photo</span>
                  </Button>
                </div>
                {pending && (
                  <p className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" /> Working…
                  </p>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/plain"
                  className="hidden"
                  onChange={handleFileChosen}
                />
              </>
            )}
          </div>

          {/* Right pane — same section skeleton as the details dialog,
              rendered disabled so the layout is consistent when the
              file lands. Once upload succeeds the caller swaps this
              whole dialog for DocumentDetailsDialog(newId) and the
              disabled placeholders become live. */}
          <div className="flex flex-col overflow-hidden">
            <DisabledSection title="Expiry" hint="Set after upload" />
            <DisabledSection title="Verify" hint="Available after upload" />
            <DisabledSection title="Review" hint="Available after upload" />
            <div className="flex-1 overflow-hidden p-4 flex flex-col min-h-0">
              <p className="text-base font-semibold">Activity</p>
              <p className="mt-2 text-xs text-muted-foreground">
                Nothing recorded yet — the document will appear here once uploaded.
              </p>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function DisabledSection({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="border-b p-4 opacity-50">
      <p className="text-base font-semibold">{title}</p>
      <p className="mt-1 text-sm text-muted-foreground">{hint}</p>
    </div>
  );
}
