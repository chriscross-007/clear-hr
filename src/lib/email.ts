import { Resend } from "resend";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { capitalize } from "@/lib/label-utils";

function getAdminClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }
  );
}

const FROM = "ClearHR <noreply@contacts.clear-hr.com>";

function fmtDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00Z");
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

function dateRange(start: string, end: string | null): string {
  if (end === null) return `${fmtDate(start)} – Open`;
  return start === end ? fmtDate(start) : `${fmtDate(start)} – ${fmtDate(end)}`;
}

function wrap(body: string, orgName: string): string {
  return `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto;padding:24px">
      <div style="margin-bottom:24px">
        <strong style="font-size:18px;color:#18181b">ClearHR</strong>
      </div>
      ${body}
      <div style="margin-top:32px;padding-top:16px;border-top:1px solid #e5e7eb;color:#9ca3af;font-size:12px">
        You are receiving this because you are a member of ${orgName} on ClearHR.
      </div>
    </div>
  `;
}

function cta(label: string, url: string): string {
  return `<p><a href="${url}" style="display:inline-block;padding:12px 24px;background:#18181b;color:#fff;text-decoration:none;border-radius:6px">${label}</a></p>`;
}

/** Renders the employee + approver note paragraphs. The "Employee" label
 *  honours the org's `member_label` (e.g. "Partner", "Colleague") via the
 *  same convention used throughout the UI — no hardcoded "Employee" in
 *  user-facing strings. */
function notesHtml(
  employeeNote: string | null | undefined,
  approverNote: string | null | undefined,
  memberLabel: string,
): string {
  const parts: string[] = [];
  if (employeeNote) parts.push(`<p style="margin:12px 0;padding:12px;background:#f3f4f6;border-radius:6px;font-size:14px"><strong>${capitalize(memberLabel)} note:</strong> ${employeeNote}</p>`);
  if (approverNote) parts.push(`<p style="margin:12px 0;padding:12px;background:#f3f4f6;border-radius:6px;font-size:14px"><strong>Approver note:</strong> ${approverNote}</p>`);
  return parts.join("");
}

/** Build a link that redirects to the target page after login if the user is not authenticated */
function appLink(baseUrl: string, path: string): string {
  return `${baseUrl}/login?next=${encodeURIComponent(path)}`;
}

// ---------------------------------------------------------------------------
// Lookup helpers (cross-user — admin client)
// ---------------------------------------------------------------------------

async function getMemberEmail(memberId: string): Promise<{ email: string; firstName: string; orgName: string; memberLabel: string } | null> {
  const admin = getAdminClient();
  const { data } = await admin
    .from("members")
    .select("email, first_name, organisations(name, member_label)")
    .eq("id", memberId)
    .single();
  if (!data) return null;
  const org = data.organisations as unknown as { name: string; member_label: string | null } | null;
  return {
    email: data.email,
    firstName: data.first_name,
    orgName: org?.name ?? "your organisation",
    memberLabel: org?.member_label?.trim() || "employee",
  };
}

async function getMemberName(memberId: string): Promise<string> {
  const admin = getAdminClient();
  const { data } = await admin
    .from("members")
    .select("first_name, last_name")
    .eq("id", memberId)
    .single();
  return data ? `${data.first_name} ${data.last_name}` : "Unknown";
}

// ---------------------------------------------------------------------------
// Notification types
// ---------------------------------------------------------------------------

export type BookingEmailData = {
  bookingId: string;
  memberId: string;
  startDate: string;
  endDate: string | null;
  days: number | null;
  leaveType: string;
  /** Parent absence-type name (e.g. "Annual Leave", "Sickness"). When the
   *  type is "Annual Leave" the approver email uses Holiday terminology;
   *  any other value falls back to the generic Absence wording. Optional
   *  because some legacy callsites haven't been wired through yet — those
   *  default to Absence (the safe generic). */
  absenceTypeName?: string | null;
  approverId?: string | null;
  approverNote?: string | null;
  employeeNote?: string | null;
  cancelledByAdmin?: boolean;
  /** Set by `adminBookAbsence` to flip the auto-approved booking email
   *  from "your X has been booked" to "an administrator has booked an X
   *  for you", so the employee knows they didn't request it themselves. */
  bookedByAdmin?: boolean;
  baseUrl: string;
};

// ---------------------------------------------------------------------------
// 1. Request submitted — pending (email approver)
// ---------------------------------------------------------------------------

export async function sendRequestPendingEmail(data: BookingEmailData): Promise<void> {
  try {
    if (!data.approverId) return;
    const approver = await getMemberEmail(data.approverId);
    if (!approver) return;

    const employee = await getMemberName(data.memberId);
    const noteHtml = data.employeeNote
      ? `<p style="margin:12px 0;padding:12px;background:#f3f4f6;border-radius:6px;font-size:14px"><strong>${capitalize(approver.memberLabel)} note:</strong> ${data.employeeNote}</p>`
      : "";

    // Holiday-vs-Absence terminology pivots on the parent absence type.
    // Annual Leave bookings read as "holiday request"; anything else
    // (Sickness, Compassionate, etc.) falls back to the generic
    // "absence request" wording.
    const isAnnualLeave = data.absenceTypeName === "Annual Leave";
    const noun = isAnnualLeave ? "Holiday" : "Absence";
    const nounLower = isAnnualLeave ? "holiday" : "absence";
    const article = isAnnualLeave ? "a" : "an";

    const resend = new Resend(process.env.RESEND_API_KEY);
    await resend.emails.send({
      from: FROM,
      to: approver.email,
      subject: `${noun} request pending your approval — ${employee}`,
      html: wrap(`
        <h2 style="margin:0 0 16px;color:#18181b">${noun} Request</h2>
        <p><strong>${employee}</strong> has submitted ${article} ${nounLower} request that needs your approval.</p>
        <table style="margin:16px 0;font-size:14px">
          <tr><td style="padding:4px 16px 4px 0;color:#6b7280">Dates</td><td>${dateRange(data.startDate, data.endDate)}</td></tr>
          <tr><td style="padding:4px 16px 4px 0;color:#6b7280">Days</td><td>${data.days ?? "—"}</td></tr>
          <tr><td style="padding:4px 16px 4px 0;color:#6b7280">Type</td><td>${data.leaveType}</td></tr>
        </table>
        ${noteHtml}
        ${cta("Review Request", `${appLink(data.baseUrl, "/approvals")}`)}
      `, approver.orgName),
    });
  } catch (e) {
    console.error("[email] sendRequestPendingEmail failed:", e);
  }
}

// ---------------------------------------------------------------------------
// 2. Auto-approved booking (email employee)
// ---------------------------------------------------------------------------

export async function sendBookingConfirmedEmail(data: BookingEmailData): Promise<void> {
  try {
    const employee = await getMemberEmail(data.memberId);
    if (!employee) return;

    const isAnnualLeave = data.absenceTypeName === "Annual Leave";
    const noun = isAnnualLeave ? "Holiday" : "Absence";
    const nounLower = isAnnualLeave ? "holiday" : "absence";
    const article = isAnnualLeave ? "a" : "an";
    // Distinguish self-booking (auto-approved on submit) from
    // admin-on-behalf so the employee knows which it was.
    const bodyLine = data.bookedByAdmin
      ? `Hi ${employee.firstName}, an administrator has booked ${article} ${nounLower} for you.`
      : `Hi ${employee.firstName}, your ${nounLower} has been booked.`;

    const resend = new Resend(process.env.RESEND_API_KEY);
    await resend.emails.send({
      from: FROM,
      to: employee.email,
      subject: `${noun} booked — ${dateRange(data.startDate, data.endDate)}`,
      html: wrap(`
        <h2 style="margin:0 0 16px;color:#18181b">${noun} Booked</h2>
        <p>${bodyLine}</p>
        <table style="margin:16px 0;font-size:14px">
          <tr><td style="padding:4px 16px 4px 0;color:#6b7280">Dates</td><td>${dateRange(data.startDate, data.endDate)}</td></tr>
          <tr><td style="padding:4px 16px 4px 0;color:#6b7280">Days</td><td>${data.days ?? "—"}</td></tr>
          <tr><td style="padding:4px 16px 4px 0;color:#6b7280">Type</td><td>${data.leaveType}</td></tr>
        </table>
        ${cta("View My Absences", `${appLink(data.baseUrl, "/holiday")}`)}
      `, employee.orgName),
    });
  } catch (e) {
    console.error("[email] sendBookingConfirmedEmail failed:", e);
  }
}

// ---------------------------------------------------------------------------
// 3. Request approved (email employee)
// ---------------------------------------------------------------------------

export async function sendRequestApprovedEmail(data: BookingEmailData): Promise<void> {
  try {
    const employee = await getMemberEmail(data.memberId);
    if (!employee) return;

    const approverName = data.approverId ? await getMemberName(data.approverId) : "your manager";

    const isAnnualLeave = data.absenceTypeName === "Annual Leave";
    const noun = isAnnualLeave ? "Holiday" : "Absence";
    const nounLower = isAnnualLeave ? "holiday" : "absence";

    const resend = new Resend(process.env.RESEND_API_KEY);
    await resend.emails.send({
      from: FROM,
      to: employee.email,
      subject: `${noun} request approved — ${dateRange(data.startDate, data.endDate)}`,
      html: wrap(`
        <h2 style="margin:0 0 16px;color:#16a34a">${noun} Request Approved</h2>
        <p>Hi ${employee.firstName}, your ${nounLower} request has been approved by ${approverName}.</p>
        <table style="margin:16px 0;font-size:14px">
          <tr><td style="padding:4px 16px 4px 0;color:#6b7280">Dates</td><td>${dateRange(data.startDate, data.endDate)}</td></tr>
          <tr><td style="padding:4px 16px 4px 0;color:#6b7280">Days</td><td>${data.days ?? "—"}</td></tr>
          <tr><td style="padding:4px 16px 4px 0;color:#6b7280">Type</td><td>${data.leaveType}</td></tr>
        </table>
        ${notesHtml(data.employeeNote, data.approverNote, employee.memberLabel)}
        ${cta("View My Absences", `${appLink(data.baseUrl, "/holiday")}`)}
      `, employee.orgName),
    });
  } catch (e) {
    console.error("[email] sendRequestApprovedEmail failed:", e);
  }
}

// ---------------------------------------------------------------------------
// 4. Request rejected (email employee)
// ---------------------------------------------------------------------------

export async function sendRequestRejectedEmail(data: BookingEmailData): Promise<void> {
  try {
    const employee = await getMemberEmail(data.memberId);
    if (!employee) return;

    const approverName = data.approverId ? await getMemberName(data.approverId) : "your manager";

    const isAnnualLeave = data.absenceTypeName === "Annual Leave";
    const noun = isAnnualLeave ? "Holiday" : "Absence";
    const nounLower = isAnnualLeave ? "holiday" : "absence";

    const resend = new Resend(process.env.RESEND_API_KEY);
    await resend.emails.send({
      from: FROM,
      to: employee.email,
      subject: `${noun} request rejected — ${dateRange(data.startDate, data.endDate)}`,
      html: wrap(`
        <h2 style="margin:0 0 16px;color:#dc2626">${noun} Request Rejected</h2>
        <p>Hi ${employee.firstName}, your ${nounLower} request has been rejected by ${approverName}.</p>
        <table style="margin:16px 0;font-size:14px">
          <tr><td style="padding:4px 16px 4px 0;color:#6b7280">Dates</td><td>${dateRange(data.startDate, data.endDate)}</td></tr>
          <tr><td style="padding:4px 16px 4px 0;color:#6b7280">Days</td><td>${data.days ?? "—"}</td></tr>
          <tr><td style="padding:4px 16px 4px 0;color:#6b7280">Type</td><td>${data.leaveType}</td></tr>
        </table>
        ${notesHtml(data.employeeNote, data.approverNote, employee.memberLabel)}
        ${cta("View My Absences", `${appLink(data.baseUrl, "/holiday")}`)}
      `, employee.orgName),
    });
  } catch (e) {
    console.error("[email] sendRequestRejectedEmail failed:", e);
  }
}

// ---------------------------------------------------------------------------
// 5. Booking cancelled (email employee if admin cancelled)
// ---------------------------------------------------------------------------

export async function sendBookingCancelledEmail(data: BookingEmailData): Promise<void> {
  try {
    if (!data.cancelledByAdmin) return; // Only email if admin cancelled on behalf
    const employee = await getMemberEmail(data.memberId);
    if (!employee) return;

    const resend = new Resend(process.env.RESEND_API_KEY);
    await resend.emails.send({
      from: FROM,
      to: employee.email,
      subject: `Holiday booking cancelled — ${dateRange(data.startDate, data.endDate)}`,
      html: wrap(`
        <h2 style="margin:0 0 16px;color:#d97706">Holiday Booking Cancelled</h2>
        <p>Hi ${employee.firstName}, your holiday booking has been cancelled by an administrator.</p>
        <table style="margin:16px 0;font-size:14px">
          <tr><td style="padding:4px 16px 4px 0;color:#6b7280">Dates</td><td>${dateRange(data.startDate, data.endDate)}</td></tr>
          <tr><td style="padding:4px 16px 4px 0;color:#6b7280">Days</td><td>${data.days ?? "—"}</td></tr>
          <tr><td style="padding:4px 16px 4px 0;color:#6b7280">Type</td><td>${data.leaveType}</td></tr>
        </table>
        ${cta("View My Holiday", `${appLink(data.baseUrl, "/holiday")}`)}
      `, employee.orgName),
    });
  } catch (e) {
    console.error("[email] sendBookingCancelledEmail failed:", e);
  }
}

// ---------------------------------------------------------------------------
// 6. Upcoming holiday reminder (used by cron)
// ---------------------------------------------------------------------------

export async function sendHolidayReminderEmail(
  to: string,
  firstName: string,
  orgName: string,
  startDate: string,
  endDate: string | null,
  days: number | null,
  leaveType: string,
  baseUrl: string
): Promise<void> {
  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    await resend.emails.send({
      from: FROM,
      to,
      subject: `Reminder: your holiday starts in 3 days — ${dateRange(startDate, endDate)}`,
      html: wrap(`
        <h2 style="margin:0 0 16px;color:#18181b">Holiday Reminder</h2>
        <p>Hi ${firstName}, this is a reminder that your holiday starts in 3 days.</p>
        <table style="margin:16px 0;font-size:14px">
          <tr><td style="padding:4px 16px 4px 0;color:#6b7280">Dates</td><td>${dateRange(startDate, endDate)}</td></tr>
          <tr><td style="padding:4px 16px 4px 0;color:#6b7280">Days</td><td>${days ?? "—"}</td></tr>
          <tr><td style="padding:4px 16px 4px 0;color:#6b7280">Type</td><td>${leaveType}</td></tr>
        </table>
        ${cta("View My Holiday", `${appLink(baseUrl, "/holiday")}`)}
      `, orgName),
    });
  } catch (e) {
    console.error("[email] sendHolidayReminderEmail failed:", e);
  }
}
