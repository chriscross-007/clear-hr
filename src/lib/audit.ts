import { createClient } from "@supabase/supabase-js";

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    }
  );
}

export interface AuditEntry {
  organisationId: string;
  actorId: string;
  actorName: string;
  action: string;
  targetType: string;
  targetId?: string;
  targetLabel?: string;
  changes?: Record<string, { old: unknown; new: unknown }>;
  metadata?: Record<string, unknown>;
}

/**
 * Log an audit trail entry. Fire-and-forget — failures are logged
 * to console but never block the calling action.
 */
export async function logAudit(entry: AuditEntry): Promise<void> {
  try {
    const { error } = await getAdminClient().from("audit_log").insert({
      organisation_id: entry.organisationId,
      actor_id: entry.actorId,
      actor_name: entry.actorName,
      action: entry.action,
      target_type: entry.targetType,
      target_id: entry.targetId ?? null,
      target_label: entry.targetLabel ?? null,
      changes: entry.changes ?? null,
      metadata: entry.metadata ?? null,
    });

    if (error) {
      console.error("Audit log insert failed:", error.message);
    }
  } catch (e) {
    console.error("Audit log error:", e);
  }
}

/**
 * Format an ISO date (YYYY-MM-DD) as "10 May 2026" for human-readable
 * audit labels.
 */
function fmtAuditDate(iso: string): string {
  // Anchor at UTC noon to avoid timezone wobble around midnight boundaries.
  const d = new Date(`${iso}T12:00:00Z`);
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * Build the audit `target_label` for an absence booking. Includes the
 * employee name, absence type, and date range so the audit history makes
 * sense without having to cross-reference the booking. Open-ended (sick)
 * bookings are rendered as "from <start>".
 *
 * Example: "Jane Smith — Annual Leave (10 May 2026 – 14 May 2026)"
 */
export function bookingAuditLabel(parts: {
  memberName: string;
  reasonName: string;
  startDate: string | null;
  endDate: string | null;
}): string {
  const name = parts.memberName.trim();
  const reason = parts.reasonName.trim();
  const head = name ? `${name} — ${reason}` : reason;
  if (!parts.startDate) return head;
  let dates = "";
  if (parts.endDate === null) {
    dates = `from ${fmtAuditDate(parts.startDate)}`;
  } else if (parts.startDate === parts.endDate) {
    dates = fmtAuditDate(parts.startDate);
  } else {
    dates = `${fmtAuditDate(parts.startDate)} – ${fmtAuditDate(parts.endDate)}`;
  }
  return `${head} (${dates})`;
}

/**
 * Compute a changes diff between old and new values.
 * Only includes fields that actually changed.
 */
export function diffChanges(
  oldValues: Record<string, unknown>,
  newValues: Record<string, unknown>
): Record<string, { old: unknown; new: unknown }> | undefined {
  const changes: Record<string, { old: unknown; new: unknown }> = {};

  for (const key of Object.keys(newValues)) {
    const oldVal = oldValues[key] ?? null;
    const newVal = newValues[key] ?? null;
    if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
      changes[key] = { old: oldVal, new: newVal };
    }
  }

  return Object.keys(changes).length > 0 ? changes : undefined;
}
