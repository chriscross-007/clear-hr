"use client";

// CLE-199 — Comparison view client. Profiles as columns, rights as
// rows. Uses the same GROUPS + tab list the editor uses so labels
// stay in lockstep. ✓ / ✗ cells; the "differences only" filter drops
// rows where every profile shares the same value.

import { useState } from "react";
import { Check, X } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import type { RightsProfileDto } from "../actions";
import { TAB_KEYS, type TabKey } from "@/lib/rights-types";

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

// Every row in the comparison grid maps to a bool value per profile.
// `readValue` extracts the flag; identity is used to detect same-value
// rows so the "Only differences" toggle can hide them.
interface Row {
  key: string;
  label: string;
  category: string;
  readValue: (p: RightsProfileDto) => boolean;
}

const ROWS: Row[] = [
  { key: "cua_self", label: "Access: Self only", category: "Access", readValue: (p) => p.crossUserAccess === "self" },
  { key: "cua_team", label: "Access: My team", category: "Access", readValue: (p) => p.crossUserAccess === "team" },
  { key: "cua_all", label: "Access: Everyone", category: "Access", readValue: (p) => p.crossUserAccess === "all" },

  { key: "canCreateUsers", label: "Create users", category: "User management", readValue: (p) => p.canCreateUsers },
  { key: "canInviteUsers", label: "Invite users", category: "User management", readValue: (p) => p.canInviteUsers },
  { key: "canDeleteUsers", label: "Delete users", category: "User management", readValue: (p) => p.canDeleteUsers },

  { key: "canApproveHolidays", label: "Approve holidays", category: "Holiday", readValue: (p) => p.canApproveHolidays },
  { key: "canOverrideHolidayRules", label: "Override notice/cover rules", category: "Holiday", readValue: (p) => p.canOverrideHolidayRules },

  { key: "canRunReports", label: "Run standard reports", category: "Reports", readValue: (p) => p.canRunReports },
  { key: "canRunAdminReports", label: "Run Admin-only reports", category: "Reports", readValue: (p) => p.canRunAdminReports },

  { key: "canManageTeams", label: "Manage teams", category: "Governance", readValue: (p) => p.canManageTeams },
  { key: "canEditOrgSettings", label: "Edit organisation settings", category: "Governance", readValue: (p) => p.canEditOrgSettings },
  { key: "canEditRightsProfiles", label: "Edit User Rights", category: "Governance", readValue: (p) => p.canEditRightsProfiles },
  { key: "canManageBilling", label: "Manage billing", category: "Governance", readValue: (p) => p.canManageBilling },
  { key: "canViewAuditLogs", label: "View audit logs", category: "Governance", readValue: (p) => p.canViewAuditLogs },

  { key: "canViewSensitiveFields", label: "View sensitive fields", category: "Sensitive data", readValue: (p) => p.canViewSensitiveFields },
  { key: "canEditSensitiveFields", label: "Edit sensitive fields", category: "Sensitive data", readValue: (p) => p.canEditSensitiveFields },

  ...TAB_KEYS.flatMap((t): Row[] => [
    { key: `tab_${t}_view`, label: `${TAB_LABEL[t]} — view`, category: "Tabs", readValue: (p) => p.tabs[t]?.view === true },
    { key: `tab_${t}_update`, label: `${TAB_LABEL[t]} — update`, category: "Tabs", readValue: (p) => p.tabs[t]?.update === true },
  ]),
];

function rowIsIdentical(profiles: RightsProfileDto[], row: Row): boolean {
  if (profiles.length < 2) return true;
  const first = row.readValue(profiles[0]);
  return profiles.every((p) => row.readValue(p) === first);
}

export function CompareClient({ profiles }: { profiles: RightsProfileDto[] }) {
  const [differencesOnly, setDifferencesOnly] = useState(false);

  const visibleRows = differencesOnly
    ? ROWS.filter((r) => !rowIsIdentical(profiles, r))
    : ROWS;

  // Group rows by category to keep the grid readable.
  const grouped: { category: string; rows: Row[] }[] = [];
  for (const r of visibleRows) {
    const bucket = grouped.find((g) => g.category === r.category);
    if (bucket) bucket.rows.push(r);
    else grouped.push({ category: r.category, rows: [r] });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Switch id="diffs-only" checked={differencesOnly} onCheckedChange={setDifferencesOnly} />
        <Label htmlFor="diffs-only" className="text-sm cursor-pointer">Only show rows where Profiles differ</Label>
      </div>

      {profiles.length === 0 ? (
        <p className="text-sm text-muted-foreground">No profiles to compare.</p>
      ) : (
        <div className="rounded-md border overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted">
              <tr>
                <th className="text-left p-2 sticky left-0 bg-muted min-w-[16rem]">Right</th>
                {profiles.map((p) => (
                  <th key={p.id} className="text-center p-2 min-w-[7rem] font-medium">{p.name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {grouped.length === 0 ? (
                <tr>
                  <td colSpan={profiles.length + 1} className="p-4 text-center text-muted-foreground">
                    No rows to show. Every profile agrees on every right.
                  </td>
                </tr>
              ) : (
                grouped.flatMap((g) => [
                  <tr key={`h-${g.category}`}>
                    <td colSpan={profiles.length + 1} className="p-2 text-xs uppercase tracking-wide text-muted-foreground bg-muted/40 sticky left-0">
                      {g.category}
                    </td>
                  </tr>,
                  ...g.rows.map((r) => (
                    <tr key={r.key} className="border-t">
                      <td className="p-2 sticky left-0 bg-background">{r.label}</td>
                      {profiles.map((p) => {
                        const v = r.readValue(p);
                        return (
                          <td key={p.id} className="text-center p-2">
                            {v ? (
                              <Check className="h-4 w-4 text-green-600 inline" />
                            ) : (
                              <X className="h-4 w-4 text-muted-foreground/50 inline" />
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  )),
                ])
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
