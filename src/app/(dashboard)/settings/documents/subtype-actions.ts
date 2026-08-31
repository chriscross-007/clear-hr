"use server";

// CLE-205 — Document Subtype CRUD.
//
// One row per (organisation × type × name). Every write is gated on
// canEditOrgSettings via the resolver; the DB additionally enforces
// tenant scoping through the flag-based RLS from
// 20260831000001_documents_foundation.

import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { getEffectiveRightsForUser } from "@/lib/rights-resolver";
import { revalidatePath } from "next/cache";
import { logAudit, diffChanges } from "@/lib/audit";
import type {
  DocumentType,
  RetentionClass,
  DocumentSubtypeDto,
  DocumentSubtypeWritePayload,
} from "./subtype-types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getAdmin() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

async function requireCanEditOrgSettings(): Promise<
  | { ok: true; organisationId: string; callerMemberId: string }
  | { ok: false; error: string }
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Not authenticated" };

  const resolved = await getEffectiveRightsForUser(user.id);
  if (!resolved) return { ok: false, error: "No organisation" };
  if (!resolved.rights.canEditOrgSettings) {
    return { ok: false, error: "You don't have permission to edit organisation settings" };
  }
  return {
    ok: true,
    organisationId: resolved.ctx.organisationId,
    callerMemberId: resolved.ctx.memberId,
  };
}

async function callerName(callerMemberId: string): Promise<string> {
  const { data } = await getAdmin()
    .from("members")
    .select("first_name, last_name")
    .eq("id", callerMemberId)
    .single();
  return `${data?.first_name ?? ""} ${data?.last_name ?? ""}`.trim() || "Unknown";
}

const SELECT_COLUMNS =
  "id, type, name, sort_order, employee_can_upload, retention_class, " +
  "expiry_required, default_expiry_months, requires_verification, " +
  "review_period_months, expected_for_every_member, requires_signature";

interface DbRow {
  id: string;
  type: DocumentType;
  name: string;
  sort_order: number;
  employee_can_upload: boolean;
  retention_class: RetentionClass;
  expiry_required: boolean;
  default_expiry_months: number | null;
  requires_verification: boolean;
  review_period_months: number | null;
  expected_for_every_member: boolean;
  requires_signature: boolean;
}

function rowToDto(row: DbRow): DocumentSubtypeDto {
  return {
    id: row.id,
    type: row.type,
    name: row.name,
    sortOrder: row.sort_order,
    employeeCanUpload: row.employee_can_upload,
    retentionClass: row.retention_class,
    expiryRequired: row.expiry_required,
    defaultExpiryMonths: row.default_expiry_months,
    requiresVerification: row.requires_verification,
    reviewPeriodMonths: row.review_period_months,
    expectedForEveryMember: row.expected_for_every_member,
    requiresSignature: row.requires_signature,
  };
}

function payloadToRow(p: DocumentSubtypeWritePayload): Record<string, unknown> {
  return {
    type: p.type,
    name: p.name.trim(),
    employee_can_upload: p.employeeCanUpload,
    retention_class: p.retentionClass,
    expiry_required: p.expiryRequired,
    default_expiry_months: p.defaultExpiryMonths,
    requires_verification: p.requiresVerification,
    review_period_months: p.reviewPeriodMonths,
    expected_for_every_member: p.expectedForEveryMember,
    requires_signature: p.requiresSignature,
  };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function getDocumentSubtypes(): Promise<DocumentSubtypeDto[]> {
  const guard = await requireCanEditOrgSettings();
  if (!guard.ok) return [];
  const admin = getAdmin();
  const { data } = await admin
    .from("document_subtype")
    .select(SELECT_COLUMNS)
    .eq("organisation_id", guard.organisationId)
    .order("type", { ascending: true })
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  return ((data ?? []) as unknown as DbRow[]).map(rowToDto);
}

// ---------------------------------------------------------------------------
// Create / update / delete / reorder
// ---------------------------------------------------------------------------

export async function createDocumentSubtype(
  payload: DocumentSubtypeWritePayload,
): Promise<{ success: boolean; error?: string; id?: string }> {
  const guard = await requireCanEditOrgSettings();
  if (!guard.ok) return { success: false, error: guard.error };
  if (!payload.name.trim()) return { success: false, error: "Name is required" };
  const admin = getAdmin();

  const { data: maxRow } = await admin
    .from("document_subtype")
    .select("sort_order")
    .eq("organisation_id", guard.organisationId)
    .eq("type", payload.type)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextOrder = ((maxRow?.sort_order as number | null) ?? 0) + 1;

  const { data, error } = await admin
    .from("document_subtype")
    .insert({
      organisation_id: guard.organisationId,
      sort_order: nextOrder,
      ...payloadToRow(payload),
    })
    .select("id")
    .single();
  if (error) {
    if (error.code === "23505") return { success: false, error: "A subtype with that name already exists for this type" };
    return { success: false, error: error.message };
  }

  const rowValues = payloadToRow(payload);
  const changes: Record<string, { old: unknown; new: unknown }> = {};
  for (const [k, v] of Object.entries(rowValues)) changes[k] = { old: null, new: v };
  await logAudit({
    organisationId: guard.organisationId,
    actorId: guard.callerMemberId,
    actorName: await callerName(guard.callerMemberId),
    action: "document_subtype.created",
    targetType: "document_subtype",
    targetId: data?.id as string | undefined,
    targetLabel: `${payload.type} — ${payload.name.trim()}`,
    changes,
  });

  revalidatePath("/settings/documents");
  return { success: true, id: data?.id as string | undefined };
}

export async function updateDocumentSubtype(
  id: string,
  payload: DocumentSubtypeWritePayload,
): Promise<{ success: boolean; error?: string }> {
  const guard = await requireCanEditOrgSettings();
  if (!guard.ok) return { success: false, error: guard.error };
  if (!payload.name.trim()) return { success: false, error: "Name is required" };
  const admin = getAdmin();

  const { data: beforeRow } = await admin
    .from("document_subtype")
    .select(SELECT_COLUMNS)
    .eq("id", id)
    .eq("organisation_id", guard.organisationId)
    .single();

  const { error } = await admin
    .from("document_subtype")
    .update(payloadToRow(payload))
    .eq("id", id)
    .eq("organisation_id", guard.organisationId);
  if (error) {
    if (error.code === "23505") return { success: false, error: "A subtype with that name already exists for this type" };
    return { success: false, error: error.message };
  }

  if (beforeRow) {
    const b = beforeRow as unknown as DbRow;
    const beforeValues: Record<string, unknown> = {
      type: b.type,
      name: b.name,
      employee_can_upload: b.employee_can_upload,
      retention_class: b.retention_class,
      expiry_required: b.expiry_required,
      default_expiry_months: b.default_expiry_months,
      requires_verification: b.requires_verification,
      review_period_months: b.review_period_months,
      expected_for_every_member: b.expected_for_every_member,
      requires_signature: b.requires_signature,
    };
    const afterValues = payloadToRow(payload);
    const changes = diffChanges(beforeValues, afterValues);
    if (changes) {
      await logAudit({
        organisationId: guard.organisationId,
        actorId: guard.callerMemberId,
        actorName: await callerName(guard.callerMemberId),
        action: "document_subtype.updated",
        targetType: "document_subtype",
        targetId: id,
        targetLabel: `${payload.type} — ${payload.name.trim()}`,
        changes,
      });
    }
  }

  revalidatePath("/settings/documents");
  return { success: true };
}

export async function deleteDocumentSubtype(
  id: string,
): Promise<{ success: boolean; error?: string }> {
  const guard = await requireCanEditOrgSettings();
  if (!guard.ok) return { success: false, error: guard.error };
  const admin = getAdmin();

  const { data: subtype } = await admin
    .from("document_subtype")
    .select("id, type, name")
    .eq("id", id)
    .eq("organisation_id", guard.organisationId)
    .single();
  if (!subtype) return { success: false, error: "Subtype not found" };

  // Refuse to delete when documents still reference this subtype.
  const { count } = await admin
    .from("document")
    .select("id", { count: "exact", head: true })
    .eq("subtype_id", id);
  if ((count ?? 0) > 0) {
    return {
      success: false,
      error: `${count} document${count === 1 ? "" : "s"} still classified under this subtype — reclassify them first.`,
    };
  }

  const { error } = await admin
    .from("document_subtype")
    .delete()
    .eq("id", id)
    .eq("organisation_id", guard.organisationId);
  if (error) return { success: false, error: error.message };

  await logAudit({
    organisationId: guard.organisationId,
    actorId: guard.callerMemberId,
    actorName: await callerName(guard.callerMemberId),
    action: "document_subtype.deleted",
    targetType: "document_subtype",
    targetId: id,
    targetLabel: `${subtype.type} — ${subtype.name}`,
    changes: { name: { old: subtype.name, new: null } },
  });

  revalidatePath("/settings/documents");
  return { success: true };
}

export async function reorderDocumentSubtypes(
  type: DocumentType,
  orderedIds: string[],
): Promise<{ success: boolean; error?: string }> {
  const guard = await requireCanEditOrgSettings();
  if (!guard.ok) return { success: false, error: guard.error };
  const admin = getAdmin();

  await Promise.all(
    orderedIds.map((id, i) =>
      admin
        .from("document_subtype")
        .update({ sort_order: i })
        .eq("id", id)
        .eq("organisation_id", guard.organisationId)
        .eq("type", type),
    ),
  );

  revalidatePath("/settings/documents");
  return { success: true };
}
