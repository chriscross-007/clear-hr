"use server";

import { createClient } from "@/lib/supabase/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import {
  computeCompletionStatus,
} from "./sick-booking-types";
import { logAudit, diffChanges } from "@/lib/audit";
import type {
  SickDetails,
  SickDetailsInput,
  CompletionStatus,
  IncompleteSickBooking,
} from "./sick-booking-types";

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
      .select("id, booking_id, self_cert_required, self_cert_received_date, self_cert_received_by, self_cert_document_id, btw_required, btw_date, btw_interviewer_id, btw_completed, med_cert_required, med_cert_received_date, med_cert_received_by, is_paid, hr_approved, hr_approved_by, hr_approved_at, completion_status")
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

    // Verify booking is in the caller's org and get end_date for status calc
    const { data: booking } = await admin
      .from("holiday_bookings")
      .select("id, organisation_id, member_id, end_date, absence_reasons(name), members!holiday_bookings_member_id_fkey(first_name, last_name)")
      .eq("id", input.bookingId)
      .eq("organisation_id", caller.organisation_id)
      .single();
    if (!booking) return { success: false, error: "Booking not found" };

    // Look up existing row to handle audit-stamp transitions correctly
    // and to compute the audit diff.
    const { data: existing } = await admin
      .from("sick_booking_details")
      .select("self_cert_required, self_cert_received_date, self_cert_received_by, self_cert_document_id, btw_required, btw_date, btw_interviewer_id, btw_completed, med_cert_required, med_cert_received_date, med_cert_received_by, is_paid, hr_approved, hr_approved_by, hr_approved_at, completion_status")
      .eq("booking_id", input.bookingId)
      .maybeSingle();

    // HR approval stamps
    let hrApprovedBy: string | null;
    let hrApprovedAt: string | null;
    if (input.hrApproved) {
      hrApprovedBy = (existing?.hr_approved_by as string | null | undefined) ?? caller.id;
      hrApprovedAt = (existing?.hr_approved_at as string | null | undefined) ?? new Date().toISOString();
    } else {
      hrApprovedBy = null;
      hrApprovedAt = null;
    }

    // Self-cert received-by: stamp caller when date is first entered
    let selfCertReceivedBy: string | null = null;
    if (input.selfCertReceivedDate) {
      selfCertReceivedBy = (existing?.self_cert_received_by as string | null | undefined) ?? caller.id;
    }

    // Medical cert received-by: stamp caller when date is first entered
    let medCertReceivedBy: string | null = null;
    if (input.medCertReceivedDate) {
      medCertReceivedBy = (existing?.med_cert_received_by as string | null | undefined) ?? caller.id;
    }

    const { data: saved, error: upsertError } = await admin
      .from("sick_booking_details")
      .upsert({
        booking_id: input.bookingId,
        self_cert_required: input.selfCertRequired,
        self_cert_received_date: input.selfCertReceivedDate,
        self_cert_received_by: selfCertReceivedBy,
        self_cert_document_id: input.selfCertDocumentId,
        btw_required: input.btwRequired,
        btw_date: input.btwDate,
        btw_interviewer_id: input.btwInterviewerId,
        btw_completed: input.btwCompleted,
        med_cert_required: input.medCertRequired,
        med_cert_received_date: input.medCertReceivedDate,
        med_cert_received_by: medCertReceivedBy,
        is_paid: input.isPaid,
        hr_approved: input.hrApproved,
        hr_approved_by: hrApprovedBy,
        hr_approved_at: hrApprovedAt,
        completion_status: computeCompletionStatus(input, (booking.end_date as string | null) ?? null),
      }, { onConflict: "booking_id" })
      .select("id, booking_id, self_cert_required, self_cert_received_date, self_cert_received_by, self_cert_document_id, btw_required, btw_date, btw_interviewer_id, btw_completed, med_cert_required, med_cert_received_date, med_cert_received_by, is_paid, hr_approved, hr_approved_by, hr_approved_at, completion_status")
      .single();

    if (upsertError || !saved) {
      return { success: false, error: upsertError?.message ?? "Failed to save sick details" };
    }

    // --- Audit log ----------------------------------------------------------
    const targetMember = booking.members as unknown as { first_name: string; last_name: string } | null;
    const memberName = targetMember ? `${targetMember.first_name} ${targetMember.last_name}`.trim() : "";
    const reasonName = (booking.absence_reasons as unknown as { name: string } | null)?.name ?? "Sick";

    // Fetch caller's name for the actor field
    const { data: callerRow } = await admin
      .from("members")
      .select("first_name, last_name")
      .eq("id", caller.id)
      .single();
    const actorName = callerRow ? `${callerRow.first_name ?? ""} ${callerRow.last_name ?? ""}`.trim() : "";

    const newVals = {
      self_cert_required: input.selfCertRequired,
      self_cert_received_date: input.selfCertReceivedDate,
      btw_required: input.btwRequired,
      btw_date: input.btwDate,
      btw_completed: input.btwCompleted,
      med_cert_required: input.medCertRequired,
      med_cert_received_date: input.medCertReceivedDate,
      is_paid: input.isPaid,
      hr_approved: input.hrApproved,
      completion_status: computeCompletionStatus(input, (booking.end_date as string | null) ?? null),
    };

    const oldVals = existing
      ? {
          self_cert_required: existing.self_cert_required,
          self_cert_received_date: existing.self_cert_received_date,
          btw_required: existing.btw_required,
          btw_date: existing.btw_date,
          btw_completed: existing.btw_completed,
          med_cert_required: existing.med_cert_required,
          med_cert_received_date: existing.med_cert_received_date,
          is_paid: existing.is_paid,
          hr_approved: existing.hr_approved,
          completion_status: existing.completion_status,
        }
      : {
          self_cert_required: null,
          self_cert_received_date: null,
          btw_required: null,
          btw_date: null,
          btw_completed: null,
          med_cert_required: null,
          med_cert_received_date: null,
          is_paid: null,
          hr_approved: null,
          completion_status: null,
        };

    const changes = diffChanges(
      oldVals as Record<string, unknown>,
      newVals as Record<string, unknown>,
    );

    if (changes) {
      logAudit({
        organisationId: caller.organisation_id,
        actorId: caller.id,
        actorName,
        action: existing ? "sick_details.updated" : "sick_details.created",
        targetType: "booking",
        targetId: input.bookingId,
        targetLabel: `${memberName} — ${reasonName}`,
        changes,
        metadata: { member_id: booking.member_id as string, member_name: memberName },
      });
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

// ---------------------------------------------------------------------------
// getIncompleteSickBookings — all sick bookings with a non-complete status,
// across the org. Used by the dashboard widget.
// ---------------------------------------------------------------------------

export async function getIncompleteSickBookings(): Promise<{
  success: boolean;
  error?: string;
  bookings: IncompleteSickBooking[];
}> {
  try {
    const caller = await requireAdmin();
    const admin = getAdminClient();

    // 1. Sick bookings with a sick_booking_details row whose status != complete
    const { data: detailRows, error: detailErr } = await admin
      .from("sick_booking_details")
      .select(`
        booking_id,
        completion_status,
        holiday_bookings!inner(
          member_id,
          start_date,
          end_date,
          status,
          absence_reasons(name, colour),
          members!holiday_bookings_member_id_fkey(first_name, last_name)
        )
      `)
      .neq("completion_status", "complete")
      .eq("holiday_bookings.organisation_id", caller.organisation_id)
      .in("holiday_bookings.status", ["pending", "approved"])
      .order("completion_status");

    if (detailErr) return { success: false, error: detailErr.message, bookings: [] };

    const bookings: IncompleteSickBooking[] = (detailRows ?? []).map((row) => {
      const hb = row.holiday_bookings as unknown as {
        member_id: string;
        start_date: string;
        end_date: string | null;
        status: string;
        absence_reasons: { name: string; colour: string } | null;
        members: { first_name: string; last_name: string };
      };
      return {
        booking_id: row.booking_id,
        member_id: hb.member_id,
        member_name: `${hb.members.first_name} ${hb.members.last_name}`.trim(),
        start_date: hb.start_date,
        end_date: hb.end_date,
        reason_name: hb.absence_reasons?.name ?? "Sick",
        reason_colour: hb.absence_reasons?.colour ?? "#6366f1",
        completion_status: row.completion_status as CompletionStatus,
      };
    });

    // 2. Open-ended sick bookings that have NO sick_booking_details row yet,
    //    or whose row still has the migration default of 'complete'.
    //    These are sick bookings with end_date IS NULL.
    const seenBookingIds = new Set(bookings.map((b) => b.booking_id));

    // Fetch sick absence type ids so we can identify sick bookings
    const { data: sickTypes } = await admin
      .from("absence_types")
      .select("id")
      .eq("organisation_id", caller.organisation_id)
      .ilike("name", "Sick%");
    const sickTypeIds = new Set((sickTypes ?? []).map((t) => t.id as string));

    if (sickTypeIds.size > 0) {
      const { data: openBookings } = await admin
        .from("holiday_bookings")
        .select("id, member_id, start_date, end_date, status, absence_reasons!inner(name, colour, absence_type_id), members!holiday_bookings_member_id_fkey(first_name, last_name)")
        .eq("organisation_id", caller.organisation_id)
        .in("status", ["pending", "approved"])
        .is("end_date", null);

      for (const ob of openBookings ?? []) {
        if (seenBookingIds.has(ob.id)) continue;
        const reason = ob.absence_reasons as unknown as { name: string; colour: string; absence_type_id: string };
        if (!sickTypeIds.has(reason.absence_type_id)) continue;
        const mem = ob.members as unknown as { first_name: string; last_name: string };
        bookings.push({
          booking_id: ob.id,
          member_id: ob.member_id,
          member_name: `${mem.first_name} ${mem.last_name}`.trim(),
          start_date: ob.start_date,
          end_date: null,
          reason_name: reason.name,
          reason_colour: reason.colour,
          completion_status: "open",
        });
      }
    }

    return { success: true, bookings };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "An error occurred", bookings: [] };
  }
}

// ---------------------------------------------------------------------------
// Self-cert template
// ---------------------------------------------------------------------------

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
