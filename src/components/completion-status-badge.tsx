"use client";

import {
  COMPLETION_STATUS_LABELS,
  COMPLETION_STATUS_COLOURS,
  type CompletionStatus,
} from "@/app/(dashboard)/sick-booking-types";

interface CompletionStatusBadgeProps {
  status: CompletionStatus;
  className?: string;
}

export function CompletionStatusBadge({ status, className }: CompletionStatusBadgeProps) {
  const label = COMPLETION_STATUS_LABELS[status] ?? status;
  const colour = COMPLETION_STATUS_COLOURS[status] ?? "#6b7280";

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium ${className ?? ""}`}
      style={{ borderColor: colour, color: colour }}
    >
      <span
        aria-hidden
        className="inline-block h-1.5 w-1.5 rounded-full"
        style={{ backgroundColor: colour }}
      />
      {label}
    </span>
  );
}
