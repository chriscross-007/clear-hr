"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { CalendarDays, ChevronDown, ChevronRight, Filter, Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { StickyPageHeader } from "@/components/ui/sticky-page-header";

interface AuditEntry {
  id: string;
  actor_id: string;
  actor_name: string;
  action: string;
  target_type: string;
  target_id: string | null;
  target_label: string | null;
  changes: Record<string, { old: unknown; new: unknown }> | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

interface Editor {
  id: string;
  name: string;
}

interface AuditClientProps {
  initialEntries: AuditEntry[];
  editors: Editor[];
}

const ACTION_LABELS: Record<string, string> = {
  "member.created": "Added Member",
  "member.updated": "Edited Member",
  "member.deleted": "Deleted Member",
  "member.invited": "Invited Member",
  "member.rights_profile_changed": "User Rights changed",
  "rights_profile.created": "User Rights profile created",
  "rights_profile.updated": "User Rights profile updated",
  "rights_profile.deleted": "User Rights profile deleted",
  "rights_profile.reordered": "User Rights list reordered",
  "document_subtype.created": "Document subtype created",
  "document_subtype.updated": "Document subtype updated",
  "document_subtype.deleted": "Document subtype deleted",
  "document.uploaded": "Document uploaded",
  "document.downloaded": "Document downloaded",
  "document.metadata_updated": "Document metadata updated",
  "document.deleted": "Document moved to Trash",
  "document.force_deleted": "Document force-deleted",
  "document.restored": "Document restored from Trash",
  "document.purged": "Document permanently deleted",
  "org.updated": "Edited Organisation",
  "team.created": "Created Team",
  "team.updated": "Edited Team",
  "team.deleted": "Deleted Team",
  "admin_profile.created": "Created Admin Profile",
  "admin_profile.updated": "Updated Admin Profile",
  "admin_profile.deleted": "Deleted Admin Profile",
  "employee_profile.created": "Created Employee Profile",
  "employee_profile.updated": "Updated Employee Profile",
  "employee_profile.deleted": "Deleted Employee Profile",
  "booking.submitted": "Submitted Booking",
  "booking.updated": "Updated Booking",
  "booking.resubmitted": "Resubmitted Booking",
  "booking.created": "Created Booking",
  "booking.approved": "Approved Booking",
  "booking.rejected": "Rejected Booking",
  "booking.cancelled": "Cancelled Booking",
  "booking.deleted": "Deleted Booking",
  "sick_details.created": "Created Sick Details",
  "sick_details.updated": "Updated Sick Details",
};

const FILTER_ACTIONS = [
  "member.created",
  "member.updated",
  "member.deleted",
  "member.invited",
  "member.rights_profile_changed",
  "rights_profile.created",
  "rights_profile.updated",
  "rights_profile.deleted",
  "rights_profile.reordered",
  "document_subtype.created",
  "document_subtype.updated",
  "document_subtype.deleted",
  "document.uploaded",
  "document.downloaded",
  "document.metadata_updated",
  "document.deleted",
  "document.force_deleted",
  "document.restored",
  "document.purged",
  "org.updated",
  "team.created",
  "team.updated",
  "team.deleted",
  "admin_profile.created",
  "admin_profile.updated",
  "admin_profile.deleted",
  "employee_profile.created",
  "employee_profile.updated",
  "employee_profile.deleted",
  "booking.submitted",
  "booking.updated",
  "booking.resubmitted",
  "booking.created",
  "booking.approved",
  "booking.rejected",
  "booking.cancelled",
  "booking.deleted",
  "sick_details.created",
  "sick_details.updated",
];

// CLE-201c — inlined legacy right-key → label lookup so we can drop
// `rights-config.ts`. These keys appear in historical audit rows
// written under the pre-Rights-Profiles-v2 model. New audit rows use
// the `<entity>.<verb>` action convention from the Audit spec.
const RIGHT_LABELS: Record<string, string> = {
  can_edit_organisation: "Edit Organisation",
  can_add_members: "Add Members",
  can_manage_members: "Manage Members",
  can_approve_holidays: "Approve Holidays",
  can_define_custom_fields: "Custom Field Definitions",
  can_see_currency: "See Currency Values",
  can_request_holidays: "Request Holidays",
  can_view_team_members: "View Team Members",
};

const FIELD_LABELS: Record<string, string> = {
  first_name: "First Name",
  last_name: "Last Name",
  email: "Email",
  role: "Role",
  team: "Team",
  team_id: "Team",
  teams: "Teams",
  payroll_number: "Payroll Number",
  invited_at: "Invited At",
  name: "Name",
  member_label: "Member Type",
  require_mfa: "Require MFA",
  member_count: "Members Used",
  max_employees: "Members Subscribed",
  admin_profile: "Admin Profile",
  employee_profile: "Employee Profile",
  rights: "Rights",
  rights_profile: "Rights Profile",
  cross_user_access: "Cross-user Access",
  can_create_users: "Create Users",
  can_invite_users: "Invite Users",
  can_delete_users: "Delete Users",
  can_approve_holidays: "Approve Holidays",
  can_override_holiday_rules: "Override Holiday Rules",
  can_run_reports: "Run Reports",
  can_run_admin_reports: "Run Admin Reports",
  can_manage_teams: "Manage Teams",
  can_edit_org_settings: "Edit Organisation Settings",
  can_edit_rights_profiles: "Edit User Rights",
  can_manage_billing: "Manage Billing",
  can_view_audit_logs: "View Audit Logs",
  can_view_sensitive_fields: "View Sensitive Fields",
  can_edit_sensitive_fields: "Edit Sensitive Fields",
  can_view_organisation_documents: "View Organisation Documents",
  can_manage_deleted_documents: "Manage Deleted Documents",
  can_force_delete_documents: "Force-Delete Documents",
  tab_matrix: "Employee Tabs",
  tab_planner: "Planner",
  tab_timesheet: "Timesheet",
  tab_dashboard: "Dashboard",
  tab_holiday: "Holiday Periods",
  tab_employment: "Employment",
  tab_personal: "Personal",
  tab_contacts: "Contacts",
  tab_documents: "Documents",
  tab_expenses: "Expenses",
  tab_history: "History",
  member: "Member",
  type_subtype: "Type / Subtype",
  file_size: "File size",
  mode: "Mode",
  force_delete_reason: "Force-delete reason",
  subtype_id: "Subtype",
  expires_on: "Expires on",
  is_default: "Is Default",
  order: "Order",
  sort_order: "Sort Order",
  rank: "Rank",
  clocked_at: "clocked at",
  inferred_type: "inferred type",
  start_date: "Start Date",
  end_date: "End Date",
  start_half: "Start Half-Day",
  end_half: "End Half-Day",
  days_deducted: "Days Deducted",
  leave_reason: "Leave Reason",
  status: "Status",
  note: "Note",
  approver_note: "Approver Note",
  self_cert_required: "Self-Cert Required",
  self_cert_received_date: "Self-Cert Received",
  btw_required: "BTW Required",
  btw_date: "BTW Date",
  btw_completed: "BTW Completed",
  med_cert_required: "Med Cert Required",
  med_cert_received_date: "Med Cert Received",
  is_paid: "Paid",
  hr_approved: "HR Approved",
  completion_status: "Completion Status",
};

const HIDDEN_METADATA_KEYS = new Set(["clocking_date", "member_id", "member_name"]);
const HIDDEN_CHANGE_KEYS = new Set(["member_id"]);

function formatRightValue(val: unknown): string {
  if (val === true) return "Yes";
  if (val === false) return "No";
  if (val === null || val === undefined) return "—";
  return String(val);
}

function isRightsObject(val: unknown): val is Record<string, unknown> {
  return (
    typeof val === "object" &&
    val !== null &&
    !Array.isArray(val) &&
    Object.keys(val).length > 0
  );
}

function formatRightsObject(rights: Record<string, unknown>): string {
  const enabled = Object.entries(rights)
    .filter(([, v]) => v === true)
    .map(([k]) => RIGHT_LABELS[k] ?? k);
  return enabled.length > 0 ? enabled.join(", ") : "None";
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) return value.length === 0 ? "None" : value.join(", ");
  if (isRightsObject(value)) return formatRightsObject(value);
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) {
    return new Date(value).toLocaleString("en-GB", {
      day: "2-digit", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit", timeZone: "UTC",
    });
  }
  return String(value);
}

/** Shows only the rights that differ between old and new. */
function RightsDiff({
  oldRights,
  newRights,
}: {
  oldRights: Record<string, unknown>;
  newRights: Record<string, unknown>;
}) {
  const allKeys = Array.from(
    new Set([...Object.keys(oldRights), ...Object.keys(newRights)])
  );
  const changed = allKeys.filter((k) => oldRights[k] !== newRights[k]);
  if (changed.length === 0) {
    return <span className="text-muted-foreground">No rights changed</span>;
  }
  return (
    <div className="space-y-0.5 pl-2 border-l ml-1">
      {changed.map((key) => (
        <div key={key} className="flex gap-2 text-xs">
          <span className="min-w-[140px] text-muted-foreground">
            {RIGHT_LABELS[key] ?? key}:
          </span>
          <span className="text-red-600 dark:text-red-400">
            {formatRightValue(oldRights[key])}
          </span>
          <span className="text-muted-foreground">&rarr;</span>
          <span className="text-green-600 dark:text-green-400">
            {formatRightValue(newRights[key])}
          </span>
        </div>
      ))}
    </div>
  );
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function ChangeSummary({ changes }: { changes: Record<string, { old: unknown; new: unknown }> }) {
  const visible = Object.entries(changes).filter(([field]) => !HIDDEN_CHANGE_KEYS.has(field));
  return (
    <span className="text-muted-foreground">
      {visible.map(([field, { old: oldVal, new: newVal }], i) => {
        const label = FIELD_LABELS[field] ?? field;
        // For rights objects, just say "X rights changed" rather than dumping the blob
        if (field === "rights" && isRightsObject(oldVal) && isRightsObject(newVal)) {
          const changedCount = Array.from(
            new Set([...Object.keys(oldVal), ...Object.keys(newVal)])
          ).filter((k) => oldVal[k] !== newVal[k]).length;
          return (
            <span key={field}>
              {i > 0 && ", "}
              {label}: {changedCount} right{changedCount !== 1 ? "s" : ""} changed
            </span>
          );
        }
        return (
          <span key={field}>
            {i > 0 && ", "}
            {label}:{" "}
            <span className="opacity-60">{formatValue(oldVal)}</span>
            {" → "}
            <span>{formatValue(newVal)}</span>
          </span>
        );
      })}
    </span>
  );
}

function ChangeDetail({ changes }: { changes: Record<string, { old: unknown; new: unknown }> }) {
  const visible = Object.entries(changes).filter(([field]) => !HIDDEN_CHANGE_KEYS.has(field));
  if (visible.length === 0) return null;
  return (
    <div className="mt-2 space-y-1.5 rounded-md border bg-muted/30 p-3 text-sm">
      {visible.map(([field, { old: oldVal, new: newVal }]) => {
        const label = FIELD_LABELS[field] ?? field;
        // For rights objects, expand to a per-right diff
        if (field === "rights" && isRightsObject(oldVal) && isRightsObject(newVal)) {
          return (
            <div key={field}>
              <span className="font-medium">{label}:</span>
              <RightsDiff oldRights={oldVal} newRights={newVal} />
            </div>
          );
        }
        return (
          <div key={field} className="flex gap-2">
            <span className="font-medium min-w-[120px]">{label}:</span>
            <span className="text-red-600 dark:text-red-400">{formatValue(oldVal)}</span>
            <span className="text-muted-foreground">&rarr;</span>
            <span className="text-green-600 dark:text-green-400">{formatValue(newVal)}</span>
          </div>
        );
      })}
    </div>
  );
}

function MetadataDetail({ metadata }: { metadata: Record<string, unknown> }) {
  const entries = Object.entries(metadata).filter(([field]) => !HIDDEN_METADATA_KEYS.has(field));
  if (entries.length === 0) return null;
  return (
    <div className="mt-2 space-y-1 rounded-md border bg-muted/30 p-3 text-sm">
      {entries.map(([field, value]) => (
        <div key={field} className="flex gap-2">
          <span className="font-medium min-w-[120px]">{FIELD_LABELS[field] ?? field}:</span>
          <span>{formatValue(value)}</span>
        </div>
      ))}
    </div>
  );
}

const STORAGE_KEY = "clearhr-audit-verbose";

export function AuditClient({ initialEntries, editors }: AuditClientProps) {
  const router = useRouter();
  const [entries] = useState<AuditEntry[]>(initialEntries);
  const [selectedActions, setSelectedActions] = useState<Set<string>>(new Set());
  const [selectedEditorIds, setSelectedEditorIds] = useState<Set<string>>(new Set());
  const [subjectSearch, setSubjectSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [verbose, setVerbose] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  // Load persisted preference
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "true") setVerbose(true);
  }, []);

  function handleVerboseChange(checked: boolean) {
    setVerbose(checked);
    localStorage.setItem(STORAGE_KEY, String(checked));
    // Clear manual overrides when switching mode
    setExpandedIds(new Set());
  }

  function toggleEditor(editorId: string) {
    setSelectedEditorIds((prev) => {
      const next = new Set(prev);
      if (next.has(editorId)) {
        next.delete(editorId);
      } else {
        next.add(editorId);
      }
      return next;
    });
  }

  function toggleAction(action: string) {
    setSelectedActions((prev) => {
      const next = new Set(prev);
      if (next.has(action)) {
        next.delete(action);
      } else {
        next.add(action);
      }
      return next;
    });
  }

  const subjectLower = subjectSearch.trim().toLowerCase();

  const filteredEntries = entries.filter((e) => {
    if (selectedActions.size > 0 && !selectedActions.has(e.action)) return false;
    if (selectedEditorIds.size > 0 && !selectedEditorIds.has(e.actor_id)) return false;
    if (subjectLower && !(e.target_label ?? "").toLowerCase().includes(subjectLower)) return false;
    if (dateFrom) {
      const from = new Date(dateFrom);
      from.setHours(0, 0, 0, 0);
      if (new Date(e.created_at) < from) return false;
    }
    if (dateTo) {
      const to = new Date(dateTo);
      to.setHours(23, 59, 59, 999);
      if (new Date(e.created_at) > to) return false;
    }
    return true;
  });

  function toggleExpanded(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8">
      <StickyPageHeader>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Audit Trail</h1>
        <div className="flex items-center gap-2">
          <Label htmlFor="audit-verbose" className="text-sm text-muted-foreground">
            {verbose ? "Verbose" : "Condensed"}
          </Label>
          <Switch
            id="audit-verbose"
            checked={verbose}
            onCheckedChange={handleVerboseChange}
          />
        </div>
      </div>
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="text"
            placeholder="Search member..."
            value={subjectSearch}
            onChange={(e) => setSubjectSearch(e.target.value)}
            className="w-[200px] pl-8 pr-8"
          />
          {subjectSearch && (
            <button
              type="button"
              onClick={() => setSubjectSearch("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="w-[200px] justify-between">
                <span className="truncate">
                  {selectedEditorIds.size === 0
                    ? "All editors"
                    : selectedEditorIds.size === 1
                      ? editors.find((e) => selectedEditorIds.has(e.id))?.name ?? "1 editor"
                      : `${selectedEditorIds.size} editors`}
                </span>
                <Filter className="ml-2 h-4 w-4 shrink-0 opacity-50" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-[200px]">
              <DropdownMenuCheckboxItem
                checked={selectedEditorIds.size === 0}
                onCheckedChange={() => setSelectedEditorIds(new Set())}
                onSelect={(e) => e.preventDefault()}
              >
                All
              </DropdownMenuCheckboxItem>
              {editors.map((editor) => (
                <DropdownMenuCheckboxItem
                  key={editor.id}
                  checked={selectedEditorIds.has(editor.id)}
                  onCheckedChange={() => toggleEditor(editor.id)}
                  onSelect={(e) => e.preventDefault()}
                >
                  {editor.name}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="w-[200px] justify-between">
                <span className="truncate">
                  {selectedActions.size === 0
                    ? "All actions"
                    : selectedActions.size === 1
                      ? ACTION_LABELS[[...selectedActions][0]] ?? "1 action"
                      : `${selectedActions.size} actions`}
                </span>
                <Filter className="ml-2 h-4 w-4 shrink-0 opacity-50" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-[200px]">
              <DropdownMenuCheckboxItem
                checked={selectedActions.size === 0}
                onCheckedChange={() => setSelectedActions(new Set())}
                onSelect={(e) => e.preventDefault()}
              >
                All
              </DropdownMenuCheckboxItem>
              {FILTER_ACTIONS.map((action) => (
                <DropdownMenuCheckboxItem
                  key={action}
                  checked={selectedActions.has(action)}
                  onCheckedChange={() => toggleAction(action)}
                  onSelect={(e) => e.preventDefault()}
                >
                  {ACTION_LABELS[action]}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <div className="flex items-center gap-1.5">
            <CalendarDays className="h-4 w-4 text-muted-foreground shrink-0" />
            <Input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="w-[140px]"
              placeholder="From"
            />
            <span className="text-muted-foreground text-sm">–</span>
            <Input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="w-[140px]"
            />
            {(dateFrom || dateTo) && (
              <button
                type="button"
                onClick={() => { setDateFrom(""); setDateTo(""); }}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
      </div>
      </StickyPageHeader>

      <div className="pb-8">
      {filteredEntries.length === 0 ? (
        <div className="rounded-md border p-8 text-center text-muted-foreground">
          No audit trail entries found
        </div>
      ) : (
        <div className="space-y-1">
          {filteredEntries.map((entry) => {
            const hasManualToggle = expandedIds.has(entry.id);
            const isExpanded = hasManualToggle ? !verbose : verbose;
            const visibleChanges = entry.changes
              ? Object.keys(entry.changes).filter((k) => !HIDDEN_CHANGE_KEYS.has(k))
              : [];
            const visibleMeta = entry.metadata
              ? Object.keys(entry.metadata).filter((k) => !HIDDEN_METADATA_KEYS.has(k))
              : [];
            const hasDetail = visibleChanges.length > 0 || visibleMeta.length > 0;

            return (
              <div
                key={entry.id}
                className="rounded-md border px-4 py-3"
              >
                <div
                  className="flex items-start gap-3"
                  onClick={() => hasDetail && toggleExpanded(entry.id)}
                >
                  <div className="mt-0.5 w-4 shrink-0">
                    {hasDetail &&
                      (isExpanded ? (
                        <ChevronDown className="h-4 w-4 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      ))}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <span className="text-muted-foreground">
                        {ACTION_LABELS[entry.action] ?? entry.action}
                      </span>
                      {entry.target_label && (
                        entry.target_id && (entry.action === "member.created" || entry.action === "member.updated") ? (
                          <button
                            className="cursor-pointer font-medium text-primary underline underline-offset-2"
                            onClick={(e) => {
                              e.stopPropagation();
                              router.push(`/employees?memberId=${entry.target_id}`);
                            }}
                          >
                            {entry.target_label}
                          </button>
                        ) : entry.target_id && entry.action === "Edited Timesheet" ? (
                          <button
                            className="cursor-pointer font-medium text-primary underline underline-offset-2"
                            onClick={(e) => {
                              e.stopPropagation();
                              const dateStr = entry.metadata?.clocking_date as string | undefined;
                              const weekParam = dateStr ? (() => {
                                const d = new Date(`${dateStr}T12:00:00Z`);
                                const day = d.getUTCDay();
                                d.setUTCDate(d.getUTCDate() + (day === 0 ? -6 : 1 - day));
                                return `?week=${d.toISOString().slice(0, 10)}`;
                              })() : "";
                              router.push(`/members/${entry.target_id}/timesheet${weekParam}`);
                            }}
                          >
                            {entry.target_label}
                          </button>
                        ) : (
                          <span className="font-medium">{entry.target_label}</span>
                        )
                      )}
                      {(entry.action === "member.created" || entry.action === "member.deleted") &&
                        entry.metadata?.member_count != null &&
                        entry.metadata?.max_employees != null && (
                          <span className="text-xs text-muted-foreground">
                            (now {String(entry.metadata.member_count)}/{String(entry.metadata.max_employees)})
                          </span>
                        )}
                    </div>
                    {entry.changes && !isExpanded && (
                      <div className="mt-0.5 text-xs">
                        <ChangeSummary changes={entry.changes} />
                      </div>
                    )}
                  </div>
                  <div className="shrink-0 text-xs whitespace-nowrap text-right">
                    <span className="font-medium text-foreground">{entry.actor_name}</span>
                    <span className="text-muted-foreground">{" · "}{formatDate(entry.created_at)}</span>
                  </div>
                </div>

                {isExpanded && entry.changes && Object.keys(entry.changes).length > 0 && (
                  <div className="ml-7">
                    <ChangeDetail changes={entry.changes} />
                  </div>
                )}
                {isExpanded && entry.metadata && Object.keys(entry.metadata).length > 0 && (
                  <div className="ml-7">
                    <MetadataDetail metadata={entry.metadata} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      </div>
    </div>
  );
}
