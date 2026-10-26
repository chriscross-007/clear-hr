// CLE-235 — Nightly document emails.
//
// Runs from /api/cron/documents-sweep after the status sweep. One email
// per person per night (`sendNightlyDocumentsEmail`), carrying:
//
//   • Their own part (members who have accepted their invite):
//       - Documents to acknowledge — first email the night after the
//         acknowledgement becomes outstanding, reminders 7 and 30 days
//         after that first email, then silent. Uses the shared
//         outstanding-ack core, so audience, HR-only and invited rules
//         match the app. (Org switch: notify_member_doc_acks.)
//       - Expiring soon — their own Certifications / RTW evidence,
//         30 / 14 / 3 days before expiry. Skipped when a newer document
//         of the same subtype supersedes it. (notify_member_doc_expiry.)
//
//   • The admin documents summary (notify_admin_doc_digest, 2026-10-26) —
//     a snapshot of the recipient's admin dashboard Documents card: every
//     member whose documents need attention (traffic light red / amber,
//     with the dashboard's description), organisation documents needing
//     attention, and the outstanding-acknowledgement count. Members / org
//     docs not in the previous summary are tagged "New". Sent whenever
//     there is something to show, so no email means the dashboard is clear.
//       - Members: signed-in recipients whose profile has Documents-tab
//         view and team / all scope (team = own team), same as the
//         dashboard. Org docs: can_manage_organisation_documents.
//
// Weekdays only (Mon–Fri, UK time) — Monday covers the weekend. Member
// touches due at the weekend go out on Monday.
//
// `document_email_log` records every member touch, so a re-run on the same
// night sends nothing; `organisations.doc_digest_snapshot` holds the
// previous summary (for "New" tags and the same-day re-run guard).
// Sends are not audited. If RESEND_API_KEY is missing the whole run is
// skipped (nothing logged), so nothing is lost before email is set up.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  docSummaryHasContent,
  sendNightlyDocumentsEmail,
  type DocSummary,
  type DocSummaryLine,
  type MemberAckItem,
  type MemberExpiryItem,
} from "@/lib/email";
import { trafficLightFromItems } from "@/lib/documents-traffic-light";
import { trafficLightTooltipText } from "@/lib/traffic-light-format";
import { deriveDocumentStatuses, STATUS_LABEL } from "@/lib/document-status";
import { pluralize } from "@/lib/label-utils";
import { _getOutstandingAcknowledgementsForMany } from "@/app/(dashboard)/documents/acknowledgement-actions-impl";
import { loadOrgDocMembers, type OrgDocMember } from "@/lib/org-doc-audience";
import { computeMemberDocAttention } from "@/lib/documents-attention";

export interface NotifyResult {
  skipped?: string;
  organisations: number;
  emailsSent: number;
  errors: string[];
}

type LogKind = "member_ack" | "member_expiry";

interface LogRow {
  kind: LogKind;
  recipient_member_id: string | null;
  document_id: string | null;
  cycle_key: string;
  dedupe_key: string;
  sent_at: string;
}

interface NewLog {
  organisation_id: string;
  kind: LogKind;
  recipient_member_id: string | null;
  document_id: string | null;
  cycle_key: string;
  dedupe_key: string;
}

function dedupeKey(recipient: string | null, documentId: string | null, cycle: string): string {
  return `${recipient ?? "-"}:${documentId ?? "-"}:${cycle}`;
}

function daysBetween(fromIso: string, toIso: string): number {
  const a = Date.UTC(+fromIso.slice(0, 4), +fromIso.slice(5, 7) - 1, +fromIso.slice(8, 10));
  const b = Date.UTC(+toIso.slice(0, 4), +toIso.slice(5, 7) - 1, +toIso.slice(8, 10));
  return Math.round((b - a) / 86_400_000);
}

/** Page through a select — PostgREST caps a response at 1000 rows. */
async function selectAll<T>(
  build: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const page = 1000;
  const out: T[] = [];
  for (let from = 0; ; from += page) {
    const { data, error } = await build(from, from + page - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < page) break;
  }
  return out;
}

/** Member Documents tab that holds a document of this type. */
function memberDocsTab(type: string): "certifications" | "employment" | "other" {
  if (type === "contract") return "employment";
  if (type === "attachment") return "other";
  return "certifications";
}

// ---------------------------------------------------------------------------
// Row shapes
// ---------------------------------------------------------------------------

interface OrgRow {
  id: string;
  name: string;
  notify_member_doc_acks: boolean;
  notify_member_doc_expiry: boolean;
  notify_admin_doc_digest: boolean;
  member_label: string | null;
  doc_digest_snapshot: DigestSnapshot | null;
}

interface DigestSnapshot {
  sentOn: string;
  memberIds: string[];
  orgDocIds: string[];
}

interface MemberRow {
  id: string;
  user_id: string | null;
  invited_at: string | null;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  known_as: string | null;
  team_id: string | null;
  rtw_not_required: boolean | null;
  rights_profile_id: string | null;
}

interface ProfileRow {
  id: string;
  cross_user_access: "self" | "team" | "all";
  can_view_organisation_documents: boolean;
  can_manage_organisation_documents: boolean;
  tab_matrix: Record<string, { view?: boolean; update?: boolean }> | null;
}

interface SubtypeRow {
  id: string;
  type: string;
  name: string;
  requires_verification: boolean;
  visible_to_member: boolean | null;
}

interface DocRow {
  id: string;
  owner_scope: "member" | "organisation";
  owner_id: string | null;
  subtype_id: string | null;
  file_name: string;
  uploaded_at: string;
  expires_on: string | null;
  next_review_on: string | null;
  verified_on: string | null;
  disposal_date: string | null;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function runDocumentNotifications(
  admin: SupabaseClient,
  opts: { baseUrl: string; today?: string },
): Promise<NotifyResult> {
  const result: NotifyResult = { organisations: 0, emailsSent: 0, errors: [] };
  if (!process.env.RESEND_API_KEY) {
    result.skipped = "RESEND_API_KEY not set";
    return result;
  }
  const today = opts.today ?? new Date().toISOString().slice(0, 10);

  // Weekdays only (UK time). Monday's run covers the weekend.
  const weekday = new Date(today + "T12:00:00Z").toLocaleDateString("en-GB", { weekday: "short", timeZone: "Europe/London" });
  if (weekday === "Sat" || weekday === "Sun") {
    result.skipped = "Weekend — document emails go out Monday to Friday";
    return result;
  }

  const { data: orgs, error } = await admin
    .from("organisations")
    .select("id, name, member_label, doc_digest_snapshot, notify_member_doc_acks, notify_member_doc_expiry, notify_admin_doc_digest");
  if (error) {
    result.errors.push(`organisations: ${error.message}`);
    return result;
  }

  for (const org of (orgs ?? []) as OrgRow[]) {
    if (!org.notify_member_doc_acks && !org.notify_member_doc_expiry && !org.notify_admin_doc_digest) continue;
    try {
      result.emailsSent += await notifyOrganisation(admin, org, today, opts.baseUrl, result.errors);
      result.organisations++;
    } catch (e) {
      result.errors.push(`org ${org.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Per organisation
// ---------------------------------------------------------------------------

async function notifyOrganisation(
  admin: SupabaseClient,
  org: OrgRow,
  today: string,
  baseUrl: string,
  errors: string[],
): Promise<number> {
  const orgId = org.id;

  // ---- Load everything once -------------------------------------------------
  const members = await selectAll<MemberRow>((a, b) =>
    admin
      .from("members")
      .select("id, user_id, invited_at, email, first_name, last_name, known_as, team_id, rtw_not_required, rights_profile_id")
      .eq("organisation_id", orgId)
      .order("id")
      .range(a, b),
  );
  if (members.length === 0) return 0;
  const memberById = new Map(members.map((m) => [m.id, m]));

  const { data: profileRows } = await admin
    .from("rights_profiles")
    .select("id, cross_user_access, can_view_organisation_documents, can_manage_organisation_documents, tab_matrix")
    .eq("organisation_id", orgId);
  const profileById = new Map(((profileRows ?? []) as ProfileRow[]).map((p) => [p.id, p]));

  const { data: subtypeRows } = await admin
    .from("document_subtype")
    .select("id, type, name, requires_verification, visible_to_member")
    .eq("organisation_id", orgId);
  const subtypes = (subtypeRows ?? []) as SubtypeRow[];
  const subtypeById = new Map(subtypes.map((s) => [s.id, s]));

  const allDocs = await selectAll<DocRow>((a, b) =>
    admin
      .from("document")
      .select("id, owner_scope, owner_id, subtype_id, file_name, uploaded_at, expires_on, next_review_on, verified_on, disposal_date")
      .eq("organisation_id", orgId)
      .is("archived_at", null) // CLE-233
      .order("id")
      .range(a, b),
  );
  const queued = new Set(
    (
      await selectAll<{ document_id: string }>((a, b) =>
        admin.from("disposal_queue").select("document_id").eq("organisation_id", orgId).order("document_id").range(a, b),
      )
    ).map((r) => r.document_id),
  );
  const docs = allDocs.filter(
    (d) => !queued.has(d.id) && (d.disposal_date === null || d.disposal_date > today),
  );

  const logs = await selectAll<LogRow>((a, b) =>
    admin
      .from("document_email_log")
      .select("kind, recipient_member_id, document_id, cycle_key, dedupe_key, sent_at")
      .eq("organisation_id", orgId)
      .order("id")
      .range(a, b),
  );
  const logged = new Set(logs.map((l) => `${l.kind}|${l.dedupe_key}`));
  const hasLog = (kind: LogKind, recipient: string | null, documentId: string | null, cycle: string) =>
    logged.has(`${kind}|${dedupeKey(recipient, documentId, cycle)}`);

  // Member-document attention items — the shared rule used by the admin
  // dashboard and the Compliance page, so the summary always agrees
  // with them (src/lib/documents-attention.ts).
  const attention = await computeMemberDocAttention(admin, orgId, members, { today });

  const signedIn = members.filter((m) => m.user_id !== null && !!m.email);

  // Per-recipient email parts.
  const ackByMember = new Map<string, { items: MemberAckItem[]; path: string; logs: NewLog[] }>();
  const expiryByMember = new Map<string, { items: MemberExpiryItem[]; logs: NewLog[] }>();
  const summaryByMember = new Map<string, DocSummary>();

  // ---- Member part: documents to acknowledge -------------------------------
  if (org.notify_member_doc_acks && signedIn.length > 0) {
    const asOrgDocMembers: OrgDocMember[] = signedIn.map((m) => {
      const p = m.rights_profile_id ? profileById.get(m.rights_profile_id) : undefined;
      return {
        id: m.id,
        teamId: m.team_id,
        rightsProfileId: m.rights_profile_id,
        signedIn: true,
        invited: true,
        canView: p?.can_view_organisation_documents === true,
        canManage: p?.can_manage_organisation_documents === true,
      };
    });
    const res = await _getOutstandingAcknowledgementsForMany(admin, orgId, asOrgDocMembers);
    if (!res.success) {
      errors.push(`org ${orgId} acks: ${res.error}`);
    } else {
      for (const [memberId, rows] of res.byMember) {
        const due: NewLog[] = [];
        const items: MemberAckItem[] = [];
        for (const r of rows) {
          const first = logs.find(
            (l) => l.kind === "member_ack" && l.recipient_member_id === memberId && l.document_id === r.documentId && l.cycle_key === "first",
          );
          let stage: "first" | "r7" | "r30" | null = null;
          if (!first) stage = "first";
          else {
            const age = daysBetween(first.sent_at.slice(0, 10), today);
            if (age >= 30) stage = hasLog("member_ack", memberId, r.documentId, "r30") ? null : "r30";
            else if (age >= 7) stage = hasLog("member_ack", memberId, r.documentId, "r7") ? null : "r7";
          }
          if (stage) {
            due.push({
              organisation_id: orgId,
              kind: "member_ack",
              recipient_member_id: memberId,
              document_id: r.documentId,
              cycle_key: stage,
              dedupe_key: dedupeKey(memberId, r.documentId, stage),
            });
          }
          items.push({ fileName: r.fileName, subtypeName: r.subtypeName, isNew: stage === "first" });
        }
        // Email only when something is due tonight; then list everything
        // outstanding so the member sees the full picture.
        if (due.length === 0) continue;
        const firstRow = rows[0];
        const tab = firstRow.ownerScope === "organisation" ? "org" : memberDocsTab(firstRow.subtypeType);
        ackByMember.set(memberId, { items, path: `/my-documents?tab=${tab}`, logs: due });
      }
    }
  }

  // ---- Member part: own certificates expiring ------------------------------
  if (org.notify_member_doc_expiry) {
    for (const m of signedIn) {
      for (const it of attention.get(m.id) ?? []) {
        // Only the member's own Certifications / RTW evidence — they can
        // renew those. Employment documents are HR's business.
        if (!it.documentId || !it.expiresOn || !it.statuses.includes("expiring_soon")) continue;
        if (it.subtypeType !== "certificate" && it.subtypeType !== "evidence") continue;
        if (it.hiddenFromOwner) continue;
        if (it.subtypeType === "evidence" && m.rtw_not_required) continue;
        const daysLeft = daysBetween(today, it.expiresOn);
        const stage = daysLeft <= 3 ? "3" : daysLeft <= 14 ? "14" : "30";
        const cycle = `${it.expiresOn}:${stage}`;
        if (hasLog("member_expiry", m.id, it.documentId, cycle)) continue;
        const entry = expiryByMember.get(m.id) ?? { items: [], logs: [] };
        entry.items.push({ fileName: it.fileName ?? "", subtypeName: it.subtypeName, expiresOn: it.expiresOn, daysLeft });
        entry.logs.push({
          organisation_id: orgId,
          kind: "member_expiry",
          recipient_member_id: m.id,
          document_id: it.documentId,
          cycle_key: cycle,
          dedupe_key: dedupeKey(m.id, it.documentId, cycle),
        });
        expiryByMember.set(m.id, entry);
      }
    }
  }

  // ---- Admin documents summary (snapshot of the dashboard) -----------------
  // Skipped when today's summary has already gone out (same-night re-run).
  const prev = org.doc_digest_snapshot;
  let snapshot: DigestSnapshot | null = null;
  if (org.notify_admin_doc_digest && prev?.sentOn !== today) {
    const label = (org.member_label?.trim() || "member").toLowerCase();
    const memberPlural = pluralize(label).toLowerCase();
    const showNew = !!prev;
    const prevMembers = new Set(prev?.memberIds ?? []);
    const prevOrgDocs = new Set(prev?.orgDocIds ?? []);

    // Members needing attention — the dashboard's traffic light rule.
    const dashName = (m: MemberRow) => `${m.first_name ?? ""} ${m.last_name ?? ""}`.trim() || "—";
    const memberLines = new Map<string, DocSummaryLine & { teamId: string | null; rank: number }>();
    for (const m of members) {
      const light = trafficLightFromItems(attention.get(m.id) ?? []);
      if (light.colour !== "red" && light.colour !== "amber") continue;
      memberLines.set(m.id, {
        text: dashName(m),
        detail: trafficLightTooltipText(light),
        path: `/members/${m.id}/docs#required-documents`,
        tone: light.colour,
        isNew: !prevMembers.has(m.id),
        teamId: m.team_id,
        rank: light.colour === "red" ? 0 : 1,
      });
    }

    // Organisation documents needing attention — counted once each.
    const rankOf = (st: string[]) =>
      st.includes("expired") ? 0 : st.includes("overdue_review") ? 1 : st.includes("expiring_soon") ? 2 : 3;
    const orgDocLines: Array<DocSummaryLine & { id: string; rank: number }> = [];
    for (const d of docs) {
      if (d.owner_scope !== "organisation") continue;
      const statuses = deriveDocumentStatuses({
        requiresVerification: false,
        verifiedOn: null,
        expiresOn: d.expires_on,
        nextReviewOn: d.next_review_on,
        today,
      });
      if (statuses.length === 0) continue;
      const st = d.subtype_id ? subtypeById.get(d.subtype_id) : undefined;
      const urgent = statuses.includes("expired") || statuses.includes("overdue_review");
      orgDocLines.push({
        id: d.id,
        text: st?.name ?? d.file_name,
        detail: `${d.file_name} · ${statuses.map((x) => STATUS_LABEL[x]).join(" · ")}`,
        path: "/documents/organisation",
        tone: urgent ? "red" : "amber",
        isNew: !prevOrgDocs.has(d.id),
        rank: rankOf(statuses),
      });
    }
    orgDocLines.sort((x, y) => x.rank - y.rank || x.text.localeCompare(y.text));

    // Outstanding acknowledgements per member (count only in the email).
    const ackCountByMember = new Map<string, number>();
    const ackRes = await _getOutstandingAcknowledgementsForMany(admin, orgId, await loadOrgDocMembers(admin, orgId));
    if (ackRes.success) {
      for (const [id, rows] of ackRes.byMember) ackCountByMember.set(id, rows.length);
    } else {
      errors.push(`org ${orgId} summary acks: ${ackRes.error}`);
    }

    for (const r of signedIn) {
      const p = r.rights_profile_id ? profileById.get(r.rights_profile_id) : undefined;
      if (!p) continue;
      const docsView = p.tab_matrix?.documents?.view === true;
      const scope = p.cross_user_access;
      const reachesMembers = docsView && scope !== "self";
      const inScope = (memberId: string, teamId: string | null) =>
        scope === "all" || (scope === "team" && (r.team_id === null ? memberId === r.id : teamId === r.team_id));

      const memberList = reachesMembers
        ? [...memberLines.entries()]
            .filter(([id, l]) => inScope(id, l.teamId))
            .map(([, l]) => l)
            .sort((x, y) => x.rank - y.rank || x.text.localeCompare(y.text))
        : [];
      const orgList = p.can_manage_organisation_documents ? orgDocLines : [];
      let acks: DocSummary["acks"] = null;
      if (reachesMembers) {
        let outstanding = 0;
        let who = 0;
        for (const m of members) {
          const n = ackCountByMember.get(m.id) ?? 0;
          if (n === 0 || !(m.id === r.id || inScope(m.id, m.team_id))) continue;
          outstanding += n;
          who++;
        }
        acks = outstanding > 0 ? { outstanding, members: who } : null;
      }
      const summary: DocSummary = {
        memberSingular: label,
        memberPlural,
        members: memberList,
        orgDocs: orgList,
        acks,
        showNew,
      };
      if (docSummaryHasContent(summary)) summaryByMember.set(r.id, summary);
    }

    snapshot = { sentOn: today, memberIds: [...memberLines.keys()], orgDocIds: orgDocLines.map((d) => d.id) };
  }

  // ---- Send: one email per person ------------------------------------------
  let sent = 0;
  const memberLogs: NewLog[] = [];
  const recipients = new Set<string>([...ackByMember.keys(), ...expiryByMember.keys(), ...summaryByMember.keys()]);
  for (const id of recipients) {
    const m = memberById.get(id);
    if (!m?.email || !m.user_id) continue;
    const ack = ackByMember.get(id);
    const exp = expiryByMember.get(id);
    const ok = await sendNightlyDocumentsEmail({
      to: m.email,
      firstName: m.known_as?.trim() || m.first_name || "there",
      orgName: org.name,
      ackItems: ack?.items ?? [],
      ackPath: ack?.path ?? "/my-documents",
      expiryItems: exp?.items ?? [],
      expiryPath: "/my-documents?tab=certifications",
      summary: summaryByMember.get(id) ?? null,
      baseUrl,
    });
    if (!ok) continue;
    sent++;
    if (ack) memberLogs.push(...ack.logs);
    if (exp) memberLogs.push(...exp.logs);
  }

  // Member touches are logged only when their email went out (retried
  // next run otherwise).
  const toLog = memberLogs;
  for (let i = 0; i < toLog.length; i += 500) {
    const { error: logErr } = await admin
      .from("document_email_log")
      .upsert(toLog.slice(i, i + 500), { onConflict: "organisation_id,kind,dedupe_key", ignoreDuplicates: true });
    if (logErr) errors.push(`org ${orgId} log: ${logErr.message}`);
  }

  // Remember this summary for tomorrow's "New" tags and the re-run guard.
  if (snapshot) {
    const { error: snapErr } = await admin.from("organisations").update({ doc_digest_snapshot: snapshot }).eq("id", orgId);
    if (snapErr) errors.push(`org ${orgId} summary snapshot: ${snapErr.message}`);
  }

  return sent;
}
