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
//   • The admin daily summary (notify_admin_doc_digest) — items NEW since
//     the last summary: expired, overdue for review, entering the 30-day
//     expiry window, awaiting verification, missing required
//     certificates / RTW evidence, plus organisation documents.
//       - Member-document items go to signed-in members whose profile has
//         Documents-tab update and team/all scope (team = own team).
//       - Organisation-document items go to members who can manage
//         organisation documents.
//
// `document_email_log` records every touch / reported item, so a re-run
// on the same night sends nothing and items appear in one summary only.
// Sends are not audited. If RESEND_API_KEY is missing the whole run is
// skipped (nothing logged), so nothing is lost before email is set up.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  sendNightlyDocumentsEmail,
  type AdminDigestSection,
  type MemberAckItem,
  type MemberExpiryItem,
} from "@/lib/email";
import { _getOutstandingAcknowledgementsForMany } from "@/app/(dashboard)/documents/acknowledgement-actions-impl";
import type { OrgDocMember } from "@/lib/org-doc-audience";
import { DOCUMENT_TYPE_LABEL } from "@/app/(dashboard)/settings/documents/subtype-types";
import { computeMemberDocAttention } from "@/lib/documents-attention";

export interface NotifyResult {
  skipped?: string;
  organisations: number;
  emailsSent: number;
  errors: string[];
}

type LogKind = "member_ack" | "member_expiry" | "admin_item";

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

function addDaysIso(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysBetween(fromIso: string, toIso: string): number {
  const a = Date.UTC(+fromIso.slice(0, 4), +fromIso.slice(5, 7) - 1, +fromIso.slice(8, 10));
  const b = Date.UTC(+toIso.slice(0, 4), +toIso.slice(5, 7) - 1, +toIso.slice(8, 10));
  return Math.round((b - a) / 86_400_000);
}

function fmt(iso: string): string {
  return new Date(iso.slice(0, 10) + "T00:00:00Z").toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
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

/** One summary line plus where it goes and how it's logged. */
interface DigestItem {
  section: "expired" | "review" | "missing" | "verification" | "expiring" | "org";
  scope: "member" | "organisation";
  /** Member the item is about (member-scope only) — drives team scoping. */
  memberId: string | null;
  documentId: string | null;
  cycleKey: string;
  text: string;
  detail: string | null;
  path: string;
  /** Org items: red when expired / overdue, amber when expiring. */
  urgent: boolean;
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

  const { data: orgs, error } = await admin
    .from("organisations")
    .select("id, name, notify_member_doc_acks, notify_member_doc_expiry, notify_admin_doc_digest");
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
  const nameOf = (id: string | null) => {
    const m = id ? memberById.get(id) : undefined;
    if (!m) return "Unknown";
    return `${m.known_as?.trim() || m.first_name || ""} ${m.last_name ?? ""}`.trim() || "Unknown";
  };

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

  const soon = addDaysIso(today, 30);
  const signedIn = members.filter((m) => m.user_id !== null && !!m.email);

  // Per-recipient email parts.
  const ackByMember = new Map<string, { items: MemberAckItem[]; path: string; logs: NewLog[] }>();
  const expiryByMember = new Map<string, { items: MemberExpiryItem[]; logs: NewLog[] }>();
  const digestByMember = new Map<string, AdminDigestSection[]>();
  const itemLogs: NewLog[] = [];

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

  // ---- Admin daily summary --------------------------------------------------
  if (org.notify_admin_doc_digest) {
    const items: DigestItem[] = [];
    // Organisation documents (counted once each, not per audience member).
    for (const d of docs) {
      if (d.owner_scope !== "organisation") continue;
      const st = d.subtype_id ? subtypeById.get(d.subtype_id) : undefined;
      const subtypeName = st?.name ?? (st ? DOCUMENT_TYPE_LABEL[st.type as keyof typeof DOCUMENT_TYPE_LABEL] : null) ?? "Document";
      const expired = d.expires_on !== null && d.expires_on <= today;

      {
        let cycle: string | null = null;
        let detail = "";
        let urgent = false;
        if (expired) {
          cycle = `expired:${d.expires_on}`;
          detail = `${subtypeName} · expired ${fmt(d.expires_on!)}`;
          urgent = true;
        } else if (d.next_review_on !== null && d.next_review_on <= today) {
          cycle = `review:${d.next_review_on}`;
          detail = `${subtypeName} · review was due ${fmt(d.next_review_on)}`;
          urgent = true;
        } else if (d.expires_on !== null && d.expires_on <= soon) {
          cycle = `expiring:${d.expires_on}`;
          detail = `${subtypeName} · expires ${fmt(d.expires_on)}`;
        }
        if (cycle && !hasLog("admin_item", null, d.id, cycle)) {
          items.push({
            section: "org", scope: "organisation", memberId: null, documentId: d.id,
            cycleKey: cycle, text: d.file_name, detail, path: "/documents/organisation", urgent,
          });
        }
      }
    }

    // Member documents — from the shared attention items. Each item
    // appears in one summary per state (logged by cycle key); missing
    // items are logged per member × subtype and cleared when the gap
    // closes so a later gap is reported again.
    const currentMissing = new Set<string>();
    for (const m of members) {
      const who = nameOf(m.id);
      for (const it of attention.get(m.id) ?? []) {
        const base = {
          scope: "member" as const,
          memberId: m.id,
          documentId: it.documentId,
          path: `/members/${m.id}/docs?tab=${memberDocsTab(it.subtypeType)}`,
          urgent: false,
          text: `${who} — ${it.subtypeName}`,
        };
        const s = it.statuses;
        if (s.includes("not_uploaded")) {
          const cycle = it.key.startsWith("rtw:") ? `missing:${m.id}:rtw` : `missing:${m.id}:${it.subtypeId}`;
          currentMissing.add(cycle);
          if (!hasLog("admin_item", null, null, cycle)) {
            items.push({ ...base, section: "missing", documentId: null, cycleKey: cycle, detail: null, path: `/members/${m.id}/docs#required-documents` });
          }
          continue;
        }
        if (!it.documentId) continue;
        if (s.includes("expired") && it.expiresOn) {
          const cycle = `expired:${it.expiresOn}`;
          if (!hasLog("admin_item", null, it.documentId, cycle)) {
            items.push({ ...base, section: "expired", cycleKey: cycle, detail: `${it.fileName} · expired ${fmt(it.expiresOn)}` });
          }
        } else if (s.includes("overdue_review") && it.nextReviewOn) {
          const cycle = `review:${it.nextReviewOn}`;
          if (!hasLog("admin_item", null, it.documentId, cycle)) {
            items.push({ ...base, section: "review", cycleKey: cycle, detail: `${it.fileName} · review was due ${fmt(it.nextReviewOn)}` });
          }
        } else if (s.includes("expiring_soon") && it.expiresOn) {
          const cycle = `expiring:${it.expiresOn}`;
          if (!hasLog("admin_item", null, it.documentId, cycle)) {
            items.push({ ...base, section: "expiring", cycleKey: cycle, detail: `${it.fileName} · expires ${fmt(it.expiresOn)}` });
          }
        }
        if (s.includes("pending_verification") && !hasLog("admin_item", null, it.documentId, "verification")) {
          items.push({ ...base, section: "verification", cycleKey: "verification", detail: `${it.fileName} · uploaded ${fmt(it.uploadedAt ?? today)}` });
        }
      }
    }
    const staleMissing = logs.filter(
      (l) => l.kind === "admin_item" && l.cycle_key.startsWith("missing:") && !currentMissing.has(l.cycle_key),
    );
    if (staleMissing.length > 0) {
      const { error: delErr } = await admin
        .from("document_email_log")
        .delete()
        .eq("organisation_id", orgId)
        .eq("kind", "admin_item")
        .in("dedupe_key", staleMissing.map((l) => l.dedupe_key));
      if (delErr) errors.push(`org ${orgId} missing cleanup: ${delErr.message}`);
    }

    // Who sees what.
    const SECTION_META: Record<DigestItem["section"], { title: string; tone: "red" | "amber" }> = {
      expired: { title: "Expired", tone: "red" },
      review: { title: "Overdue for review", tone: "red" },
      missing: { title: "Missing required documents", tone: "red" },
      verification: { title: "Awaiting verification", tone: "red" },
      expiring: { title: "Expiring within 30 days", tone: "amber" },
      org: { title: "Organisation documents", tone: "amber" },
    };
    const ORDER: DigestItem["section"][] = ["expired", "review", "missing", "verification", "expiring", "org"];

    for (const m of signedIn) {
      const p = m.rights_profile_id ? profileById.get(m.rights_profile_id) : undefined;
      if (!p) continue;
      const docsUpdate = p.tab_matrix?.documents?.update === true;
      const scope = p.cross_user_access;
      const seesMember = (it: DigestItem) => {
        if (!docsUpdate || scope === "self") return false;
        if (scope === "all") return true;
        const owner = it.memberId ? memberById.get(it.memberId) : undefined;
        return !!owner && owner.team_id !== null && owner.team_id === m.team_id;
      };
      const mine = items.filter((it) =>
        it.scope === "organisation" ? p.can_manage_organisation_documents === true : seesMember(it),
      );
      if (mine.length === 0) continue;
      const sections: AdminDigestSection[] = ORDER.map((key) => {
        const lines = mine.filter((it) => it.section === key);
        const meta = SECTION_META[key];
        const tone = key === "org" && lines.some((l) => l.urgent) ? "red" : meta.tone;
        return { title: meta.title, tone, lines: lines.map((l) => ({ text: l.text, detail: l.detail, path: l.path })) };
      }).filter((s) => s.lines.length > 0);
      digestByMember.set(m.id, sections);
    }

    for (const it of items) {
      itemLogs.push({
        organisation_id: orgId,
        kind: "admin_item",
        recipient_member_id: null,
        document_id: it.documentId,
        cycle_key: it.cycleKey,
        dedupe_key: dedupeKey(null, it.documentId, it.cycleKey),
      });
    }
  }

  // ---- Send: one email per person ------------------------------------------
  let sent = 0;
  const memberLogs: NewLog[] = [];
  const recipients = new Set<string>([...ackByMember.keys(), ...expiryByMember.keys(), ...digestByMember.keys()]);
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
      digestSections: digestByMember.get(id) ?? [],
      baseUrl,
    });
    if (!ok) continue;
    sent++;
    if (ack) memberLogs.push(...ack.logs);
    if (exp) memberLogs.push(...exp.logs);
  }

  // Member touches are logged only when their email went out (retried
  // tomorrow otherwise). Summary items are logged regardless — they were
  // either sent to every admin in scope or there was nobody to send to.
  const toLog = [...memberLogs, ...itemLogs];
  for (let i = 0; i < toLog.length; i += 500) {
    const { error: logErr } = await admin
      .from("document_email_log")
      .upsert(toLog.slice(i, i + 500), { onConflict: "organisation_id,kind,dedupe_key", ignoreDuplicates: true });
    if (logErr) errors.push(`org ${orgId} log: ${logErr.message}`);
  }

  return sent;
}
