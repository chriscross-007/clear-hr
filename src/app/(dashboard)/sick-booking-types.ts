// ---------------------------------------------------------------------------
// Sick booking types & constants — shared between server actions and client
// components. Kept in a plain module (no "use server") so Next.js doesn't
// complain about exporting non-async values.
// ---------------------------------------------------------------------------

export type SickDetails = {
  id: string;
  booking_id: string;
  self_cert_required: boolean;
  self_cert_received_date: string | null;
  self_cert_received_by: string | null;
  self_cert_document_id: string | null;
  btw_required: boolean;
  btw_date: string | null;
  btw_interviewer_id: string | null;
  btw_completed: boolean;
  med_cert_required: boolean;
  med_cert_received_date: string | null;
  med_cert_received_by: string | null;
  is_paid: boolean;
  hr_approved: boolean;
  hr_approved_by: string | null;
  hr_approved_at: string | null;
  completion_status: string;
};

export type SickDetailsInput = {
  bookingId: string;
  selfCertRequired: boolean;
  selfCertReceivedDate: string | null;
  selfCertDocumentId: string | null;
  btwRequired: boolean;
  btwDate: string | null;
  btwInterviewerId: string | null;
  btwCompleted: boolean;
  medCertRequired: boolean;
  medCertReceivedDate: string | null;
  isPaid: boolean;
  hrApproved: boolean;
};

// ---------------------------------------------------------------------------
// Completion status — the highest-priority outstanding action on a sick
// booking. Checked in priority order; the first match wins.
// ---------------------------------------------------------------------------

export type CompletionStatus =
  | "open"
  | "waiting_self_cert"
  | "btw_unscheduled"
  | "btw_pending"
  | "med_cert_pending"
  | "waiting_hr_approval"
  | "complete";

export const COMPLETION_STATUS_LABELS: Record<CompletionStatus, string> = {
  open: "Open",
  waiting_self_cert: "Waiting Self Cert",
  btw_unscheduled: "BTW Unscheduled",
  btw_pending: "BTW Pending",
  med_cert_pending: "Medical Cert Pending",
  waiting_hr_approval: "Waiting HR Approval",
  complete: "Complete",
};

export const COMPLETION_STATUS_COLOURS: Record<CompletionStatus, string> = {
  open: "#ef4444",            // red
  waiting_self_cert: "#f97316", // orange
  btw_unscheduled: "#f59e0b",  // amber
  btw_pending: "#eab308",      // yellow
  med_cert_pending: "#f97316", // orange
  waiting_hr_approval: "#8b5cf6", // violet
  complete: "#22c55e",         // green
};

// ---------------------------------------------------------------------------
// computeCompletionStatus — shared so both server actions and client
// components can derive the status from the current field values.
// ---------------------------------------------------------------------------

export function computeCompletionStatus(
  input: Omit<SickDetailsInput, "bookingId">,
  bookingEndDate: string | null,
): CompletionStatus {
  if (bookingEndDate === null) return "open";
  if (input.selfCertRequired && !input.selfCertReceivedDate) return "waiting_self_cert";
  if (input.btwRequired && !input.btwDate) return "btw_unscheduled";
  if (input.btwRequired && !input.btwCompleted) return "btw_pending";
  if (input.medCertRequired && !input.medCertReceivedDate) return "med_cert_pending";
  if (!input.hrApproved) return "waiting_hr_approval";
  return "complete";
}

export type IncompleteSickBooking = {
  booking_id: string;
  member_id: string;
  member_name: string;
  start_date: string;
  end_date: string | null;
  reason_name: string;
  reason_colour: string;
  completion_status: CompletionStatus;
};
