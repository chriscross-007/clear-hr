"use client";

import { useState } from "react";
import {
  History, Plus, Pencil, CheckCircle2, XCircle, Ban, Trash2,
  Stethoscope, Loader2, MessageCircle, FileText,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { getBookingHistory } from "@/app/(dashboard)/booking-history-actions";
import type { BookingHistoryEntry, BookingHistoryAudit, BookingHistoryChat } from "@/app/(dashboard)/booking-history-types";

// ---------------------------------------------------------------------------
// Icon + colour per audit action
// ---------------------------------------------------------------------------

const ACTION_STYLES: Record<string, { icon: React.ElementType; colour: string }> = {
  "booking.submitted":   { icon: Plus,         colour: "#6366f1" }, // indigo
  "booking.created":     { icon: Plus,         colour: "#6366f1" },
  "booking.updated":     { icon: Pencil,       colour: "#3b82f6" }, // blue
  "booking.resubmitted": { icon: Pencil,       colour: "#8b5cf6" }, // violet
  "booking.approved":    { icon: CheckCircle2,  colour: "#22c55e" }, // green
  "booking.rejected":    { icon: XCircle,       colour: "#ef4444" }, // red
  "booking.cancelled":   { icon: Ban,           colour: "#f59e0b" }, // amber
  "booking.deleted":     { icon: Trash2,        colour: "#ef4444" },
  "sick_details.created": { icon: Stethoscope,  colour: "#0ea5e9" }, // sky
  "sick_details.updated": { icon: Stethoscope,  colour: "#0ea5e9" },
};

const DEFAULT_STYLE = { icon: Pencil, colour: "#6b7280" };

function fmtTimestamp(ts: string): string {
  const d = new Date(ts);
  return d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

// ---------------------------------------------------------------------------
// Audit event row
// ---------------------------------------------------------------------------

function AuditRow({ entry, isLast }: { entry: BookingHistoryAudit; isLast: boolean }) {
  const style = ACTION_STYLES[entry.action] ?? DEFAULT_STYLE;
  const Icon = style.icon;

  return (
    <div className="relative flex gap-3">
      {/* Icon dot + connector line */}
      <div className="relative flex flex-col items-center shrink-0">
        <div
          className="relative z-10 flex h-6 w-6 items-center justify-center rounded-full bg-background border"
          style={{ borderColor: style.colour }}
        >
          <Icon className="h-3 w-3" style={{ color: style.colour }} />
        </div>
        {!isLast && <div className="w-px flex-1 bg-border" aria-hidden />}
      </div>

      {/* Content */}
      <div className={`min-w-0 ${isLast ? "" : "pb-1"}`}>
        <p className="text-sm font-medium leading-tight">{entry.description}</p>
        <p className="text-xs text-muted-foreground mt-0.5">
          {entry.actorName} · {fmtTimestamp(entry.timestamp)}
        </p>
        {entry.details.length > 0 && (
          <ul className="mt-1.5 space-y-0.5">
            {entry.details.map((d, i) => (
              <li key={i} className="text-xs text-muted-foreground leading-snug">{d}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Chat message row — employee left/grey, admin right/blue
// ---------------------------------------------------------------------------

function ChatRow({ entry, isLast }: { entry: BookingHistoryChat; isLast: boolean }) {
  const isAdmin = entry.authorRole === "admin" || entry.authorRole === "owner";

  return (
    <div className="relative flex gap-3">
      {/* Connector column — chat icon */}
      <div className="relative flex flex-col items-center shrink-0">
        <div className="relative z-10 flex h-6 w-6 items-center justify-center rounded-full bg-background border border-gray-300">
          <MessageCircle className="h-3 w-3 text-gray-400" />
        </div>
        {!isLast && <div className="w-px flex-1 bg-border" aria-hidden />}
      </div>

      {/* Chat bubble */}
      <div className={`min-w-0 flex-1 ${isLast ? "" : "pb-1"}`}>
        <div className={`flex flex-col ${isAdmin ? "items-end" : "items-start"}`}>
          <p className="text-xs text-muted-foreground mb-1">
            {entry.authorName}
            <span
              className={`ml-1.5 inline-block rounded px-1 py-0.5 text-[10px] font-medium leading-none ${
                isAdmin
                  ? "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              {entry.authorRole === "owner" ? "Owner" : isAdmin ? "Admin" : "Employee"}
            </span>
            <span className="ml-1.5">{fmtTimestamp(entry.timestamp)}</span>
          </p>
          <div
            className={`max-w-[85%] px-3 py-2 text-xs leading-relaxed ${
              isAdmin
                ? "rounded-2xl rounded-tr-sm bg-blue-600 text-white"
                : "rounded-2xl rounded-tl-sm bg-muted"
            }`}
          >
            {entry.body}
            {entry.documents.length > 0 && (
              <div className="mt-1.5 space-y-1">
                {entry.documents.map((doc) => (
                  <div
                    key={doc.id}
                    className={`flex items-center gap-1 text-[10px] ${
                      isAdmin ? "text-white/80" : "text-muted-foreground"
                    }`}
                  >
                    <FileText className="h-3 w-3 shrink-0" />
                    <span className="truncate">{doc.fileName}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function BookingHistoryPopover({ bookingId }: { bookingId: string }) {
  const [entries, setEntries] = useState<BookingHistoryEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  async function handleOpen(isOpen: boolean) {
    setOpen(isOpen);
    if (isOpen && entries === null) {
      setLoading(true);
      setError(null);
      const res = await getBookingHistory(bookingId);
      if (res.success) {
        setEntries(res.entries);
      } else {
        setError(res.error ?? "Could not load history");
      }
      setLoading(false);
    }
  }

  return (
    <Popover open={open} onOpenChange={handleOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground hover:text-foreground"
          title="Booking history"
        >
          <History className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        side="left"
        align="start"
        className="w-80 p-0"
        onWheel={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b">
          <h4 className="text-sm font-semibold">Booking History</h4>
        </div>

        {loading && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        )}

        {error && (
          <div className="px-4 py-3 text-sm text-destructive">{error}</div>
        )}

        {!loading && !error && entries !== null && entries.length === 0 && (
          <div className="px-4 py-6 text-sm text-muted-foreground text-center">
            No history recorded yet.
          </div>
        )}

        {!loading && !error && entries !== null && entries.length > 0 && (
          <div className="px-4 py-3 max-h-80 overflow-y-auto">
            <div className="space-y-4">
              {entries.map((entry, idx) => {
                const isLast = idx === entries.length - 1;
                if (entry.type === "chat") {
                  return <ChatRow key={entry.id} entry={entry} isLast={isLast} />;
                }
                return <AuditRow key={entry.id} entry={entry} isLast={isLast} />;
              })}
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
