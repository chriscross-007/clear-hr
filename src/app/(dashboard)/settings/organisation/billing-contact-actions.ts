"use server";

// CLE-199 — Billing contact designation. One member per organisation
// carries `is_billing_contact = true`; a partial unique index enforces
// the invariant. This action atomically swaps the flag between two
// members via a single transaction (no window where 0 or 2 rows are
// flagged). Gated on the caller's `canManageBilling` right.

import { createClient } from "@/lib/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { getEffectiveRightsForUser } from "@/lib/rights-resolver";
import { revalidatePath } from "next/cache";

function getAdmin() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

export interface BillingContactRow {
  memberId: string;
  firstName: string;
  lastName: string;
  email: string;
}

/**
 * Returns the current billing contact for the caller's org, plus a
 * list of members who could be transferred to. Eligibility for the
 * picker: members whose profile grants `canManageBilling`, so the new
 * holder can actually act on billing emails/portals.
 */
export async function getBillingContactContext(): Promise<{
  current: BillingContactRow | null;
  candidates: BillingContactRow[];
}> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { current: null, candidates: [] };

  const resolved = await getEffectiveRightsForUser(user.id);
  if (!resolved) return { current: null, candidates: [] };
  const orgId = resolved.ctx.organisationId;

  const admin = getAdmin();
  const { data: currentRow } = await admin
    .from("members")
    .select("id, first_name, last_name, email")
    .eq("organisation_id", orgId)
    .eq("is_billing_contact", true)
    .maybeSingle();

  const { data: candidateRows } = await admin
    .from("members")
    .select("id, first_name, last_name, email, rights_profiles!inner(can_manage_billing)")
    .eq("organisation_id", orgId)
    .eq("rights_profiles.can_manage_billing", true)
    .order("first_name");

  return {
    current: currentRow
      ? {
          memberId: currentRow.id as string,
          firstName: currentRow.first_name as string,
          lastName: currentRow.last_name as string,
          email: currentRow.email as string,
        }
      : null,
    candidates: ((candidateRows ?? []) as Array<{
      id: string;
      first_name: string;
      last_name: string;
      email: string;
    }>).map((r) => ({
      memberId: r.id,
      firstName: r.first_name,
      lastName: r.last_name,
      email: r.email,
    })),
  };
}

/**
 * Transfer billing contact from the current holder to `newMemberId`.
 * Runs the two writes back-to-back — flip current to false first
 * (unique index would otherwise reject the second insert), then flip
 * new to true. Gated on `canManageBilling`.
 */
export async function transferBillingContact(
  newMemberId: string,
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "Not authenticated" };

  const resolved = await getEffectiveRightsForUser(user.id);
  if (!resolved) return { success: false, error: "No organisation" };
  if (!resolved.rights.canManageBilling) {
    return { success: false, error: "You don't have permission to transfer the billing contact" };
  }
  const orgId = resolved.ctx.organisationId;
  const admin = getAdmin();

  // Verify the target is in the caller's org.
  const { data: target } = await admin
    .from("members")
    .select("id, is_billing_contact")
    .eq("id", newMemberId)
    .eq("organisation_id", orgId)
    .single();
  if (!target) return { success: false, error: "Member not found" };
  if (target.is_billing_contact) return { success: true }; // already the contact

  // Clear current holder(s) first so the partial unique index doesn't
  // reject the new insert.
  const { error: clearErr } = await admin
    .from("members")
    .update({ is_billing_contact: false })
    .eq("organisation_id", orgId)
    .eq("is_billing_contact", true);
  if (clearErr) return { success: false, error: clearErr.message };

  const { error: setErr } = await admin
    .from("members")
    .update({ is_billing_contact: true })
    .eq("id", newMemberId)
    .eq("organisation_id", orgId);
  if (setErr) return { success: false, error: setErr.message };

  revalidatePath("/settings/organisation");
  return { success: true };
}
