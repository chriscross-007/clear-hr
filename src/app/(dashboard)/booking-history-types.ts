// Plain module — no "use server" directive.
// Types and constants shared between the server action and client components.

export type BookingHistoryAudit = {
  type: "audit";
  id: string;
  timestamp: string;
  actorName: string;
  action: string;
  /** Human-readable summary, e.g. "Self-cert received" */
  description: string;
  /** Optional detail lines derived from the changes JSON */
  details: string[];
};

export type BookingHistoryChat = {
  type: "chat";
  id: string;
  timestamp: string;
  authorName: string;
  authorRole: "admin" | "owner" | "employee";
  body: string;
  documents: { id: string; fileName: string }[];
};

/** Union type for a single entry in the booking history timeline */
export type BookingHistoryEntry = BookingHistoryAudit | BookingHistoryChat;

/** @deprecated — use BookingHistoryAudit instead */
export type BookingHistoryEvent = BookingHistoryAudit;
