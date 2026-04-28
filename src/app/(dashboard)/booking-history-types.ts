// Plain module — no "use server" directive.
// Types and constants shared between the server action and client components.

export type BookingHistoryEvent = {
  id: string;
  timestamp: string;
  actorName: string;
  action: string;
  /** Human-readable summary, e.g. "Self-cert received" */
  description: string;
  /** Optional detail lines derived from the changes JSON */
  details: string[];
};
