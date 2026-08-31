"use client";

// CLE-199 — Per-member lookup client. A member picker + a
// plain-English summary generated in-browser from the assigned profile.
// The summary is copyable to clipboard for support conversations.

import { useMemo, useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Copy, CheckCheck } from "lucide-react";
import { TAB_KEYS, type TabKey } from "@/lib/rights-types";
import type { RightsProfileDto } from "../actions";

export interface MemberOption {
  memberId: string;
  name: string;
  email: string;
  profileId: string | null;
}

const TAB_LABEL: Record<TabKey, string> = {
  planner: "Planner",
  timesheet: "Timesheet",
  dashboard: "Dashboard",
  holiday: "Holiday",
  employment: "Employment",
  personal: "Personal",
  contacts: "Contacts",
  documents: "Documents",
  expenses: "Expenses",
  history: "History",
};

const SCOPE_LABEL = {
  self: "themselves",
  team: "members of their team",
  all: "all members of the organisation",
} as const;

/**
 * Turn a profile into an English paragraph. Keeps the wording flat —
 * no bullet points — so it reads like a support-friendly sentence.
 */
function summarise(member: MemberOption, profile: RightsProfileDto | undefined): string {
  if (!profile) {
    return `${member.name} has no User Rights profile assigned — the app will treat them as read-only. This shouldn't happen; assign them to a profile via Employment → User Rights.`;
  }

  const scope = SCOPE_LABEL[profile.crossUserAccess];
  const sentences: string[] = [];

  sentences.push(`${member.name} is on the ${profile.name} profile.`);

  const viewTabs: string[] = [];
  const updateTabs: string[] = [];
  for (const t of TAB_KEYS) {
    if (profile.tabs[t]?.view) viewTabs.push(TAB_LABEL[t]);
    if (profile.tabs[t]?.update) updateTabs.push(TAB_LABEL[t]);
  }
  if (viewTabs.length === 0) {
    sentences.push(`They cannot view any tabs on ${scope}.`);
  } else if (updateTabs.length === 0) {
    sentences.push(`They can view ${listJoin(viewTabs)} on ${scope}, but cannot make any edits.`);
  } else if (viewTabs.length === updateTabs.length) {
    sentences.push(`They can view and edit ${listJoin(updateTabs)} on ${scope}.`);
  } else {
    const viewOnly = viewTabs.filter((v) => !updateTabs.includes(v));
    sentences.push(
      `They can view and edit ${listJoin(updateTabs)} on ${scope}, and can view (but not edit) ${listJoin(viewOnly)}.`,
    );
  }

  const positive: string[] = [];
  const negative: string[] = [];
  const pushBoth = (label: string, on: boolean) => (on ? positive : negative).push(label);

  pushBoth("create new members", profile.canCreateUsers);
  pushBoth("invite members", profile.canInviteUsers);
  pushBoth("delete members", profile.canDeleteUsers);
  pushBoth("approve holiday requests", profile.canApproveHolidays);
  pushBoth("override notice/cover rules on holidays", profile.canOverrideHolidayRules);
  pushBoth("run standard reports", profile.canRunReports);
  pushBoth("run Admin-only reports", profile.canRunAdminReports);
  pushBoth("manage teams", profile.canManageTeams);
  pushBoth("edit organisation settings", profile.canEditOrgSettings);
  pushBoth("edit User Rights", profile.canEditRightsProfiles);
  pushBoth("manage billing", profile.canManageBilling);
  pushBoth("view audit logs", profile.canViewAuditLogs);
  pushBoth("view sensitive fields", profile.canViewSensitiveFields);
  pushBoth("edit sensitive fields", profile.canEditSensitiveFields);
  pushBoth("view organisation documents", profile.canViewOrganisationDocuments);
  pushBoth("manage deleted documents", profile.canManageDeletedDocuments);
  pushBoth("force-delete documents", profile.canForceDeleteDocuments);

  if (positive.length > 0) {
    sentences.push(`They can also ${listJoin(positive)}.`);
  }
  if (negative.length > 0) {
    sentences.push(`They cannot ${listJoin(negative)}.`);
  }

  return sentences.join(" ");
}

/** Join with commas + "and". "A, B, and C" (Oxford comma). */
function listJoin(items: string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

export function LookupClient({
  members,
  profiles,
}: {
  members: MemberOption[];
  profiles: RightsProfileDto[];
}) {
  const [memberId, setMemberId] = useState<string>("");
  const [copied, setCopied] = useState(false);

  const selectedMember = useMemo(
    () => members.find((m) => m.memberId === memberId),
    [members, memberId],
  );
  const selectedProfile = useMemo(
    () => profiles.find((p) => p.id === selectedMember?.profileId),
    [profiles, selectedMember?.profileId],
  );

  const summary = useMemo(
    () => (selectedMember ? summarise(selectedMember, selectedProfile) : ""),
    [selectedMember, selectedProfile],
  );

  async function handleCopy() {
    if (!summary) return;
    try {
      await navigator.clipboard.writeText(summary);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard may be unavailable outside https origins; noop.
    }
  }

  return (
    <div className="space-y-4">
      <Select value={memberId} onValueChange={setMemberId}>
        <SelectTrigger className="max-w-md">
          <SelectValue placeholder="Choose a member" />
        </SelectTrigger>
        <SelectContent>
          {members.length === 0 ? (
            <div className="p-2 text-xs text-muted-foreground">No members found.</div>
          ) : (
            members.map((m) => (
              <SelectItem key={m.memberId} value={m.memberId}>
                {m.name} ({m.email})
              </SelectItem>
            ))
          )}
        </SelectContent>
      </Select>

      {selectedMember && (
        <div className="rounded-lg border bg-card p-4 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-semibold">{selectedMember.name}</div>
              <div className="text-xs text-muted-foreground">{selectedMember.email}</div>
            </div>
            <Button variant="outline" size="sm" onClick={handleCopy}>
              {copied ? <CheckCheck className="h-4 w-4 mr-1" /> : <Copy className="h-4 w-4 mr-1" />}
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
          <p className="text-sm leading-relaxed">{summary}</p>
        </div>
      )}
    </div>
  );
}
