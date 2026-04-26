"use server";

import { createClient } from "@/lib/supabase/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SickDetails = {
  id: string;
  booking_id: string;
  self_cert_required: boolean;
  self_cert_received_date: string | null;
  self_cert_document_id: string | null;
  btw_required: boolean;
  btw_date: string | null;
  btw_interviewer_id: string | null;
  is_paid: boolean;
  hr_approved: boolean;
  hr_approved_by: string | null;
  hr_approved_at: string | null;
};

export type SickDetailsInput = {
  bookingId: string;
  selfCertRequired: boolean;
  selfCertReceivedDate: string | null;
  selfCertDocumentId: string | null;
  btwRequired: boolean;
  btwDate: string | null;
  btwInterviewerId: string | null;
  isPaid: boolean;
  hrApproved: boolean;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getAdminClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } },
  );
}

async function getCallerMember() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const { data: member } = await supabase
    .from("members")
    .select("id, organisation_id, role")
    .eq("user_id", user.id)
    .single();
  if (!member) throw new Error("No membership found");

  return { supabase, member };
}

async function requireAdmin() {
  const { member } = await getCallerMember();
  if (member.role !== "admin" && member.role !== "owner") {
    throw new Error("Not authorised");
  }
  return member;
}

// ---------------------------------------------------------------------------
// getSickDetails — load existing row for a booking, or null if none yet.
// ---------------------------------------------------------------------------

export async function getSickDetails(
  bookingId: string,
): Promise<{ success: boolean; error?: string; details?: SickDetails | null }> {
  try {
    await requireAdmin();
    const admin = getAdminClient();
    const { data } = await admin
      .from("sick_booking_details")
      .select("id, booking_id, self_cert_required, self_cert_received_date, self_cert_document_id, btw_required, btw_date, btw_interviewer_id, is_paid, hr_approved, hr_approved_by, hr_approved_at")
      .eq("booking_id", bookingId)
      .maybeSingle();
    return { success: true, details: (data as SickDetails | null) ?? null };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "An error occurred" };
  }
}

// ---------------------------------------------------------------------------
// saveSickDetails — upsert keyed on booking_id. Records hr_approved_by/at on
// the transition from unapproved -> approved; clears them on the reverse.
// ---------------------------------------------------------------------------

export async function saveSickDetails(
  input: SickDetailsInput,
): Promise<{ success: boolean; error?: string; details?: SickDetails }> {
  try {
    const caller = await requireAdmin();
    const admin = getAdminClient();

    // Verify booking is in the caller's org
    const { data: booking } = await admin
      .from("holiday_bookings")
      .select("id, organisation_id")
      .eq("id", input.bookingId)
      .eq("organisation_id", caller.organisation_id)
      .single();
    if (!booking) return { success: false, error: "Booking not found" };

    // Look up existing row to handle hr_approved transitions correctly.
    const { data: existing } = await admin
      .from("sick_booking_details")
      .select("hr_approved_by, hr_approved_at")
      .eq("booking_id", input.bookingId)
      .maybeSingle();

    let hrApprovedBy: string | null;
    let hrApprovedAt: string | null;
    if (input.hrApproved) {
      // Approving — keep prior approver if set, otherwise stamp the caller.
      hrApprovedBy = (existing?.hr_approved_by as string | null | undefined) ?? caller.id;
      hrApprovedAt = (existing?.hr_approved_at as string | null | undefined) ?? new Date().toISOString();
    } else {
      // Un-approved — clear the audit fields.
      hrApprovedBy = null;
      hrApprovedAt = null;
    }

    const { data: saved, error: upsertError } = await admin
      .from("sick_booking_details")
      .upsert({
        booking_id: input.bookingId,
        self_cert_required: input.selfCertRequired,
        self_cert_received_date: input.selfCertReceivedDate,
        self_cert_document_id: input.selfCertDocumentId,
        btw_required: input.btwRequired,
        btw_date: input.btwDate,
        btw_interviewer_id: input.btwInterviewerId,
        is_paid: input.isPaid,
        hr_approved: input.hrApproved,
        hr_approved_by: hrApprovedBy,
        hr_approved_at: hrApprovedAt,
      }, { onConflict: "booking_id" })
      .select("id, booking_id, self_cert_required, self_cert_received_date, self_cert_document_id, btw_required, btw_date, btw_interviewer_id, is_paid, hr_approved, hr_approved_by, hr_approved_at")
      .single();

    if (upsertError || !saved) {
      return { success: false, error: upsertError?.message ?? "Failed to save sick details" };
    }
    return { success: true, details: saved as SickDetails };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "An error occurred" };
  }
}

// ---------------------------------------------------------------------------
// getOrgAdmins — admins + owners for the BTW interviewer dropdown.
// ---------------------------------------------------------------------------

export async function getOrgAdmins(): Promise<{
  success: boolean;
  error?: string;
  admins: { id: string; firstName: string; lastName: string }[];
}> {
  try {
    const caller = await requireAdmin();
    const admin = getAdminClient();
    const { data, error } = await admin
      .from("members")
      .select("id, first_name, last_name")
      .eq("organisation_id", caller.organisation_id)
      .in("role", ["admin", "owner"])
      .order("first_name");
    if (error) return { success: false, error: error.message, admins: [] };
    const admins = (data ?? []).map((r) => ({
      id: r.id as string,
      firstName: (r.first_name as string) ?? "",
      lastName: (r.last_name as string) ?? "",
    }));
    return { success: true, admins };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "An error occurred", admins: [] };
  }
}

// ---------------------------------------------------------------------------
// Self-cert template — per-org PDF stored under member-documents at
// org-templates/{org_id}/self-cert-template.pdf, served via signed URL.
// ---------------------------------------------------------------------------

export async function getSelfCertTemplateUrl(): Promise<{
  success: boolean;
  error?: string;
  url?: string;
}> {
  try {
    const caller = await requireAdmin();
    const admin = getAdminClient();
    const { data: org } = await admin
      .from("organisations")
      .select("self_cert_template_path")
      .eq("id", caller.organisation_id)
      .single();
    const path = (org?.self_cert_template_path as string | null | undefined) ?? null;
    if (!path) return { success: false, error: "No template uploaded" };

    const { data: signed, error: signErr } = await admin.storage
      .from("member-documents")
      .createSignedUrl(path, 3600);
    if (signErr || !signed) {
      return { success: false, error: signErr?.message ?? "Could not create download link" };
    }
    return { success: true, url: signed.signedUrl };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "An error occurred" };
  }
}

export async function uploadSelfCertTemplate(
  formData: FormData,
): Promise<{ success: boolean; error?: string }> {
  try {
    const caller = await requireAdmin();
    const file = formData.get("file") as File | null;
    if (!file || file.size === 0) return { success: false, error: "No file provided" };

    const admin = getAdminClient();
    const path = `org-templates/${caller.organisation_id}/self-cert-template.pdf`;
    const buffer = Buffer.from(await file.arrayBuffer());

    const { error: uploadError } = await admin.storage
      .from("member-documents")
      .upload(path, buffer, { contentType: file.type || "application/pdf", upsert: true });
    if (uploadError) return { success: false, error: uploadError.message };

    const { error: updateError } = await admin
      .from("organisations")
      .update({ self_cert_template_path: path })
      .eq("id", caller.organisation_id);
    if (updateError) return { success: false, error: updateError.message };

    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "An error occurred" };
  }
}
