import { createClient } from "@supabase/supabase-js";

const adminClient = createClient(
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
    const { error } = await adminClient.from("audit_log").insert({
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
