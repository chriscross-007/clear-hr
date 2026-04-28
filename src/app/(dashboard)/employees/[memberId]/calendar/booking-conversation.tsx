"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Paperclip, SendHorizontal, FileText, X, Loader2, Download, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  getOrCreateBookingConversation,
  getConversationMessages,
  sendConversationMessage,
  uploadDocumentToMessage,
  getDocumentDownloadUrl,
  type ConversationMessage,
} from "../../../conversation-actions";
import { createClient } from "@/lib/supabase/client";

interface BookingConversationProps {
  /** null when the parent is creating a new booking — no conversation exists yet. */
  bookingId: string | null;
  /** Member the booking belongs to (used for document upload metadata). */
  memberId: string;
  /**
   * The viewing user's own member id — messages they authored render as
   * right-aligned blue "mine" bubbles; everyone else renders left-aligned grey.
   * Optional because create-mode shows no thread.
   */
  callerMemberId?: string;
  /** Create-mode hook: called whenever the draft message/files change. */
  onFirstMessageReady?: (message: string, files: File[]) => void;
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diff = Math.max(0, now - then);
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function roleLabel(role: string): string {
  if (role === "owner") return "Owner";
  if (role === "admin") return "Admin";
  return "Employee";
}

function roleClass(role: string): string {
  if (role === "owner" || role === "admin") {
    return "bg-muted text-muted-foreground";
  }
  return "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300";
}

export function BookingConversation({
  bookingId,
  memberId,
  callerMemberId,
  onFirstMessageReady,
}: BookingConversationProps) {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [draft, setDraft] = useState("");
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [sending, setSending] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Document viewer dialog state
  const [viewerDoc, setViewerDoc] = useState<{
    url: string;
    downloadUrl: string;
    fileName: string;
    contentType: string;
  } | null>(null);

  // Edit-mode: load conversation + messages.
  useEffect(() => {
    if (bookingId === null) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      const conv = await getOrCreateBookingConversation(bookingId);
      if (cancelled) return;
      if (!conv.success || !conv.conversationId) {
        setError(conv.error ?? "Could not open conversation");
        setLoading(false);
        return;
      }
      setConversationId(conv.conversationId);
      const res = await getConversationMessages(conv.conversationId);
      if (cancelled) return;
      if (!res.success) {
        setError(res.error ?? "Could not load messages");
      } else {
        setMessages(res.messages ?? []);
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [bookingId]);

  // Realtime: subscribe to new messages AND document attachments.
  // Documents arrive after the message row (the mobile app inserts the message
  // first, then uploads files one-by-one), so we listen on both tables.
  useEffect(() => {
    if (!conversationId || bookingId === null) return;
    const supabase = createClient();
    const channel = supabase
      .channel(`conv-${conversationId}`)
      // --- new messages ---
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "conversation_messages",
          filter: `conversation_id=eq.${conversationId}`,
        },
        async (payload) => {
          const row = payload.new as { id: string; body: string; created_at: string; author_member_id: string };
          // Skip messages we sent (already in the list from optimistic add).
          if (callerMemberId && row.author_member_id === callerMemberId) return;
          // Fetch author info for the incoming message.
          const { data: member } = await supabase
            .from("members")
            .select("id, first_name, last_name, role")
            .eq("id", row.author_member_id)
            .single();
          const msg: ConversationMessage = {
            id: row.id,
            body: row.body,
            createdAt: row.created_at,
            author: {
              memberId: row.author_member_id,
              firstName: member?.first_name ?? "Unknown",
              lastName: member?.last_name ?? "",
              role: member?.role ?? "employee",
            },
            documents: [], // docs arrive separately via the subscription below
          };
          setMessages((prev) => {
            if (prev.some((m) => m.id === msg.id)) return prev;
            return [...prev, msg];
          });
        },
      )
      // --- document attachments landing on any message in this conversation ---
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "member_documents",
        },
        (payload) => {
          const d = payload.new as {
            id: string;
            conversation_message_id: string | null;
            file_name: string;
            content_type: string;
            file_size: number;
          };
          if (!d.conversation_message_id) return;
          const doc = {
            id: d.id,
            fileName: d.file_name,
            contentType: d.content_type,
            fileSize: d.file_size,
          };
          setMessages((prev) =>
            prev.map((m) => {
              if (m.id !== d.conversation_message_id) return m;
              // Skip if already present (e.g. optimistic add from our own send)
              if (m.documents.some((existing) => existing.id === doc.id)) return m;
              return { ...m, documents: [...m.documents, doc] };
            }),
          );
        },
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [conversationId, bookingId, callerMemberId]);

  // Auto-scroll to the bottom whenever the message list changes.
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages.length]);

  // Notify the parent during create-mode. Funnel through a ref so an unstable
  // callback identity from the parent doesn't make this effect re-fire on
  // every render — that race could cause the draft to be lost on submit.
  const onFirstMessageReadyRef = useRef(onFirstMessageReady);
  onFirstMessageReadyRef.current = onFirstMessageReady;
  useEffect(() => {
    if (bookingId === null && onFirstMessageReadyRef.current) {
      onFirstMessageReadyRef.current(draft, pendingFiles);
    }
  }, [bookingId, draft, pendingFiles]);

  const canSend = (draft.trim().length > 0 || pendingFiles.length > 0) && !sending;

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const list = e.target.files;
    if (!list || list.length === 0) return;
    const next: File[] = [];
    for (let i = 0; i < list.length; i++) next.push(list[i]);
    setPendingFiles((prev) => [...prev, ...next]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  const handleRemoveFile = useCallback((idx: number) => {
    setPendingFiles((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  const handleSend = useCallback(async () => {
    if (!conversationId || !canSend) return;
    setSending(true);
    setError(null);
    const body = draft.trim() || "(attachment)";
    const sendRes = await sendConversationMessage(conversationId, body);
    if (!sendRes.success || !sendRes.message) {
      setError(sendRes.error ?? "Could not send message");
      setSending(false);
      return;
    }
    const newMessage: ConversationMessage = sendRes.message;
    // Upload each attachment, accumulating any successfully-stored docs onto
    // the message before we add it to the list.
    for (const file of pendingFiles) {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("conversationMessageId", newMessage.id);
      fd.append("memberId", memberId);
      const upRes = await uploadDocumentToMessage(fd);
      if (upRes.success && upRes.documentId) {
        newMessage.documents.push({
          id: upRes.documentId,
          fileName: file.name,
          contentType: file.type,
          fileSize: file.size,
        });
      }
    }
    setMessages((prev) => [...prev, newMessage]);
    setDraft("");
    setPendingFiles([]);
    setSending(false);
  }, [canSend, conversationId, draft, memberId, pendingFiles]);

  const handleDocClick = useCallback(async (docId: string, fileName?: string, contentType?: string) => {
    const res = await getDocumentDownloadUrl(docId);
    if (res.success && res.url) {
      setViewerDoc({
        url: res.url,
        downloadUrl: res.downloadUrl ?? res.url,
        fileName: res.fileName ?? fileName ?? "document",
        contentType: contentType ?? "application/octet-stream",
      });
    }
  }, []);

  // ===== Create mode (no booking yet — only the input row) =====
  if (bookingId === null) {
    return (
      <div className="space-y-2">
        {pendingFiles.length > 0 && <PendingFileChips files={pendingFiles} onRemove={handleRemoveFile} />}
        <ComposerRow
          value={draft}
          onChange={setDraft}
          placeholder="Add a note for this booking..."
          onAttach={() => fileInputRef.current?.click()}
          onSend={undefined}
          sending={false}
        />
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={handleFileSelect}
        />
      </div>
    );
  }

  // ===== Edit mode (load + render thread + composer) =====
  return (
    <div className="space-y-2">
      {error && <p className="text-xs text-destructive">{error}</p>}

      <div ref={scrollRef} className="flex max-h-60 flex-col gap-3 overflow-y-auto pr-1">
        {loading && (
          <div className="flex items-center justify-center py-3 text-xs text-muted-foreground">
            <Loader2 className="mr-2 h-3 w-3 animate-spin" /> Loading...
          </div>
        )}
        {!loading && messages.length === 0 && (
          <p className="py-2 text-center text-xs text-muted-foreground">
            No messages yet — start the conversation below.
          </p>
        )}
        {messages.map((m) => (
          <MessageRow
            key={m.id}
            message={m}
            onDocClick={handleDocClick}
            isMine={!!callerMemberId && m.author.memberId === callerMemberId}
          />
        ))}
      </div>

      {pendingFiles.length > 0 && <PendingFileChips files={pendingFiles} onRemove={handleRemoveFile} />}

      <ComposerRow
        value={draft}
        onChange={setDraft}
        placeholder="Write a message..."
        onAttach={() => fileInputRef.current?.click()}
        onSend={handleSend}
        sending={sending}
        disabled={!canSend}
      />
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={handleFileSelect}
      />

      {/* Document viewer dialog with download & print */}
      <DocumentViewerDialog doc={viewerDoc} onClose={() => setViewerDoc(null)} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Document viewer — shows the file in a dialog with Download and Print buttons.
// ---------------------------------------------------------------------------
function DocumentViewerDialog({
  doc,
  onClose,
}: {
  doc: { url: string; downloadUrl: string; fileName: string; contentType: string } | null;
  onClose: () => void;
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const isImage = doc?.contentType.startsWith("image/");

  const handlePrint = useCallback(() => {
    if (!doc) return;
    // For images, open a minimal print window
    const printWin = window.open("", "_blank");
    if (!printWin) return;
    if (isImage) {
      printWin.document.write(`
        <html><head><title>${doc.fileName}</title>
        <style>@media print { body { margin: 0; } img { max-width: 100%; height: auto; } }</style>
        </head><body>
        <img src="${doc.url}" onload="window.print();window.close();" />
        </body></html>
      `);
      printWin.document.close();
    } else {
      // For PDFs and other files, open in a new tab and let the user print from there
      printWin.location.href = doc.url;
    }
  }, [doc, isImage]);

  const handleDownload = useCallback(() => {
    if (!doc) return;
    const a = document.createElement("a");
    a.href = doc.downloadUrl;
    a.download = doc.fileName;
    a.rel = "noopener noreferrer";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }, [doc]);

  return (
    <Dialog open={doc !== null} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="flex max-h-[90vh] max-w-3xl flex-col">
        <DialogHeader className="flex-row items-center justify-between gap-4 space-y-0">
          <DialogTitle className="truncate text-sm font-medium">
            {doc?.fileName}
          </DialogTitle>
          <div className="flex shrink-0 gap-2">
            <Button variant="outline" size="sm" onClick={handleDownload}>
              <Download className="mr-1.5 h-4 w-4" />
              Download
            </Button>
            <Button variant="outline" size="sm" onClick={handlePrint}>
              <Printer className="mr-1.5 h-4 w-4" />
              Print
            </Button>
          </div>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-auto rounded-md border bg-muted/30">
          {doc && isImage && (
            <img
              src={doc.url}
              alt={doc.fileName}
              className="mx-auto max-h-[70vh] object-contain"
            />
          )}
          {doc && !isImage && (
            <iframe
              ref={iframeRef}
              src={doc.url}
              title={doc.fileName}
              className="h-[70vh] w-full"
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function MessageRow({
  message,
  onDocClick,
  isMine,
}: {
  message: ConversationMessage;
  onDocClick: (id: string, fileName?: string, contentType?: string) => void;
  isMine: boolean;
}) {
  return (
    <div className={`flex flex-col ${isMine ? "items-end" : "items-start"}`}>
      <div className="max-w-[85%] space-y-1">
        <div className={`flex items-center gap-2 text-xs text-muted-foreground ${isMine ? "justify-end" : "justify-start"}`}>
          <span className="font-medium">
            {message.author.firstName} {message.author.lastName}
          </span>
          <span className={`rounded-full px-2 py-0.5 text-[10px] ${roleClass(message.author.role)}`}>
            {roleLabel(message.author.role)}
          </span>
          <span>{relativeTime(message.createdAt)}</span>
        </div>
        <div
          className={
            isMine
              ? "rounded-2xl rounded-tr-sm bg-blue-600 px-3 py-2 text-white"
              : "rounded-2xl rounded-tl-sm bg-muted px-3 py-2"
          }
        >
          <p className="whitespace-pre-wrap text-sm">{message.body}</p>
          {message.documents.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-1.5">
              {message.documents.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => onDocClick(d.id, d.fileName, d.contentType)}
                  className={
                    isMine
                      ? "inline-flex max-w-full items-center gap-1.5 rounded-md border border-white/30 bg-white/10 px-2 py-1 text-xs text-white/90 hover:bg-white/20"
                      : "inline-flex max-w-full items-center gap-1.5 rounded-md border bg-background/60 px-2 py-1 text-xs hover:bg-background"
                  }
                >
                  <FileText className={`h-3 w-3 shrink-0 ${isMine ? "text-white/80" : "text-muted-foreground"}`} />
                  <span className="truncate">{d.fileName}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ComposerRow({
  value,
  onChange,
  placeholder,
  onAttach,
  onSend,
  sending,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  onAttach: () => void;
  onSend: (() => void) | undefined;
  sending: boolean;
  disabled?: boolean;
}) {
  // Auto-grow up to ~3 lines via rows attribute based on newline count.
  const rows = Math.max(1, Math.min(3, value.split("\n").length));
  return (
    <div className="flex items-end gap-2">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-9 w-9 shrink-0"
        onClick={onAttach}
        aria-label="Attach file"
      >
        <Paperclip className="h-4 w-4" />
      </Button>
      <Textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={rows}
        className="min-h-9 resize-none py-2"
      />
      {onSend && (
        <Button
          type="button"
          size="icon"
          className="h-9 w-9 shrink-0"
          onClick={onSend}
          disabled={disabled || sending}
          aria-label="Send"
        >
          {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <SendHorizontal className="h-4 w-4" />}
        </Button>
      )}
    </div>
  );
}

function PendingFileChips({ files, onRemove }: { files: File[]; onRemove: (i: number) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {files.map((f, i) => (
        <span
          key={`${f.name}-${i}`}
          className="inline-flex items-center gap-1.5 rounded-md border bg-muted/40 px-2 py-1 text-xs"
        >
          <FileText className="h-3 w-3 shrink-0 text-muted-foreground" />
          <span className="max-w-[120px] truncate">{f.name}</span>
          <button
            type="button"
            onClick={() => onRemove(i)}
            className="ml-0.5 text-muted-foreground hover:text-foreground"
            aria-label={`Remove ${f.name}`}
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
    </div>
  );
}
